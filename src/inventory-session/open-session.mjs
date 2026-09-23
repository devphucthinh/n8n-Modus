const asText = (value) => (value == null ? '' : String(value).trim());
const active = (row) => ['ACTIVE', 'OPEN', 'IN_PROGRESS'].includes(asText(row?.status).toUpperCase());
const stableId = (prefix, value) => `${prefix}-${asText(value).replace(/[^A-Za-z0-9_-]/g, '_')}`;

function auditRow({ envelope, outcome, now }) {
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

function operationRow({ envelope, dispatchKey, operationType, expectedRowCount, now }) {
  return {
    operation_id: asText(envelope.operation_id),
    request_id: asText(envelope.request_id),
    operation_type: operationType,
    idempotency_key: dispatchKey,
    expected_row_count: expectedRowCount,
    actual_row_count: '',
    checksum: '',
    status: 'PREPARED',
    error_id: '',
    created_at: now,
    updated_at: now,
  };
}

function stagedAuditRow({ envelope, outcome, now }) {
  return { ...auditRow({ envelope, outcome, now }), trang_thai: 'PREPARED' };
}

function stagedSessionRow(session) {
  return { ...session, status: 'PREPARED' };
}

function configuredValue(rows, key) {
  return asText((rows ?? []).find((row) => asText(row.config_key) === key && asText(row.trang_thai).toUpperCase() !== 'INACTIVE')?.config_value);
}

function resolveInventoryTopic({ topics, branch, configGlobal, createdTopic } = {}) {
  const branchId = asText(branch?.branch_id);
  const existing = (topics ?? []).find((row) => asText(row.branch_id) === branchId && asText(row.topic_type).toUpperCase() === 'KIEM_KE' && asText(row.trang_thai).toUpperCase() === 'ACTIVE');
  if (existing) return { topic: existing, topicAction: 'REUSE_TOPIC' };

  const chatId = asText(branch?.forum_chat_id);
  const topicNameTemplate = configuredValue(configGlobal, 'INVENTORY_TOPIC_NAME_TEMPLATE') || configuredValue(configGlobal, 'INVENTORY_TOPIC_NAME');
  const topicName = topicNameTemplate.replaceAll('{branch_id}', branchId).replaceAll('{branch_name}', asText(branch?.branch_name));
  const topicId = stableId('topic', `${branchId}-KIEM_KE`);
  const threadId = asText(createdTopic?.message_thread_id || createdTopic?.result?.message_thread_id);
  if (threadId) {
    const topic = {
      topic_id: topicId,
      branch_id: branchId,
      topic_type: 'KIEM_KE',
      chat_id: chatId,
      message_thread_id: threadId,
      trang_thai: 'ACTIVE',
    };
    return {
      topic,
      topicAction: 'CREATE_TOPIC',
      configTopicRow: { ...topic, trang_thai: 'PREPARED' },
    };
  }
  if (createdTopic) return { error_code: 'INVENTORY_TOPIC_CREATE_FAILED' };
  if (!branchId || !chatId || !topicName) {
    return { error_code: 'INVENTORY_TOPIC_NOT_CONFIGURED' };
  }
  return {
    needsCreation: true,
    topic_request: { method: 'createForumTopic', chat_id: chatId, name: topicName },
    configTopicRow: {
      topic_id: topicId,
      branch_id: branchId,
      topic_type: 'KIEM_KE',
      chat_id: chatId,
      message_thread_id: '',
      trang_thai: 'ACTIVE',
    },
  };
}

function commitOperationPlan({ operation, audit, session, topic, now }) {
  const commitPlan = [];
  if (topic) {
    commitPlan.push({
      sheet: 'CONFIG_TOPIC',
      phase: 'COMMIT',
      action: 'UPDATE',
      match: { topic_id: topic.topic_id },
      patch: { message_thread_id: topic.message_thread_id, trang_thai: 'ACTIVE' },
    });
  }
  if (session) {
    commitPlan.push({
      sheet: 'PHIEN_KIEM_KE',
      phase: 'COMMIT',
      action: 'UPDATE',
      match: { session_id: session.session_id },
      patch: { status: 'ACTIVE', updated_at: now },
    });
  }
  commitPlan.push({
    sheet: 'EVENT_LOG',
    phase: 'COMMIT',
    action: 'UPDATE',
    match: { event_id: audit.event_id },
    patch: { trang_thai: 'COMMITTED' },
  });
  commitPlan.push({
    sheet: 'OPERATION',
    phase: 'COMMIT',
    action: 'UPDATE',
    match: { operation_id: operation.operation_id },
    patch: { status: 'COMMITTED', actual_row_count: operation.expected_row_count, updated_at: now },
  });
  return commitPlan;
}

export function openOrReuseInventorySession({ envelope, configSnapshotId, topics = [], sessions = [], branch = null, configGlobal = [], createdTopic = null, now = new Date().toISOString() } = {}) {
  if (!envelope?.request_id || !envelope?.operation_id || !envelope?.branch_id || !envelope?.business_date || !configSnapshotId) {
    return { ok: false, status: 'ERROR', error_code: 'SESSION_CONTEXT_INVALID', write_plan: [] };
  }
  const dispatchKey = asText(envelope.payload?.dispatch_key) || asText(envelope.operation_id);
  const existing = (sessions ?? []).find((row) => asText(row.branch_id) === asText(envelope.branch_id) && active(row));
  if (existing) {
    const operation = operationRow({ envelope, dispatchKey, operationType: 'REUSE_INVENTORY_SESSION', expectedRowCount: 2, now });
    const audit = stagedAuditRow({ envelope, outcome: 'REUSED_ACTIVE_SESSION', now });
    return {
      ok: true,
      status: 'REUSED',
      session: { ...existing },
      operation,
      write_plan: [
        { sheet: 'OPERATION', phase: 'PREPARE', action: 'APPEND_OR_UPDATE', match: { operation_id: operation.operation_id }, row: operation },
        { sheet: 'EVENT_LOG', phase: 'PREPARE', action: 'APPEND_OR_UPDATE', match: { event_id: audit.event_id }, row: audit },
      ],
      commit_plan: commitOperationPlan({ operation, audit, now }),
    };
  }
  const topicResult = resolveInventoryTopic({ topics, branch: branch || { branch_id: envelope.branch_id }, configGlobal, createdTopic });
  if (topicResult.needsCreation) {
    return {
      ok: false,
      status: 'TOPIC_CREATE_REQUIRED',
      error_code: 'INVENTORY_TOPIC_CREATE_REQUIRED',
      topic_request: topicResult.topic_request,
      config_topic_row: topicResult.configTopicRow,
      write_plan: [],
    };
  }
  if (!topicResult.topic) return { ok: false, status: 'ERROR', error_code: topicResult.error_code || 'INVENTORY_TOPIC_NOT_CONFIGURED', write_plan: [] };
  const topic = topicResult.topic;
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
    topic_action: topicResult.topicAction,
  };
  const topicWrite = topicResult.configTopicRow ? {
    sheet: 'CONFIG_TOPIC',
    phase: 'PREPARE',
    action: 'APPEND_OR_UPDATE',
    match: { topic_id: topic.topic_id },
    row: topicResult.configTopicRow,
  } : null;
  const expectedRowCount = topicWrite ? 4 : 3;
  const operation = operationRow({ envelope, dispatchKey, operationType: 'OPEN_INVENTORY_SESSION', expectedRowCount, now });
  const audit = stagedAuditRow({ envelope, outcome: 'OPENED', now });
  return {
    ok: true,
    status: 'OPENED',
    session,
    operation,
    write_plan: [
      { sheet: 'OPERATION', phase: 'PREPARE', action: 'APPEND_OR_UPDATE', match: { operation_id: operation.operation_id }, row: operation },
      ...(topicWrite ? [topicWrite] : []),
      { sheet: 'PHIEN_KIEM_KE', phase: 'PREPARE', action: 'APPEND_OR_UPDATE', match: { session_id: sessionId }, row: stagedSessionRow(session) },
      { sheet: 'EVENT_LOG', phase: 'PREPARE', action: 'APPEND_OR_UPDATE', match: { event_id: audit.event_id }, row: audit },
    ],
    topic_write_plan: topicWrite ? [topicWrite] : [],
    commit_plan: commitOperationPlan({ operation, audit, session, topic: topicWrite ? topic : null, now }),
  };
}
