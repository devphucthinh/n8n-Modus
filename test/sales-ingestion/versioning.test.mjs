import test from 'node:test';
import assert from 'node:assert/strict';

import {
  authorizeSalesPublish,
  computeNormalizedContentHash,
  createAdjustmentForNegative,
  createSystemZero,
  dedupeSalesFile,
  planPublish,
} from '../../src/sales-ingestion/versioned-ledger.mjs';

const canonicalLines = [
  { item_id: 'TIGER', quantity_inventory_units: 48, inventory_unit: 'chai' },
  { item_id: 'SODA', quantity_inventory_units: 0, inventory_unit: 'lon' },
];

const contentHash = computeNormalizedContentHash({
  branchId: 'CN1',
  businessDate: '2026-09-18',
  canonicalLines,
});

function draft(overrides = {}) {
  return {
    upload_id: 'upload-002',
    source_file_id: 'file-002',
    file_hash: 'file-hash-002',
    normalized_content_hash: contentHash,
    source_config_id: 'POS_A',
    config_snapshot_id: 'cfg-v1-sales',
    branch_id: 'CN1',
    business_date: '2026-09-18',
    uploader_user_id: 'user-uploader',
    approver_user_id: 'user-approver',
    preview: {
      status: 'PREVIEW_READY',
      can_publish: true,
      canonical_lines: canonicalLines,
      source_rows: [],
      errors: [],
      warnings: [],
    },
    ...overrides,
  };
}

test('same file hash is classified as a duplicate without a new version', () => {
  const result = dedupeSalesFile({
    fileHash: 'file-hash-002',
    normalizedContentHash: contentHash,
    branchId: 'CN1',
    businessDate: '2026-09-18',
    existingUploads: [{ upload_id: 'upload-001', file_hash: 'file-hash-002', sales_version_id: 'sales-version-001', status: 'PUBLISHED' }],
    existingVersions: [],
  });

  assert.deepEqual(result, {
    kind: 'DUPLICATE_FILE',
    existing_upload_id: 'upload-001',
    existing_version_id: 'sales-version-001',
  });
});

test('different file with identical normalized content is a no-change upload', () => {
  const result = dedupeSalesFile({
    fileHash: 'file-hash-new',
    normalizedContentHash: contentHash,
    branchId: 'CN1',
    businessDate: '2026-09-18',
    existingUploads: [{ upload_id: 'upload-001', file_hash: 'file-hash-old', sales_version_id: 'sales-version-001', status: 'PUBLISHED' }],
    existingVersions: [{ sales_version_id: 'sales-version-001', branch_id: 'CN1', business_date: '2026-09-18', normalized_content_hash: contentHash, status: 'ACTIVE' }],
  });

  assert.deepEqual(result, {
    kind: 'NO_CHANGE',
    existing_version_id: 'sales-version-001',
  });
});

test('superseded content is not treated as the current no-change version', () => {
  const result = dedupeSalesFile({
    fileHash: 'file-hash-later',
    normalizedContentHash: contentHash,
    branchId: 'CN1',
    businessDate: '2026-09-18',
    existingUploads: [],
    existingVersions: [{
      sales_version_id: 'sales-version-old',
      branch_id: 'CN1',
      business_date: '2026-09-18',
      normalized_content_hash: contentHash,
      status: 'SUPERSEDED',
    }],
  });

  assert.deepEqual(result, { kind: 'NEW' });
});

test('CHO_SUA_FILE blocks SYSTEM_ZERO creation', () => {
  const result = createSystemZero({
    branchId: 'CN1',
    businessDate: '2026-09-18',
    trackedItems: [
      { item_id: 'TIGER', inventory_unit: 'chai', tracked: 'YES', trang_thai: 'ACTIVE' },
    ],
    pendingUploads: [{ upload_id: 'upload-broken', status: 'CHO_SUA_FILE' }],
  });

  assert.deepEqual(result, {
    ok: false,
    error_code: 'SYSTEM_ZERO_BLOCKED_PENDING_FILE',
    blocking_upload_ids: ['upload-broken'],
  });
});

