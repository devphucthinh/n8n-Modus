const asText = (value) => (value == null ? '' : String(value).trim());
const isCanonicalUtcIso = (value) => {
  const text = asText(value);
  const parsed = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text) ? Date.parse(text) : Number.NaN;
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === text;
};
const active = (row) => ['ACTIVE', 'OPEN', 'IN_PROGRESS'].includes(asText(row?.status).toUpperCase());
const stableId = (prefix, value) => `${prefix}-${asText(value).split('').map((character) => character.charCodeAt(0).toString(16).padStart(4, '0')).join('')}`;
const legacySessionId = (value) => `session-${asText(value).replace(/[^A-Za-z0-9_-]/g, '_')}`;

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

function freezeCatalog(beers) {
  const activeBeers = (beers ?? []).filter((row) => asText(row.trang_thai).toUpperCase() === 'ACTIVE');
  if (activeBeers.length === 0) return { error_code: 'INVENTORY_CATALOG_EMPTY' };
  const seen = new Set();
  for (const beer of activeBeers) {
    const code = asText(beer.ma_bia).toUpperCase();
    if (!code || !asText(beer.ten_bia) || !asText(beer.don_vi_dem)
      || !/^[1-9]\d*$/.test(asText(beer.thu_tu_hien_thi))) {
      return { error_code: 'INVENTORY_CATALOG_INVALID' };
    }
    if (seen.has(code)) return { error_code: 'INVENTORY_CATALOG_DUPLICATE' };
    seen.add(code);
  }
  const ordered = [...activeBeers].sort((left, right) =>
    Number(left.thu_tu_hien_thi) - Number(right.thu_tu_hien_thi)
      || asText(left.ma_bia).localeCompare(asText(right.ma_bia)));
  const snapshot = ordered.map((beer, index) => ({
    stt: index + 1,
    ma_bia: asText(beer.ma_bia),
    ten_bia: asText(beer.ten_bia),
    don_vi_dem: asText(beer.don_vi_dem),
  }));
  const json = JSON.stringify(snapshot);
  if (json.length > 49000) return { error_code: 'INVENTORY_CATALOG_TOO_LARGE' };
  return { json, count: String(snapshot.length) };
}

function inventoryPageSize(configGlobal) {
  const value = asText((configGlobal ?? []).find((row) => asText(row.config_key) === 'INVENTORY_PAGE_SIZE'
    && asText(row.trang_thai).toUpperCase() === 'ACTIVE')?.config_value);
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? value : null;
}

function resolveInventoryTopic({ topics, branch } = {}) {
  const branchId = asText(branch?.branch_id);
  const topic = (topics ?? []).find((row) => asText(row.branch_id) === branchId
    && asText(row.topic_type).toUpperCase() === 'KIEM_KE'
    && asText(row.trang_thai).toUpperCase() === 'ACTIVE'
    && asText(row.topic_id) && asText(row.chat_id) && asText(row.message_thread_id));
  return topic ? { topic } : { error_code: 'INVENTORY_TOPIC_NOT_CONFIGURED' };
}

