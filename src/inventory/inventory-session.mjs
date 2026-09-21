const ACTIVE = 'ACTIVE';

const asText = (value) => (value == null ? '' : String(value).trim());

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function sessionClone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function safeId(value) {
  return asText(value).replace(/[^A-Za-z0-9._-]/g, '_');
}

function itemCode(row) {
  return asText(row?.ma_bia ?? row?.item_code ?? row?.item_id);
}

function itemName(row) {
  return asText(row?.ten_bia ?? row?.item_name ?? row?.name);
}

function itemUnit(row) {
  return asText(row?.don_vi_dem ?? row?.unit ?? row?.count_unit);
}

export function formatInventoryItemLabel(item) {
  return `${itemCode(item)} — ${itemName(item)} — ${itemUnit(item)}`;
}

function normalizeCatalog(catalog) {
  if (!Array.isArray(catalog)) return [];
  return catalog.map((row, index) => {
    const item = sessionClone(row ?? {});
    const normalized = {
      ...item,
      ma_bia: itemCode(item),
      ten_bia: itemName(item),
      don_vi_dem: itemUnit(item),
      thu_tu_hien_thi: asText(item.thu_tu_hien_thi ?? item.display_order ?? index + 1),
    };
    normalized.display_label = formatInventoryItemLabel(normalized);
    return normalized;
  });
}

export function snapshotInventoryConfig(configSnapshot) {
  const input = sessionClone(configSnapshot ?? {});
  const snapshot = {
    config_snapshot_id: asText(input.config_snapshot_id ?? input.snapshot_id),
    config_version: asText(input.config_version),
    captured_at: asText(input.captured_at ?? input.created_at),
    config: sessionClone(input.config ?? {}),
    catalog: normalizeCatalog(input.catalog ?? input.items ?? []),
  };
  return deepFreeze(snapshot);
}

function isActiveSession(session) {
  return asText(session?.status).toUpperCase() === ACTIVE;
}

function failure(errorCode, message, details = {}) {
  return {
    ok: false,
    error_code: errorCode,
    message_safe: message,
    write_plan: [],
    ...details,
  };
}

function sessionAuditPlan({ session, nextSession, event, operationId, requestId, now }) {
  const operationRow = {
    operation_id: operationId,
    request_id: requestId,
    operation_type: event.event_type,
    idempotency_key: requestId || operationId,
    expected_row_count: '2',
    actual_row_count: '',
    checksum: `${event.event_id}:${nextSession.status}`,
    status: 'PREPARED',
    error_id: '',
    created_at: now,
    updated_at: now,
  };
  return [
    { sheet: 'OPERATION', action: 'APPEND', row: operationRow },
    {
      sheet: 'PHIEN_KIEM_KE',
      action: 'UPDATE',
      match: { session_id: session.session_id },
      patch: { status: `${nextSession.status}_PREPARED`, write_state: 'PREPARED', operation_id: operationId, updated_at: now },
    },
    { sheet: 'EVENT_LOG', action: 'APPEND', row: event },
    { sheet: 'EVENT_LOG', action: 'UPDATE', match: { event_id: event.event_id }, patch: { status: 'COMMITTED', write_state: 'COMMITTED', updated_at: now } },
    { sheet: 'PHIEN_KIEM_KE', action: 'UPDATE', match: { session_id: session.session_id }, patch: { ...nextSession, write_state: 'COMMITTED', operation_id: operationId } },
    { sheet: 'OPERATION', action: 'UPDATE', match: { operation_id: operationId }, patch: { status: 'COMMITTED', actual_row_count: '2', updated_at: now } },
  ];
}

