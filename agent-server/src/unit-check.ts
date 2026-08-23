#!/usr/bin/env node
/**
 * 无依赖单元检查(node ≥22 类型剥离直跑):
 *   node src/unit-check.ts
 * 覆盖:分词、BM25 相关性、resolvePage 定位、历史截断、限流/信号量。
 * 依赖网络(下载线上索引);不需要 npm 包与 ANTHROPIC_API_KEY。
 */
import { WikiIndex, tokenize, normalizeText } from './search.ts';
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
  } as unknown as import('node:http').ServerResponse;

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
  const sem = new Semaphore(2);
  const r1 = sem.tryAcquire();
  const r2 = sem.tryAcquire();
  check('信号量: 满 2 时拒绝第 3 个', r1 !== null && r2 !== null && sem.tryAcquire() === null);
  r1!();
  check('信号量: 释放后可再取', sem.tryAcquire() !== null);
  r2!();
}

console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`);
process.exit(failed === 0 ? 0 : 1);
