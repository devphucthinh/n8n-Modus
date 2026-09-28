import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIT_CONFIG_TEMPLATE, CORE_CONFIG_TEMPLATE } from '../../config/google-sheets/core-config-template.mjs';
import { AUDIT_SHEET_DEFINITIONS, CORE_SHEET_DEFINITIONS } from '../../src/contracts/core-sheet-schema.mjs';

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

test('template exposes the operational audit sheet separately from router config', () => {
  for (const [sheetName, columns] of Object.entries(AUDIT_SHEET_DEFINITIONS)) {
    assert.deepEqual(AUDIT_CONFIG_TEMPLATE[sheetName].columns, columns);
    assert.deepEqual(AUDIT_CONFIG_TEMPLATE[sheetName].rows, []);
  }
});

test('template provides every protocol message required by the gateway', () => {
  const required = [
    'STATUS_HEADER',
    'STATUS_GATEWAY_HEALTH_LINE',
    'STATUS_CONFIG_LINE',
    'STATUS_BRANCH_COUNT_LINE',
    'STATUS_BRANCH_LINE',
    'STATUS_MAINTENANCE_LINE',
    'ERROR_GENERIC',
    'USER_NOT_ACTIVE',
    'COMMAND_NOT_AVAILABLE',
    'HELP_HEADER',
    'ROUTER_COMMAND_ACCEPTED',
    'ROUTER_RETRY_ACCEPTED',
    'ROUTER_DUPLICATE',
  ];
  const actual = new Set(CORE_CONFIG_TEMPLATE.CONFIG_THONG_BAO.rows.map((row) => row.message_key));
  for (const key of required) assert.ok(actual.has(key), `missing ${key}`);
});