function commitOperationPlan({ operation, audit, session, now }) {
  const commitPlan = [];
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

export function openOrReuseInventorySession({ envelope, configSnapshotId, expectedConfigSnapshotId = null, topics = [], sessions = [], operations = [], branch = null, beers = [], configGlobal = [], now = new Date().toISOString() } = {}) {
  if (!envelope?.request_id || !envelope?.operation_id || !envelope?.branch_id) {
    return { ok: false, status: 'ERROR', error_code: 'SESSION_CONTEXT_INVALID', write_plan: [] };
  }
  const eventType = asText(envelope.event_type).toUpperCase();
  if (!['SCHEDULED_JOB', 'TELEGRAM_UPDATE'].includes(eventType)) {
    return { ok: false, status: 'ERROR', error_code: 'SESSION_EVENT_UNSUPPORTED', write_plan: [] };
  }
  if (eventType === 'SCHEDULED_JOB' && !envelope.business_date) {
    return { ok: false, status: 'ERROR', error_code: 'SESSION_CONTEXT_INVALID', write_plan: [] };
  }
  if (eventType === 'SCHEDULED_JOB' && !configSnapshotId) {
    return { ok: false, status: 'ERROR', error_code: 'SESSION_CONTEXT_INVALID', write_plan: [] };
  }
  if (eventType === 'TELEGRAM_UPDATE' && asText(envelope.payload?.command).toLowerCase() !== '/kiemke') {
    return { ok: false, status: 'ERROR', error_code: 'SESSION_COMMAND_UNSUPPORTED', write_plan: [] };
  }
  const dispatchKey = asText(envelope.payload?.dispatch_key) || asText(envelope.payload?.idempotency_key) || asText(envelope.operation_id);
  const matchingOperations = (operations ?? []).filter((row) => asText(row.operation_id) === asText(envelope.operation_id));
  if (matchingOperations.length > 1) {
    return { ok: false, status: 'ERROR', error_code: 'INVENTORY_SESSION_RECONCILIATION_REQUIRED', write_plan: [] };
  }
  const claimedOperation = matchingOperations.length === 1 ? matchingOperations[0] : null;
  const reservationStatus = asText(claimedOperation?.status).toUpperCase();
  const reservationRowCount = asText(claimedOperation?.expected_row_count);
  const compatibleRouterReservationState = (reservationStatus === 'RUNNING' && reservationRowCount === '')
    || (reservationStatus === 'PREPARED' && ['1', '2'].includes(reservationRowCount));
  const routerReservation = eventType === 'TELEGRAM_UPDATE' && claimedOperation
    && asText(claimedOperation.operation_type) === 'ROUTE_COMMAND'
    && compatibleRouterReservationState
    && asText(claimedOperation.request_id) === asText(envelope.request_id)
    && asText(claimedOperation.idempotency_key) === dispatchKey
    && !asText(claimedOperation.actual_row_count)
    && !asText(claimedOperation.checksum)
    && !asText(claimedOperation.error_id)
    && isCanonicalUtcIso(claimedOperation.created_at)
    && isCanonicalUtcIso(claimedOperation.updated_at);
  if (eventType === 'TELEGRAM_UPDATE' && !routerReservation) {
    return { ok: false, status: 'ERROR', error_code: 'INVENTORY_SESSION_RECONCILIATION_REQUIRED', write_plan: [] };
  }
  const branchSessions = (sessions ?? []).filter((row) => asText(row.branch_id) === asText(envelope.branch_id));
  const activeSessions = branchSessions.filter(active);
  if (activeSessions.length > 1) {
    return { ok: false, status: 'ERROR', error_code: 'INVENTORY_SESSION_RECONCILIATION_REQUIRED', write_plan: [] };
  }
  const prepared = branchSessions.filter((row) => asText(row.status).toUpperCase() === 'PREPARED');
  if (branchSessions.some((row) => ['SEND_REQUESTED', 'RECONCILIATION_REQUIRED'].includes(asText(row.status).toUpperCase()))) {
    return { ok: false, status: 'ERROR', error_code: 'INVENTORY_SESSION_RECONCILIATION_REQUIRED', write_plan: [] };
  }
  if (prepared.length > 0) {
    const staged = prepared[0];
    const operation = claimedOperation;
    let catalog = null;
    try { catalog = JSON.parse(asText(staged.catalog_snapshot_json)); } catch { /* A broken frozen catalog cannot be replayed. */ }
    const recoverable = eventType === 'SCHEDULED_JOB' && prepared.length === 1 && !branchSessions.some(active)
      && [stableId('session', dispatchKey), legacySessionId(dispatchKey)].includes(asText(staged.session_id))
      && (sessions ?? []).filter((row) => asText(row.session_id) === asText(staged.session_id)).length === 1
      && asText(staged.dispatch_key) === dispatchKey
      && asText(staged.business_date) === asText(envelope.business_date)
      && asText(expectedConfigSnapshotId)
      && asText(staged.config_snapshot_id) === asText(expectedConfigSnapshotId)
      && asText(staged.topic_id) && asText(staged.chat_id) && asText(staged.message_thread_id)
      && Array.isArray(catalog) && catalog.length > 0 && String(catalog.length) === asText(staged.catalog_count)
      && /^[1-9]\d*$/.test(asText(staged.page_size))
      && asText(staged.bubble_state).toUpperCase() === 'NONE' && !asText(staged.master_message_id)
      && asText(staged.created_at) && operation
      && asText(operation.operation_type) === 'OPEN_INVENTORY_SESSION'
      && asText(operation.idempotency_key) === dispatchKey
      && asText(operation.status).toUpperCase() === 'PREPARED'
      && asText(operation.expected_row_count) === '3' && asText(operation.created_at);
    if (!recoverable) {
      return { ok: false, status: 'ERROR', error_code: 'INVENTORY_SESSION_RECONCILIATION_REQUIRED', write_plan: [] };
    }
    const session = { ...staged, status: 'ACTIVE', updated_at: now };
    const audit = stagedAuditRow({ envelope, outcome: 'OPENED', now });
    if (asText(staged.session_id) === legacySessionId(dispatchKey)) {
      audit.event_id = `evt-session-${asText(dispatchKey).replace(/[^A-Za-z0-9_-]/g, '_')}`;
    }
    return {
      ok: true,
      status: 'OPENED',
      session,
      operation: { ...operation },
      write_plan: [
        { sheet: 'OPERATION', phase: 'PREPARE', action: 'APPEND_OR_UPDATE', match: { operation_id: operation.operation_id }, row: { ...operation } },
        { sheet: 'PHIEN_KIEM_KE', phase: 'PREPARE', action: 'APPEND_OR_UPDATE', match: { session_id: session.session_id }, row: stagedSessionRow(session) },
        { sheet: 'EVENT_LOG', phase: 'PREPARE', action: 'APPEND_OR_UPDATE', match: { event_id: audit.event_id }, row: audit },
      ],
      topic_write_plan: [],
      commit_plan: commitOperationPlan({ operation, audit, session, now }),
    };
  }
  const existing = activeSessions[0] ?? null;
  if (existing) {
    const committedOpen = (operations ?? []).find((row) =>
      asText(row.idempotency_key) === asText(existing.dispatch_key)
      && asText(row.operation_type) === 'OPEN_INVENTORY_SESSION'
      && asText(row.status).toUpperCase() === 'COMMITTED');
    if (!asText(existing.session_id) || !asText(existing.config_snapshot_id)
      || !/^[1-9]\d*$/.test(asText(existing.master_message_id))
      || asText(existing.bubble_state).toUpperCase() !== 'SENT' || !committedOpen) {
      return { ok: false, status: 'ERROR', error_code: 'INVENTORY_SESSION_RECONCILIATION_REQUIRED', write_plan: [] };
    }
    const repeatedScheduledOpen = eventType === 'SCHEDULED_JOB' && dispatchKey === asText(existing.dispatch_key);
    if (claimedOperation && !(repeatedScheduledOpen && claimedOperation === committedOpen) && !routerReservation) {
      return { ok: false, status: 'ERROR', error_code: 'INVENTORY_SESSION_RECONCILIATION_REQUIRED', write_plan: [] };
    }
    if (repeatedScheduledOpen) {
      return {
        ok: true, status: 'REUSED', session: { ...existing }, operation: { ...committedOpen },
        write_plan: [], commit_plan: [],
      };
    }
    const operation = routerReservation
      ? { ...claimedOperation, expected_row_count: '2', updated_at: now }
      : operationRow({ envelope, dispatchKey, operationType: 'REUSE_INVENTORY_SESSION', expectedRowCount: 2, now });
    const audit = stagedAuditRow({ envelope, outcome: 'REUSED_ACTIVE_SESSION', now });
    return {
      ok: true,
      status: 'REUSED',
      reply_handled: eventType === 'TELEGRAM_UPDATE',
      session: { ...existing },
      operation,
      write_plan: [
        { sheet: 'OPERATION', phase: 'PREPARE', action: 'APPEND_OR_UPDATE', match: { operation_id: operation.operation_id }, row: operation },
        { sheet: 'EVENT_LOG', phase: 'PREPARE', action: 'APPEND_OR_UPDATE', match: { event_id: audit.event_id }, row: audit },
      ],
      commit_plan: commitOperationPlan({ operation, audit, now }),
    };
  }
  if (eventType === 'TELEGRAM_UPDATE') {
    return { ok: false, status: 'ERROR', error_code: 'INVENTORY_SESSION_NOT_OPEN', write_plan: [] };
  }
  if ((operations ?? []).some((row) => asText(row.operation_id) === asText(envelope.operation_id))) {
    return { ok: false, status: 'ERROR', error_code: 'INVENTORY_SESSION_RECONCILIATION_REQUIRED', write_plan: [] };
  }
  if (expectedConfigSnapshotId && asText(expectedConfigSnapshotId) !== asText(configSnapshotId)) {
    return { ok: false, status: 'ERROR', error_code: 'INVENTORY_CONFIG_SNAPSHOT_MISMATCH', write_plan: [] };
  }
  const topicResult = resolveInventoryTopic({ topics, branch: branch || { branch_id: envelope.branch_id } });
  if (!topicResult.topic) return { ok: false, status: 'ERROR', error_code: topicResult.error_code || 'INVENTORY_TOPIC_NOT_CONFIGURED', write_plan: [] };
  const catalog = freezeCatalog(beers);
  if (catalog.error_code) return { ok: false, status: 'ERROR', error_code: catalog.error_code, write_plan: [] };
  const pageSize = inventoryPageSize(configGlobal);
  if (!pageSize) return { ok: false, status: 'ERROR', error_code: 'INVENTORY_PAGE_SIZE_INVALID', write_plan: [] };
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
    catalog_snapshot_json: catalog.json,
    catalog_count: catalog.count,
    page_size: pageSize,
    master_message_id: '',
    bubble_state: 'NONE',
    status: 'ACTIVE',
    created_at: now,
    updated_at: now,
  };
  const expectedRowCount = 3;
  const operation = operationRow({ envelope, dispatchKey, operationType: 'OPEN_INVENTORY_SESSION', expectedRowCount, now });
  const audit = stagedAuditRow({ envelope, outcome: 'OPENED', now });
  return {
    ok: true,
    status: 'OPENED',
    session,
    operation,
    write_plan: [
      { sheet: 'OPERATION', phase: 'PREPARE', action: 'APPEND_OR_UPDATE', match: { operation_id: operation.operation_id }, row: operation },
      { sheet: 'PHIEN_KIEM_KE', phase: 'PREPARE', action: 'APPEND_OR_UPDATE', match: { session_id: sessionId }, row: stagedSessionRow(session) },
      { sheet: 'EVENT_LOG', phase: 'PREPARE', action: 'APPEND_OR_UPDATE', match: { event_id: audit.event_id }, row: audit },
    ],
    topic_write_plan: [],
    commit_plan: commitOperationPlan({ operation, audit, session, now }),
  };
}
