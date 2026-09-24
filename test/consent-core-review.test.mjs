import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.env.CONSENT_REVIEW_ROOT || "meta/consent-review/bundle-rebuild");
const require = createRequire(resolve(root, "package.json"));
const { JSDOM } = require("jsdom");
const { createConsentCore } = await import(pathToFileURL(resolve(root, "docs/_static/js/annotation-consent-core.js")));
const KEY = "aipm-anno-consent-v1";
const START = Date.UTC(2026, 8, 24);
const DAYS = 30 * 86400000;
const QUOTA = 8192;

function fixture(t) {
  const dom = new JSDOM("", { url: "https://aipm.ac", storageQuota: QUOTA });
  t.after(() => dom.window.close());
  const storage = dom.window.localStorage;
  let now = START;
  let counter = 0;
  const context = {
    identity: "github-1", session: "session-1",
    request: { requestId: "req-1", proposalId: "proposal-1", page: "/ai/rag/",
      scope: "text", visibility: "private", body: "private body", quote: "selected text",
      prefix: "before", suffix: "after", color: "yellow", style: "highlight" },
  };
  const reference = { identity: context.identity, session: context.session, requestId: context.request.requestId };
  const create = (site = "https://aipm.ac") => createConsentCore({ storage, site,
    clock: () => now, newId: () => `grant-${++counter}` });
  const core = create();
  const inspect = () => core.inspect(reference);
  const settle = (status, annotationId) => core.settle({ ...reference, status, annotationId });
  const claim = (grantId) => core.claim({ ...context, grantId });
  const begin = async () => claim(await core.confirm(context));
  const unknown = async () => { await begin(); settle("unknown"); };
  const fill = () => storage.setItem("quota-filler", "x".repeat(QUOTA - KEY.length - storage.getItem(KEY).length - "quota-filler".length));
  return { storage, core, create, context, reference, inspect, settle, claim, begin, unknown, fill,
    time: (value) => { now = value; } };
}

test("additional request fields and site remain bound to the permit", async (t) => {
  const f = fixture(t);
  const grantId = await f.core.confirm(f.context);
  for (const [key, value] of Object.entries({ proposalId: "proposal-2", scope: "page", quote: "other",
    prefix: "other", suffix: "other", color: "red", style: "underline" })) {
    await assert.rejects(f.core.claim({ ...f.context, grantId, request: { ...f.context.request, [key]: value } }));
  }
  await assert.rejects(f.create("https://other.invalid").claim({ ...f.context, grantId }));
  assert.equal(f.inspect().permits[0].used, false);
  assert.deepEqual(await f.claim(grantId), f.context.request);
});

