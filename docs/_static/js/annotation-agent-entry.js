import { createConsentCore } from './annotation-consent-core.js?v=46';
import { mountProposalConfirmation } from './annotation-proposal-confirm.js?v=46';

export function createAgentEntry({ storage = localStorage, site = location.origin } = {}) {
  const core = createConsentCore({ storage, clock: () => Date.now(), site,
    newId: () => crypto.randomUUID() });

  const KEY = 'aipm-agent-login-draft-v1';
  const PROPOSALS_KEY = 'aipm-agent-proposals-v1';
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

  function pendingProposals() {
    const records = JSON.parse(storage.getItem(PROPOSALS_KEY) || '[]');
    if (!Array.isArray(records)) throw new Error('proposal evidence invalid');
    return records.filter(record => record.site === site && Number.isSafeInteger(record.savedAt) &&
      Date.now() >= record.savedAt && Date.now() - record.savedAt < 30 * 86400000);
  }

  function rememberProposal(proposal) {
    if (proposal.page !== location.pathname || typeof proposal.id !== 'string' || !proposal.id ||
        typeof proposal.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(proposal.requestId)) {
      throw new Error('original proposal evidence unavailable');
    }
    const records = pendingProposals();
    if (records.some(record => record.proposal?.requestId === proposal.requestId)) {
      throw new Error('proposal already recorded');
    }
    const user = window.__aipmAnnoAuth.user();
    records.push({ site, identity: user ? String(user.githubId) : null,
      savedAt: Date.now(), proposal });
    storage.setItem(PROPOSALS_KEY, JSON.stringify(records));
  }

  function hasPendingProposal(proposal) {
    const record = pendingProposals().find(item => item.proposal?.requestId === proposal?.requestId);
    if (!record || proposal.page !== location.pathname ||
        !FIELDS.filter(field => field !== 'visibility').every(field => record.proposal[field] === proposal[field])) return false;
    if (proposal.visibility !== record.proposal.visibility) {
      const choice = JSON.parse(storage.getItem(`aipm-agent-visibility:${proposal.requestId}`) || 'null');
      if (!choice || choice.proposalId !== proposal.id || choice.page !== proposal.page ||
          choice.visibility !== proposal.visibility || choice.locked !== true) return false;
    }
    if (proposal.visibility === 'local') return true;
    const user = window.__aipmAnnoAuth.user();
    return record.identity === null ? !user || hasLoginDraft(proposal) :
      record.identity === String(user?.githubId);
  }

  function loginDraft(proposal) {
    if (typeof proposal?.id !== 'string' || !proposal.id ||
        typeof proposal.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(proposal.requestId) ||
        proposal.page !== location.pathname || !['public', 'private'].includes(proposal.visibility) ||
        !['page', 'text'].includes(proposal.scope) ||
        typeof proposal.body !== 'string' || (proposal.scope === 'page' && !proposal.body.trim()) ||
        (proposal.scope === 'page' && proposal.quote) ||
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
    if (historical && !evidence && !hasLoginDraft(proposal) && !hasPendingProposal(proposal)) {
      throw new Error('original proposal evidence unavailable');
    }
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

  return Object.freeze({ mount, restoreEvidence, loginDraft, hasLoginDraft, rememberProposal, hasPendingProposal,
    prune: () => { pruneLoginDraft(); core.prune(); } });
}
