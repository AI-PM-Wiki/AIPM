import { createConsentCore } from './annotation-consent-core.js';
import { mountProposalConfirmation } from './annotation-proposal-confirm.js';

export function createAgentEntry({ storage = localStorage, site = location.origin } = {}) {
  const core = createConsentCore({ storage, clock: () => Date.now(), site,
    newId: () => crypto.randomUUID() });

  function restoreEvidence(requestId, visibility) {
    const auth = window.__aipmAnnoAuth;
    const identity = visibility === 'local' ? 'local' : String(auth.user()?.githubId);
    if (visibility !== 'local' && (!Number.isSafeInteger(auth.user()?.githubId) || !auth.token())) {
      throw new Error('original identity unavailable');
    }
    return core.inspectOwned({ identity, requestId });
  }

  function mount({ proposal, historical = false, host }) {
    core.prune();
    if (typeof proposal?.id !== 'string' || !proposal.id ||
        typeof proposal?.requestId !== 'string' || !proposal.requestId) {
      throw new Error('original proposal evidence unavailable');
    }
    const evidence = restoreEvidence(proposal.requestId, proposal.visibility);
    if (historical && !evidence) throw new Error('original proposal evidence unavailable');
    if (proposal.resultUnknown && !evidence) throw new Error('unknown request evidence unavailable');
    const session = evidence?.session ?? crypto.randomUUID();
    return mountProposalConfirmation({ core, proposal: {
      requestId: proposal.requestId, proposalId: proposal.id, page: proposal.page,
      scope: proposal.scope, visibility: proposal.visibility, body: proposal.body,
      quote: proposal.quote, prefix: proposal.prefix, suffix: proposal.suffix,
      color: proposal.color, style: proposal.style
    }, session, host, resumeExisting: Boolean(evidence) });
  }

  return Object.freeze({ mount, restoreEvidence, prune: () => core.prune() });
}
