// Read-only controller. Construct only with the site's authenticated annotation session.
export function createAnnotationRequestStatus({ core }) {
  const auth = window.__aipmAnnoAuth;
  const store = window.__aipmAnnoStore;
  if (!core || !auth || !store) throw new TypeError('dependencies');

  function actor() {
    const user = auth.user();
    const token = auth.token();
    if (!Number.isSafeInteger(user?.githubId) || user.githubId <= 0 ||
        typeof token !== 'string' || !token) throw new Error('authentication required');
    return { identity: String(user.githubId), token };
  }

  async function query(requestId) {
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) {
      throw new TypeError('requestId');
    }
    const local = core.inspectOwned({ identity: 'local', requestId });
    if (local && (local.visibility === 'local' || local.request?.visibility === 'local')) {
      if (!['unknown', 'executing'].includes(local.status)) {
        return { status: local.status, annotationId: local.annotationId ?? null };
      }
      const matches = store.localList(local.page ?? local.request?.page)
        .filter((item) => item.requestId === requestId);
      if (matches.length !== 1 || !local.request || matches[0].visibility !== 'local' ||
          matches[0].page !== local.request.page || matches[0].body !== local.request.body ||
          matches[0].color !== local.request.color || matches[0].style !== local.request.style ||
          matches[0].target?.scope !== (local.request.scope === 'page' ? 'page' : undefined) ||
          JSON.stringify(matches[0].target?.selectors) !== JSON.stringify(local.request.scope === 'page' ? [] :
            [{ type: 'TextQuoteSelector', exact: local.request.quote,
              prefix: local.request.prefix, suffix: local.request.suffix }]) ||
          typeof matches[0].id !== 'string' || !matches[0].id) return { status: 'indeterminate' };
      const annotationId = matches[0].id;
      const evidence = { identity: local.identity, session: local.session, site: local.site,
        requestId, digest: local.digest, source: 'read_result', status: 'succeeded', annotationId };
      core.settle({ identity: local.identity, session: local.session, requestId,
        status: 'succeeded', annotationId, evidence });
      return { status: 'succeeded', annotationId };
    }

    const { identity, token } = actor();
    const original = core.inspectOwned({ identity, requestId });
    if (!original) return null;
    if (original.request?.visibility === 'local' || original.visibility === 'local') {
      return { status: original.status, annotationId: original.annotationId ?? null };
    }
    if (!['public', 'private'].includes(original.visibility ?? original.request?.visibility)) {
      throw new Error('original visibility unavailable');
    }
    const response = await store.request(`/api/annotation-requests/${encodeURIComponent(requestId)}`, { token });
    const current = { identity: String(auth.user()?.githubId), token: auth.token() };
    if (current.identity !== identity || current.token !== token) return { status: 'indeterminate' };
    const latest = core.inspectOwned({ identity, requestId });
    if (!latest || latest.session !== original.session || latest.digest !== original.digest ||
        latest.site !== original.site) return { status: 'indeterminate' };
    if (response.status === 404 || !response.ok) return { status: 'indeterminate' };
    const operation = response.body?.operation;
    if (operation?.status === 'pending') return { status: 'pending' };
    if (operation?.status !== 'succeeded' || operation.originalRequestKnown === false ||
        operation.page !== (original.page ?? original.request?.page) ||
        operation.visibility !== (original.visibility ?? original.request?.visibility) ||
        typeof operation.annotationId !== 'string' || !operation.annotationId) {
      return { status: 'indeterminate' };
    }
    if (latest.status === 'succeeded') {
      return latest.annotationId === operation.annotationId
        ? { status: 'succeeded', annotationId: latest.annotationId }
        : { status: 'indeterminate' };
    }
    if (latest.status !== 'unknown' && latest.status !== 'executing') {
      return { status: 'indeterminate' };
    }
    const evidence = {
      identity: original.identity, session: original.session, site: original.site,
      requestId: original.requestId, digest: original.digest,
      source: 'read_result', status: 'succeeded', annotationId: operation.annotationId
    };
    core.settle({ identity: original.identity, session: original.session,
      requestId: original.requestId, status: 'succeeded',
      annotationId: operation.annotationId, evidence });
    return { status: 'succeeded', annotationId: operation.annotationId };
  }

  return Object.freeze({ query });
}