test("same-runtime concurrent consumers obtain one claim only", async (t) => {
  const f = fixture(t);
  const grantId = await f.core.confirm(f.context);
  const results = await Promise.allSettled([f.claim(grantId), f.claim(grantId)]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
  assert.equal(f.inspect().permits.filter((item) => item.used).length, 1);
});

test("another identity may independently use the same requestId without reading the first record", async (t) => {
  const f = fixture(t);
  await f.begin();
  const second = { ...f.context, identity: "github-2", request: { ...f.context.request, body: "second body" } };
  assert.equal(f.core.inspect({ ...f.reference, identity: second.identity }), null);
  const grantId = await f.core.confirm(second);
  assert.deepEqual(await f.core.claim({ ...second, grantId }), second.request);
  assert.equal(f.inspect().request.body, f.context.request.body);
  assert.throws(() => f.core.revoke({ ...f.reference, session: "other-session" }));
  assert.throws(() => f.core.settle({ ...f.reference, session: "other-session", status: "succeeded" }));
});

test("returned objects cannot mutate frozen request evidence", async (t) => {
  const f = fixture(t);
  const returned = await f.begin();
  returned.body = "changed";
  const record = f.inspect();
  record.request.quote = "changed";
  record.permits[0].used = false;
  assert.equal(f.inspect().request.body, f.context.request.body);
  assert.equal(f.inspect().request.quote, f.context.request.quote);
  assert.equal(f.inspect().permits[0].used, true);
});

test("five-minute expiry and revocation preserve an unknown record and both permit histories", async (t) => {
  const f = fixture(t);
  await f.unknown();
  const renewed = await f.core.confirm({ ...f.context, unknown: true });
  f.time(START + 300000);
  await assert.rejects(f.claim(renewed));
  assert.equal(f.inspect().status, "unknown");
  f.core.revoke(f.reference);
  assert.equal(f.inspect().status, "unknown");
  assert.equal(f.inspect().permits.length, 2);
  assert.equal(f.inspect().permits[0].used, true);
  assert.equal(f.inspect().permits[1].revoked, true);
  const third = await f.core.confirm({ ...f.context, unknown: true });
  await f.claim(third);
  assert.equal(f.inspect().unknownRetained, true);
});

test("thirty-day pruning preserves unknown and successful idempotency evidence", async (t) => {
  for (const status of ["unknown", "succeeded"]) {
    const f = fixture(t);
    await f.begin();
    f.settle(status, status === "succeeded" ? "annotation-1" : undefined);
    const before = f.inspect();
    f.time(START + DAYS - 1);
    f.core.prune();
    assert.deepEqual(f.inspect(), before);
    f.time(START + DAYS);
    f.core.prune();
    const after = f.inspect();
    assert.equal(after.request, undefined);
    for (const key of ["identity", "session", "site", "requestId", "digest", "createdAt", "status", "annotationId", "unknownRetained"]) {
      assert.deepEqual(after[key], before[key]);
    }
    assert.deepEqual(after.permits, before.permits);
    await assert.rejects(f.core.confirm({ ...f.context, unknown: status === "unknown" }));
    f.time(START + DAYS * 100);
    f.core.prune();
    assert.deepEqual(f.inspect(), after);
    assert.equal(JSON.stringify(after).includes(f.context.request.body), false);
    assert.equal(JSON.stringify(after).includes(f.context.request.quote), false);
  }
});

test("quota rejection during unknown settlement leaves the durable snapshot unchanged", async (t) => {
  const f = fixture(t);
  await f.begin();
  const before = f.storage.getItem(KEY);
  f.fill();
  assert.throws(() => f.settle("unknown"), { name: "QuotaExceededError" });
  assert.equal(f.storage.getItem(KEY), before);
  await assert.rejects(f.claim("grant-1"));
  f.storage.removeItem("quota-filler");
  f.settle("unknown");
  assert.equal(f.create().inspect(f.reference).status, "unknown");
});

test("R1: unknown retry cannot become terminal failed without terminal nonexecution evidence", async (t) => {
  const f = fixture(t);
  await f.unknown();
  const grantId = await f.core.confirm({ ...f.context, unknown: true });
  await f.claim(grantId);
  f.settle("failed");
  assert.equal(f.inspect().status, "unknown");
  assert.equal(f.inspect().unknownRetained, true);
});

test("R2: an unknown record accepts a confirmed successful result without claiming another write", async (t) => {
  const f = fixture(t);
  await f.unknown();
  const record = f.inspect();
  const evidence = { ...f.reference, site: "https://aipm.ac", digest: record.digest,
    source: "read_result", status: "succeeded", annotationId: "annotation-1" };
  assert.doesNotThrow(() => f.core.settle({ ...f.reference, status: "succeeded",
    annotationId: "annotation-1", evidence }));
  assert.equal(f.inspect().status, "succeeded");
  assert.equal(f.inspect().annotationId, "annotation-1");
});

test("R2: success arriving after in-flight revocation remains recordable", async (t) => {
  const f = fixture(t);
  await f.begin();
  f.core.revoke(f.reference);
  assert.equal(f.inspect().status, "unknown");
  const record = f.inspect();
  const evidence = { ...f.reference, site: "https://aipm.ac", digest: record.digest,
    source: "in_flight", grantId: record.permits[0].id, status: "succeeded", annotationId: "annotation-1" };
  assert.doesNotThrow(() => f.core.settle({ ...f.reference, status: "succeeded",
    annotationId: "annotation-1", evidence }));
  assert.equal(f.inspect().annotationId, "annotation-1");
});

test("R3: a renewed permit cannot cross the thirty-day recovery boundary", async (t) => {
  const f = fixture(t);
  await f.unknown();
  f.time(START + DAYS - 1);
  f.core.prune();
  const grantId = await f.core.confirm({ ...f.context, unknown: true });
  f.time(START + DAYS);
  await assert.rejects(f.claim(grantId));
  assert.equal(f.inspect().status, "unknown");
});

test("R3: confirmation at the recovery deadline is denied before a scheduled prune", async (t) => {
  const f = fixture(t);
  await f.unknown();
  f.time(START + DAYS);
  await assert.rejects(f.core.confirm({ ...f.context, unknown: true }));
});

test("storage recovery keeps the consumed permit closed until the controller records uncertainty", async (t) => {
  const f = fixture(t);
  await f.begin();
  f.fill();
  assert.throws(() => f.settle("unknown"), { name: "QuotaExceededError" });
  f.storage.removeItem("quota-filler");
  const restored = f.create();
  await assert.rejects(restored.claim({ ...f.context, grantId: "grant-1" }));
  await assert.rejects(restored.confirm({ ...f.context, unknown: true }));
  restored.settle({ ...f.reference, status: "unknown" });
  assert.equal(restored.inspect(f.reference).status, "unknown");
  const grantId = await restored.confirm({ ...f.context, unknown: true });
  assert.deepEqual(await restored.claim({ ...f.context, grantId }), f.context.request);
});


test("unknown success requires matching result and used execution evidence", async (t) => {
  const f = fixture(t);
  await f.unknown();
  const record = f.inspect();
  const result = { ...f.reference, site: "https://aipm.ac", digest: record.digest,
    source: "read_result", status: "succeeded", annotationId: "annotation-1" };
  const settle = (evidence) => f.core.settle({ ...f.reference, status: "succeeded",
    annotationId: "annotation-1", evidence });
  assert.throws(() => settle(undefined));
  for (const change of [{ identity: "github-2" }, { session: "session-2" },
    { site: "https://other.invalid" }, { requestId: "req-2" }, { digest: "other" },
    { annotationId: "annotation-2" }, { status: "failed" }, { source: "unknown" }]) {
    assert.throws(() => settle({ ...result, ...change }));
  }
  assert.throws(() => settle({ ...result, source: "in_flight", grantId: "unused" }));
  assert.equal(f.inspect().status, "unknown");
  const grantId = await f.core.confirm({ ...f.context, unknown: true });
  await f.claim(grantId);
  f.settle("failed");
  assert.equal(f.inspect().status, "unknown");
  await f.core.confirm({ ...f.context, unknown: true });
  settle(result);
  assert.equal(f.inspect().annotationId, "annotation-1");
  assert.throws(() => settle(result));
});

test("successful read result after pruning retains original operation binding", async (t) => {
  const f = fixture(t);
  await f.unknown();
  const original = f.inspect();
  f.time(START + DAYS);
  f.core.prune();
  const evidence = { ...f.reference, site: "https://aipm.ac", digest: original.digest,
    source: "read_result", status: "succeeded", annotationId: "annotation-1" };
  f.core.settle({ ...f.reference, status: "succeeded", annotationId: "annotation-1", evidence });
  const resolved = f.inspect();
  assert.equal(resolved.request, undefined);
  assert.equal(resolved.annotationId, "annotation-1");
  await assert.rejects(f.core.confirm({ ...f.context, unknown: true }));
});
