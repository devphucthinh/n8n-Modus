import { stableKey } from '../contracts.mjs';

const text = (value) => (value == null ? '' : String(value).trim());
const utc = (value) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value));

function fail(errorCode, errorClass = 'VALIDATION', details = {}) {
  return { ok: false, status: 'ERROR', error_code: errorCode, error_class: errorClass, retryable: false, rows: {}, should_call_wf07: false, ...details };
}

function decimalParts(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const raw = String(value).trim();
  if (!raw || raw.length > 64) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return null;
  return { negative: match[1] === '-', whole: match[2], fraction: match[3] ?? '' };
}

function scaledInteger(parts, places) {
  if (!parts || parts.fraction.length > places) return null;
  const factor = 10n ** BigInt(places);
  const fraction = (parts.fraction + '0'.repeat(places - parts.fraction.length)) || '0';
  const magnitude = BigInt(parts.whole) * factor + BigInt(fraction);
  return parts.negative ? -magnitude : magnitude;
}

function latestCountsForSession(currentCounts, sessionId) {
  const latest = new Map();
  for (const row of currentCounts) {
    if (text(row?.session_id) !== sessionId || text(row?.status).toUpperCase() !== 'COMMITTED') continue;
    const code = text(row.ma_bia);
    const revision = Number(row.revision);
    if (!code || !Number.isSafeInteger(revision) || revision < 1) continue;
    const previous = latest.get(code);
    if (!previous || revision > Number(previous.revision)) latest.set(code, row);
    else if (revision === Number(previous.revision) && row.entry_id !== previous.entry_id) {
      throw new Error(`ambiguous count history for ${code} revision ${revision}`);
    }
  }
  return latest;
}

function rulesForItem(item) {
  if (item?.decimal_places == null || text(item.decimal_places) === '') return null;
  const decimalPlaces = Number(item?.decimal_places);
  const step = decimalParts(item?.quantity_step);
  const minimum = decimalParts(item?.minimum_quantity);
  const maximum = decimalParts(item?.maximum_quantity);
  if (!Number.isSafeInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 18
    || !step || !minimum || !maximum
    || step.fraction.length > decimalPlaces || minimum.fraction.length > decimalPlaces || maximum.fraction.length > decimalPlaces) return null;
  const places = decimalPlaces;
  const stepUnits = scaledInteger(step, places);
  const minimumUnits = scaledInteger(minimum, places);
  const maximumUnits = scaledInteger(maximum, places);
  if (stepUnits == null || stepUnits <= 0n || minimumUnits == null || minimumUnits > 0n
    || maximumUnits == null || maximumUnits < 0n || minimumUnits > maximumUnits) return null;
  return { decimalPlaces, places, stepUnits, minimumUnits, maximumUnits };
}

function actionRevision(session, latest) {
  const sessionRevision = Number(session.session_revision ?? 0);
  if (!Number.isSafeInteger(sessionRevision) || sessionRevision < 0) return null;
  return Math.max(sessionRevision, ...[...latest.values()].map((row) => Number(row.revision)));
}

