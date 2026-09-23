const claimAsText = (value) => (value == null ? '' : String(value).trim());
const claimStableId = (prefix, value) => `${prefix}-${claimAsText(value).replace(/[^A-Za-z0-9_-]/g, '_')}`;

export function prepareDispatchClaim({ action, claimToken, requestId } = {}) {
  const dispatchKey = claimAsText(action?.dispatch_key);
  const token = claimAsText(claimToken);
  if (!dispatchKey || !token) return { ...(action ?? {}), claim_token: token };
  return {
    ...(action ?? {}),
    status: 'CLAIMED',
    claim_token: token,
    operation_id: claimAsText(action.operation_id) || claimStableId('op-dispatch', dispatchKey),
    request_id: claimAsText(requestId) || claimStableId('req-dispatch', `${dispatchKey}:${token}`),
  };
}

export function verifyDispatchClaim({ action, persistedRow } = {}) {
  const dispatchKey = claimAsText(action?.dispatch_key);
  const claimToken = claimAsText(action?.claim_token);
  const row = persistedRow ?? {};
  return Boolean(
    dispatchKey &&
    claimToken &&
    claimAsText(row.dispatch_key) === dispatchKey &&
    claimAsText(row.claim_token) === claimToken &&
    ['CLAIMED', 'RUNNING'].includes(claimAsText(row.status).toUpperCase()),
  );
}
