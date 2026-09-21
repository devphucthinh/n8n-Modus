import test from 'node:test';
import assert from 'node:assert/strict';

import {
  acknowledgePriceWarning,
  calculatePriceWarning,
  createReviewedLine,
  transitionReviewedLine,
} from '../../src/purchase-ingestion/review.mjs';

const line = () => createReviewedLine({
  line_id: 'line-001',
  invoice_id: 'invoice-001',
  ocr_raw_id: 'ocr-001',
  source_line_number: 1,
  source_item_code: 'BIA-001',
  item_id: 'bia-001',
  source_unit: 'thung',
  inventory_unit: 'chai',
  source_quantity: 1,
  inventory_quantity: 24,
  converted_unit_price: 25000,
  supplier_recorded: 'Nhà máy A',
});

test('reviewed Dòng nhập bia reaches each approved terminal state', () => {
  const terminalActions = [
    ['CONFIRM', 'CONFIRMED'],
    ['IGNORE', 'IGNORED'],
    ['REJECT', 'REJECTED'],
    ['ADJUST', 'ADJUSTED'],
  ];

  for (const [action, expectedStatus] of terminalActions) {
    const result = transitionReviewedLine(line(), {
      action,
      actor_user_id: 'reviewer-001',
      at: '2026-09-21T10:30:00.000Z',
      reason: action === 'ADJUST' ? 'Điều chỉnh sổ đã được lập' : undefined,
      adjustment_id: action === 'ADJUST' ? 'adjustment-001' : undefined,
    });

    assert.equal(result.ok, true, action);
    assert.equal(result.line.review_status, expectedStatus, action);
    assert.equal(result.line.reviewed_by, 'reviewer-001', action);
  }
});

test('negative quantity and return Dòng nhập bia require Điều chỉnh sổ', () => {
  const cases = [
    { inventory_quantity: -1, expectedReason: 'NEGATIVE_QUANTITY' },
    { inventory_quantity: 1, is_return: true, expectedReason: 'RETURN_DOCUMENT' },
  ];

  for (const values of cases) {
    const result = transitionReviewedLine({ ...line(), ...values }, {
      action: 'CONFIRM',
      actor_user_id: 'reviewer-001',
      at: '2026-09-21T10:30:00.000Z',
    });

    assert.equal(result.ok, true);
    assert.equal(result.line.review_status, 'PENDING_ADJUSTMENT');
    assert.equal(result.line.requires_adjustment, true);
    assert.equal(result.line.adjustment_reason, values.expectedReason);
    assert.equal(result.adjustment_plan.reference_line_id, 'line-001');
  }
});

test('Cảnh báo giá nhập is non-blocking after explicit acknowledgement', () => {
  const warning = calculatePriceWarning({
    current_price: 30_000,
    reference_price: 25_000,
    threshold_ratio: 0.1,
    supplier_recorded: '  Nhà   máy A ',
  });
  assert.equal(warning.warning, true);
  assert.equal(warning.blocking, false);
  assert.equal(warning.acknowledgement_required, true);
  assert.equal(warning.supplier_key, 'NHÀ MÁY A');

  const unacknowledged = transitionReviewedLine({ ...line(), price_warning: warning }, {
    action: 'CONFIRM',
    actor_user_id: 'reviewer-001',
    at: '2026-09-21T10:30:00.000Z',
  });
  assert.equal(unacknowledged.ok, false);
  assert.equal(unacknowledged.error_code, 'PRICE_WARNING_ACK_REQUIRED');

  const acknowledged = acknowledgePriceWarning({ ...line(), price_warning: warning }, {
    actor_user_id: 'reviewer-001',
    at: '2026-09-21T10:31:00.000Z',
  });
  const confirmed = transitionReviewedLine(acknowledged.line, {
    action: 'CONFIRM',
    actor_user_id: 'reviewer-001',
    at: '2026-09-21T10:32:00.000Z',
  });

  assert.equal(acknowledged.ok, true);
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.line.review_status, 'CONFIRMED');
  assert.equal(confirmed.line.price_warning.acknowledged_by, 'reviewer-001');
});
