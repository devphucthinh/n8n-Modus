import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_SHEET_DEFINITIONS, CORE_SHEET_NAMES } from '../../src/contracts/core-sheet-schema.mjs';

test('declares the nine core V2 tabs in stable order', () => {
  assert.deepEqual(CORE_SHEET_NAMES, [
    'CONFIG_SCHEMA',
    'CONFIG_VERSION',
    'CONFIG_GLOBAL',
    'CONFIG_BRANCH',
    'CONFIG_USER',
    'CONFIG_THONG_BAO',
    'CONFIG_SNAPSHOT',
    'OPERATION',
    'ERROR_BIA',
  ]);
});

test('every core tab has unique non-empty ASCII column keys', () => {
  for (const [sheetName, columns] of Object.entries(CORE_SHEET_DEFINITIONS)) {
    assert.ok(columns.length > 0, `${sheetName} must declare columns`);
    assert.equal(new Set(columns).size, columns.length, `${sheetName} has duplicate columns`);
    for (const column of columns) {
      assert.match(column, /^[a-z][a-z0-9_]*$/);
    }
  }
});
