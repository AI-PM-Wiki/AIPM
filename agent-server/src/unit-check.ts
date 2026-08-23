#!/usr/bin/env node
/**
 * 无依赖单元检查(node ≥22 类型剥离直跑):
 *   node src/unit-check.ts
 * 覆盖:分词、BM25 相关性、resolvePage 定位、历史截断、限流/信号量。
 * 依赖网络(下载线上索引);不需要 npm 包与 ANTHROPIC_API_KEY。
 */
import { WikiIndex, tokenize, normalizeText, filterQueryTokens } from './search.ts';
import { truncateHistory } from './history.ts';
import { SlidingWindowLimiter, Semaphore, hashIp } from './rate-limit.ts';
import { initSseResponse, writeSseEvent, startHeartbeat } from './sse.ts';

// ---- SSE 帧写入(用 stub ServerResponse) ----
{
  const chunks: Buffer[] = [];
  const res = {
    _headers: {} as Record<string, unknown>,
    writeHead: (status: number, headers: Record<string, unknown>) => {
      res._headers = { status, ...headers };
    },
    flushHeaders: () => {},
    write: (c: string | Buffer) => {
      chunks.push(Buffer.from(c));
      return true;
    },
    end: () => {},
  } as unknown as import('node:http').ServerResponse & { _headers: Record<string, unknown> };

  initSseResponse(res, { 'Access-Control-Allow-Origin': 'https://hyc.ac' });
  check('SSE: Content-Type', res._headers['Content-Type'] === 'text/event-stream; charset=utf-8', String(res._headers['Content-Type']));
  writeSseEvent(res, 'ready', { requestId: 'abc' });
  writeSseEvent(res, 'delta', { text: '你好' });
  writeSseEvent(res, 'done', { costUsd: 0.01 });
  const text = Buffer.concat(chunks).toString('utf8');
  check('SSE: 事件帧格式', text.includes('event: ready\ndata: {"requestId":"abc"}\n\n'), JSON.stringify(text.slice(0, 60)));
  check('SSE: 多事件串联', text.includes('event: delta\ndata: {"text":"你好"}\n\n'), 'ok');
  const stopHb = startHeartbeat(res, 5);
  await new Promise((r) => setTimeout(r, 15));
  const withHb = Buffer.concat(chunks).toString('utf8');
  check('SSE: 心跳注释行', withHb.includes(': ping\n\n'), 'ok');
  stopHb();
}

let failed = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
  if (!cond) failed++;
}

// ---- 分词 ----
{
  const toks = tokenize('提示词工程');
  check(
    '分词: 提示词工程 → unigram+bigram',
    JSON.stringify(toks) === JSON.stringify(['提', '示', '词', '工', '程', '提示', '示词', '词工', '工程']),
    toks.join('/'),
  );
  const mixed = tokenize('RAG知识库问答');
  check('分词: 中英混合 RAG知识库问答', mixed.includes('rag') && mixed.includes('知识') && mixed.includes('库问') && mixed.includes('问答'), mixed.join('/'));
  const norm = normalizeText('ＲＡＧ ＡＢＣ１２３');
  check('归一化: 全角→半角+小写', norm === 'rag abc123', norm);
  const gpt = tokenize('GPT-4o 是什么');
  check('分词: gpt-4o → gpt/4o', gpt.includes('gpt') && gpt.includes('4o'), gpt.join('/'));
}

// ---- 索引加载与检索 ----
const index = new WikiIndex(
  process.env['SEARCH_INDEX_URL'] ?? 'https://hyc.ac/aipm/search/search_index.json',
  0,
  'https://hyc.ac/aipm',
);
await index.load();
{
  const stats = index.getStats();
  check('索引加载: 887 条目', stats.docCount >= 800, `docs=${stats.docCount}`);
  const hits = index.search('RAG 幻觉', 8);
  check('检索: RAG 幻觉 top8 非空', hits.length > 0, `top1=${hits[0]?.title}`);
  const top1 = hits[0]!;
  check('检索: 命中含 RAG 关键词', /rag/i.test(top1.title) || /rag/i.test(top1.snippet), top1.title);
  check('检索: snippet 无 HTML 标签', !top1.snippet.includes('<'), top1.snippet.slice(0, 40));
  check('检索: snippet ≤300 字', top1.snippet.length <= 300, `len=${top1.snippet.length}`);
  check('检索: url 完整', top1.url.startsWith('https://hyc.ac/aipm/'), top1.url);
}

