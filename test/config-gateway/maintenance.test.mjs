import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConfigGateway } from '../../src/config-gateway/evaluate-config.mjs';
import { CORE_SHEET_DEFINITIONS } from '../../src/contracts/core-sheet-schema.mjs';
import { envelope, FIXED_NOW, validConfig, validConfigWithRouterTables } from '../fixtures/config/valid-config.mjs';

const completeRow = (sheetName, values) => Object.fromEntries(CORE_SHEET_DEFINITIONS[sheetName].map((column) => [column, values[column] ?? '']));

test('allows status reads during maintenance and reports maintenance state', () => {
  const tables = validConfig();
  tables.CONFIG_VERSION[0].maintenance_mode = 'YES';
  const result = evaluateConfigGateway({ envelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.equal(result.response.state, 'MAINTENANCE');
  assert.equal(result.response.maintenance_mode, 'YES');
});

test('blocks new operations during maintenance', () => {
  const tables = validConfig();
  tables.CONFIG_VERSION[0].maintenance_mode = 'YES';
  const operationEnvelope = { ...envelope, payload: { command: '/nhap', intent: 'START_OPERATION' } };
  const result = evaluateConfigGateway({ envelope: operationEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_MAINTENANCE');
  assert.deepEqual(result.write_plan, []);
});

test('allows the sheet-driven help catalog during maintenance', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_VERSION[0].maintenance_mode = 'YES';
  const helpEnvelope = { ...envelope, payload: { command: '/help', intent: 'READ_HELP', required_sheet_names: ['CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH', 'EVENT_LOG'] } };
  const result = evaluateConfigGateway({ envelope: helpEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.equal(result.response.state, 'MAINTENANCE');
  assert.equal(result.response.data.config_tables.CONFIG_LENH.length, 7);
});

test('treats a request without an explicit status intent as a new operation', () => {
  const tables = validConfig();
  tables.CONFIG_VERSION[0].maintenance_mode = 'YES';
  const operationEnvelope = { ...envelope, payload: { command: '/nhap' } };
  const result = evaluateConfigGateway({ envelope: operationEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_MAINTENANCE');
});

test('does not reuse a committed read-only snapshot for a status request', () => {
  const first = evaluateConfigGateway({ envelope, tables: validConfig(), now: FIXED_NOW });
  const tables = validConfig();
  tables.CONFIG_SNAPSHOT = [completeRow('CONFIG_SNAPSHOT', {
    config_snapshot_id: first.response.config_snapshot_id ?? 'cfg-v1-status-old',
    config_version: 'v1',
    schema_version: '1.0',
    fingerprint: first.response.fingerprint,
    normalized_config_json: first.diagnostics.normalized_config_json,
    operation_id: envelope.operation_id,
    status: 'COMMITTED',
    created_at: FIXED_NOW,
  })];
  tables.OPERATION = [completeRow('OPERATION', { operation_id: envelope.operation_id, operation_type: 'READ_STATUS', status: 'COMMITTED' })];
  const result = evaluateConfigGateway({ envelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.deepEqual(result.write_plan, []);
  assert.equal(result.response.config_snapshot_id, null);
});
