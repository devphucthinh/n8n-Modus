import test from 'node:test';
import assert from 'node:assert/strict';
import { planCountSave, validateCountValue } from '../../src/inventory/count-entry.mjs';

test('treats numeric zero as a valid count', () => {
  assert.deepEqual(validateCountValue(0), {
    status: 'VALID',
    value: 0,
  });
});

test('treats a blank count as incomplete', () => {
  assert.deepEqual(validateCountValue('   '), {
    status: 'INCOMPLETE',
    value: null,
  });
});

test('rejects a negative count as invalid', () => {
  assert.deepEqual(validateCountValue(-1), {
    status: 'INVALID',
    value: -1,
    error_code: 'COUNT_NEGATIVE',
  });
});

test('rejects a count that exceeds the configured decimal precision', () => {
  assert.deepEqual(validateCountValue(1.5, { decimal_places: 0 }), {
    status: 'INVALID',
    value: 1.5,
    error_code: 'COUNT_DECIMAL_NOT_ALLOWED',
  });
});

test('applies item count rules without rounding a submitted value', () => {
  const result = planCountSave({
    session: { session_id: 'phien-1', branch_id: 'CN_HN', business_date: '2026-09-21', config_snapshot_id: 'cfg-v1', status: 'ACTIVE' },
    item: { ma_bia: 'BIA-333', ten_bia: 'Bia 333', don_vi_dem: 'chai', decimal_places: 0 },
    value: 1.5,
    expected_revision: 0,
    operation_id: 'op-rule-1',
    request_id: 'req-rule-1',
    actor_user_id: 'user-1',
    now: '2026-09-21T17:00:00.000Z',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'COUNT_DECIMAL_NOT_ALLOWED');
  assert.deepEqual(result.write_plan, []);
});

test('rejects a stale item revision without planning a write', () => {
  const result = planCountSave({
    session: {
      session_id: 'phien-CN_HN-2026-09-21-cfg-v1',
      branch_id: 'CN_HN',
      business_date: '2026-09-21',
      config_snapshot_id: 'cfg-v1',
      status: 'ACTIVE',
    },
    item: { ma_bia: 'BIA-333', ten_bia: 'Bia 333', don_vi_dem: 'chai' },
    current_entry: {
      entry_id: 'entry-old',
      ma_bia: 'BIA-333',
      ton_thuc_te: 2,
      revision: 3,
      status: 'COMMITTED',
    },
    value: 4,
    expected_revision: 2,
    operation_id: 'op-count-1',
    request_id: 'req-count-1',
    actor_user_id: 'user-2',
    now: '2026-09-21T17:00:00.000Z',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'COUNT_REVISION_CONFLICT');
  assert.deepEqual(result.conflict, {
    expected_revision: 2,
    current_revision: 3,
    current_value: 2,
    submitted_value: 4,
    current_entry_id: 'entry-old',
  });
  assert.deepEqual(result.write_plan, []);
});

test('plans an append-only staged save for the next item revision', () => {
  const result = planCountSave({
    session: {
      session_id: 'phien-CN_HN-2026-09-21-cfg-v1',
      branch_id: 'CN_HN',
      business_date: '2026-09-21',
      config_snapshot_id: 'cfg-v1',
      config_version: 'v1',
      status: 'ACTIVE',
    },
    item: { ma_bia: 'BIA-333', ten_bia: 'Bia 333', don_vi_dem: 'chai' },
    current_entry: {
      entry_id: 'entry-old',
      ma_bia: 'BIA-333',
      ton_thuc_te: 2,
      revision: 1,
      status: 'COMMITTED',
    },
    value: 4,
    expected_revision: 1,
    operation_id: 'op-count-2',
    request_id: 'req-count-2',
    actor_user_id: 'user-2',
    now: '2026-09-21T17:00:00.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.entry.revision, 2);
  assert.equal(result.entry.ton_thuc_te, 4);
  assert.equal(result.entry.supersedes_entry_id, 'entry-old');
  assert.equal(result.write_plan[0].sheet, 'OPERATION');
  assert.equal(result.write_plan[0].row.status, 'PREPARED');
  const append = result.write_plan.find((step) => step.sheet === 'BIA_LOG' && step.action === 'APPEND');
  assert.equal(append.row.entry_id, result.entry.entry_id);
  assert.equal(append.row.status, 'PREPARED');
  assert.equal(append.row.write_state, 'PREPARED');
  assert.equal(append.row.operation_id, 'op-count-2');
  assert.equal(result.write_plan.some((step) => step.sheet === 'BIA_LOG' && step.action === 'UPDATE' && step.match.entry_id === 'entry-old'), false);
  assert.equal(result.write_plan.at(-1).patch.status, 'COMMITTED');
});

test('plans a correction adjustment instead of overwriting a finalized count', () => {
  const result = planCountSave({
    session: {
      session_id: 'phien-CN_HN-2026-09-21-cfg-v1',
      branch_id: 'CN_HN',
      business_date: '2026-09-21',
      config_snapshot_id: 'cfg-v1',
      config_version: 'v1',
      status: 'FINALIZED',
    },
    item: { ma_bia: 'BIA-333', ten_bia: 'Bia 333', don_vi_dem: 'chai' },
    current_entry: {
      entry_id: 'entry-final',
      ma_bia: 'BIA-333',
      ton_thuc_te: 2,
      revision: 1,
      status: 'COMMITTED',
    },
    value: 4,
    expected_revision: 1,
    correction_reason: 'Đếm lại sau khi phát hiện nhập nhầm',
    operation_id: 'op-correction-1',
    request_id: 'req-correction-1',
    actor_user_id: 'admin-1',
    now: '2026-09-21T18:00:00.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'ADJUSTMENT_PLANNED');
  const adjustment = result.write_plan.find((step) => step.sheet === 'DIEU_CHINH_SO' && step.action === 'APPEND');
  assert.equal(adjustment.row.target_entry_id, 'entry-final');
  assert.equal(adjustment.row.from_value, 2);
  assert.equal(adjustment.row.to_value, 4);
  assert.equal(adjustment.row.reason, 'Đếm lại sau khi phát hiện nhập nhầm');
  assert.equal(result.write_plan.some((step) => step.sheet === 'BIA_LOG' && step.action === 'UPDATE'), false);
});

test('rejects count entry while the session is expired until it is reopened', () => {
  const result = planCountSave({
    session: { session_id: 'phien-1', branch_id: 'CN_HN', business_date: '2026-09-21', config_snapshot_id: 'cfg-v1', status: 'EXPIRED' },
    item: { ma_bia: 'BIA-333', ten_bia: 'Bia 333', don_vi_dem: 'chai' },
    value: 4,
    expected_revision: 0,
    operation_id: 'op-expired-count-1',
    request_id: 'req-expired-count-1',
    actor_user_id: 'user-1',
    now: '2026-09-21T18:00:00.000Z',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'SESSION_EXPIRED_REOPEN_REQUIRED');
  assert.deepEqual(result.write_plan, []);
});

test('rejects an item outside the session catalog', () => {
  const result = planCountSave({
    session: {
      session_id: 'phien-1',
      status: 'ACTIVE',
      catalog: [{ ma_bia: 'BIA-001', ten_bia: 'Bia 001', don_vi_dem: 'chai' }],
    },
    item: { ma_bia: 'NOT_IN_CATALOG', ten_bia: 'Lạ', don_vi_dem: 'chai' },
    value: 1,
    expected_revision: 0,
    operation_id: 'op-catalog-1',
    request_id: 'req-catalog-1',
    actor_user_id: 'user-1',
    now: '2026-09-21T18:00:00.000Z',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'ITEM_NOT_IN_CATALOG');
});
