import { hasPermission } from './authorize-command.mjs';

const asText = (value) => (value == null ? '' : String(value).trim());
const failure = (errorCode, errorId) => ({ ok: false, response: { status: 'ERROR', error_code: errorCode, error_id: errorId }, write_plan: [] });

export function planRetry({ actorUserId, errorId, permissionCode, tables, now = new Date().toISOString() } = {}) {
  const id = asText(errorId);
  const row = (tables?.ERROR_BIA ?? []).find((candidate) => asText(candidate.error_id) === id && asText(candidate.status).toUpperCase() !== 'RESOLVED');
  if (!asText(permissionCode) || !hasPermission({ actorUserId, permissionCode, tables, now })) return failure('USER_NOT_AUTHORIZED', `err-${id || 'unknown'}-retry-denied`);
  if (!row) return failure('ERROR_NOT_FOUND', `err-${id || 'unknown'}-not-found`);
  if (!['YES', 'TRUE', '1'].includes(asText(row.retryable).toUpperCase())) return failure('ERROR_NOT_RETRYABLE', id);
  const operationId = asText(row.operation_id);
  const idempotencyKey = asText(row.request_id) || operationId;
  return {
    ok: true,
    retry: {
      error_id: id,
      operation_id: operationId,
      idempotency_key: idempotencyKey,
      envelope: {
        request_id: idempotencyKey,
        operation_id: operationId,
        event_type: 'MANUAL_RETRY',
        actor_user_id: asText(actorUserId),
        branch_id: null,
        business_date: null,
        config_version: asText(row.config_version) || null,
        payload: { error_id: id, retry_of: operationId, idempotency_key: idempotencyKey },
      },
    },
    write_plan: [],
  };
}
