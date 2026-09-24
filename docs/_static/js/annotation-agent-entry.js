import { createConsentCore } from './annotation-consent-core.js?v=40';
import { mountProposalConfirmation } from './annotation-proposal-confirm.js?v=40';

export function createAgentEntry({ storage = localStorage, site = location.origin } = {}) {
  const core = createConsentCore({ storage, clock: () => Date.now(), site,
    newId: () => crypto.randomUUID() });

  const KEY = 'aipm-agent-login-draft-v1';
  function restoreEvidence(requestId, visibility) {
    const auth = window.__aipmAnnoAuth;
    const identity = visibility === 'local' ? 'local' : String(auth.user()?.githubId);
    if (visibility !== 'local' && (!Number.isSafeInteger(auth.user()?.githubId) || !auth.token())) {
      throw new Error('original identity unavailable');
    }
    return core.inspectOwned({ identity, requestId });
  }

  const FIELDS = ['id', 'requestId', 'page', 'scope', 'visibility', 'body',
    'quote', 'prefix', 'suffix', 'color', 'style'];

  function loginDraft(proposal) {
    if (typeof proposal?.id !== 'string' || !proposal.id ||
        typeof proposal.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(proposal.requestId) ||
        proposal.page !== location.pathname || !['public', 'private'].includes(proposal.visibility) ||
        !['page', 'text'].includes(proposal.scope) ||
        typeof proposal.body !== 'string' || !proposal.body.trim() ||
        (proposal.scope === 'text' && (typeof proposal.quote !== 'string' || !proposal.quote.trim()))) {
      throw new TypeError('proposal');
    }
    if (window.__aipmAnnoAuth.user()) throw new Error('already authenticated');
    pruneLoginDraft();
    const previous = storage.getItem(KEY);
    if (previous && !hasLoginDraft(proposal)) throw new Error('another draft exists');
    if (!previous) storage.setItem(KEY, JSON.stringify({ proposal, site, savedAt: Date.now() }));
    if (!hasLoginDraft(proposal)) throw new Error('login draft not saved');
    window.__aipmAnnoAuth.login(location.href);
  }

  function hasLoginDraft(proposal) {
    const raw = storage.getItem(KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);

    return draft.site === site && draft.proposal?.page === location.pathname &&
      (!draft.identity || !window.__aipmAnnoAuth.user() ||
        draft.identity === String(window.__aipmAnnoAuth.user().githubId)) &&
      Number.isSafeInteger(draft.savedAt) && Date.now() >= draft.savedAt &&
      Date.now() - draft.savedAt < 30 * 86400000 &&
      FIELDS.every((field) => draft.proposal[field] === proposal?.[field]);
  }
  function pruneLoginDraft() {
    const raw = storage.getItem(KEY);
    if (!raw) return;
    const savedAt = JSON.parse(raw).savedAt;
    if (!Number.isSafeInteger(savedAt)) throw new Error('login draft evidence invalid');
    if (Date.now() - savedAt >= 30 * 86400000) storage.removeItem(KEY);
  }

  function bindLoginDraft(proposal) {
    if (!hasLoginDraft(proposal)) return;
    const draft = JSON.parse(storage.getItem(KEY));
    const identity = String(window.__aipmAnnoAuth.user()?.githubId);
    if (draft.identity && draft.identity !== identity) throw new Error('original identity unavailable');
    if (!draft.identity) {
      storage.setItem(KEY, JSON.stringify({ ...draft, identity }));
      if (!hasLoginDraft(proposal)) throw new Error('login draft identity not saved');
    }
  }
  function mount({ proposal, historical = false, host }) {
    pruneLoginDraft();
    core.prune();
    if (typeof proposal?.id !== 'string' || !proposal.id ||
        typeof proposal?.requestId !== 'string' || !proposal.requestId) {
      throw new Error('original proposal evidence unavailable');
    }
    const pending = storage.getItem(KEY);
    if (pending && JSON.parse(pending).proposal?.requestId === proposal.requestId &&
        !hasLoginDraft(proposal)) throw new Error('original proposal evidence unavailable');
    const evidence = restoreEvidence(proposal.requestId, proposal.visibility);
    if (historical && !evidence && !hasLoginDraft(proposal)) throw new Error('original proposal evidence unavailable');
    if (proposal.resultUnknown && !evidence) throw new Error('unknown request evidence unavailable');
    bindLoginDraft(proposal);
    const session = evidence?.session ?? crypto.randomUUID();
    const frame = mountProposalConfirmation({ core, proposal: {
      requestId: proposal.requestId, proposalId: proposal.id, page: proposal.page,
      scope: proposal.scope, visibility: proposal.visibility, body: proposal.body,
      quote: proposal.quote, prefix: proposal.prefix, suffix: proposal.suffix,
      color: proposal.color, style: proposal.style
    }, session, host, resumeExisting: Boolean(evidence) });
    if (evidence?.status === 'succeeded' && hasLoginDraft(proposal)) storage.removeItem(KEY);
    return frame;
  }

  return Object.freeze({ mount, restoreEvidence, loginDraft, hasLoginDraft,
    prune: () => { pruneLoginDraft(); core.prune(); } });
}
