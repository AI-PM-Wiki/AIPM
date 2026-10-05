const assert = (condition, message) => { if (!condition) throw new Error(message); };
const records = async () => (await fetch('http://127.0.0.1:18981/review/records')).json();
const existing = await records();

const task = await taskSpace('AIPM isolated recorder regression');
const page = task.page('p1');
await page.cdp('Network.enable');
await page.cdp('Network.setBypassServiceWorker', { bypass: true });
await page.cdp('Network.setCacheDisabled', { cacheDisabled: true });
await page.goto(`http://127.0.0.1:18981/review/fixture/?fresh=${crypto.randomUUID()}`);
await page.waitForFunction(() => window.currentConfirmation?.frame?.tagName === 'IFRAME');
await page.waitForFunction(async (baseline) =>
  (await (await fetch('/review/records')).json()).length > baseline,
  existing.length, { timeout: 15000 });

const initial = await page.evaluate(() => {
  const { frame, proposal } = window.currentConfirmation;
  return { body: proposal.body, quote: proposal.quote, sandbox: frame.getAttribute('sandbox'),
    document: frame.contentDocument, parentText: document.body.textContent };
});
assert(initial.sandbox === 'allow-scripts' && initial.document === null, 'opaque origin');
assert(!initial.parentText.includes(initial.body) && !initial.parentText.includes(initial.quote), 'parent DOM clean');
await page.click('text="同意并写入"', { label: 'approve isolated local proposal' });
await page.waitForFunction(() => {
  const { core, proposal, session, identity } = window.currentConfirmation;
  return core.inspect({ identity, session, requestId: proposal.requestId })?.status === 'succeeded';
});
const final = await page.evaluate(() => {
  const { core, proposal, session, identity } = window.currentConfirmation;
  const record = core.inspect({ identity, session, requestId: proposal.requestId });
  return { status: record.status, used: record.permits[0].used, annotationId: record.annotationId };
});
const next = await page.evaluate(() => window.prepareConfirmation('local'));
await page.waitForFunction(() => document.querySelectorAll('iframe[sandbox="allow-scripts"]').length === 2);
await page.goto(`http://127.0.0.1:18981/review/fixture/?flush=${crypto.randomUUID()}`);
const rows = (await records()).slice(existing.length);
const captured = JSON.stringify(rows);

assert(rows.length > 0, 'real recorder sent payload');
assert(rows.some((row) => row.payload.events.some((event) => event.type === 2)), 'full snapshot');
assert(rows.some((row) => row.payload.events.some((event) => event.type === 3)), 'incremental snapshot');
for (const marker of [initial.body, initial.quote, next.body, next.quote,
  '最终可见范围：仅本机', '已写入：仅本机', final.annotationId]) {
  assert(!captured.includes(marker), `recorder leaked ${marker}`);
}
console.log({ rows: rows.length, types: [...new Set(rows.flatMap((row) => row.payload.events.map((event) => event.type)))],
  first: final.status, used: final.used, sandbox: initial.sandbox });
await task.finish({ keep: [] });
