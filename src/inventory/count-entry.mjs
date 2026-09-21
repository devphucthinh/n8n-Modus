import { sha256 } from '../config-gateway/sha256.mjs';

const asText = (value) => (value == null ? '' : String(value).trim());

const safeId = (value) => asText(value).replace(/[^A-Za-z0-9._-]/g, '_');

const itemCode = (item) => asText(item?.ma_bia ?? item?.item_code ?? item?.item_id);
const itemName = (item) => asText(item?.ten_bia ?? item?.item_name ?? item?.name);
const itemUnit = (item) => asText(item?.don_vi_dem ?? item?.unit ?? item?.count_unit);

function displayLabel(item) {
  return `${itemCode(item)} — ${itemName(item)} — ${itemUnit(item)}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stagedPlan({ operationId, requestId, operationType, rows, now }) {
  const checksum = sha256(canonicalJson(rows));
  const operationRow = {
    operation_id: operationId,
    request_id: requestId,
    operation_type: operationType,
    idempotency_key: requestId || operationId,
    expected_row_count: String(rows.length),
    actual_row_count: '',
    checksum,
    status: 'PREPARED',
    error_id: '',
    created_at: now,
    updated_at: now,
  };
  const plan = [{ sheet: 'OPERATION', action: 'APPEND', row: operationRow }];
  for (const { sheet, row } of rows) plan.push({ sheet, action: 'APPEND', row });
  for (const { sheet, row, match_column: matchColumn } of rows) {
    plan.push({
      sheet,
      action: 'UPDATE',
      match: { [matchColumn]: row[matchColumn] },
      patch: { status: 'COMMITTED', write_state: 'COMMITTED', updated_at: now },
    });
  }
  plan.push({
    sheet: 'OPERATION',
    action: 'UPDATE',
    match: { operation_id: operationId },
    patch: { status: 'COMMITTED', actual_row_count: String(rows.length), updated_at: now },
  });
  return plan;
}

function decimalPlaces(value) {
  const text = asText(value).toLowerCase();
  if (text.includes('e')) {
    const [coefficient, exponentText] = text.split('e');
    const exponent = Number(exponentText);
    return Math.max(0, (coefficient.split('.')[1]?.length ?? 0) - exponent);
  }
  return text.split('.')[1]?.length ?? 0;
}

export function validateCountValue(value, rules = {}) {
  if (value == null || (typeof value === 'string' && asText(value) === '')) {
    return { status: 'INCOMPLETE', value: null };
  }
  const numericValue = typeof value === 'number' ? value : Number(asText(value));
  if (!Number.isFinite(numericValue)) {
    return { status: 'INVALID', value: null, error_code: 'COUNT_NOT_NUMERIC' };
  }
  if (numericValue < 0) {
    return { status: 'INVALID', value: numericValue, error_code: 'COUNT_NEGATIVE' };
  }
  const configuredPrecision = rules.decimal_places ?? rules.so_le ?? rules.decimals;
  if (asText(configuredPrecision) !== '' && decimalPlaces(value) > Number(configuredPrecision)) {
    return { status: 'INVALID', value: numericValue, error_code: 'COUNT_DECIMAL_NOT_ALLOWED' };
  }
  const configuredStep = Number(rules.step ?? rules.buoc_dem);
  if (Number.isFinite(configuredStep) && configuredStep > 0) {
    const quotient = numericValue / configuredStep;
    if (Math.abs(quotient - Math.round(quotient)) > 1e-9) {
      return { status: 'INVALID', value: numericValue, error_code: 'COUNT_STEP_INVALID' };
    }
  }
  const minimum = Number(rules.min ?? rules.ton_min);
  if (Number.isFinite(minimum) && numericValue < minimum) return { status: 'INVALID', value: numericValue, error_code: 'COUNT_BELOW_MIN' };
  const maximum = Number(rules.max ?? rules.ton_max);
  if (Number.isFinite(maximum) && numericValue > maximum) return { status: 'INVALID', value: numericValue, error_code: 'COUNT_ABOVE_MAX' };
  return { status: 'VALID', value: numericValue };
}

export function planCountSave({
  session = {},
  item = {},
  current_entry: currentEntry,
  value,
  expected_revision: expectedRevision = 0,
  correction_reason: correctionReason,
  operation_id: operationId,
  request_id: requestId,
  actor_user_id: actorUserId,
  now,
} = {}) {
  const validation = validateCountValue(value, item);
  if (validation.status !== 'VALID') return { ok: false, ...validation, write_plan: [] };
  if (Array.isArray(session.catalog) && session.catalog.length > 0) {
    const requestedCode = itemCode(item);
    const catalogItem = session.catalog.find((candidate) => itemCode(candidate) === requestedCode);
    if (!catalogItem) return { ok: false, error_code: 'ITEM_NOT_IN_CATALOG', write_plan: [] };
  }
  const currentSessionStatus = asText(session.status).toUpperCase();
  if (currentSessionStatus === 'EXPIRED') return { ok: false, error_code: 'SESSION_EXPIRED_REOPEN_REQUIRED', write_plan: [] };
  if (currentSessionStatus === 'CANCELLED') return { ok: false, error_code: 'SESSION_CANCELLED', write_plan: [] };

  const currentRevision = Number(currentEntry?.revision ?? 0);
  const expected = Number(expectedRevision ?? 0);
  if (expected !== currentRevision) {
    return {
      ok: false,
      error_code: 'COUNT_REVISION_CONFLICT',
      conflict: {
        expected_revision: expected,
        current_revision: currentRevision,
        current_value: currentEntry?.ton_thuc_te ?? null,
        submitted_value: value,
        current_entry_id: currentEntry?.entry_id ?? null,
      },
      write_plan: [],
    };
  }

  const sessionStatus = asText(session.status).toUpperCase();
  if (['FINALIZED', 'LOCKED', 'CLOSED'].includes(sessionStatus)) {
    const reason = asText(correctionReason);
    if (!reason) {
      return {
        ok: false,
        error_code: 'CORRECTION_REASON_REQUIRED',
        write_plan: [],
      };
    }
    const code = itemCode(item);
    const adjustment = {
      adjustment_id: `adjust-${safeId(session.session_id)}-${safeId(code)}-r${currentRevision + 1}`,
      session_id: asText(session.session_id),
      branch_id: asText(session.branch_id),
      business_date: asText(session.business_date),
      ma_bia: code,
      target_entry_id: asText(currentEntry?.entry_id),
      from_value: currentEntry?.ton_thuc_te ?? null,
      to_value: validation.value,
      reason,
      actor_user_id: asText(actorUserId),
      status: 'PREPARED',
      operation_id: asText(operationId),
      write_state: 'PREPARED',
      created_at: asText(now),
      approved_at: '',
      approved_by: '',
    };
    return {
      ok: true,
      action: 'ADJUSTMENT_PLANNED',
      adjustment: { ...adjustment, status: 'COMMITTED', write_state: 'COMMITTED' },
      write_plan: stagedPlan({
        operationId: asText(operationId),
        requestId: asText(requestId),
        operationType: 'COUNT_CORRECTION',
        rows: [{ sheet: 'DIEU_CHINH_SO', row: adjustment, match_column: 'adjustment_id' }],
        now: asText(now),
      }),
    };
  }

  const nextRevision = currentRevision + 1;
  const code = itemCode(item);
  const entry = {
    entry_id: `count-${safeId(session.session_id)}-${safeId(code)}-r${nextRevision}`,
    session_id: asText(session.session_id),
    branch_id: asText(session.branch_id),
    business_date: asText(session.business_date),
    config_snapshot_id: asText(session.config_snapshot_id),
    ma_bia: code,
    ten_bia: itemName(item),
    don_vi_dem: itemUnit(item),
    display_label: displayLabel(item),
    ton_thuc_te: validation.value,
    revision: nextRevision,
    supersedes_entry_id: asText(currentEntry?.entry_id),
    status: 'PREPARED',
    explanation: '',
    actor_user_id: asText(actorUserId),
    idempotency_key: `${asText(requestId) || asText(operationId)}:${asText(session.session_id)}:${code}:${nextRevision}`,
    operation_id: asText(operationId),
    write_state: 'PREPARED',
    created_at: asText(now),
    updated_at: asText(now),
  };
  return {
    ok: true,
    action: 'COUNT_SAVED',
    entry: { ...entry, status: 'COMMITTED', write_state: 'COMMITTED' },
    write_plan: stagedPlan({
      operationId: asText(operationId),
      requestId: asText(requestId),
      operationType: 'SAVE_COUNT',
      rows: [{ sheet: 'BIA_LOG', row: entry, match_column: 'entry_id' }],
      now: asText(now),
    }),
  };
}
