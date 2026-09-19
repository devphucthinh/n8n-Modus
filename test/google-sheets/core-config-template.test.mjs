import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_CONFIG_TEMPLATE } from '../../config/google-sheets/core-config-template.mjs';
import { CORE_SHEET_DEFINITIONS } from '../../src/contracts/core-sheet-schema.mjs';

test('template exposes every core sheet and required column exactly once', () => {
  for (const [sheetName, columns] of Object.entries(CORE_SHEET_DEFINITIONS)) {
    assert.deepEqual(CORE_CONFIG_TEMPLATE[sheetName].columns, columns);
    assert.equal(new Set(CORE_CONFIG_TEMPLATE[sheetName].columns).size, columns.length);
  }
});

test('template contains no real credential or production identifier', () => {
  assert.doesNotMatch(JSON.stringify(CORE_CONFIG_TEMPLATE), /AIza|Bearer|bot_token|credential_id/i);
  assert.match(JSON.stringify(CORE_CONFIG_TEMPLATE), /BRANCH_ID_CONFIGURE/);
});