// ---- 查询端停用词过滤 ----
{
  const df = new Map<string, number>([
    ['是', 550], ['什', 300], ['么', 350], ['什么', 300], ['么是', 23],
    ['rag', 96], ['提示', 120], ['工程', 200], ['产品', 300], ['经理', 150],
    ['幻', 200], ['觉', 300], ['幻觉', 250],
  ]);
  const N = 887;
  const f = (toks: string[]) => filterQueryTokens([...new Set(toks)], df, N);
  const ragQ = f(tokenize('什么是 RAG'));
  check('停用词: 什么是 RAG → 剔除 是/什么/么是/是什', !ragQ.includes('是') && !ragQ.includes('什么') && !ragQ.includes('么是') && !ragQ.includes('是什'), ragQ.join('/'));
  const pmQ = f(tokenize('产品经理'));
  check('停用词: 内容词 产品/经理 保留', pmQ.includes('产品') && pmQ.includes('经理'), pmQ.join('/'));
  const huanQ = f(tokenize('幻觉问题'));
  check('停用词: 内容词 幻觉 保留', huanQ.includes('幻觉'), huanQ.join('/'));
  const emptyQ = f(tokenize('是什么'));
  check('停用词: 虚词剔除后保留有区分度单字', emptyQ.join('/') === '什/么', emptyQ.join('/'));
  const allDropped = filterQueryTokens(['是', '的'], new Map([['是', 800], ['的', 700]]), 887);
  check('停用词: 全部被剔除时回退原 token', allDropped.join('') === '是的');
}

// ---- 标题加权 + 停用词过滤的端到端召回(线上索引) ----
{
  const rag = index.search('什么是 RAG', 8);
  const ragHit = rag.findIndex((h) => h.location.startsWith('ai/rag'));
  check('召回: 什么是 RAG → 正典 RAG 页进 top-5', ragHit >= 0 && ragHit < 5, `rank=${ragHit + 1}, top1=${rag[0]?.title}`);
  const rag2 = index.search('RAG 是什么', 8);
  const rag2Hit = rag2.findIndex((h) => h.location.startsWith('ai/rag'));
  check('召回: RAG 是什么 → 正典 RAG 页进 top-5', rag2Hit >= 0 && rag2Hit < 5, `rank=${rag2Hit + 1}`);
  const prompt = index.search('提示词工程', 8);
  check('召回: 提示词工程 → ai/prompting 第一', (prompt[0]?.location.startsWith('ai/prompting') ?? false), prompt[0]?.title);
  const kb = index.search('知识库问答', 8);
  check('召回: 知识库问答 → practice/kb-qa 第一', (kb[0]?.location.startsWith('practice/kb-qa') ?? false), kb[0]?.title);
  const halluc = index.search('幻觉问题怎么解决', 8);
  check(
    '召回: 幻觉问题 → top-8 含相关页(幻觉护栏/坑三)',
    halluc.some((h) => h.location.includes('幻觉护栏') || h.location.includes('lessons')),
    halluc[0]?.title,
  );
}

// ---- resolvePage ----
{
  const full = index.resolvePage('https://hyc.ac/aipm/ai/rag/');
  check('定位: 整页 URL → 命中', full !== null && full.text.length > 100, full?.title);
  check('定位: 整页含内容', (full?.text.length ?? 0) > 500, `len=${full?.text.length}`);
  const rel = index.resolvePage('ai/rag/');
  check('定位: 相对路径与整页一致', rel?.url === full?.url && rel?.text === full?.text, rel?.url);
  const noSlash = index.resolvePage('ai/rag');
  check('定位: 无尾斜杠兜底', noSlash !== null && noSlash.url.endsWith('ai/rag/'), noSlash?.url);
  const anchor = index.resolvePage('ai/rag/#rag-产品经理的评估视角');
  check('定位: 锚点节命中或回落整页', anchor !== null && anchor.text.length > 0, anchor?.title);
  const encoded = index.resolvePage('https://hyc.ac/aipm/ai/rag/#rag-%E4%BA%A7%E5%93%81%E5%8C%96%E5%AE%9E%E6%88%98');
  check('定位: 百分号编码锚点兜底', encoded !== null, encoded?.title);
  const root = index.resolvePage('https://hyc.ac/aipm');
  check('定位: 站点根', root !== null && root.url.endsWith('/aipm/'), root?.url);
  const missing = index.resolvePage('https://hyc.ac/aipm/no-such-page/');
  check('定位: 不存在页面 → null', missing === null);
  const longText = index.resolvePage('https://hyc.ac/aipm/case/teardown-chatgpt/');
  check('定位: 超长页 ≤12000 字截断', (longText?.text.length ?? 999999) <= 12_050, `len=${longText?.text.length}`);
}

