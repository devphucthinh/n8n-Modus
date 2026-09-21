import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_SHEET_DEFINITIONS,
  EXTENDED_CONFIG_SHEET_NAMES,
  EXTENDED_SHEET_DEFINITIONS,
  EXTENDED_SHEET_NAMES,
  GATEWAY_SHEET_NAMES,
} from '../../src/contracts/core-sheet-schema.mjs';

test('declares the shared V2 contract tables needed by all four lanes', () => {
  assert.deepEqual(EXTENDED_SHEET_NAMES.slice(0, 2), ['CONFIG_LICH', 'DISPATCH_HISTORY']);
  assert.ok(EXTENDED_CONFIG_SHEET_NAMES.includes('CONFIG_BIA'));
  assert.ok(EXTENDED_CONFIG_SHEET_NAMES.includes('CONFIG_QUY_DOI'));
  assert.ok(EXTENDED_CONFIG_SHEET_NAMES.includes('CONFIG_MAPPING_NHAP'));
  assert.ok(EXTENDED_CONFIG_SHEET_NAMES.includes('CONFIG_MAPPING_BAN'));
  assert.ok(EXTENDED_CONFIG_SHEET_NAMES.includes('CONFIG_NGUON_BAN'));
  assert.ok(EXTENDED_CONFIG_SHEET_NAMES.includes('CONFIG_NGUON_BAN_COT'));
  assert.ok(GATEWAY_SHEET_NAMES.includes('CONFIG_LICH'));
  assert.ok(GATEWAY_SHEET_NAMES.includes('CONFIG_BIA'));
  assert.ok(Object.hasOwn(EXTENDED_SHEET_DEFINITIONS, 'LOG_NHAP'));
  assert.ok(Object.hasOwn(EXTENDED_SHEET_DEFINITIONS, 'LOG_BAN'));
});

test('all shared contract columns are stable ASCII keys without duplicates', () => {
  for (const [sheetName, columns] of Object.entries(EXTENDED_SHEET_DEFINITIONS)) {
    assert.ok(columns.length > 0, `${sheetName} must declare columns`);
    assert.equal(new Set(columns).size, columns.length, `${sheetName} has duplicate columns`);
    for (const column of columns) assert.match(column, /^[a-z][a-z0-9_]*$/);
  }
});
