const asText = (value) => (value == null ? '' : String(value).trim());
const active = (row) => ['ACTIVE', 'OPEN', 'IN_PROGRESS'].includes(asText(row?.status).toUpperCase());
const stableId = (prefix, value) => `${prefix}-${asText(value).replace(/[^A-Za-z0-9_-]/g, '_')}`;

function auditRow({ envelope, sessionId, outcome, now }) {
  return {
    event_id: stableId('evt-session', envelope.payload?.dispatch_key || envelope.operation_id),
    event_type: 'INVENTORY_SESSION_DISPATCH',
    request_id: asText(envelope.request_id),
    operation_id: asText(envelope.operation_id),
    actor_user_id: asText(envelope.actor_user_id) || 'SYSTEM',
    branch_id: asText(envelope.branch_id),
    topic_type: 'KIEM_KE',
    command: '/kiemke',
    outcome,
    error_code: '',
    created_at: now,
    trang_thai: 'ACTIVE',
  };
}

export function openOrReuseInventorySession({ envelope, configSnapshotId, topics = [], sessions = [], now = new Date().toISOString() } = {}) {
  if (!envelope?.request_id || !envelope?.operation_id || !envelope?.branch_id || !envelope?.business_date || !configSnapshotId) {
    return { ok: false, status: 'ERROR', error_code: 'SESSION_CONTEXT_INVALID', write_plan: [] };
  }
  const existing = (sessions ?? []).find((row) => asText(row.branch_id) === asText(envelope.branch_id) && active(row));
  if (existing) {
    return {
      ok: true,
      status: 'REUSED',
      session: { ...existing },
      write_plan: [{ sheet: 'EVENT_LOG', action: 'APPEND_OR_UPDATE', match: { event_id: stableId('evt-session', envelope.payload?.dispatch_key || envelope.operation_id) }, row: auditRow({ envelope, sessionId: asText(existing.session_id), outcome: 'REUSED_ACTIVE_SESSION', now }) }],
    };
  }
  const topic = (topics ?? []).find((row) => asText(row.branch_id) === asText(envelope.branch_id) && asText(row.topic_type).toUpperCase() === 'KIEM_KE' && asText(row.trang_thai).toUpperCase() === 'ACTIVE');
  if (!topic) return { ok: false, status: 'ERROR', error_code: 'INVENTORY_TOPIC_NOT_CONFIGURED', write_plan: [] };
  const dispatchKey = asText(envelope.payload?.dispatch_key) || asText(envelope.operation_id);
  const sessionId = stableId('session', dispatchKey);
  const session = {
    session_id: sessionId,
    branch_id: asText(envelope.branch_id),
    business_date: asText(envelope.business_date),
    config_snapshot_id: asText(configSnapshotId),
    topic_id: asText(topic.topic_id),
    chat_id: asText(topic.chat_id),
    message_thread_id: asText(topic.message_thread_id),
    dispatch_key: dispatchKey,
    status: 'ACTIVE',
    created_at: now,
    updated_at: now,
    topic_action: 'REUSE_TOPIC',
  };
  return {
    ok: true,
    status: 'OPENED',
    session,
    write_plan: [
      { sheet: 'PHIEN_KIEM_KE', action: 'APPEND_OR_UPDATE', match: { session_id: sessionId }, row: session },
      { sheet: 'EVENT_LOG', action: 'APPEND_OR_UPDATE', match: { event_id: stableId('evt-session', dispatchKey) }, row: auditRow({ envelope, sessionId, outcome: 'OPENED', now }) },
    ],
  };
}
