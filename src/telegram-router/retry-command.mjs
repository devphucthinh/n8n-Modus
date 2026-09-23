import { authorizeCommand } from './authorize-command.mjs';

const retryText = (value) => (value == null ? '' : String(value).trim());
const retryFailure = (errorCode, errorId) => ({ ok: false, response: { status: 'ERROR', error_code: errorCode, error_id: errorId }, write_plan: [] });

export function planRetry({ actorUserId, errorId, permissionCode, topic = null, tables, now = new Date().toISOString() } = {}) {
  const id = retryText(errorId);
  const row = (tables?.ERROR_BIA ?? []).find((candidate) => retryText(candidate.error_id) === id && retryText(candidate.status).toUpperCase() !== 'RESOLVED');
  const authorizationTopic = topic ?? { branch_id: '*', trang_thai: 'ACTIVE' };
  const authorization = authorizeCommand({ actorUserId, command: '/retry', topic: authorizationTopic, tables, now });
  if (!retryText(permissionCode) || !authorization.allowed || authorization.permission_code !== retryText(permissionCode)) return retryFailure('USER_NOT_AUTHORIZED', `err-${id || 'unknown'}-retry-denied`);
  if (!row) return retryFailure('ERROR_NOT_FOUND', `err-${id || 'unknown'}-not-found`);
  if (!['YES', 'TRUE', '1'].includes(retryText(row.retryable).toUpperCase())) return retryFailure('ERROR_NOT_RETRYABLE', id);
  const operationId = retryText(row.operation_id);
  const originalOperation = (tables?.OPERATION ?? []).find((candidate) => retryText(candidate.operation_id) === operationId);
  const idempotencyKey = retryText(row.idempotency_key) || retryText(originalOperation?.idempotency_key);
  const requestId = retryText(row.request_id) || retryText(originalOperation?.request_id);
  const branchId = retryText(row.branch_id);
  const branchScopeMismatch = !authorization.global_scope && branchId !== authorization.branch_id;
  if (!branchId) return retryFailure('ERROR_BRANCH_MISSING', id);
  if (branchScopeMismatch) return retryFailure('USER_NOT_AUTHORIZED', `err-${id}-retry-branch-denied`);
  if (!idempotencyKey) return retryFailure('ERROR_IDEMPOTENCY_MISSING', id);
  if (!operationId || !requestId) return retryFailure('ERROR_RETRY_CONTEXT_MISSING', id);
  // ERROR_BIA and OPERATION persist identifiers and retryability, not the
  // original request payload. Reconstructing an empty command here could
  // replay a different business action, so retry must fail closed.
  return retryFailure('ERROR_RETRY_CONTEXT_MISSING', id);
}