function parseRequestedRevision(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const revision = Number(value.trim());
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function eventRow({ envelope, session, idempotencyKey, eventType, entityId, payload, now }) {
  return {
    event_id: stableKey(['WF06_EVENT', envelope.operation_id, eventType]),
    operation_id: envelope.operation_id,
    request_id: envelope.request_id,
    event_type: eventType,
    source_workflow: 'WF06',
    actor_user_id: text(envelope.actor_user_id) || null,
    branch_id: session.branch_id,
    business_date: session.business_date,
    entity_type: 'PHIEN_KIEM_KE',
    entity_id: entityId,
    idempotency_key: idempotencyKey,
    event_payload_json: JSON.stringify(payload),
    status: 'PREPARED',
    created_at: now,
  };
}

/** Validate one count action against the immutable per-session catalog snapshot. */
export function acceptInventoryCount({ envelope, session, currentCounts = [], payload, now }) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
    || !session || typeof session !== 'object' || Array.isArray(session)
    || !payload || typeof payload !== 'object' || Array.isArray(payload)
    || !Array.isArray(currentCounts)) return fail('INVALID_WORKFLOW_INPUT');
  if (!utc(now)) return fail('INVALID_WORKFLOW_TIME');
  if (!text(envelope.request_id) || !text(envelope.operation_id) || !text(envelope.branch_id)
    || !text(envelope.config_snapshot_id) || !text(session.session_id)) return fail('INVALID_ENVELOPE');
  if (text(session.branch_id) !== text(envelope.branch_id)
    || text(session.config_snapshot_id) !== text(envelope.config_snapshot_id)
    || (payload.session_id != null && text(payload.session_id) !== text(session.session_id))) {
    return fail('SESSION_SCOPE_MISMATCH', 'CONFLICT');
  }
  if (text(session.status).toUpperCase() !== 'ACTIVE_SESSION') return fail('SESSION_CLOSED', 'CONFLICT');
  if (!utc(session.expires_at)) return fail('SESSION_EXPIRY_INVALID', 'CONFIGURATION');
  if (Date.parse(session.expires_at) <= Date.parse(now)) return fail('SESSION_EXPIRED', 'CONFLICT');

  let snapshot;
  try { snapshot = JSON.parse(session.snapshot_json ?? '{}'); } catch { return fail('SESSION_SNAPSHOT_INVALID', 'CONFIGURATION'); }
  if (text(snapshot.config_snapshot_id) !== text(session.config_snapshot_id) || !Array.isArray(snapshot.catalog) || snapshot.catalog.length === 0) {
    return fail('SESSION_SNAPSHOT_INVALID', 'CONFIGURATION');
  }
  let latest;
  try { latest = latestCountsForSession(currentCounts, text(session.session_id)); } catch { return fail('COUNT_HISTORY_AMBIGUOUS', 'MANUAL_REVIEW'); }
  const revision = actionRevision(session, latest);
  if (revision == null) return fail('SESSION_REVISION_INVALID', 'CONFIGURATION');

  const action = text(payload.action).toUpperCase();
  const idempotencyKey = text(payload.idempotency_key || envelope.idempotency_key || envelope.request_id);
  if (!idempotencyKey) return fail('IDEMPOTENCY_KEY_REQUIRED');

  if (action === 'PREVIEW') {
    const missing = snapshot.catalog.filter((item) => !latest.has(text(item.item_code))).map((item) => text(item.item_code));
    return { ok: true, status: 'PREVIEW', replay: false, rows: {}, should_call_wf07: false, data: {
      session_id: session.session_id,
      session_revision: revision,
      item_count: snapshot.catalog.length,
      completed_count: snapshot.catalog.length - missing.length,
      missing_item_codes: missing,
      counts: snapshot.catalog.map((item) => ({ item_id: item.item_id, item_code: item.item_code, quantity: latest.has(text(item.item_code)) ? Number(latest.get(text(item.item_code)).ton_thuc_te) : null })),
    } };
  }

  if (action === 'COUNT') {
    const item = snapshot.catalog.find((candidate) => text(candidate.item_id) === text(payload.item_id));
    if (!item) return fail('COUNT_ITEM_NOT_IN_SESSION', 'VALIDATION');
    const rules = rulesForItem(item);
    if (!rules) return fail('CONFIG_COUNT_RULES_INVALID', 'CONFIGURATION');
    const rawCount = payload.quantity;
    if (rawCount == null || (typeof rawCount === 'string' && !rawCount.trim())) return fail('COUNT_BLANK');
    const countParts = decimalParts(rawCount);
    if (!countParts) return fail('COUNT_INVALID');
    if (countParts.negative && /[1-9]/.test(countParts.whole + countParts.fraction)) return fail('COUNT_NEGATIVE');
    if (countParts.fraction.length > rules.decimalPlaces) return fail('COUNT_PRECISION_INVALID');
    const countUnits = scaledInteger(countParts, rules.places);
    if (countUnits == null) return fail('COUNT_PRECISION_INVALID');
    if (countUnits < 0n) return fail('COUNT_NEGATIVE');
    if (countUnits < rules.minimumUnits || countUnits > rules.maximumUnits) return fail('COUNT_OUT_OF_BOUNDS');
    if (countUnits % rules.stepUnits !== 0n) return fail('COUNT_STEP_INVALID');

    const replayRows = currentCounts.filter((row) => text(row?.session_id) === text(session.session_id)
      && text(row?.idempotency_key) === idempotencyKey);
    if (replayRows.length > 1) return fail('COUNT_IDEMPOTENCY_AMBIGUOUS', 'MANUAL_REVIEW');
    const existingReplay = replayRows[0];
    if (existingReplay) {
      if (text(existingReplay.ma_bia) !== text(item.item_code) || Number(existingReplay.ton_thuc_te) !== Number(rawCount)) {
        return fail('COUNT_IDEMPOTENCY_CONFLICT', 'CONFLICT');
      }
      if (text(existingReplay.status).toUpperCase() === 'COMMITTED') {
        return { ok: true, status: 'COMMITTED', replay: true, rows: {}, should_call_wf07: false, data: { entry_id: existingReplay.entry_id, revision: Number(existingReplay.revision) } };
      }
      if (text(existingReplay.status).toUpperCase() !== 'PREPARED'
        || text(existingReplay.operation_id) !== text(envelope.operation_id)) {
        return fail('COUNT_IDEMPOTENCY_CONFLICT', 'CONFLICT');
      }
      const resumedEntry = { ...existingReplay, status: 'PREPARED', write_state: 'PREPARED' };
      const eventEnvelope = { ...envelope, operation_id: text(existingReplay.operation_id) || envelope.operation_id };
      const event = eventRow({ envelope: eventEnvelope, session, idempotencyKey, eventType: 'INVENTORY_COUNT_RECORDED', entityId: existingReplay.entry_id, payload: { entry_id: existingReplay.entry_id, item_id: item.item_id, revision: Number(existingReplay.revision) }, now });
      return { ok: true, status: 'PREPARED', replay: true, rows: { BIA_LOG: [resumedEntry], EVENT_LOG: [event] }, should_call_wf07: false, required_writes: ['BIA_LOG', 'EVENT_LOG'], data: { entry_id: existingReplay.entry_id, item_id: item.item_id, quantity: Number(String(rawCount).trim()), revision: Number(existingReplay.revision) } };
    }

    const expectedRevision = parseRequestedRevision(payload.expected_revision);
    if (expectedRevision == null) return fail('REVISION_REQUIRED');
    if (expectedRevision !== revision) return fail('REVISION_CONFLICT', 'CONFLICT', { current_revision: revision });

    const previous = latest.get(text(item.item_code)) ?? null;
    const nextRevision = revision + 1;
    const entryId = stableKey(['WF06_COUNT', session.session_id, item.item_id, idempotencyKey]);
    const entry = {
      entry_id: entryId,
      session_id: session.session_id,
      branch_id: session.branch_id,
      business_date: session.business_date,
      config_snapshot_id: session.config_snapshot_id,
      ma_bia: item.item_code,
      ten_bia: item.item_name,
      don_vi_dem: item.inventory_unit,
      display_label: `${item.item_name} (${item.inventory_unit})`,
      ton_thuc_te: Number(String(rawCount).trim()),
      revision: nextRevision,
      supersedes_entry_id: previous?.entry_id ?? null,
      status: 'PREPARED',
      explanation: null,
      actor_user_id: text(envelope.actor_user_id) || null,
      idempotency_key: idempotencyKey,
      operation_id: envelope.operation_id,
      write_state: 'PREPARED',
      created_at: now,
      updated_at: now,
    };
    const event = eventRow({ envelope, session, idempotencyKey, eventType: 'INVENTORY_COUNT_RECORDED', entityId: entryId, payload: { entry_id: entryId, item_id: item.item_id, revision: nextRevision }, now });
    return { ok: true, status: 'PREPARED', replay: false, rows: { BIA_LOG: [entry], EVENT_LOG: [event] }, should_call_wf07: false, required_writes: ['BIA_LOG', 'EVENT_LOG'], data: { entry_id: entryId, item_id: item.item_id, quantity: Number(String(rawCount).trim()), revision: nextRevision } };
  }

  if (action === 'FINALIZE') {
    const expectedRevision = parseRequestedRevision(payload.expected_revision);
    if (expectedRevision == null) return fail('REVISION_REQUIRED');
    if (expectedRevision !== revision) return fail('REVISION_CONFLICT', 'CONFLICT', { current_revision: revision });
    const missing = snapshot.catalog.filter((item) => !latest.has(text(item.item_code))).map((item) => text(item.item_code));
    if (missing.length) return fail('COUNT_INCOMPLETE', 'VALIDATION', { missing_item_codes: missing });
    const nextRevision = revision + 1;
    const updatedSession = { ...session, status: 'CLOSED', session_revision: nextRevision, operation_id: envelope.operation_id, write_state: 'PREPARED', updated_at: now };
    const state = { state_id: session.session_id, branch_id: session.branch_id, topic_type: 'INVENTORY_SESSION', owner_user_id: session.opened_by ?? null, invoice_id: null, status: 'CLOSED', revision: nextRevision, expires_at: session.expires_at, updated_at: now, operation_id: envelope.operation_id };
    const event = eventRow({ envelope, session, idempotencyKey, eventType: 'INVENTORY_COUNT_FINALIZED', entityId: session.session_id, payload: { session_id: session.session_id, revision: nextRevision }, now });
    return { ok: true, status: 'PREPARED', replay: false, rows: { PHIEN_KIEM_KE: [updatedSession], STATE_CHO: [state], EVENT_LOG: [event] }, should_call_wf07: true, required_writes: ['PHIEN_KIEM_KE', 'STATE_CHO', 'EVENT_LOG'], data: { session_id: session.session_id, session_revision: nextRevision, finalized: true } };
  }

  return fail('COUNT_ACTION_INVALID');
}
