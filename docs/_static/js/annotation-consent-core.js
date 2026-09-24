// Local state only. A trusted browser controller must call confirm after a user gesture.
const KEY = 'aipm-anno-consent-v1';
const FIVE_MINUTES = 5 * 60 * 1000;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(name);
  return value;
}

function canonical(request) {
  if (!request || typeof request !== 'object') throw new TypeError('request');
  const { requestId, proposalId, page, scope, visibility, body } = request;
  for (const [name, value] of Object.entries({ requestId, proposalId, page, scope, visibility, body })) {
    requireText(value, name);
  }
  if (!['page', 'text'].includes(scope) || !['local', 'public', 'private'].includes(visibility)) {
    throw new TypeError('scope or visibility');
  }
  const allowed = ['requestId', 'proposalId', 'page', 'scope', 'visibility', 'body', 'quote', 'prefix', 'suffix', 'color', 'style'];
  if (Object.keys(request).some((key) => !allowed.includes(key))) throw new TypeError('unexpected request field');
  const result = { requestId, proposalId, page, scope, visibility, body };
  for (const field of allowed.slice(6)) {
    if (request[field] !== undefined) {
      if (typeof request[field] !== 'string') throw new TypeError(field);
      result[field] = request[field];
    }
  }
  return result;
}

async function fingerprint(request) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(request)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createConsentCore({ storage, clock, site, newId }) {
  requireText(site, 'site');
  if (!storage || !clock || !newId) throw new TypeError('dependencies');

  function read() {
    const raw = storage.getItem(KEY);
    if (raw === null) return { version: 1, records: [] };
    const state = JSON.parse(raw);
    if (state.version !== 1 || !Array.isArray(state.records)) throw new Error('invalid consent state');
    return state;
  }

  function save(state) {
    storage.setItem(KEY, JSON.stringify(state));
  }

  function match(record, identity, requestId) {
    return record.site === site && record.identity === identity && record.requestId === requestId;
  }

  function checked(record, identity, session, request, digest) {
    if (!record || record.identity !== identity || record.session !== session || record.site !== site || record.digest !== digest) {
      throw new Error('request binding mismatch');
    }
    if (!record.request || JSON.stringify(record.request) !== JSON.stringify(request)) {
      throw new Error('recovery copy unavailable');
    }
  }

  async function confirm({ identity, session, request, unknown = false }) {
    requireText(identity, 'identity');
    requireText(session, 'session');
    request = canonical(request);
    const digest = await fingerprint(request);
    const state = read();
    let record = state.records.find((entry) => match(entry, identity, request.requestId));
    const now = clock();
    if (record) {
      checked(record, identity, session, request, digest);
      if (unknown !== (record.status === 'unknown') ||
          !['unknown', 'awaiting_confirmation'].includes(record.status)) throw new Error('request already recorded');
      if (record.permit) {
        const prior = record.permits.find((item) => item.id === record.permit);
        if (!prior || (!prior.revoked && now < prior.expiresAt)) throw new Error('permission already active');
        prior.revoked = true;
      }
      if (record.permits.some((item) => item.used) && record.status !== 'unknown') throw new Error('request already used');
    } else {
      if (unknown) throw new Error('unknown request absent');
      record = { site, identity, session, requestId: request.requestId, digest, request,
        createdAt: now, status: 'awaiting_confirmation', permits: [], permit: null };
      state.records.push(record);
    }
    const grantId = newId();
    requireText(grantId, 'grantId');
    if (record.permits.some((item) => item.id === grantId)) throw new Error('duplicate grant');
    record.permit = grantId;
    record.permits.push({ id: grantId, at: now, expiresAt: now + FIVE_MINUTES, revoked: false, used: false });
    save(state);
    return grantId;
  }

  async function claim({ identity, session, request, grantId }) {
    request = canonical(request);
    const digest = await fingerprint(request);
    const state = read();
    const record = state.records.find((entry) => match(entry, identity, request.requestId));
    checked(record, identity, session, request, digest);
    const permit = record.permits.find((item) => item.id === grantId);
    if (record.permit !== grantId || !permit || permit.used || permit.revoked || clock() >= permit.expiresAt ||
        !['awaiting_confirmation', 'unknown'].includes(record.status)) throw new Error('permission denied');
    permit.used = true;
    record.permit = null;
    if (record.status === 'unknown') record.unknownRetained = true;
    record.status = 'executing';
    save(state);
    return structuredClone(record.request);
  }

  function revoke({ identity, session, requestId }) {
    const state = read();
    const record = state.records.find((entry) => match(entry, identity, requestId));
    if (!record || record.session !== session) throw new Error('request binding mismatch');
    for (const permit of record.permits) if (!permit.used) permit.revoked = true;
    record.permit = null;
    if (record.status === 'executing') {
      record.status = 'unknown';
      record.unknownRetained = true;
    }
    save(state);
  }

  function settle({ identity, session, requestId, status, annotationId }) {
    if (!['unknown', 'succeeded', 'failed'].includes(status)) throw new TypeError('status');
    const state = read();
    const record = state.records.find((entry) => match(entry, identity, requestId));
    if (!record || record.session !== session || record.status !== 'executing') throw new Error('no executing request');
    record.status = status;
    if (status === 'unknown') record.unknownRetained = true;
    if (annotationId !== undefined) {
      if (status !== 'succeeded') throw new TypeError('annotationId');
      record.annotationId = requireText(annotationId, 'annotationId');
    }
    save(state);
  }

  function prune() {
    const state = read();
    let changed = false;
    for (const record of state.records) {
      if (record.request && clock() - record.createdAt >= THIRTY_DAYS) {
        delete record.request;
        record.permit = null;
        changed = true;
      }
    }
    if (changed) save(state);
  }

  function inspect({ identity, session, requestId }) {
    const record = read().records.find((entry) => match(entry, identity, requestId));
    if (!record || record.session !== session) return null;
    return structuredClone(record);
  }

  return Object.freeze({ confirm, claim, revoke, settle, prune, inspect });
}
