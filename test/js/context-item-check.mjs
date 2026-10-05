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
check('导出的入口齐全', ['forSelection', 'forAnnotation', 'forChart', 'isDeliverable', 'sanitize', 'upsert', 'remove', 'toPayload'].every((k) => typeof CTX[k] === 'function'));

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

/* ---- 图表 ---- */
{
  const base = { page: '/ai/rag/', title: '检索增强生成', chart: 'mermaid', source: 'flowchart TB\n    a --> b', key: 'flowchart TB\n    a --> b' };

  const mermaid = CTX.forChart(base);
  check('图表: 造出条目', mermaid !== null && mermaid.kind === 'chart');
  check('图表: 种类与取到的文字都在', mermaid.chart === 'mermaid' && mermaid.source === 'flowchart TB\n    a --> b');
  check('图表: 引文与正文是空的(那是另外两种才有的)', mermaid.quote === '' && mermaid.body === '');
  check('图表: 可见范围固定公开', mermaid.visibility === 'public');
  check('图表: 标签写明是图与种类', CTX.labelOf(mermaid) === '图表 · Mermaid 图', CTX.labelOf(mermaid));
  check('图表: 摘要取的是取到的文字', CTX.excerptOf(mermaid) === 'flowchart TB a --> b', CTX.excerptOf(mermaid));

  const mermaidAgain = CTX.forChart(base);
  check('图表: 同一段源码 → 同一个 id(连点两次不会排两条)', mermaidAgain.id === mermaid.id, mermaid.id);

  const other = CTX.forChart({ ...base, source: 'pie title 占比\n    "a" : 60', key: 'pie title 占比\n    "a" : 60' });
  check('图表: 另一张图 → 另一个 id', other.id !== mermaid.id);

  const svg = CTX.forChart({ ...base, chart: 'svg', key: '/ai/rag/images/flow.svg' });
  check('图表: SVG 可用', svg !== null && svg.chart === 'svg');
  check('图表: 同页两张不同来源的图 id 不同', svg.id !== mermaid.id);
  check('图表: SVG 的标签', CTX.labelOf(svg) === '图表 · SVG 图', CTX.labelOf(svg));

  const image = CTX.forChart({ ...base, chart: 'image', key: '/ai/rag/images/x.png' });
  check('图表: 位图可用', image !== null && image.chart === 'image');
  check('图表: 位图的标签', CTX.labelOf(image) === '图表 · 图片', CTX.labelOf(image));
  check('图表: 位图没有图像内容时两个字段都是空串', image.mediaType === '' && image.imageData === '');

  check('图表: 认不出的种类 → 不造条目', CTX.forChart({ ...base, chart: 'jpg' }) === null);
  check('图表: 种类缺失 → 不造条目', CTX.forChart({ ...base, chart: undefined }) === null);
  check('图表: 取到的文字为空 → 不造条目', CTX.forChart({ ...base, source: '   ' }) === null);
  check('图表: 没有来源标识 → 不造条目(去重无从谈起)', CTX.forChart({ ...base, key: '' }) === null);
  check('图表: page 缺失 → 不造条目', CTX.forChart({ ...base, page: '' }) === null);

  const overlong = CTX.forChart({ ...base, source: 'x'.repeat(9000) });
  check('图表: 超长内容按上限截断', overlong.source.length === CTX.LIMITS.source, String(overlong.source.length));

  const wire = CTX.toPayload([mermaid]);
  check('图表: 出网带上种类与内容', wire[0].chart === 'mermaid' && wire[0].source.startsWith('flowchart TB'));
  check('图表: 出网不再额外带别的字段', ['kind', 'page', 'title', 'quote', 'prefix', 'suffix', 'body', 'color', 'chart', 'source', 'mediaType', 'imageData', 'visibility'].every((k) => k in wire[0]) && Object.keys(wire[0]).length === 13, JSON.stringify(Object.keys(wire[0])));

  /* 另外两种不出网时,图表那几个字段是空串 —— 服务端的 schema 有它们,缺省也是空串。 */
  const selectionWire = CTX.toPayload([CTX.forSelection({ page: '/ai/rag/', quote: '一段话。', selectors: [] })]);
  check('非图表: 出网时种类与内容留空串', selectionWire[0].chart === '' && selectionWire[0].source === '' && selectionWire[0].mediaType === '' && selectionWire[0].imageData === '');

  /* 同一份列表里混着三种,各自保留各自的 id 与顺序。 */
  const mixed = [CTX.forSelection({ page: '/ai/rag/', quote: '一段话。', selectors: [] }), mermaid, svg];
  const kept = CTX.sanitize(mixed);
  check('恢复: 三种条目一起过,一条不少', kept.length === 3, `len=${kept.length}`);
  check('恢复: 图表的种类与内容一起回来', kept[1].chart === 'mermaid' && kept[1].source.startsWith('flowchart TB'));
}

