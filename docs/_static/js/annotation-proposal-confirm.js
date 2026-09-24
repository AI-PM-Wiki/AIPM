// Isolated verification entry: no production bootstrap imports this module.
import { createAnnotationRequestStatus } from './annotation-request-status.js';
import { createConfirmationView } from './annotation-confirm-view.js';

const LABELS = { local: '仅本机', private: '仅自己可见', public: '公开' };

export function mountProposalConfirmation({ core, proposal, session, host = document.body }) {
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
  if (core.inspect({ identity, session, requestId: request.requestId })) {
    throw new Error('request already recorded');
  }
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
  const cancel = { set disabled(value) { view.update({ cancelDisabled: value }); },
    addEventListener(type, handler) { actions.cancel = handler; } };
  const check = { set hidden(value) { view.update({ checkHidden: value }); },
    addEventListener(type, handler) { actions.check = handler; } };

  let started = false;
  let cancelled = false;
  let claimed = false;
  function sameContext() {
    return location.pathname === request.page &&
      auth.token() === initialToken && auth.user()?.githubId === initialUser?.githubId &&
      (request.visibility === 'local' || String(auth.user()?.githubId) === identity);
  }
  function unknown() {
    const record = core.inspect({ identity, session, requestId: request.requestId });
    if (record?.status === 'executing') core.settle({ identity, session, requestId: request.requestId, status: 'unknown' });
    state.textContent = '结果未知；只能查询原请求，不能再次提交。';
    check.hidden = request.visibility === 'local';
  }

  cancel.addEventListener('click', () => {
    cancelled = true;
    agree.disabled = true;
    cancel.disabled = true;
    const record = core.inspect({ identity, session, requestId: request.requestId });
    if (record) core.revoke({ identity, session, requestId: request.requestId });
    if (claimed) unknown();
    else state.textContent = '已取消，未写入。';
  });
  agree.addEventListener('click', async (event) => {
    if (!event.isTrusted) return;
    if (started || cancelled) return;
    started = true;
    agree.disabled = true;
    if (!sameContext()) {
      state.textContent = '页面或身份已变化，未写入。';
      return;
    }
    let grantId;
    try {
      grantId = await core.confirm({ identity, session, request });
      if (!sameContext() || cancelled) {
        core.revoke({ identity, session, requestId: request.requestId });
        state.textContent = '页面或身份已变化，未写入。';
        return;
      }
      const claimedRequest = await core.claim({ identity, session, request, grantId });
      claimed = true;
      if (!sameContext() || cancelled) {
        unknown();
        return;
      }
      state.textContent = '写入中…';
      const selectors = claimedRequest.scope === 'page' ? [] : [{ type: 'TextQuoteSelector',
        exact: claimedRequest.quote, prefix: claimedRequest.prefix, suffix: claimedRequest.suffix }];
      const target = claimedRequest.scope === 'page' ? { scope: 'page', selectors } : { selectors };
      if (claimedRequest.visibility === 'local') {
        const id = store.uid();
        store.localAdd({ id, page: claimedRequest.page, visibility: 'local',
          color: claimedRequest.color, style: claimedRequest.style, body: claimedRequest.body, target,
          author: { githubId: 0, login: auth.user()?.login ?? '本机' },
          replies: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        const saved = store.localList(claimedRequest.page).find((item) => item.id === id);
        if (!saved) throw new Error('local write missing');
        core.settle({ identity, session, requestId: claimedRequest.requestId,
          status: 'succeeded', annotationId: saved.id });
        state.textContent = '已写入：仅本机';
        cancel.disabled = true;
        return;
      }
      const response = await store.request('/api/annotations', { method: 'POST', token: initialToken,
        body: { requestId: claimedRequest.requestId, page: claimedRequest.page, body: claimedRequest.body,
          color: claimedRequest.color, style: claimedRequest.style, visibility: claimedRequest.visibility, target } });
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
      const record = core.inspect({ identity, session, requestId: request.requestId });
      if (record?.status === 'executing' || record?.status === 'unknown') unknown();
      else state.textContent = '未写入：确认状态无法保存或许可失效。';
      card.dataset.error = error.message;
    }
  });
  check.addEventListener('click', async () => {
    const result = await createAnnotationRequestStatus({ core }).query(request.requestId);
    if (result?.status === 'succeeded') {
      state.textContent = `已写入：${LABELS[request.visibility]}`;
      check.hidden = true;
    } else state.textContent = '结果仍未知；请稍后查询。';
  });
  return view.frame;
}
