import { sha256Hex } from '../contracts.mjs';

const ERROR_CLASSES = new Set(['VALIDATION', 'AUTHORIZATION', 'CONFLICT', 'TRANSIENT', 'CONFIGURATION', 'EXTERNAL', 'SYSTEM', 'MANUAL_REVIEW']);

export function handleWorkflowError({ error, context, replyTarget, policy, now }) {
  const safeId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : null;
  const safeWorkflow = (value) => typeof value === 'string' && /^WF\d{2}$/.test(value) ? value : null;
  const safeNode = (value) => typeof value === 'string' && /^[A-Za-z0-9 _-]{1,80}$/.test(value) ? value : null;
  const inferredClass = error?.error_code === 'USER_NOT_ACTIVE'
    ? 'AUTHORIZATION'
    : error?.error_code === 'ENVELOPE_INVALID'
      ? 'VALIDATION'
      : ['CONFIG_VERSION_AMBIGUOUS', 'CONFIG_VERSION_NOT_INCREMENTED', 'CONFIG_VERSION_EMPTY_CHANGE', 'CONFIG_VERSION_SCOPE_MISMATCH', 'CONFIG_VERSION_FINGERPRINT_MISMATCH', 'CONFIG_SNAPSHOT_SCOPE_MISMATCH', 'OPERATION_IDEMPOTENCY_CONFLICT'].includes(error?.error_code)
        ? 'CONFLICT'
        : 'SYSTEM';
  const errorClass = ERROR_CLASSES.has(error?.error_class) ? error.error_class : inferredClass;
  const retryable = errorClass === 'TRANSIENT';
  const errorCode = typeof error?.error_code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(error.error_code) ? error.error_code : 'UNEXPECTED_ERROR';
  const requestId = safeId(context?.request_id);
  const operationId = safeId(context?.operation_id);
  const workflowCode = safeWorkflow(context?.workflow_code);
  const nodeName = safeNode(context?.node_name);
  const executionId = safeId(context?.execution_id);
  const configSnapshotId = safeId(context?.config_snapshot_id);
  const branchId = safeId(context?.branch_id);
  const actorUserId = safeId(context?.actor_user_id);
  const businessDate = typeof context?.business_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(context.business_date) ? context.business_date : null;
  const replyChatId = typeof replyTarget?.chat_id === 'string' && /^-?\d{1,20}$/.test(replyTarget.chat_id) ? replyTarget.chat_id : null;
  const replyThreadId = typeof replyTarget?.message_thread_id === 'string' && /^\d{1,20}$/.test(replyTarget.message_thread_id) ? replyTarget.message_thread_id : null;
  const safeReplyTarget = replyChatId ? { chat_id: replyChatId, message_thread_id: replyThreadId } : null;
  const identity = requestId || operationId
    ? JSON.stringify([requestId, operationId, workflowCode, nodeName, errorCode])
    : JSON.stringify([executionId, workflowCode, nodeName, errorCode]);
  const errorId = `err-${sha256Hex(identity)}`;
  const messageSafe = `Không thể hoàn tất thao tác. Mã lỗi: ${errorId}`;
  const safeContext = { request_id: requestId, operation_id: operationId, workflow_code: workflowCode, node_name: nodeName, execution_id: executionId, config_snapshot_id: configSnapshotId, branch_id: branchId, actor_user_id: actorUserId, business_date: businessDate };
  const row = { error_id: errorId, operation_id: operationId, request_id: requestId, workflow_code: workflowCode, node_name: nodeName, error_code: errorCode, error_class: errorClass, retryable, message_safe: messageSafe, sanitized_context_json: JSON.stringify(safeContext), branch_id: branchId, actor_user_id: actorUserId, business_date: businessDate, status: 'OPEN', created_at: now, updated_at: now };
  const enabled = (value) => value === true || value === 'TRUE' || value === 'YES';
  const active = (entry) => (entry?.trang_thai ?? entry?.status) === 'ACTIVE';
  const rule = Array.isArray(policy?.notifications) ? policy.notifications.find((entry) => entry && typeof entry === 'object' && entry.event_type === 'WF02_ERROR' && (entry.branch_id === branchId || entry.branch_id === '*') && enabled(entry.enabled) && active(entry) && typeof entry.template_text === 'string' && entry.template_text.length > 0) : null;
  const topic = rule && Array.isArray(policy?.topics) ? policy.topics.find((entry) => entry && typeof entry === 'object' && entry.topic_type === rule.topic_type && (entry.branch_id === branchId || entry.branch_id === '*') && active(entry) && typeof entry.chat_id === 'string' && /^-?\d{1,20}$/.test(entry.chat_id)) : null;
  const cooldownMinutes = Number(rule?.cooldown_minutes);
  const withinCooldown = Number.isFinite(cooldownMinutes) && cooldownMinutes > 0 && Array.isArray(policy?.delivered_events) && policy.delivered_events.some((prior) => {
    if (prior?.event_type !== 'WF02_NOTIFICATION_DELIVERED' || prior?.status !== 'COMMITTED') return false;
    let details;
    try { details = JSON.parse(prior.event_payload_json ?? '{}'); } catch { return false; }
    const sameError = details.error_id === errorId;
    const sameFingerprint = details.error_code === errorCode && details.error_class === errorClass && details.workflow_code === workflowCode && details.branch_id === branchId;
    if (!sameError && !sameFingerprint) return false;
    const age = Date.parse(now) - Date.parse(prior.created_at);
    return Number.isFinite(age) && age >= 0 && age < cooldownMinutes * 60000;
  });
  const substitutions = { error_id: errorId, error_code: errorCode, error_class: errorClass, workflow_code: workflowCode, node_name: nodeName, request_id: requestId, operation_id: operationId, branch_id: branchId, business_date: businessDate };
  const template = rule?.template_text ?? '';
  const renderedTemplate = template.replace(/\{\{([a-z_]+)\}\}/g, (_token, key) => Object.hasOwn(substitutions, key) && substitutions[key] != null ? String(substitutions[key]) : '');
  const notification = topic && !withinCooldown ? { send: true, notification_code: rule.notification_code, chat_id: topic.chat_id, message_thread_id: typeof topic.message_thread_id === 'string' && /^\d{1,20}$/.test(topic.message_thread_id) ? topic.message_thread_id : null, text: renderedTemplate } : { send: false };
  return { ok: false, status: 'FAILED', error_id: errorId, error_code: errorCode, error_class: errorClass, retryable, message_safe: messageSafe, request_id: requestId, operation_id: operationId, workflow_code: workflowCode, reply_target: safeReplyTarget, error_row: row, notification };
}