test('SYSTEM_ZERO creates one zero line per tracked item when no file is pending', () => {
  const result = createSystemZero({
    branchId: 'CN1',
    businessDate: '2026-09-18',
    trackedItems: [
      { item_id: 'SODA', inventory_unit: 'lon', tracked: 'YES', trang_thai: 'ACTIVE' },
      { item_id: 'TIGER', inventory_unit: 'chai', tracked: 'YES', trang_thai: 'ACTIVE' },
    ],
    now: '2026-09-21T01:00:00.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.version.source, 'SYSTEM_ZERO');
  assert.equal(result.version.status, 'ACTIVE');
  assert.equal(result.version.created_at, '2026-09-21T01:00:00.000Z');
  assert.deepEqual(result.version.lines, [
    { item_id: 'SODA', quantity_inventory_units: 0, inventory_unit: 'lon' },
    { item_id: 'TIGER', quantity_inventory_units: 0, inventory_unit: 'chai' },
  ]);
});

test('SYSTEM_ZERO can be recreated after a prior zero version was superseded', () => {
  const result = createSystemZero({
    branchId: 'CN1',
    businessDate: '2026-09-18',
    trackedItems: [{ item_id: 'TIGER', inventory_unit: 'chai', tracked: 'YES', trang_thai: 'ACTIVE' }],
    existingVersions: [{
      sales_version_id: 'sales-zero-old',
      branch_id: 'CN1',
      business_date: '2026-09-18',
      source: 'SYSTEM_ZERO',
      status: 'SUPERSEDED',
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'CREATE');
});

test('real file supersedes SYSTEM_ZERO instead of adding to it', () => {
  const result = planPublish({
    draft: draft(),
    existingVersions: [{
      sales_version_id: 'sales-zero-001',
      branch_id: 'CN1',
      business_date: '2026-09-18',
      source: 'SYSTEM_ZERO',
      status: 'ACTIVE',
      normalized_content_hash: computeNormalizedContentHash({ branchId: 'CN1', businessDate: '2026-09-18', canonicalLines: [{ item_id: 'TIGER', quantity_inventory_units: 0, inventory_unit: 'chai' }, { item_id: 'SODA', quantity_inventory_units: 0, inventory_unit: 'lon' }] }),
    }],
    now: '2026-09-21T01:05:00.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'PUBLISH');
  assert.equal(result.version.source, 'FILE');
  assert.equal(result.version.supersedes_version_id, 'sales-zero-001');
  assert.deepEqual(result.supersede, { sales_version_id: 'sales-zero-001', status: 'SUPERSEDED', superseded_by: result.version.sales_version_id });
  assert.equal(result.version.lines.find((line) => line.item_id === 'TIGER').quantity_inventory_units, 48);
  assert.equal(result.version.lines.reduce((sum, line) => sum + line.quantity_inventory_units, 0), 48);
});

test('real file still replaces SYSTEM_ZERO when normalized content is also all zero', () => {
  const zeroHash = computeNormalizedContentHash({
    branchId: 'CN1',
    businessDate: '2026-09-18',
    canonicalLines: [
      { item_id: 'SODA', quantity_inventory_units: 0, inventory_unit: 'lon' },
      { item_id: 'TIGER', quantity_inventory_units: 0, inventory_unit: 'chai' },
    ],
  });
  const result = planPublish({
    draft: draft({ normalized_content_hash: zeroHash, file_hash: 'real-zero-file-hash' }),
    existingVersions: [{
      sales_version_id: 'sales-zero-same-content',
      branch_id: 'CN1',
      business_date: '2026-09-18',
      source: 'SYSTEM_ZERO',
      status: 'ACTIVE',
      normalized_content_hash: zeroHash,
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'PUBLISH');
  assert.equal(result.version.source, 'FILE');
  assert.equal(result.version.supersedes_version_id, 'sales-zero-same-content');
});

test('negative quantities require an adjustment and never publish automatically', () => {
  const negativeDraft = draft({
    preview: {
      status: 'ADJUSTMENT_REQUIRED',
      can_publish: false,
      canonical_lines: [],
      source_rows: [{ source_line_id: 'line-file-002-9', item_id: 'TIGER', quantity_inventory_units: -2, source_quantity: -1 }],
      errors: [{ code: 'NEGATIVE_QUANTITY_REQUIRES_ADJUSTMENT', source_line_id: 'line-file-002-9', quantity: -1 }],
      warnings: [],
    },
  });
  const publish = planPublish({ draft: negativeDraft, existingVersions: [] });
  assert.deepEqual(publish, { ok: false, error_code: 'NEGATIVE_QUANTITY_REQUIRES_ADJUSTMENT', adjustment_required: true });

  const adjustment = createAdjustmentForNegative({ draft: negativeDraft, actorUserId: 'admin-1', reason: 'Hoàn hàng cần duyệt' });
  assert.equal(adjustment.ok, true);
  assert.equal(adjustment.status, 'PENDING_APPROVAL');
  assert.equal(adjustment.rows[0].reference_source_line_id, 'line-file-002-9');
  assert.equal(adjustment.rows[0].quantity_inventory_units, -2);
});

test('SYSTEM_ZERO waits for any non-terminal pending upload, not only CHO_SUA_FILE', () => {
  const result = createSystemZero({
    branchId: 'CN1',
    businessDate: '2026-09-18',
    trackedItems: [{ item_id: 'TIGER', inventory_unit: 'chai', tracked: 'YES', trang_thai: 'ACTIVE' }],
    pendingUploads: [{ upload_id: 'upload-pending', branch_id: 'CN1', business_date: '2026-09-18', status: 'PREVIEW_READY' }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'SYSTEM_ZERO_BLOCKED_PENDING_FILE');
  assert.deepEqual(result.blocking_upload_ids, ['upload-pending']);
});

test('separate approver policy blocks self-publish only when configured', () => {
  assert.deepEqual(authorizeSalesPublish({ requireSeparateApprover: 'YES', uploaderUserId: 'u1', approverUserId: 'u1' }), {
    ok: false,
    error_code: 'SEPARATE_APPROVER_REQUIRED',
  });
  assert.equal(authorizeSalesPublish({ requireSeparateApprover: 'YES', uploaderUserId: 'u1', approverUserId: 'u2' }).ok, true);
  assert.equal(authorizeSalesPublish({ requireSeparateApprover: 'NO', uploaderUserId: 'u1' }).ok, true);
});

test('publish requires a different approver when source policy says YES', () => {
  const result = planPublish({
    draft: draft({ approver_user_id: 'user-uploader' }),
    requireSeparateApprover: 'YES',
    existingVersions: [],
  });
  assert.deepEqual(result, { ok: false, error_code: 'SEPARATE_APPROVER_REQUIRED' });
});
