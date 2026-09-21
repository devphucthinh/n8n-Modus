const clone = (value) => structuredClone(value);

export const TERMINAL_LINE_REVIEW_STATES = Object.freeze([
  'CONFIRMED',
  'IGNORED',
  'REJECTED',
  'ADJUSTED',
]);

export function createReviewedLine(input) {
  return {
    ...clone(input),
    review_status: 'PENDING_REVIEW',
    reviewed_by: null,
    reviewed_at: null,
  };
}

function supplierKey(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('vi-VN');
}

export function calculatePriceWarning({ current_price: currentPrice, reference_price: referencePrice, threshold_ratio: thresholdRatio, supplier_recorded: supplierRecorded }) {
  const current = Number(currentPrice);
  const reference = Number(referencePrice);
  const threshold = Number(thresholdRatio);
  const normalizedSupplier = supplierKey(supplierRecorded);
  const unknownSupplier = normalizedSupplier === 'NHÀ CUNG CẤP KHÔNG RÕ' || normalizedSupplier === '';
  const hasBaseline = !unknownSupplier && Number.isFinite(reference) && reference >= 0;
  const deviation = hasBaseline
    ? (reference === 0 ? (current === 0 ? 0 : Infinity) : Math.abs(current - reference) / Math.abs(reference))
    : null;
  const warning = hasBaseline && Number.isFinite(current) && deviation > threshold;
  return {
    warning,
    blocking: false,
    acknowledgement_required: warning,
    supplier_key: normalizedSupplier,
    baseline_available: hasBaseline,
    current_price: current,
    reference_price: hasBaseline ? reference : null,
    deviation_ratio: deviation,
    threshold_ratio: threshold,
    acknowledged_by: null,
    acknowledged_at: null,
  };
}

export function acknowledgePriceWarning(line, { actor_user_id: actorUserId, at }) {
  const next = clone(line);
  if (!next.price_warning?.warning) return { ok: true, line: next };
  return {
    ok: true,
    line: {
      ...next,
      price_warning: {
        ...next.price_warning,
        acknowledged_by: actorUserId,
        acknowledged_at: at,
      },
    },
  };
}

export function transitionReviewedLine(line, { action, actor_user_id: actorUserId, at, reason, adjustment_id: adjustmentId }) {
  const next = clone(line);
  const transitions = {
    CONFIRM: 'CONFIRMED',
    IGNORE: 'IGNORED',
    REJECT: 'REJECTED',
    ADJUST: 'ADJUSTED',
  };
  const nextStatus = transitions[action];
  if (!nextStatus) return { ok: false, line: next, error_code: 'REVIEW_ACTION_INVALID' };
  if (action === 'ADJUST' && !adjustmentId) return { ok: false, line: next, error_code: 'ADJUSTMENT_ID_REQUIRED' };
  if (next.review_status !== 'PENDING_REVIEW') return { ok: false, line: next, error_code: 'LINE_ALREADY_TERMINAL' };
  if (action === 'CONFIRM' && next.price_warning?.warning && !next.price_warning.acknowledged_by) {
    return { ok: false, line: next, error_code: 'PRICE_WARNING_ACK_REQUIRED' };
  }
  if (action === 'CONFIRM' && (Number(next.inventory_quantity) < 0 || next.is_return === true)) {
    const adjustmentReason = Number(next.inventory_quantity) < 0 ? 'NEGATIVE_QUANTITY' : 'RETURN_DOCUMENT';
    return {
      ok: true,
      line: {
        ...next,
        review_status: 'PENDING_ADJUSTMENT',
        requires_adjustment: true,
        adjustment_reason: adjustmentReason,
        reviewed_by: actorUserId,
        reviewed_at: at,
      },
      adjustment_plan: {
        reference_line_id: next.line_id,
        reason: adjustmentReason,
        status: 'PENDING_APPROVAL',
      },
    };
  }
  return {
    ok: true,
    line: {
      ...next,
      review_status: nextStatus,
      reviewed_by: actorUserId,
      reviewed_at: at,
      review_reason: reason ?? null,
      adjustment_id: adjustmentId ?? null,
    },
  };
}