export function makeNotificationDeliveredEvent({ errorRecord, deliveredAt }) {
  if (errorRecord?.notification?.send !== true) return null;
  const row = errorRecord.error_row ?? {};
  const errorId = row.error_id;
  const eventId = `${errorId}-delivered-${Date.parse(deliveredAt)}`;
  return {
    event_id: eventId,
    operation_id: `op-${errorId}`,
    request_id: row.request_id ?? null,
    event_type: 'WF02_NOTIFICATION_DELIVERED',
    source_workflow: 'WF02',
    actor_user_id: row.actor_user_id ?? null,
    branch_id: row.branch_id ?? null,
    business_date: row.business_date ?? null,
    entity_type: 'ERROR_BIA',
    entity_id: errorId,
    idempotency_key: eventId,
    event_payload_json: JSON.stringify({ error_id: errorId, error_code: row.error_code, error_class: row.error_class, workflow_code: row.workflow_code, branch_id: row.branch_id, notification_code: errorRecord.notification.notification_code ?? null }),
    status: 'COMMITTED',
    created_at: deliveredAt,
  };
}

export function planErrorTransaction({ errorRecord, operationalState = {}, now }) {
  const source = errorRecord?.error_row ?? {};
  const errorId = typeof source.error_id === 'string' ? source.error_id : 'err-unknown';
  const operationId = `op-${errorId}`;
  const requestId = typeof source.request_id === 'string' ? source.request_id : null;
  let safeContext = {};
  try { safeContext = JSON.parse(source.sanitized_context_json ?? '{}'); } catch { safeContext = {}; }
  const configSnapshotId = typeof safeContext.config_snapshot_id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(safeContext.config_snapshot_id) ? safeContext.config_snapshot_id : null;
  const eventId = `${errorId}-event`;
  const operations = Array.isArray(operationalState.operations) ? operationalState.operations : [];
  const errorRows = Array.isArray(operationalState.errorRows) ? operationalState.errorRows : [];
  const eventRows = Array.isArray(operationalState.eventRows) ? operationalState.eventRows : [];
  const committed = operations.some((row) => row?.operation_id === operationId && row?.status === 'COMMITTED' && row?.commit_state === 'COMMITTED');
  const preparedKey = `${operationId}:PREPARED`;
  const hasPrepared = operations.some((row) => row?.operation_id === operationId && row?.idempotency_key === preparedKey);
  const errorRow = { ...source, error_id: errorId, operation_id: operationId, status: 'PREPARED' };
  const eventRow = {
    event_id: eventId,
    operation_id: operationId,
    request_id: requestId,
    event_type: 'WF02_ERROR',
    source_workflow: source.workflow_code ?? 'WF02',
    actor_user_id: source.actor_user_id ?? null,
    branch_id: source.branch_id ?? null,
    business_date: source.business_date ?? null,
    entity_type: 'ERROR_BIA',
    entity_id: errorId,
    idempotency_key: eventId,
    event_payload_json: JSON.stringify({ error_id: errorId, error_code: source.error_code, error_class: source.error_class, retryable: source.retryable }),
    status: 'PREPARED',
    created_at: source.created_at ?? now,
  };
  const operationBase = {
    operation_id: operationId,
    request_id: requestId,
    event_type: 'WF02_ERROR',
    branch_id: source.branch_id ?? null,
    actor_user_id: source.actor_user_id ?? null,
    business_date: source.business_date ?? null,
    config_snapshot_id: source.config_snapshot_id ?? configSnapshotId,
    workflow_code: 'WF02',
    status: 'PREPARED',
    commit_state: 'PREPARED',
    attempt_number: 1,
    retryable: source.retryable === true,
    error_code: source.error_code,
    error_id: errorId,
    started_at: source.created_at ?? now,
    created_at: source.created_at ?? now,
    updated_at: now,
  };
  const preparedOperation = { ...operationBase, idempotency_key: preparedKey };
  const commitOperation = { ...operationBase, idempotency_key: `${operationId}:COMMITTED`, status: 'COMMITTED', commit_state: 'COMMITTED', committed_at: now };
  const hasError = errorRows.some((row) => row?.error_id === errorId && row?.operation_id === operationId);
  const hasEvent = eventRows.some((row) => row?.event_id === eventId && row?.operation_id === operationId);
  return {
    operation_id: operationId,
    append_prepared_operation: !committed && !hasPrepared,
    append_error_record: !hasError,
    append_event_record: !hasEvent,
    append_commit_operation: !committed,
    prepared_operation: preparedOperation,
    error_row: errorRow,
    event_row: eventRow,
    commit_operation: commitOperation,
  };
}

