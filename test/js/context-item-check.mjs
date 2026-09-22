/*
  context-item.js 的行为断言(零依赖,node 直跑):

      node test/js/context-item-check.mjs

  test_agent_native.py 里那条 Python 用例会把本文件跑一遍并按退出码判定,所以
  这里不引 node:test,只按「有一条失败就 exit 1」写 —— 任何 ≥14 的 node 都能跑。
  浏览器脚本被当成 ESM 载入:context-item.js 是 IIFE,执行完把命名空间挂在
  window 上,这里先把 globalThis 顶上去当 window。
*/
globalThis.window = globalThis;

const url = new URL('../../docs/_static/js/context-item.js', import.meta.url);
await import(url.href);

const CTX = globalThis.__aipmContext;

let failed = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
  if (!cond) failed++;
};

check('模块挂在 window 上', CTX !== null && typeof CTX === 'object');
check('导出的入口齐全', ['forSelection', 'forAnnotation', 'upsert', 'remove', 'toPayload'].every((k) => typeof CTX[k] === 'function'));

/* ---- 划选 ---- */
{
  const selectors = [
    { type: 'TextQuoteSelector', exact: '检索增强生成把外部知识接进上下文。', prefix: '简单说,', suffix: '它由两段组成。' },
    { type: 'TextPositionSelector', start: 120, end: 138 },
  ];
  const item = CTX.forSelection({
    page: '/ai/rag/',
    title: '检索增强生成',
    quote: '检索增强生成把外部知识接进上下文。',
    selectors,
  });
  check('划选:造出条目', item !== null && item.kind === 'selection');
  check('划选:带上前后缀', item.prefix === '简单说,' && item.suffix === '它由两段组成。');
  check('划选:没有可见范围(那是批注才有的)', item.visibility === 'public' && item.body === '');

  const same = CTX.forSelection({
    page: '/ai/rag/',
    title: '检索增强生成',
    quote: '检索增强生成把外部知识接进上下文。',
    selectors,
  });
  check('划选:同一段选区 id 相同(连点两次不会排两条)', same.id === item.id, item.id);

  const moved = CTX.forSelection({
    page: '/ai/rag/',
    title: '检索增强生成',
    quote: '另一段话。',
    selectors: [{ type: 'TextPositionSelector', start: 300, end: 305 }],
  });
  check('划选:不同位置 id 不同', moved.id !== item.id);

  check('划选:引文为空 → 不造条目', CTX.forSelection({ page: '/ai/rag/', quote: '   ', selectors }) === null);
  check('划选:page 缺失 → 不造条目', CTX.forSelection({ page: '', quote: '有字', selectors }) === null);

  const noSlash = CTX.forSelection({ page: 'ai/rag', quote: '有字', selectors: [] });
  check('划选:路径归一成 /ai/rag/', noSlash.page === '/ai/rag/', noSlash.page);

  const overlong = CTX.forSelection({ page: '/ai/rag/', quote: 'x'.repeat(9000), selectors: [] });
  check('划选:超长引文按上限截断', overlong.quote.length === CTX.LIMITS.quote, String(overlong.quote.length));
}

/* ---- 批注:可见范围这道边界 ---- */
{
  const base = { page: '/ai/rag/', title: '检索增强生成', id: 'anno-1', quote: '召回率与精确率要一起看。', body: '这里的召回率是 top-k 口径。', color: 'blue' };

  check('批注:仅本机 → 造不出语境', CTX.forAnnotation({ ...base, visibility: 'local' }) === null);
  check('批注:可见范围缺失 → 造不出语境', CTX.forAnnotation({ ...base, visibility: undefined }) === null);
  check('批注:可见范围是没见过的值 → 造不出语境', CTX.forAnnotation({ ...base, visibility: 'PUBLIC' }) === null);

  const pub = CTX.forAnnotation({ ...base, visibility: 'public' });
  check('批注:公开可用', pub !== null && pub.visibility === 'public');
  check('批注:标签写明可见范围', CTX.labelOf(pub) === '批注 · 公开', CTX.labelOf(pub));

  const priv = CTX.forAnnotation({ ...base, visibility: 'private' });
  check('批注:私有可用', priv !== null && priv.visibility === 'private');
  check('批注:私有标签', CTX.labelOf(priv) === '批注 · 仅自己可见', CTX.labelOf(priv));

  check('批注:同一 id → 同一语境 id', priv.id === pub.id, pub.id);
  check('批注:没给 id 时按页+引文兜底', CTX.forAnnotation({ ...base, id: undefined, visibility: 'public' }).id.startsWith('anno:/ai/rag/#'));
  check('批注:引文与正文都空 → 不造条目', CTX.forAnnotation({ ...base, quote: '', body: '', visibility: 'public' }) === null);

  const pageComment = CTX.forAnnotation({ ...base, quote: '', body: '整页感想。', visibility: 'public' });
  check('批注:全页评论(只有正文)可用', pageComment !== null && pageComment.quote === '');
  check('批注:全页评论的摘要取正文', CTX.excerptOf(pageComment) === '整页感想。');
}