function openSessionPlan({ session, operationId, requestId, now }) {
  const operationRow = {
    operation_id: operationId,
    request_id: requestId,
    operation_type: 'OPEN_INVENTORY_SESSION',
    idempotency_key: requestId || operationId,
    expected_row_count: '1',
    actual_row_count: '',
    checksum: `${session.session_id}:${session.config_snapshot_id}`,
    status: 'PREPARED',
    error_id: '',
    created_at: now,
    updated_at: now,
  };
  const row = {
    session_id: session.session_id,
    branch_id: session.branch_id,
    business_date: session.business_date,
    config_snapshot_id: session.config_snapshot_id,
    config_version: session.config_version,
    snapshot_json: JSON.stringify(session.config_snapshot),
    status: 'PREPARED',
    opened_by: session.opened_by,
    opened_at: session.opened_at,
    expires_at: session.expires_at,
    session_revision: session.session_revision,
    operation_id: operationId,
    write_state: 'PREPARED',
    updated_at: now,
  };
  return [
    { sheet: 'OPERATION', action: 'APPEND', row: operationRow },
    { sheet: 'PHIEN_KIEM_KE', action: 'APPEND', row },
    { sheet: 'PHIEN_KIEM_KE', action: 'UPDATE', match: { session_id: session.session_id }, patch: { status: 'COMMITTED', write_state: 'COMMITTED', updated_at: now } },
    { sheet: 'OPERATION', action: 'UPDATE', match: { operation_id: operationId }, patch: { status: 'COMMITTED', actual_row_count: '1', updated_at: now } },
  ];
}

export function openOrReuseInventorySession({
  branch_id: branchId,
  business_date: businessDate,
  config_snapshot: configSnapshot,
  existing_sessions: existingSessions = [],
  actor_user_id: actorUserId,
  now,
  expires_at: expiresAt,
  operation_id: operationId,
  request_id: requestId,
} = {}) {
  const branch = asText(branchId);
  const date = asText(businessDate);
  if (!branch || !date) return failure('SESSION_SCOPE_INVALID', 'branch_id and business_date are required');

  const activeSessions = (Array.isArray(existingSessions) ? existingSessions : [])
    .filter((session) => asText(session?.branch_id) === branch && isActiveSession(session));
  const sameDate = activeSessions.find((session) => asText(session.business_date) === date);
  if (sameDate) {
    return {
      ok: true,
      action: 'REUSED',
      session: deepFreeze(sessionClone(sameDate)),
      write_plan: [],
    };
  }
  if (activeSessions.length > 0) {
    return failure('ACTIVE_SESSION_EXISTS', 'An active inventory session already exists for this branch', {
      active_session_id: asText(activeSessions[0].session_id),
      active_business_date: asText(activeSessions[0].business_date),
    });
  }
  const snapshot = snapshotInventoryConfig(configSnapshot);
  const snapshotId = asText(snapshot.config_snapshot_id);
  if (!snapshotId || !asText(snapshot.config_version)) {
    return failure('CONFIG_SNAPSHOT_REQUIRED', 'An accepted configuration snapshot is required');
  }
  const session = deepFreeze({
    session_id: `phien-${safeId(branch)}-${safeId(date)}-${safeId(snapshotId)}`,
    branch_id: branch,
    business_date: date,
    config_snapshot_id: snapshot.config_snapshot_id,
    config_version: snapshot.config_version,
    config_snapshot: snapshot,
    catalog: snapshot.catalog,
    status: ACTIVE,
    opened_by: asText(actorUserId),
    opened_at: asText(now),
    expires_at: asText(expiresAt),
    session_revision: 0,
    updated_at: asText(now),
  });

  return {
    ok: true,
    action: 'OPENED',
    session,
    write_plan: openSessionPlan({
      session,
      operationId: asText(operationId),
      requestId: asText(requestId),
      now: asText(now),
    }),
  };
}