/* ---- 位图那份图像 ----
   位图送进对话的是**图像本身**:base64 的字节与它的媒体类型。取源那一步
   (chart-context.js)已经把来源、类型、体积筛过一遍,这里判的是形状 —— 类型认不
   认识、与内容是否成对、有没有超出尺寸。 */
{
  const base = { page: '/ai/rag/', title: '检索增强生成', chart: 'image', source: '页面上的第 1 张图(位图, 作者没有写替代文本)。', key: '/ai/rag/images/x.png' };
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const withImage = CTX.forChart({ ...base, mediaType: 'image/png', imageData: PNG });
  check('位图: 带图像内容时造得出条目', withImage !== null && withImage.mediaType === 'image/png' && withImage.imageData === PNG);
  check('位图: 同一张图带不带图像内容都是同一个 id(原位刷新)', withImage.id === CTX.forChart(base).id);

  check('位图: 只给类型不给图像 → 不造条目', CTX.forChart({ ...base, mediaType: 'image/png' }) === null);
  check('位图: 只给图像不给类型 → 不造条目', CTX.forChart({ ...base, imageData: PNG }) === null);
  check('位图: 类型不在那四种里 → 不造条目', CTX.forChart({ ...base, mediaType: 'image/tiff', imageData: PNG }) === null);
  check('位图: 格式名大小写不对 → 不造条目', CTX.forChart({ ...base, mediaType: 'IMAGE/PNG', imageData: PNG }) === null);
  check('位图: 图像内容为空串 → 不造条目', CTX.forChart({ ...base, mediaType: 'image/png', imageData: '' }) === null);
  check('位图: 图像内容超上限 → 不造条目', CTX.forChart({ ...base, mediaType: 'image/png', imageData: 'A'.repeat(CTX.LIMITS.imageData + 1) }) === null);
  check('位图: 刚好到上限 → 收下', CTX.forChart({ ...base, mediaType: 'image/png', imageData: 'A'.repeat(CTX.LIMITS.imageData) }) !== null);
  check('位图: 四种格式都收', CTX.RASTER_TYPES.every((t) => CTX.forChart({ ...base, mediaType: t, imageData: PNG }) !== null), CTX.RASTER_TYPES.join(','));
  check('位图: 认得的就是那四种', CTX.RASTER_TYPES.length === 4 && CTX.RASTER_TYPES.includes('image/webp'));

  check('非位图: Mermaid 图带图像 → 不造条目', CTX.forChart({ page: '/ai/rag/', chart: 'mermaid', source: 'flowchart TB', key: 'k', mediaType: 'image/png', imageData: PNG }) === null);
  check('非位图: SVG 图带图像 → 不造条目', CTX.forChart({ page: '/ai/rag/', chart: 'svg', source: '图里的字', key: 'k', mediaType: 'image/png', imageData: PNG }) === null);

  /* 恢复与出网:图像跟着条目一起走,一个字节都不少。 */
  const restored = CTX.sanitize([withImage]);
  check('位图: 从 localStorage 恢复时图像原样回来', restored.length === 1 && restored[0].imageData === PNG && restored[0].mediaType === 'image/png');

  const wire = CTX.toPayload([withImage]);
  check('位图: 出网时图像原样带出', wire[0].mediaType === 'image/png' && wire[0].imageData === PNG, JSON.stringify(wire[0]).slice(0, 80));

  /* 手工拼的坏形状:恢复与出网这两道自己也要判,不能只靠构造函数。 */
  const badShaped = { ...withImage, mediaType: 'image/tiff' };
  check('位图: 手工拼的坏类型恢复时被丢掉', CTX.sanitize([badShaped]).length === 0);
  check('位图: 手工拼的坏类型出网时被丢掉', CTX.toPayload([badShaped]).length === 0);
  const halfPair = { ...withImage, imageData: '' };
  check('位图: 手工拼的半对字段出网时被丢掉', CTX.toPayload([halfPair]).length === 0);
  const oversized = { ...withImage, imageData: 'A'.repeat(CTX.LIMITS.imageData + 1) };
  check('位图: 手工拼的超限内容出网时被丢掉', CTX.toPayload([oversized]).length === 0);

  /* 「仅本机」与图像无关:带图像也一样进不来、出不去。 */
  const localWithImage = { ...withImage, visibility: 'local' };
  check('仅本机: 带图像的位图一样过不了 isDeliverable', CTX.isDeliverable(localWithImage) === false);
  check('仅本机: 带图像的位图进不了语境条', CTX.upsert([], localWithImage).code === 'invalid_context');
  check('仅本机: 带图像的位图恢复时被丢掉', CTX.sanitize([localWithImage]).length === 0);
  check('仅本机: 带图像的位图出网时被丢掉', CTX.toPayload([localWithImage]).length === 0);
}

