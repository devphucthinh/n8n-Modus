import { authorizeCommand } from './authorize-command.mjs';

const retryText = (value) => (value == null ? '' : String(value).trim());
const failure = (errorCode, errorId) => ({ ok: false, response: { status: 'ERROR', error_code: errorCode, error_id: errorId }, write_plan: [] });

export function planRetry({ actorUserId, errorId, permissionCode, topic, tables, now = new Date().toISOString() } = {}) {
  const id = retryText(errorId);
  const command = (tables?.CONFIG_LENH ?? []).find((candidate) => retryText(candidate.trang_thai).toUpperCase() === 'ACTIVE'
    && retryText(candidate.command_text).toLowerCase() === '/retry');
  const configuredPermission = retryText(command?.permission_code);
  const authorization = authorizeCommand({ actorUserId, command: '/retry', topic, tables, now });
  if (!configuredPermission || (retryText(permissionCode) && retryText(permissionCode) !== configuredPermission) || !authorization.allowed) {
    return failure('USER_NOT_AUTHORIZED', `err-${id || 'unknown'}-retry-denied`);
  }
  const row = (tables?.ERROR_BIA ?? []).find((candidate) => retryText(candidate.error_id) === id && retryText(candidate.status).toUpperCase() !== 'RESOLVED');
  if (!row) return failure('ERROR_NOT_FOUND', `err-${id || 'unknown'}-not-found`);
  if (!['YES', 'TRUE', '1'].includes(retryText(row.retryable).toUpperCase())) return failure('ERROR_NOT_RETRYABLE', id);
  const operationId = retryText(row.operation_id);
  const operation = (tables?.OPERATION ?? []).find((candidate) => retryText(candidate.operation_id) === operationId);
  const idempotencyKey = retryText(operation?.idempotency_key) || retryText(row.request_id) || operationId;
  return {
    ...failure('RETRY_PAYLOAD_UNAVAILABLE', `err-${id || 'unknown'}-retry-payload-unavailable`),
    retry: { error_id: id, operation_id: operationId, idempotency_key: idempotencyKey },
  };
}