// ---- 历史截断 ----
{
  const many = Array.from({ length: 10 }, (_, i) => ({ role: 'user' as const, content: `第${i}轮问题` }));
  const t1 = truncateHistory(many);
  check('历史: 只留最近 6 轮', t1.length === 6 && t1[0]!.content === '第4轮问题', `len=${t1.length}`);
  const big = [{ role: 'user' as const, content: '长'.repeat(3000) }, { role: 'assistant' as const, content: '答'.repeat(3000) }];
  const t2 = truncateHistory(big);
  check('历史: 每轮截 2000 字', t2.every((t) => t.content.length <= 2000), t2.map((t) => t.content.length).join(','));
  const manySmall = Array.from({ length: 8 }, (_, i) => ({ role: 'assistant' as const, content: 'x'.repeat(2000) }));
  const t3 = truncateHistory(manySmall);
  const total = t3.reduce((s, t) => s + t.content.length, 0);
  check('历史: 总量 ≤12000 字', total <= 12_000, `total=${total}, turns=${t3.length}`);
}

// ---- 限流 / 信号量 ----
{
  const lim = new SlidingWindowLimiter(3, 60_000);
  const key = hashIp('127.0.0.1');
  const got = [lim.tryAcquire(key), lim.tryAcquire(key), lim.tryAcquire(key)];
  check('限流: 窗口内放行 3 次', got.every(Boolean));
  check('限流: 第 4 次拒绝', !lim.tryAcquire(key));
  const lim2 = new SlidingWindowLimiter(1, 10);
  lim2.tryAcquire(key);
  await new Promise((r) => setTimeout(r, 25));
  check('限流: 窗口过期后可放行', lim2.tryAcquire(key));
  const sem = new Semaphore(2, { waitMs: 200, queueLimit: 2 });
  const r1 = await sem.acquire();
  const r2 = await sem.acquire();
  check('信号量: 前 2 个立即获得', typeof r1 === 'function' && typeof r2 === 'function');
  const t0 = Date.now();
  const w1 = await sem.acquire({ timeoutMs: 30 }).then(() => null, (e: unknown) => e);
  check('信号量: 排队超时(>25ms)拒绝', w1 instanceof Error && Date.now() - t0 >= 25);
  const w2 = sem.acquire();
  const w3 = sem.acquire();
  check('信号量: 排队中(深度 2/2)', sem.waitingCount === 2);
  const w4 = await sem.acquire().then(() => null, (e: unknown) => e);
  check(
    '信号量: 队列满拒绝 queue_full',
    w4 instanceof Error && (w4 as { code?: string }).code === 'queue_full',
  );
  r1!();
  const rel2 = await w2;
  check('信号量: 释放后排队者 FIFO 获得', typeof rel2 === 'function' && sem.waitingCount === 1);
  const ac = new AbortController();
  const w5 = sem.acquire({ signal: ac.signal });
  ac.abort();
  const w5r = await w5.then(() => 'granted', (e: unknown) => (e as { code?: string }).code);
  check('信号量: 排队中 abort 取消', w5r === 'aborted' && sem.waitingCount === 1);
  rel2!();
  const rel3 = await w3;
  rel3!();
  r2!();
  const r3 = await sem.acquire();
  check('信号量: 全部释放后可再取', typeof r3 === 'function' && sem.activeCount === 1);
  r3!();
}

console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`);
process.exit(failed === 0 ? 0 : 1);