/* ---- 语境条:去重与移除(poco-ai/Agentero#614) ---- */
{
  let list = [];
  const a = CTX.forAnnotation({ page: '/ai/rag/', id: 'anno-a', quote: '第一段。', body: '', color: 'yellow', visibility: 'public' });
  const b = CTX.forAnnotation({ page: '/ai/rag/', id: 'anno-b', quote: '第二段。', body: '', color: 'yellow', visibility: 'public' });

  let res = CTX.upsert(list, a);
  check('语境条:第一条放进去', res.ok && res.added && res.items.length === 1);
  list = res.items;

  res = CTX.upsert(list, b);
  list = res.items;
  check('语境条:第二条放进去', res.ok && res.added && list.length === 2);

  /* 同一条来源再送一次:只刷新,不追加 */
  const aAgain = CTX.forAnnotation({ page: '/ai/rag/', id: 'anno-a', quote: '第一段(改过)。', body: '', color: 'yellow', visibility: 'public' });
  res = CTX.upsert(list, aAgain);
  list = res.items;
  check('语境条:同一条来源连送两次仍只有一条', res.ok && res.added === false && list.length === 2, `len=${list.length}`);
  check('语境条:刷新取新内容', list[0].quote === '第一段(改过)。', list[0].quote);
  check('语境条:刷新后位置不动', list[0].id === a.id && list[1].id === b.id);

  /* 删一条只删一条 */
  const left = CTX.remove(list, a.id);
  check('语境条:删一条只删这一条', left.length === 1 && left[0].id === b.id);
  check('语境条:remove 不改原数组', list.length === 2);

  /* 上限 */
  let full = [];
  for (let i = 0; i < CTX.MAX_ITEMS; i++) {
    full = CTX.upsert(full, CTX.forAnnotation({ page: '/ai/rag/', id: `n${i}`, quote: `第 ${i} 段。`, body: '', color: 'yellow', visibility: 'public' })).items;
  }
  check('语境条:放满到上限', full.length === CTX.MAX_ITEMS, String(full.length));
  const overflow = CTX.upsert(full, CTX.forAnnotation({ page: '/ai/rag/', id: 'n-extra', quote: '再来一段。', body: '', color: 'yellow', visibility: 'public' }));
  check('语境条:超上限时拒绝并给出原因', overflow.ok === false && overflow.code === 'context_full');
  check('语境条:拒绝时不改动原列表', overflow.items.length === CTX.MAX_ITEMS);
  const refreshAtFull = CTX.upsert(full, CTX.forAnnotation({ page: '/ai/rag/', id: 'n0', quote: '第 0 段(改过)。', body: '', color: 'yellow', visibility: 'public' }));
  check('语境条:满了仍能刷新已有条目', refreshAtFull.ok === true && refreshAtFull.added === false && refreshAtFull.items.length === CTX.MAX_ITEMS);

  check('语境条:null 条目被拒', CTX.upsert([], null).ok === false);
}

/* ---- 出网形态 ---- */
{
  const item = CTX.forAnnotation({ page: '/ai/rag/', title: '检索增强生成', id: 'anno-9', quote: '一段话。', body: '一条批注。', color: 'pink', visibility: 'private' });
  const wire = CTX.toPayload([item]);
  check('出网:一条一条地转', wire.length === 1);
  check('出网:内部 id 不进请求体', !('id' in wire[0]), JSON.stringify(Object.keys(wire[0])));
  check('出网:字段与后端 schema 对齐', ['kind', 'page', 'title', 'quote', 'prefix', 'suffix', 'body', 'color', 'visibility'].every((k) => k in wire[0]));
  check('出网:可见范围原样带出', wire[0].visibility === 'private');
  check('出网:空列表 → 空数组', CTX.toPayload([]).length === 0);
}

console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`);
process.exit(failed === 0 ? 0 : 1);
