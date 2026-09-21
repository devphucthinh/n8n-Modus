import test from 'node:test';
import assert from 'node:assert/strict';

import {
  matchSourceConfigs,
  selectSourceConfig,
  splitByBusinessDate,
} from '../../src/sales-ingestion/source-config.mjs';

const sourceColumns = [
  { source_config_id: 'POS_A', column_role: 'business_date', header_alias: 'Ngày bán', required: 'YES' },
  { source_config_id: 'POS_A', column_role: 'item_code', header_alias: 'Mã hàng', required: 'YES' },
  { source_config_id: 'POS_A', column_role: 'quantity', header_alias: 'Số lượng', required: 'YES' },
  { source_config_id: 'POS_A', column_role: 'unit', header_alias: 'Đơn vị tính', required: 'YES' },
  { source_config_id: 'POS_B', column_role: 'business_date', header_alias: 'Date', required: 'YES' },
  { source_config_id: 'POS_B', column_role: 'item_code', header_alias: 'SKU', required: 'YES' },
  { source_config_id: 'POS_B', column_role: 'quantity', header_alias: 'Qty', required: 'YES' },
  { source_config_id: 'POS_B', column_role: 'unit', header_alias: 'Unit', required: 'YES' },
];

const sourceConfigs = [
  { source_config_id: 'POS_A', source_name: 'POS A', sheet_name_pattern: '^Báo cáo', trang_thai: 'ACTIVE', missing_item_policy: 'ZERO' },
  { source_config_id: 'POS_B', source_name: 'POS B', sheet_name_pattern: '^Báo cáo', trang_thai: 'ACTIVE', missing_item_policy: 'BLOCK' },
];

test('matches a configured source by sheet and header aliases', () => {
  const result = matchSourceConfigs({
    sheetName: 'Báo cáo ngày',
    headers: ['Ngày bán', 'Mã hàng', 'Số lượng', 'Đơn vị tính'],
    sourceConfigs,
    sourceColumns,
  });

  assert.equal(result.status, 'MATCHED');
  assert.deepEqual(result.matches.map((match) => match.source_config_id), ['POS_A']);
  assert.deepEqual(result.matches[0].matched_columns, {
    business_date: 'Ngày bán',
    item_code: 'Mã hàng',
    quantity: 'Số lượng',
    unit: 'Đơn vị tính',
  });
});

test('requires explicit selection when more than one source matches', () => {
  const matches = matchSourceConfigs({
    sheetName: 'Báo cáo ngày',
    headers: ['Ngày bán', 'Mã hàng', 'Số lượng', 'Đơn vị tính', 'Date', 'SKU', 'Qty', 'Unit'],
    sourceConfigs,
    sourceColumns,
  });

  assert.equal(matches.status, 'AMBIGUOUS');
  assert.deepEqual(matches.matches.map((match) => match.source_config_id), ['POS_A', 'POS_B']);
  assert.deepEqual(selectSourceConfig({ matches: matches.matches }), {
    ok: false,
    error_code: 'SOURCE_AMBIGUOUS',
    options: ['POS_A', 'POS_B'],
  });
  assert.equal(selectSourceConfig({ matches: matches.matches, sourceConfigId: 'POS_B' }).source_config_id, 'POS_B');
});

test('splits a late file by business date from its rows, not upload time', () => {
  const result = splitByBusinessDate({
    rows: [
      { row_number: 2, business_date: '2026-09-18', item_code: 'A', quantity: '2' },
      { row_number: 3, business_date: '2026-09-19', item_code: 'A', quantity: '3' },
      { row_number: 4, business_date: '2026-09-18', item_code: 'B', quantity: '1' },
    ],
    businessDateField: 'business_date',
    branchId: 'CN1',
    uploadedAt: '2026-09-21T01:00:00.000Z',
  });

  assert.deepEqual(result.groups.map((group) => group.business_date), ['2026-09-18', '2026-09-19']);
  assert.deepEqual(result.groups[0].rows.map((row) => row.row_number), [2, 4]);
  assert.equal(result.groups[0].branch_id, 'CN1');
  assert.equal(result.uploaded_at, '2026-09-21T01:00:00.000Z');
  assert.deepEqual(result.invalid_rows, []);
});

test('does not invent a missing-item policy when source config omits it', () => {
  const result = matchSourceConfigs({
    sheetName: 'Báo cáo ngày',
    headers: ['Ngày bán', 'Mã hàng', 'Số lượng', 'Đơn vị tính'],
    sourceConfigs: [{ source_config_id: 'POS_MISSING_POLICY', sheet_name_pattern: '^Báo cáo', trang_thai: 'ACTIVE' }],
    sourceColumns: sourceColumns
      .filter((row) => row.source_config_id === 'POS_A')
      .map((row) => ({ ...row, source_config_id: 'POS_MISSING_POLICY' })),
  });

  assert.equal(result.status, 'MATCHED');
  assert.equal(result.matches[0].missing_item_policy, '');
});
