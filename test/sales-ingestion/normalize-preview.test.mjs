import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSourceRows,
  previewSales,
} from '../../src/sales-ingestion/normalize-sales.mjs';

const columnMap = {
  business_date: 'Ngày bán',
  item_code: 'Mã hàng',
  item_name: 'Tên hàng',
  quantity: 'Số lượng',
  unit: 'Đơn vị tính',
};

const items = [
  { item_id: 'TIGER', item_name: 'Tiger', inventory_unit: 'chai', tracked: 'YES', trang_thai: 'ACTIVE' },
  { item_id: 'SODA', item_name: 'Soda', inventory_unit: 'lon', tracked: 'YES', trang_thai: 'ACTIVE' },
  { item_id: 'WATER', item_name: 'Nước', inventory_unit: 'chai', tracked: 'NO', trang_thai: 'ACTIVE' },
];

const mappings = [
  { source_config_id: 'POS_A', source_item_code: 'T1', item_id: 'TIGER', trang_thai: 'ACTIVE' },
  { source_config_id: 'POS_A', source_item_code: 'SODA-RAW', item_id: 'SODA', trang_thai: 'ACTIVE' },
  { source_config_id: 'POS_A', source_item_code: 'WATER-RAW', item_id: 'WATER', trang_thai: 'ACTIVE' },
];

const conversions = [
  { item_id: 'TIGER', source_unit: 'két', target_unit: 'chai', numerator: 24, denominator: 1, effective_from: '2026-01-01', effective_to: '', trang_thai: 'ACTIVE' },
  { item_id: 'SODA', source_unit: 'lon', target_unit: 'lon', numerator: 1, denominator: 1, effective_from: '2026-01-01', effective_to: '', trang_thai: 'ACTIVE' },
  { item_id: 'WATER', source_unit: 'chai', target_unit: 'chai', numerator: 1, denominator: 1, effective_from: '2026-01-01', effective_to: '', trang_thai: 'ACTIVE' },
];

function rows() {
  return [
    { row_number: 2, 'Ngày bán': '2026-09-18', 'Mã hàng': 'T1', 'Tên hàng': 'Tiger', 'Số lượng': '2', 'Đơn vị tính': 'két' },
    { row_number: 3, 'Ngày bán': '2026-09-18', 'Mã hàng': 'WATER-RAW', 'Tên hàng': 'Nước', 'Số lượng': '3', 'Đơn vị tính': 'chai' },
  ];
}

function normalizedRows(inputRows = rows()) {
  return normalizeSourceRows({
    rows: inputRows,
    columnMap,
    sourceConfigId: 'POS_A',
    sourceFileId: 'file-001',
    sourceFileHash: 'hash-001',
    branchId: 'CN1',
    itemMappings: mappings,
    items,
    conversions,
  });
}

test('normalizes source rows through configured item mapping and unit conversion', () => {
  const result = normalizedRows();

  assert.equal(result.rows[0].business_date, '2026-09-18');
  assert.equal(result.rows[0].source_item_code, 'T1');
  assert.equal(result.rows[0].item_id, 'TIGER');
  assert.equal(result.rows[0].source_quantity, 2);
  assert.equal(result.rows[0].quantity_inventory_units, 48);
  assert.equal(result.rows[0].inventory_unit, 'chai');
  assert.equal(result.rows[0].mapping_status, 'MAPPED');
  assert.equal(result.rows[0].conversion_status, 'CONVERTED');
  assert.equal(result.rows[0].raw_values['Mã hàng'], 'T1');
  assert.equal(result.rows[1].mapping_status, 'UNTRACKED');
  assert.equal(result.rows[1].inclusion, 'IGNORED_UNTRACKED');
  assert.deepEqual(result.issues, []);
});

test('preview ZERO policy fills absent tracked items without hiding source rows', () => {
  const normalized = normalizedRows();
  const result = previewSales({
    normalizedRows: normalized.rows,
    trackedItems: items,
    missingItemPolicy: 'ZERO',
    branchId: 'CN1',
    businessDate: '2026-09-18',
  });

  assert.equal(result.status, 'PREVIEW_READY');
  assert.equal(result.can_publish, true);
  assert.deepEqual(result.missing_item_ids, ['SODA']);
  assert.deepEqual(result.zero_lines, [{ item_id: 'SODA', quantity_inventory_units: 0, inventory_unit: 'lon' }]);
  assert.equal(result.total_quantity_inventory_units, 48);
  assert.equal(result.source_row_count, 2);
  assert.ok(result.warnings.some((warning) => warning.code === 'MISSING_ITEM_ZERO'));
});

test('preview BLOCK policy prevents publish when a tracked item is absent', () => {
  const normalized = normalizedRows();
  const result = previewSales({
    normalizedRows: normalized.rows,
    trackedItems: items,
    missingItemPolicy: 'BLOCK',
    branchId: 'CN1',
    businessDate: '2026-09-18',
  });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.can_publish, false);
  assert.deepEqual(result.missing_item_ids, ['SODA']);
  assert.equal(result.errors[0].code, 'MISSING_TRACKED_ITEMS');
});

test('preview blocks an unmapped or unconvertible row as CHO_SUA_FILE', () => {
  const normalized = normalizedRows([
    { row_number: 8, 'Ngày bán': '2026-09-18', 'Mã hàng': 'UNKNOWN', 'Tên hàng': 'Lạ', 'Số lượng': '1', 'Đơn vị tính': 'keg' },
  ]);

  assert.equal(normalized.rows[0].mapping_status, 'MAPPING_REQUIRED');
  assert.equal(normalized.rows[0].conversion_status, 'NOT_ATTEMPTED');
  assert.equal(normalized.issues[0].code, 'ITEM_MAPPING_MISSING');

  const result = previewSales({
    normalizedRows: normalized.rows,
    trackedItems: items,
    missingItemPolicy: 'ZERO',
    branchId: 'CN1',
    businessDate: '2026-09-18',
  });
  assert.equal(result.status, 'CHO_SUA_FILE');
  assert.equal(result.can_publish, false);
  assert.equal(result.blocks_system_zero, true);
});

test('preview rejects a missing-item policy that was not supplied by source config', () => {
  const normalized = normalizedRows();
  const result = previewSales({
    normalizedRows: normalized.rows,
    trackedItems: items,
    branchId: 'CN1',
    businessDate: '2026-09-18',
  });

  assert.equal(result.status, 'CHO_SUA_FILE');
  assert.equal(result.can_publish, false);
  assert.equal(result.errors[0].code, 'MISSING_ITEM_POLICY_INVALID');
  assert.equal(result.blocks_system_zero, true);
});
