import { stableKey } from '../contracts.mjs';

const text = (value) => (value == null ? '' : String(value).trim());
const SESSION_TTL_KEY = 'inventory_session_ttl_minutes';
const isSessionUtcTimestamp = (value) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value));

function failure(errorCode, errorClass, messageSafe, details = {}) {
  return {
    ok: false,
    status: 'ERROR',
    error_code: errorCode,
    error_class: errorClass,
    retryable: false,
    message_safe: messageSafe,
    ...details,
  };
}

function isTrackedActiveItem(item) {
  const tracked = item?.tracked === true || ['TRUE', 'YES'].includes(text(item?.tracked).toUpperCase());
  return tracked && text(item?.trang_thai).toUpperCase() === 'ACTIVE';
}

function projectCatalogItem(item) {
  const configuredNumber = (value) => value != null && text(value) !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    item_id: text(item.item_id),
    item_code: text(item.item_code),
    item_name: text(item.item_name),
    inventory_unit: text(item.inventory_unit),
    decimal_places: configuredNumber(item.decimal_places),
    quantity_step: configuredNumber(item.quantity_step),
    minimum_quantity: configuredNumber(item.minimum_quantity),
    maximum_quantity: configuredNumber(item.maximum_quantity),
    tracked: true,
    ordinal: Number.isFinite(Number(item.ordinal)) ? Number(item.ordinal) : null,
  };
}

function configuredSessionTtlMinutes(snapshot) {
  const rows = snapshot?.config_tables?.CONFIG_GLOBAL;
  if (!Array.isArray(rows)) return null;
  const matches = rows.filter((row) => text(row?.config_key) === SESSION_TTL_KEY);
  if (matches.length !== 1) return null;
  const [row] = matches;
  if (text(row.value_type).toUpperCase() !== 'NUMBER'
    || !['GLOBAL', '*'].includes(text(row.scope).toUpperCase())
    || text(row.trang_thai ?? row.status).toUpperCase() !== 'ACTIVE'
    || row.config_value == null || typeof row.config_value === 'boolean' || text(row.config_value) === '') return null;
  const minutes = Number(row.config_value);
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : null;
}

