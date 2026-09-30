const claimAsText = (value) => (value == null ? '' : String(value).trim());
// Fixed-width UTF-16 code units distinguish every canonical key without Node APIs.
const claimEncode = (value) => claimAsText(value).split('').map((character) => character.charCodeAt(0).toString(16).padStart(4, '0')).join('');
const claimStableId = (prefix, ...parts) => `${prefix}-${parts.map(claimEncode).join('-')}`;

export function prepareDispatchClaim({ action, claimToken, requestId } = {}) {
  const dispatchKey = claimAsText(action?.dispatch_key);
  const token = claimAsText(claimToken);
  if (!dispatchKey || !token) return { ...(action ?? {}), claim_token: token };
  return {
    ...(action ?? {}),
    status: 'CLAIMED',
    claim_token: token,
    operation_id: claimAsText(action.operation_id) || claimStableId('op-dispatch', dispatchKey),
    request_id: claimAsText(requestId) || claimStableId('req-dispatch', dispatchKey, token),
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
