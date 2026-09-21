import test from 'node:test';
import assert from 'node:assert/strict';
import { finalizeInventorySession, reviewInventorySession } from '../../src/inventory/review-finalize.mjs';

const session = {
  session_id: 'phien-CN_HN-2026-09-21-cfg-v1',
  branch_id: 'CN_HN',
  business_date: '2026-09-21',
  config_snapshot_id: 'cfg-v1',
  config_version: 'v1',
  status: 'ACTIVE',
  catalog: [
    {
      ma_bia: 'BIA-333',
      ten_bia: 'Bia 333',
      don_vi_dem: 'chai',
      nguong_chenh_vang: '0.5',
      nguong_chenh_do: '1',
    },
  ],
};

test('marks a complete review with a red variance that needs explanation', () => {
  const result = reviewInventorySession({
    session,
    count_entries: [{ ma_bia: 'BIA-333', ton_thuc_te: 10, revision: 1, status: 'COMMITTED' }],
    theoretical_by_item: { 'BIA-333': 8 },
    now: '2026-09-21T18:00:00.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'REVIEW_READY');
  assert.deepEqual(result.missing_item_codes, []);
  assert.equal(result.red_items.length, 1);
  assert.equal(result.red_items[0].ma_bia, 'BIA-333');
  assert.equal(result.red_items[0].variance, 2);
  assert.equal(result.red_items[0].requires_explanation, true);
});

test('requires explicit confirmation before finalizing a reviewed session', () => {
  const result = finalizeInventorySession({
    session,
    review: {
      status: 'REVIEW_READY',
      session_id: session.session_id,
      missing_item_codes: [],
      invalid_item_codes: [],
      red_items: [],
      summary: [],
    },
    confirmed: false,
    operation_id: 'op-finalize-1',
    request_id: 'req-finalize-1',
    actor_user_id: 'user-1',
    now: '2026-09-21T18:05:00.000Z',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'FINALIZE_CONFIRMATION_REQUIRED');
  assert.deepEqual(result.write_plan, []);
});

test('blocks finalization until every red variance has an explanation', () => {
  const review = reviewInventorySession({
    session,
    count_entries: [{ ma_bia: 'BIA-333', ton_thuc_te: 10, revision: 1, status: 'COMMITTED' }],
    theoretical_by_item: { 'BIA-333': 8 },
    now: '2026-09-21T18:00:00.000Z',
  });
  const result = finalizeInventorySession({
    session,
    review,
    confirmed: true,
    explanations: {},
    operation_id: 'op-finalize-2',
    request_id: 'req-finalize-2',
    actor_user_id: 'user-1',
    now: '2026-09-21T18:05:00.000Z',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'RED_VARIANCE_EXPLANATION_REQUIRED');
  assert.deepEqual(result.missing_explanation_item_codes, ['BIA-333']);
  assert.deepEqual(result.write_plan, []);
});

test('stages an explicit finalize with red variance audit entries', () => {
  const review = reviewInventorySession({
    session,
    count_entries: [{ ma_bia: 'BIA-333', ton_thuc_te: 10, revision: 1, status: 'COMMITTED' }],
    theoretical_by_item: { 'BIA-333': 8 },
    now: '2026-09-21T18:00:00.000Z',
  });
  const result = finalizeInventorySession({
    session,
    review,
    confirmed: true,
    explanations: { 'BIA-333': 'Kiểm tra lại thùng và phát hiện lệch khi đếm.' },
    operation_id: 'op-finalize-3',
    request_id: 'req-finalize-3',
    actor_user_id: 'user-1',
    now: '2026-09-21T18:05:00.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'FINALIZED');
  assert.equal(result.finalized.status, 'FINALIZED');
  assert.equal(result.finalized.finalized_by, 'user-1');
  const audit = result.write_plan.find((step) => step.sheet === 'EVENT_LOG' && step.action === 'APPEND');
  assert.equal(audit.row.event_type, 'RED_VARIANCE_EXPLAINED');
  assert.equal(audit.row.entity_id, 'BIA-333');
  assert.match(audit.row.reason, /phát hiện lệch/);
  assert.equal(result.write_plan.some((step) => step.sheet === 'PHIEN_KIEM_KE' && step.action === 'UPDATE' && step.patch.status === 'FINALIZED'), true);
  assert.equal(result.write_plan[0].row.status, 'PREPARED');
  assert.equal(result.write_plan.at(-1).patch.status, 'COMMITTED');
});