function isUnexpiredSession(session, now) {
  const expiresAt = text(session?.expires_at);
  if (!expiresAt) return true;
  const expiresAtMs = Date.parse(expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs > Date.parse(now);
}

/**
 * Prepare one branch-scoped inventory session. activeSessions must contain only
 * operation-committed rows; PREPARED session rows are not business-visible.
 * The caller is responsible for reserving/committing the returned rows through
 * operation-journal.mjs and for serializing competing opens at persistence time.
 */
export function openInventorySession({ envelope, activeSessions, catalog, snapshot, now }) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return failure('INVALID_ENVELOPE', 'VALIDATION', 'Required workflow input is missing or invalid.');
  }
  if (!Array.isArray(activeSessions) || !Array.isArray(catalog)) {
    return failure('INVALID_WORKFLOW_INPUT', 'VALIDATION', 'Session and catalog inputs must be arrays.');
  }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return failure('CONFIG_SNAPSHOT_INVALID', 'CONFIGURATION', 'The configuration snapshot is unavailable.');
  }
  if (!isSessionUtcTimestamp(now)) {
    return failure('INVALID_WORKFLOW_TIME', 'VALIDATION', 'The workflow timestamp is invalid.');
  }

  const requestId = text(envelope.request_id);
  const operationId = text(envelope.operation_id);
  const branchId = text(envelope.branch_id);
  const businessDate = text(envelope.business_date);
  const snapshotId = text(envelope.config_snapshot_id);
  if (!requestId || !operationId || !branchId || !snapshotId || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    return failure('INVALID_ENVELOPE', 'VALIDATION', 'The request is missing a required session identifier or business date.');
  }
  if (text(snapshot.config_snapshot_id) !== snapshotId) {
    return failure('CONFIG_SNAPSHOT_MISMATCH', 'CONFIGURATION', 'The requested configuration snapshot does not match the validated snapshot.');
  }
  if (snapshot.config_version != null && envelope.config_version != null
    && String(snapshot.config_version) !== String(envelope.config_version)) {
    return failure('CONFIG_SNAPSHOT_MISMATCH', 'CONFIGURATION', 'The requested configuration version does not match the validated snapshot.');
  }
  const branchScope = text(snapshot.branch_scope);
  if (branchScope && branchScope !== '*' && branchScope !== branchId) {
    return failure('CONFIG_SNAPSHOT_SCOPE_MISMATCH', 'CONFIGURATION', 'The validated configuration snapshot is outside this branch.');
  }

  const sameOperationSession = activeSessions.find((session) => text(session?.operation_id) === operationId
    && text(session?.branch_id) === branchId
    && text(session?.status).toUpperCase() === 'ACTIVE_SESSION');
  if (sameOperationSession) {
    return {
      ok: true,
      status: 'COMMITTED',
      replay: true,
      session: sameOperationSession,
      data: {
        session_id: text(sameOperationSession.session_id),
        initial_revision: Number(sameOperationSession.session_revision ?? 0),
        catalog: JSON.parse(sameOperationSession.snapshot_json ?? '{}').catalog ?? [],
      },
      rows: {},
      required_writes: [],
    };
  }

  const active = activeSessions.find((session) => text(session?.branch_id) === branchId
    && text(session?.status).toUpperCase() === 'ACTIVE_SESSION'
    && isUnexpiredSession(session, now));
  if (active) {
    return failure('SESSION_ALREADY_ACTIVE', 'CONFLICT', 'This branch already has an active inventory session.', {
      active_session_id: text(active.session_id),
    });
  }

  const sessionTtlMinutes = configuredSessionTtlMinutes(snapshot);
  if (sessionTtlMinutes == null) {
    return failure('CONFIG_SESSION_TTL_INVALID', 'CONFIGURATION', 'A valid inventory session TTL is required in the configuration snapshot.');
  }
  const expiresAtMs = Date.parse(now) + sessionTtlMinutes * 60_000;
  const expiresAt = new Date(expiresAtMs);
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(expiresAt.getTime())) {
    return failure('CONFIG_SESSION_TTL_INVALID', 'CONFIGURATION', 'The configured inventory session TTL is outside the supported range.');
  }
  const expiresAtUtc = expiresAt.toISOString();

  const items = catalog.filter(isTrackedActiveItem).map(projectCatalogItem);
  if (items.some((item) => !item.item_id || !item.item_code || !item.item_name || !item.inventory_unit)) {
    return failure('CONFIG_CATALOG_INVALID', 'CONFIGURATION', 'An active tracked catalog item is missing required fields.');
  }
  if (items.length === 0) {
    return failure('CONFIG_CATALOG_EMPTY', 'CONFIGURATION', 'No active tracked catalog items are available for this branch.');
  }
  if (new Set(items.map((item) => item.item_id)).size !== items.length) {
    return failure('CONFIG_CATALOG_INVALID', 'CONFIGURATION', 'The active tracked catalog contains duplicate item identifiers.');
  }
  items.sort((left, right) => (left.ordinal ?? Number.MAX_SAFE_INTEGER) - (right.ordinal ?? Number.MAX_SAFE_INTEGER)
    || left.item_id.localeCompare(right.item_id));

  const idempotencyKey = [envelope.idempotency_key, envelope.payload?.idempotency_key, requestId, operationId]
    .map(text)
    .find(Boolean);
  const sessionId = stableKey(['WF05_SESSION', branchId, idempotencyKey]);
  const snapshotJson = JSON.stringify({
    format: 'wf05-session-v1',
    config_snapshot_id: snapshotId,
    config_version: snapshot.config_version ?? envelope.config_version ?? null,
    config_fingerprint: snapshot.config_fingerprint ?? null,
    session_ttl_minutes: sessionTtlMinutes,
    catalog: items,
  });
  const session = {
    session_id: sessionId,
    branch_id: branchId,
    business_date: businessDate,
    config_snapshot_id: snapshotId,
    config_version: snapshot.config_version ?? envelope.config_version ?? null,
    snapshot_json: snapshotJson,
    status: 'ACTIVE_SESSION',
    opened_by: text(envelope.actor_user_id) || null,
    opened_at: now,
    expires_at: expiresAtUtc,
    session_revision: 0,
    operation_id: operationId,
    write_state: 'PREPARED',
    updated_at: now,
  };
  const state = {
    state_id: sessionId,
    branch_id: branchId,
    topic_type: 'INVENTORY_SESSION',
    owner_user_id: text(envelope.actor_user_id) || null,
    invoice_id: null,
    status: 'ACTIVE_SESSION',
    revision: 0,
    expires_at: expiresAtUtc,
    updated_at: now,
    operation_id: operationId,
  };
  const event = {
    event_id: stableKey(['WF05_SESSION_OPENED', operationId]),
    operation_id: operationId,
    request_id: requestId,
    event_type: 'INVENTORY_SESSION_OPENED',
    source_workflow: 'WF05',
    actor_user_id: text(envelope.actor_user_id) || null,
    branch_id: branchId,
    business_date: businessDate,
    entity_type: 'PHIEN_KIEM_KE',
    entity_id: sessionId,
    idempotency_key: idempotencyKey,
    event_payload_json: JSON.stringify({ config_snapshot_id: snapshotId, item_count: items.length }),
    status: 'PREPARED',
    created_at: now,
  };

  return {
    ok: true,
    status: 'PREPARED',
    replay: false,
    session,
    state,
    event,
    required_writes: ['PHIEN_KIEM_KE', 'STATE_CHO', 'EVENT_LOG'],
    rows: { PHIEN_KIEM_KE: [session], STATE_CHO: [state], EVENT_LOG: [event] },
    data: { session_id: sessionId, initial_revision: 0, catalog: items },
  };
}
