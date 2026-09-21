import { sha256 } from '../config-gateway/sha256.mjs';
import { validateCountValue } from './count-entry.mjs';

const reviewText = (value) => (value == null ? '' : String(value).trim());

function numberOrNull(value) {
  if (value == null || reviewText(value) === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function labelFor(item) {
  return item.display_label || `${reviewText(item.ma_bia)} — ${reviewText(item.ten_bia)} — ${reviewText(item.don_vi_dem)}`;
}

function varianceStatus(variance, item) {
  const magnitude = Math.abs(variance);
  const redThreshold = numberOrNull(item.nguong_chenh_do);
  const yellowThreshold = numberOrNull(item.nguong_chenh_vang);
  if (redThreshold !== null && magnitude > redThreshold) return 'RED';
  if (yellowThreshold !== null && magnitude > yellowThreshold) return 'YELLOW';
  return 'NORMAL';
}

function reviewCanonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(reviewCanonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${reviewCanonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function finalizeWritePlan({ session, finalized, auditRows, operationId, requestId, now }) {
  const checksumInput = { finalized, audit_rows: auditRows };
  const operationRow = {
    operation_id: operationId,
    request_id: requestId,
    operation_type: 'FINALIZE_INVENTORY_SESSION',
    idempotency_key: requestId || operationId,
    expected_row_count: String(auditRows.length + 1),
    actual_row_count: '',
    checksum: sha256(reviewCanonicalJson(checksumInput)),
    status: 'PREPARED',
    error_id: '',
    created_at: now,
    updated_at: now,
  };
  const plan = [
    { sheet: 'OPERATION', action: 'APPEND', row: operationRow },
    {
      sheet: 'PHIEN_KIEM_KE',
      action: 'UPDATE',
      match: { session_id: session.session_id },
      patch: {
        status: 'FINALIZE_PREPARED',
        write_state: 'PREPARED',
        operation_id: operationId,
        updated_at: now,
      },
    },
  ];
  for (const row of auditRows) plan.push({ sheet: 'EVENT_LOG', action: 'APPEND', row });
  for (const row of auditRows) {
    plan.push({
      sheet: 'EVENT_LOG',
      action: 'UPDATE',
      match: { event_id: row.event_id },
      patch: { status: 'COMMITTED', write_state: 'COMMITTED', updated_at: now },
    });
  }
  plan.push({
    sheet: 'PHIEN_KIEM_KE',
    action: 'UPDATE',
    match: { session_id: session.session_id },
    patch: {
      ...finalized,
      write_state: 'COMMITTED',
      operation_id: operationId,
    },
  });
  plan.push({
    sheet: 'OPERATION',
    action: 'UPDATE',
    match: { operation_id: operationId },
    patch: { status: 'COMMITTED', actual_row_count: String(auditRows.length + 1), updated_at: now },
  });
  return plan;
}

export function reviewInventorySession({
  session = {},
  count_entries: countEntries = [],
  theoretical_by_item: theoreticalByItem = {},
  now,
} = {}) {
  const entries = new Map((Array.isArray(countEntries) ? countEntries : [])
    .filter((entry) => reviewText(entry?.ma_bia))
    .map((entry) => [reviewText(entry.ma_bia), entry]));
  const summary = [];
  const missingItemCodes = [];
  const invalidItemCodes = [];
  const redItems = [];

  for (const item of Array.isArray(session.catalog) ? session.catalog : []) {
    const code = reviewText(item.ma_bia);
    const entry = entries.get(code);
    const validation = validateCountValue(entry?.ton_thuc_te);
    if (!entry || validation.status === 'INCOMPLETE') missingItemCodes.push(code);
    if (entry && validation.status === 'INVALID') invalidItemCodes.push(code);

    const theoretical = numberOrNull(theoreticalByItem?.[code]);
    const actual = validation.status === 'VALID' ? validation.value : null;
    const variance = actual === null || theoretical === null ? null : actual - theoretical;
    const status = variance === null ? 'INCOMPLETE' : varianceStatus(variance, item);
    const line = {
      ma_bia: code,
      ten_bia: reviewText(item.ten_bia),
      don_vi_dem: reviewText(item.don_vi_dem),
      display_label: labelFor(item),
      ton_thuc_te: actual,
      revision: entry?.revision ?? 0,
      ton_ly_thuyet: theoretical,
      variance,
      variance_status: status,
      requires_explanation: status === 'RED',
      explanation: reviewText(entry?.explanation),
    };
    summary.push(line);
    if (status === 'RED') redItems.push(line);
  }

  return {
    ok: true,
    status: missingItemCodes.length || invalidItemCodes.length ? 'REVIEW_INCOMPLETE' : 'REVIEW_READY',
    session_id: reviewText(session.session_id),
    reviewed_at: reviewText(now),
    summary,
    missing_item_codes: missingItemCodes,
    invalid_item_codes: invalidItemCodes,
    red_items: redItems,
  };
}

export function finalizeInventorySession({
  session = {},
  review = {},
  confirmed,
  explanations = {},
  operation_id: operationId,
  request_id: requestId,
  actor_user_id: actorUserId,
  now,
} = {}) {
  if (confirmed !== true) {
    return {
      ok: false,
      error_code: 'FINALIZE_CONFIRMATION_REQUIRED',
      write_plan: [],
    };
  }
  const missingExplanationItemCodes = (Array.isArray(review.red_items) ? review.red_items : [])
    .map((item) => reviewText(item.ma_bia))
    .filter((code) => !reviewText(explanations?.[code]));
  if (missingExplanationItemCodes.length > 0) {
    return {
      ok: false,
      error_code: 'RED_VARIANCE_EXPLANATION_REQUIRED',
      missing_explanation_item_codes: missingExplanationItemCodes,
      write_plan: [],
    };
  }
  if (review.status !== 'REVIEW_READY' || review.missing_item_codes?.length || review.invalid_item_codes?.length) {
    return {
      ok: false,
      error_code: 'FINALIZE_REVIEW_INCOMPLETE',
      write_plan: [],
    };
  }

  const finalOperationId = reviewText(operationId);
  const finalRequestId = reviewText(requestId);
  const finalActorUserId = reviewText(actorUserId);
  const finalNow = reviewText(now);
  const auditRows = (Array.isArray(review.red_items) ? review.red_items : []).map((item) => ({
    event_id: `event-${reviewText(session.session_id)}-red-${reviewText(item.ma_bia)}-${finalOperationId}`,
    event_key: `${finalOperationId}:RED_VARIANCE_EXPLAINED:${reviewText(item.ma_bia)}`,
    event_type: 'RED_VARIANCE_EXPLAINED',
    entity_type: 'COUNT_ITEM',
    entity_id: reviewText(item.ma_bia),
    branch_id: reviewText(session.branch_id),
    actor_user_id: finalActorUserId,
    reason: reviewText(explanations?.[item.ma_bia]),
    payload_json: JSON.stringify({ variance: item.variance, session_id: session.session_id }),
    status: 'PREPARED',
    operation_id: finalOperationId,
    write_state: 'PREPARED',
    created_at: finalNow,
  }));
  const finalized = {
    session_id: reviewText(session.session_id),
    status: 'FINALIZED',
    finalized_by: finalActorUserId,
    finalized_at: finalNow,
    red_item_count: auditRows.length,
    warning_status: auditRows.length > 0 ? 'RED_EXPLAINED' : 'OK',
    updated_at: finalNow,
  };
  return {
    ok: true,
    action: 'FINALIZED',
    finalized,
    write_plan: finalizeWritePlan({
      session,
      finalized,
      auditRows,
      operationId: finalOperationId,
      requestId: finalRequestId,
      now: finalNow,
    }),
  };
}