export function visibleCommittedRows(rows, operations) {
  const committedIds = new Set((Array.isArray(operations) ? operations : [])
    .filter((row) => row?.status === 'COMMITTED' && row?.commit_state === 'COMMITTED')
    .map((row) => row.operation_id));
  return (Array.isArray(rows) ? rows : []).filter((row) => committedIds.has(row?.operation_id));
}

export function safeSystemFallback(original) {
  const safeId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : null;
  const reply = original?.reply_target;
  const replyTarget = reply && typeof reply.chat_id === 'string' && /^-?\d{1,20}$/.test(reply.chat_id)
    ? { chat_id: reply.chat_id, message_thread_id: typeof reply.message_thread_id === 'string' && /^\d{1,20}$/.test(reply.message_thread_id) ? reply.message_thread_id : null }
    : null;
  return {
    ok: false,
    status: 'ERROR_HANDLER_FAILED',
    error_id: safeId(original?.error_id),
    error_code: 'WF02_HANDLER_FAILED',
    original_error_code: typeof original?.error_code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(original.error_code) ? original.error_code : 'UNEXPECTED_ERROR',
    original_error_class: ERROR_CLASSES.has(original?.error_class) ? original.error_class : 'SYSTEM',
    request_id: safeId(original?.request_id ?? original?.error_row?.request_id),
    operation_id: safeId(original?.operation_id ?? original?.error_row?.operation_id),
    workflow_code: typeof original?.workflow_code === 'string' && /^WF\d{2}$/.test(original.workflow_code) ? original.workflow_code : null,
    reply_target: replyTarget,
    error_class: 'SYSTEM',
    retryable: false,
    message_safe: `Không thể hoàn tất thao tác. Mã lỗi: ${safeId(original?.error_id) ?? 'không xác định'}`,
  };
}