/* ---- 「仅本机」这道边界对图表同样成立 ----
   图表这边前端永远写 public(正文里的图没有三态一说),但边界不能因此少判一次:
   手工拼的、或从旧数据里恢复出来的 local 条目,一样不许进语境条、不许出网。 */
{
  const local = {
    id: 'chart:/ai/rag/#mermaid:zzz',
    kind: 'chart',
    page: '/ai/rag/',
    title: '检索增强生成',
    quote: '',
    prefix: '',
    suffix: '',
    body: '',
    color: '',
    chart: 'mermaid',
    source: 'flowchart TB\n    a --> b',
    visibility: 'local'
  };

  check('仅本机图表: 过不了 isDeliverable', CTX.isDeliverable(local) === false);
  const put = CTX.upsert([], local);
  check('仅本机图表: 进不了语境条', put.ok === false && put.code === 'invalid_context' && put.items.length === 0);
  check('仅本机图表: 从 localStorage 恢复时被丢掉', CTX.sanitize([local]).length === 0);
  check('仅本机图表: 出网那一道也发不出去', CTX.toPayload([local]).length === 0);

  /* 形状补全但可见范围是 local:挡住它的必须是可见范围那条,而不是形状那条。 */
  const shaped = { ...local, visibility: 'public' };
  check('同一条改回公开就收得下(证明挡它的是可见范围那一条)', CTX.isDeliverable(shaped) === true);

  const noSource = { ...shaped, source: '' };
  check('公开但内容为空: 一样过不了(服务端也会拒)', CTX.isDeliverable(noSource) === false);
  const badKind = { ...shaped, chart: 'jpg' };
  check('公开但种类不认识: 一样过不了', CTX.isDeliverable(badKind) === false);
}

/* ---- 出网形态 ---- */
{
  const item = CTX.forAnnotation({ page: '/ai/rag/', title: '检索增强生成', id: 'anno-9', quote: '一段话。', body: '一条批注。', color: 'pink', visibility: 'private' });
  const wire = CTX.toPayload([item]);
  check('出网:一条一条地转', wire.length === 1);
  check('出网:内部 id 不进请求体', !('id' in wire[0]), JSON.stringify(Object.keys(wire[0])));
  check('出网:字段与后端 schema 对齐', ['kind', 'page', 'title', 'quote', 'prefix', 'suffix', 'body', 'color', 'chart', 'source', 'mediaType', 'imageData', 'visibility'].every((k) => k in wire[0]));
  check('出网:可见范围原样带出', wire[0].visibility === 'private');
  check('出网:空列表 → 空数组', CTX.toPayload([]).length === 0);
}

/* ---- 「仅本机」不止构造函数那一道 ----
   条目要经过四个容器才走出去:构造 → 语境条 → localStorage → 请求体。此前只有
   构造那一处判 visibility,于是从 localStorage 恢复回来的、或别的调用方直接塞
   进来的 local 条目会一路进到请求体,由服务端拒掉 —— 那时内容已经离开设备了。
   这里用**手工拼的**条目绕开构造函数,按路径各断言一次。 */
{
  const local = {
    id: 'anno-local',
    kind: 'annotation',
    page: '/ai/rag/',
    title: '检索增强生成',
    quote: '这段话只在本机。',
    prefix: '',
    suffix: '',
    body: '仅本机的批注。',
    color: 'yellow',
    visibility: 'local'
  };

  check('仅本机: 过不了 isDeliverable', CTX.isDeliverable(local) === false);

  const put = CTX.upsert([], local);
  check('仅本机: 进不了语境条', put.ok === false && put.code === 'invalid_context' && put.items.length === 0);

  const publicItem = CTX.forSelection({ page: '/ai/rag/', quote: '公开的一段话。', selectors: [] });
  const restored = CTX.sanitize([local, publicItem]);
  check('仅本机: 从 localStorage 恢复时被丢掉', restored.length === 1 && restored[0].kind === 'selection', `len=${restored.length}`);

  const wire = CTX.toPayload([local, publicItem]);
  check('仅本机: 出网那一道也发不出去', wire.length === 1 && wire[0].quote === '公开的一段话。', JSON.stringify(wire));
  check('仅本机: 一份都不剩时请求体里没有它', CTX.toPayload([local]).length === 0);

  check('恢复: 非数组 → 空', CTX.sanitize(null).length === 0 && CTX.sanitize('x').length === 0);
  check('恢复: 坏形状丢掉,好的留下', CTX.sanitize([
    { id: 'x' },
    null,
    CTX.forAnnotation({ page: '/ai/rag/', id: 'ok', quote: '好的一条。', body: '', color: '', visibility: 'public' })
  ]).length === 1);
  check('恢复: 好条目原样留下(不丢字段)', restored[0].quote === '公开的一段话。' && restored[0].page === '/ai/rag/' && restored[0].visibility === 'public');
}

console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`);
process.exit(failed === 0 ? 0 : 1);
