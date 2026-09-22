import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConfigGateway } from '../../src/config-gateway/evaluate-config.mjs';
import { CORE_SHEET_DEFINITIONS } from '../../src/contracts/core-sheet-schema.mjs';
import { envelope, FIXED_NOW, validConfig, validConfigWithRouterTables } from '../fixtures/config/valid-config.mjs';

const completeRow = (sheetName, values) => Object.fromEntries(CORE_SHEET_DEFINITIONS[sheetName].map((column) => [column, values[column] ?? '']));

function withCommittedSnapshot(configVersion, fingerprint, status = 'COMMITTED') {
  const tables = validConfig();
  tables.CONFIG_SNAPSHOT = [completeRow('CONFIG_SNAPSHOT', {
    config_snapshot_id: `cfg-${configVersion}-old`,
    config_version: configVersion,
    schema_version: '1.0',
    fingerprint,
    normalized_config_json: '{}',
    operation_id: 'op-old',
    status,
    created_at: FIXED_NOW,
  })];
  tables.OPERATION = [completeRow('OPERATION', { operation_id: 'op-old', operation_type: 'START_OPERATION', status: 'COMMITTED' })];
  return tables;
}

const writeEnvelope = { ...envelope, payload: { command: '/kiemke', intent: 'START_OPERATION' } };

test('blocks changed content when config_version did not increase', () => {
  const baseline = evaluateConfigGateway({ envelope: writeEnvelope, tables: validConfig(), now: FIXED_NOW });
  const tables = withCommittedSnapshot('v1', baseline.response.fingerprint);
  tables.CONFIG_BRANCH[0].branch_name = 'Chi nhánh Hà Nội đã đổi';
  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.response.error_code, 'CONFIG_VERSION_NOT_INCREMENTED');
});

test('blocks an increased version when normalized content is unchanged', () => {
  const baseline = evaluateConfigGateway({ envelope: writeEnvelope, tables: validConfig(), now: FIXED_NOW });
  const tables = validConfig();
  tables.CONFIG_VERSION[0].config_version = 'v2';
  tables.CONFIG_SNAPSHOT = [completeRow('CONFIG_SNAPSHOT', {
    config_snapshot_id: 'cfg-v1-old',
    config_version: 'v1',
    schema_version: '1.0',
    fingerprint: baseline.response.fingerprint,
    normalized_config_json: baseline.diagnostics.normalized_config_json,
    operation_id: 'op-old',
    status: 'COMMITTED',
    created_at: FIXED_NOW,
  })];
  tables.OPERATION = [completeRow('OPERATION', { operation_id: 'op-old', operation_type: 'START_OPERATION', status: 'COMMITTED' })];
  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.response.error_code, 'CONFIG_VERSION_EMPTY_CHANGE');
});

test('ignores PREPARED snapshots when finding the accepted predecessor', () => {
  const tables = validConfig();
  tables.CONFIG_SNAPSHOT = [completeRow('CONFIG_SNAPSHOT', {
    config_snapshot_id: 'cfg-v1-prepared',
    config_version: 'v1',
    schema_version: '1.0',
    fingerprint: 'not-the-current-content',
    normalized_config_json: '{}',
    operation_id: 'op-prepared',
    status: 'PREPARED',
    created_at: FIXED_NOW,
  })];
  tables.OPERATION = [completeRow('OPERATION', { operation_id: 'op-prepared', status: 'PREPARED' })];
  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.equal(result.write_plan.length, 4);
});

test('keeps status reads read-only', () => {
  const result = evaluateConfigGateway({ envelope, tables: validConfig(), now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.deepEqual(result.write_plan, []);
  assert.equal(result.diagnostics.read_only, true);
});

test('does not let a committed read-only snapshot poison help or write operations', () => {
  const statusResult = evaluateConfigGateway({ envelope, tables: validConfig(), now: FIXED_NOW });
  const tables = validConfigWithRouterTables();
  tables.CONFIG_SNAPSHOT = [completeRow('CONFIG_SNAPSHOT', {
    config_snapshot_id: statusResult.response.config_snapshot_id ?? 'cfg-v1-status-old',
    config_version: 'v1',
    schema_version: '1.0',
    fingerprint: statusResult.response.fingerprint,
    normalized_config_json: statusResult.diagnostics.normalized_config_json,
    operation_id: 'op-status-old',
    status: 'COMMITTED',
    created_at: FIXED_NOW,
  })];
  tables.OPERATION = [completeRow('OPERATION', { operation_id: 'op-status-old', operation_type: 'READ_STATUS', status: 'COMMITTED' })];

  const helpResult = evaluateConfigGateway({
    envelope: { ...envelope, payload: { command: '/help', intent: 'READ_HELP', required_sheet_names: ['CONFIG_LENH', 'CONFIG_PERMISSION'] } },
    tables,
    now: FIXED_NOW,
  });
  assert.equal(helpResult.ok, true);
  assert.equal(helpResult.response.data.config_tables.CONFIG_LENH.length, 7);
  assert.deepEqual(helpResult.write_plan, []);
  assert.equal(helpResult.diagnostics.read_only, true);

  const writeResult = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  assert.equal(writeResult.ok, true);
  assert.equal(writeResult.write_plan.length, 4);
});

test('keeps Google Sheets row metadata out of the snapshot cell payload', () => {
  const tables = validConfigWithRouterTables();
  for (const rows of Object.values(tables)) {
    if (Array.isArray(rows)) rows.forEach((row, index) => { row.row_number = String(index + 2); });
  }
  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.diagnostics.normalized_config_json, /row_number/);
  assert.ok(result.diagnostics.normalized_config_json.length < 50000);
});

test('reuses a legacy snapshot when only Google Sheets row metadata differs', () => {
  const tables = validConfigWithRouterTables();
  const baseline = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  const legacyPayload = JSON.parse(baseline.diagnostics.normalized_config_json);
  for (const rows of Object.values(legacyPayload)) rows.forEach((row) => { row.row_number = '2'; });
  const legacySnapshotId = 'cfg-v1-legacy-row-metadata';
  tables.CONFIG_SNAPSHOT = [completeRow('CONFIG_SNAPSHOT', {
    config_snapshot_id: legacySnapshotId,
    config_version: 'v1',
    schema_version: '1.0',
    fingerprint: 'legacy-fingerprint-with-row-metadata',
    normalized_config_json: JSON.stringify(legacyPayload),
    operation_id: 'op-legacy-snapshot',
    status: 'COMMITTED',
    created_at: FIXED_NOW,
  })];
  tables.OPERATION = [completeRow('OPERATION', { operation_id: 'op-legacy-snapshot', operation_type: 'START_OPERATION', status: 'COMMITTED' })];

  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.deepEqual(result.write_plan, []);
  assert.equal(result.response.config_snapshot_id, legacySnapshotId);
});