export function expireInventorySession({
  session = {},
  now,
  actor_user_id: actorUserId,
  operation_id: operationId,
  request_id: requestId,
} = {}) {
  if (!isActiveSession(session)) return failure('SESSION_NOT_ACTIVE', 'Only an active inventory session can expire');
  const expiresAt = Date.parse(asText(session.expires_at));
  const currentAt = Date.parse(asText(now));
  if (!Number.isFinite(expiresAt) || !Number.isFinite(currentAt) || currentAt < expiresAt) {
    return failure('SESSION_NOT_EXPIRED', 'Inventory session has not reached its expiry time');
  }
  const nextSession = {
    ...sessionClone(session),
    status: 'EXPIRED',
    expired_by: asText(actorUserId),
    expired_at: asText(now),
    session_revision: Number(session.session_revision ?? 0) + 1,
    updated_at: asText(now),
  };
  const event = {
    event_id: `event-${asText(session.session_id)}-expired-${nextSession.session_revision}`,
    event_key: `${asText(operationId)}:INVENTORY_SESSION_EXPIRED:${asText(session.session_id)}`,
    event_type: 'INVENTORY_SESSION_EXPIRED',
    entity_type: 'INVENTORY_SESSION',
    entity_id: asText(session.session_id),
    branch_id: asText(session.branch_id),
    actor_user_id: asText(actorUserId),
    reason: 'EXPIRED_AT_TTL',
    payload_json: JSON.stringify({ expires_at: session.expires_at }),
    status: 'PREPARED',
    operation_id: asText(operationId),
    write_state: 'PREPARED',
    created_at: asText(now),
  };
  return {
    ok: true,
    action: 'EXPIRED',
    session: deepFreeze(nextSession),
    write_plan: sessionAuditPlan({
      session,
      nextSession,
      event,
      operationId: asText(operationId),
      requestId: asText(requestId),
      now: asText(now),
    }),
  };
}

export function reopenInventorySession({
  session = {},
  existing_sessions: existingSessions = [],
  can_reopen: canReopen = false,
  actor_user_id: actorUserId,
  reason,
  expires_at: expiresAt,
  operation_id: operationId,
  request_id: requestId,
  now,
} = {}) {
  if (canReopen !== true) return failure('REOPEN_NOT_ALLOWED', 'The actor is not allowed to reopen an inventory session');
  const reopenReason = asText(reason);
  if (!reopenReason) return failure('REOPEN_REASON_REQUIRED', 'A reason is required to reopen an inventory session');
  const reopenable = ['EXPIRED', 'FINALIZED', 'LOCKED', 'CLOSED'].includes(asText(session.status).toUpperCase());
  if (!reopenable) return failure('SESSION_NOT_REOPENABLE', 'The inventory session is not eligible for reopening');
  const competing = (Array.isArray(existingSessions) ? existingSessions : [])
    .find((candidate) => candidate?.session_id !== session.session_id
      && asText(candidate?.branch_id) === asText(session.branch_id)
      && isActiveSession(candidate));
  if (competing) {
    return failure('ACTIVE_SESSION_EXISTS', 'An active inventory session already exists for this branch', {
      active_session_id: asText(competing.session_id),
      active_business_date: asText(competing.business_date),
    });
  }

  const nextSession = {
    ...sessionClone(session),
    status: ACTIVE,
    expires_at: asText(expiresAt) || asText(session.expires_at),
    reopened_by: asText(actorUserId),
    reopened_at: asText(now),
    reopen_reason: reopenReason,
    reopen_audit_id: `event-${asText(session.session_id)}-reopen-${Number(session.session_revision ?? 0) + 1}`,
    session_revision: Number(session.session_revision ?? 0) + 1,
    updated_at: asText(now),
  };
  const event = {
    event_id: nextSession.reopen_audit_id,
    event_key: `${asText(operationId)}:INVENTORY_SESSION_REOPENED:${asText(session.session_id)}`,
    event_type: 'INVENTORY_SESSION_REOPENED',
    entity_type: 'INVENTORY_SESSION',
    entity_id: asText(session.session_id),
    branch_id: asText(session.branch_id),
    actor_user_id: asText(actorUserId),
    reason: reopenReason,
    payload_json: JSON.stringify({ previous_status: session.status, expires_at: nextSession.expires_at }),
    status: 'PREPARED',
    operation_id: asText(operationId),
    write_state: 'PREPARED',
    created_at: asText(now),
  };
  return {
    ok: true,
    action: 'REOPENED',
    session: deepFreeze(nextSession),
    write_plan: sessionAuditPlan({
      session,
      nextSession,
      event,
      operationId: asText(operationId),
      requestId: asText(requestId),
      now: asText(now),
    }),
  };
}
