// An isolated confirmation entry. The production Agent bootstrap remains disabled.
import { createAnnotationRequestStatus } from './annotation-request-status.js?v=45';
import { createConfirmationView } from './annotation-confirm-view.js?v=45';

const LABELS = { local: '仅本机', private: '仅自己可见', public: '公开' };

export function mountProposalConfirmation({ core, proposal, session, host = document.body, resumeExisting = false }) {
  const auth = window.__aipmAnnoAuth;
  const store = window.__aipmAnnoStore;
  if (!core || !auth || !store || !host || typeof session !== 'string' || !session) {
    throw new TypeError('confirmation dependencies');
  }
  if (!proposal || typeof proposal !== 'object' || !['page', 'text'].includes(proposal.scope) ||
      !Object.hasOwn(LABELS, proposal.visibility) ||
      typeof proposal.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(proposal.requestId) ||
      typeof proposal.proposalId !== 'string' || !proposal.proposalId ||
      typeof proposal.page !== 'string' || proposal.page !== location.pathname ||
      typeof proposal.body !== 'string' || !proposal.body.trim() ||
      (proposal.scope === 'text' && (typeof proposal.quote !== 'string' || !proposal.quote.trim())) ||
      (proposal.scope === 'page' && proposal.quote)) throw new TypeError('proposal');

  const request = Object.freeze({ requestId: proposal.requestId, proposalId: proposal.proposalId,
    page: proposal.page, scope: proposal.scope, visibility: proposal.visibility,
    body: proposal.body, ...(proposal.scope === 'text' ? {
      quote: proposal.quote, prefix: proposal.prefix ?? '', suffix: proposal.suffix ?? ''
    } : {}), color: proposal.color ?? store.DEFAULT_COLOR, style: proposal.style ?? 'highlight' });
  const initialUser = auth.user();
  const initialToken = auth.token();
  const identity = request.visibility === 'local' ? 'local' : String(initialUser?.githubId);
  if (request.visibility !== 'local' &&
      (!Number.isSafeInteger(initialUser?.githubId) || initialUser.githubId <= 0 || !initialToken)) {
    throw new Error('authentication required');
  }
  const existing = core.inspectOwned({ identity, requestId: request.requestId });
  if (existing && !resumeExisting) {
    throw new Error('request already recorded');
  }
  if (resumeExisting && (!existing || existing.session !== session ||
      JSON.stringify(existing.request) !== JSON.stringify(request) ||
      existing.site !== location.origin)) throw new Error('recovery evidence unavailable');
  const actions = {};
  const view = createConfirmationView(host, (action, trusted) => {
    if (trusted && actions[action]) actions[action]({ isTrusted: true });
  });
  view.update({
    target: `目标：${request.page}${request.scope === 'text' ? ` · 引文：${request.quote}` : ' · 整篇文章'}`,
    body: `正文：${request.body}`,
    visibility: `最终可见范围：${LABELS[request.visibility]}`
  });
  const state = { set textContent(value) { view.update({ state: value }); } };
  const agree = { set disabled(value) { view.update({ agreeDisabled: value }); },
    addEventListener(type, handler) { actions.agree = handler; } };
  const retry = { set disabled(value) { view.update({ retryDisabled: value }); },
    set hidden(value) { view.update({ retryHidden: value }); },
    addEventListener(type, handler) { actions.retry = handler; } };
  const cancel = { set disabled(value) { view.update({ cancelDisabled: value }); },
    addEventListener(type, handler) { actions.cancel = handler; } };
  const check = { set hidden(value) { view.update({ checkHidden: value }); },
    addEventListener(type, handler) { actions.check = handler; } };

  let started = false;
  let cancelled = false;
  let claimed = false;
  let sent = false;
  function integrityReady() {
    return window.__aipmIntegrityReady === true && !window.__aipmIntegrityFailed;
  }
  function refreshIntegrity() {
    const record = core.inspect({ identity, session, requestId: request.requestId });
    const ready = integrityReady();
    agree.disabled = !ready || started || cancelled || Boolean(record && record.status !== 'awaiting_confirmation');
    retry.disabled = true;
    if (!started && !cancelled && (!record || record.status === 'awaiting_confirmation')) {
      state.textContent = ready ? '等待同意' :
        (window.__aipmIntegrityFailed ? '资源校验失败，未提交。' : '资源校验中，未提交。');
    }
  }
  window.addEventListener('aipm-integrity-change', refreshIntegrity);
  if (existing) {
    agree.disabled = true;
    if (existing.status === 'unknown' || existing.status === 'executing') {
      state.textContent = '结果未知；只能查询原请求，不能再次提交。';
      check.hidden = false;
    } else if (existing.status === 'succeeded') {
      state.textContent = `已写入：${LABELS[request.visibility]}`;
      cancel.disabled = true;
    } else if (existing.status === 'awaiting_confirmation') {
      agree.disabled = false;
      state.textContent = '等待再次同意原请求。';
    } else {
      state.textContent = '原请求已有记录；只能查询原请求。';
      check.hidden = false;
    }
  }
  refreshIntegrity();
  function sameContext() {
    return location.pathname === request.page &&
      auth.token() === initialToken && auth.user()?.githubId === initialUser?.githubId &&
      (request.visibility === 'local' || String(auth.user()?.githubId) === identity);
  }
  function unknown() {
    const record = core.inspect({ identity, session, requestId: request.requestId });
    if (record?.status === 'executing') {
      try {
        core.settle({ identity, session, requestId: request.requestId, status: 'unknown' });
      } catch (error) {
        if (error.name !== 'QuotaExceededError') throw error;
      }
    }
    state.textContent = '结果未知；只能查询原请求，不能再次提交。';
    check.hidden = false;
    started = false;
  }

  cancel.addEventListener('click', () => {
    cancelled = true;
    agree.disabled = true;
    retry.disabled = true;
    cancel.disabled = true;
    const record = core.inspect({ identity, session, requestId: request.requestId });
    if (record) {
      try {
        if (record.status === 'executing' && !sent) {
          core.abortUnsent({ identity, session, requestId: request.requestId });
        }
        else core.revoke({ identity, session, requestId: request.requestId });
      } catch (error) {
        if (error.name !== 'QuotaExceededError') throw error;
        unknown();
        return;
      }
    }

    if (claimed && sent) unknown();
    else state.textContent = '已取消，未写入。';
  });
  async function submit(event, retryUnknown) {
    if (!event.isTrusted) return;
    if (started || cancelled) return;
    if (!integrityReady()) { refreshIntegrity(); return; }
    if (retryUnknown) return;
    started = true;
    sent = false;
    claimed = false;
    agree.disabled = true;
    retry.disabled = true;
    if (!sameContext()) {
      state.textContent = '页面或身份已变化，未写入。';
      return;
    }
    let grantId;
    try {
      if (resumeExisting && !retryUnknown &&
          core.inspect({ identity, session, requestId: request.requestId })?.status === 'awaiting_confirmation') {
        core.revoke({ identity, session, requestId: request.requestId });
      }
      grantId = await core.confirm({ identity, session, request });
      if (!sameContext() || cancelled || !integrityReady()) {
        core.revoke({ identity, session, requestId: request.requestId });
        started = false;
        refreshIntegrity();
        return;
      }
      const claimedRequest = await core.claim({ identity, session, request, grantId });
      claimed = true;
      if (!sameContext() || cancelled || !integrityReady()) throw new Error('unsent request blocked');
      state.textContent = '写入中…';
      const selectors = claimedRequest.scope === 'page' ? [] : [{ type: 'TextQuoteSelector',
        exact: claimedRequest.quote, prefix: claimedRequest.prefix, suffix: claimedRequest.suffix }];
      const target = claimedRequest.scope === 'page' ? { scope: 'page', selectors } : { selectors };
      if (claimedRequest.visibility === 'local') {
        const id = store.uid();
        store.localAdd({ id, requestId: claimedRequest.requestId, page: claimedRequest.page, visibility: 'local',
          color: claimedRequest.color, style: claimedRequest.style, body: claimedRequest.body, target,
          author: { githubId: 0, login: auth.user()?.login ?? '本机' },
          replies: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        sent = true;
        const saved = store.localList(claimedRequest.page).find((item) => item.id === id);
        if (!saved) throw new Error('local write missing');
        core.settle({ identity, session, requestId: claimedRequest.requestId,
          status: 'succeeded', annotationId: saved.id });
        state.textContent = '已写入：仅本机';
        cancel.disabled = true;
        return;
      }
      if (!integrityReady()) throw new Error('unsent request blocked');
      const payload = { requestId: claimedRequest.requestId, page: claimedRequest.page,
        body: claimedRequest.body, color: claimedRequest.color, style: claimedRequest.style,
        visibility: claimedRequest.visibility, target };
      const issued = await store.request('/api/annotation-permits', {
        method: 'POST', token: initialToken, body: payload });
      if (issued.status !== 201 || !issued.body?.permit) throw new Error('confirmation permit unavailable');
      if (!sameContext() || cancelled || !integrityReady()) throw new Error('unsent request blocked');
      const pending = store.request('/api/annotations', { method: 'POST', token: initialToken,
        permit: issued.body.permit, body: payload });
      sent = true;
      const response = await pending;
      if (!sameContext() || cancelled) {
        unknown();
        return;
      }
      const annotation = response.body?.annotation;
      if (response.status !== 201 || !response.ok || !annotation ||
          typeof annotation.id !== 'string' || !annotation.id ||
          annotation.page !== claimedRequest.page || annotation.body !== claimedRequest.body ||
          annotation.visibility !== claimedRequest.visibility ||
          annotation.color !== claimedRequest.color || annotation.style !== claimedRequest.style ||
          annotation.target?.scope !== target.scope ||
          JSON.stringify(annotation.target?.selectors) !== JSON.stringify(target.selectors) ||
          String(annotation.author?.githubId) !== identity) {
        unknown();
        return;
      }
      core.settle({ identity, session, requestId: claimedRequest.requestId,
        status: 'succeeded', annotationId: annotation.id });
      state.textContent = `已写入：${LABELS[claimedRequest.visibility]}`;
      cancel.disabled = true;
    } catch (error) {
      if (!sent) {
        const record = core.inspect({ identity, session, requestId: request.requestId });
        if (record?.status === 'executing') core.abortUnsent({ identity, session, requestId: request.requestId });
        started = false;
        claimed = false;
        refreshIntegrity();
        return;
      }
      unknown();
    }
  }
  agree.addEventListener('click', (event) => submit(event, false));
  retry.addEventListener('click', (event) => submit(event, true));
  check.addEventListener('click', async () => {
    try {
      const result = await createAnnotationRequestStatus({ core }).query(request.requestId);
      if (result?.status === 'succeeded') {
        state.textContent = `已写入：${LABELS[request.visibility]}`;
        check.hidden = true;
        retry.hidden = true;
      } else state.textContent = '结果仍未知；请稍后查询。';
    } catch (error) {
      if (error.name !== 'QuotaExceededError') throw error;
      unknown();
    }
  });
  return view.frame;
}
