import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConfigGateway, expandSnapshotPayload } from '../../src/config-gateway/evaluate-config.mjs';
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

test('ignores committed snapshots without a committed operation', () => {
  const baseline = evaluateConfigGateway({ envelope: writeEnvelope, tables: validConfig(), now: FIXED_NOW });
  const tables = validConfig();
  tables.CONFIG_SNAPSHOT = [completeRow('CONFIG_SNAPSHOT', {
    config_snapshot_id: 'cfg-v1-orphan',
    config_version: 'v1',
    schema_version: '1.0',
    fingerprint: baseline.response.fingerprint,
    normalized_config_json: baseline.diagnostics.normalized_config_json,
    operation_id: 'op-orphan',
    status: 'COMMITTED',
    created_at: FIXED_NOW,
  })];
  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.reused_snapshot, false);
  assert.notEqual(result.response.config_snapshot_id, 'cfg-v1-orphan');
});

test('does not append a deterministic snapshot id already occupied by an orphan', () => {
  const baseline = evaluateConfigGateway({ envelope: writeEnvelope, tables: validConfig(), now: FIXED_NOW });
  const tables = validConfig();
  tables.CONFIG_SNAPSHOT = [completeRow('CONFIG_SNAPSHOT', {
    config_snapshot_id: baseline.response.config_snapshot_id,
    config_version: 'v1',
    schema_version: '1.0',
    fingerprint: baseline.response.fingerprint,
    normalized_config_json: baseline.diagnostics.normalized_config_json,
    operation_id: 'op-orphan',
    status: 'COMMITTED',
    created_at: FIXED_NOW,
  })];

  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  const append = result.write_plan.find((step) => step.sheet === 'CONFIG_SNAPSHOT' && step.action === 'APPEND');
  assert.equal(result.ok, true);
  assert.notEqual(append.row.config_snapshot_id, baseline.response.config_snapshot_id);
  assert.notEqual(append.row.config_snapshot_id, tables.CONFIG_SNAPSHOT[0].config_snapshot_id);
});

test('upserts an incomplete operation instead of appending the same operation identity', () => {
  const tables = validConfig();
  const baseline = evaluateConfigGateway({ envelope: writeEnvelope, tables: validConfig(), now: FIXED_NOW });
  tables.OPERATION = [completeRow('OPERATION', {
    operation_id: 'op-001',
    request_id: 'req-001',
    operation_type: 'START_OPERATION',
    idempotency_key: 'req-001',
    checksum: baseline.response.fingerprint,
    status: 'PREPARED',
  })];
  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.equal(result.write_plan.find((step) => step.sheet === 'OPERATION').action, 'UPSERT');
  assert.equal(result.write_plan.find((step) => step.sheet === 'OPERATION').row.operation_id, 'op-001');
});

test('rejects recovery when an incomplete operation has conflicting immutable identity fields', () => {
  const tables = validConfig();
  tables.OPERATION = [completeRow('OPERATION', {
    operation_id: 'op-001',
    request_id: 'different-request',
    operation_type: 'START_OPERATION',
    idempotency_key: 'different-request',
    checksum: 'different-checksum',
    status: 'PREPARED',
  })];
  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'OPERATION_ID_COLLISION');
  assert.deepEqual(result.write_plan, []);
});

test('preserves the original operation identity and creation time during recovery', () => {
  const tables = validConfig();
  const baseline = evaluateConfigGateway({ envelope: writeEnvelope, tables: validConfig(), now: FIXED_NOW });
  const createdAt = '2026-09-18T01:00:00.000Z';
  tables.OPERATION = [completeRow('OPERATION', {
    operation_id: 'op-001',
    request_id: 'req-001',
    operation_type: 'START_OPERATION',
    idempotency_key: 'req-001',
    checksum: baseline.response.fingerprint,
    created_at: createdAt,
    status: 'FAILED',
  })];
  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  const operationStep = result.write_plan.find((step) => step.sheet === 'OPERATION');
  assert.equal(result.ok, true);
  assert.equal(operationStep.action, 'UPSERT');
  assert.equal(operationStep.row.request_id, 'req-001');
  assert.equal(operationStep.row.idempotency_key, 'req-001');
  assert.equal(operationStep.row.created_at, createdAt);
});

test('rejects reuse of an operation identity that is already committed', () => {
  const tables = validConfig();
  tables.OPERATION = [completeRow('OPERATION', {
    operation_id: 'op-001',
    request_id: 'old-request',
    operation_type: 'START_OPERATION',
    idempotency_key: 'old-request',
    status: 'COMMITTED',
  })];
  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'OPERATION_ID_COMMITTED');
  assert.deepEqual(result.write_plan, []);
});

test('reuses the snapshot identity owned by an incomplete operation', () => {
  const tables = validConfig();
  const baseline = evaluateConfigGateway({ envelope: writeEnvelope, tables: validConfig(), now: FIXED_NOW });
  const snapshotId = 'cfg-v1-incomplete-op';
  tables.OPERATION = [completeRow('OPERATION', {
    operation_id: 'op-001',
    request_id: 'req-001',
    operation_type: 'START_OPERATION',
    idempotency_key: 'req-001',
    checksum: baseline.response.fingerprint,
    status: 'PREPARED',
  })];
  tables.CONFIG_SNAPSHOT = [completeRow('CONFIG_SNAPSHOT', {
    config_snapshot_id: snapshotId,
    config_version: 'v1',
    fingerprint: baseline.response.fingerprint,
    operation_id: 'op-001',
    status: 'PREPARED',
  })];
  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  const snapshotStep = result.write_plan.find((step) => step.sheet === 'CONFIG_SNAPSHOT' && ['APPEND', 'UPSERT'].includes(step.action));
  assert.equal(result.ok, true);
  assert.equal(snapshotStep.action, 'UPSERT');
  assert.equal(snapshotStep.row.config_snapshot_id, snapshotId);
});

test('does not create a second snapshot for an incomplete operation tied to different config', () => {
  const tables = validConfig();
  const baseline = evaluateConfigGateway({ envelope: writeEnvelope, tables: validConfig(), now: FIXED_NOW });
  tables.OPERATION = [completeRow('OPERATION', {
    operation_id: 'op-001',
    request_id: 'req-001',
    operation_type: 'START_OPERATION',
    idempotency_key: 'req-001',
    checksum: baseline.response.fingerprint,
    status: 'PREPARED',
  })];
  tables.CONFIG_SNAPSHOT = [completeRow('CONFIG_SNAPSHOT', {
    config_snapshot_id: 'cfg-v0-old',
    config_version: 'v0',
    fingerprint: 'old-fingerprint',
    normalized_config_json: '{}',
    operation_id: 'op-001',
    status: 'PREPARED',
  })];
  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'OPERATION_RECOVERY_MISMATCH');
  assert.deepEqual(result.write_plan, []);
});

test('keeps status reads read-only', () => {
  const result = evaluateConfigGateway({ envelope, tables: validConfig(), now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.deepEqual(result.write_plan, []);
  assert.equal(result.diagnostics.read_only, true);
});

test('snapshots first-use routed config with an operation identity separate from the route reservation', () => {
  const result = evaluateConfigGateway({
    envelope: { ...writeEnvelope, payload: { command: '/kiemke', intent: 'ROUTE_COMMAND', required_sheet_names: [] } },
    tables: validConfig(),
    now: FIXED_NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.write_plan.length, 4);
  assert.equal(result.write_plan[0].row.operation_type, 'CONFIG_SNAPSHOT');
  assert.match(result.write_plan[0].row.operation_id, /^cfg-v1-/);
  assert.equal(result.response.operation_id, envelope.operation_id);
  assert.equal(result.diagnostics.reused_snapshot, false);
});

test('rejects routed commands when config content changed without a version bump', () => {
  const baseline = evaluateConfigGateway({ envelope: writeEnvelope, tables: validConfig(), now: FIXED_NOW });
  const tables = withCommittedSnapshot('v1', baseline.response.fingerprint);
  tables.CONFIG_BRANCH[0].branch_name = 'Tên chưa được version hóa';

  const result = evaluateConfigGateway({
    envelope: { ...writeEnvelope, payload: { command: '/kiemke', intent: 'ROUTE_COMMAND', required_sheet_names: [] } },
    tables,
    now: FIXED_NOW,
  });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_VERSION_NOT_INCREMENTED');
  assert.deepEqual(result.write_plan, []);
});

test('rejects /help when config content changed without a version bump', () => {
  const baseline = evaluateConfigGateway({ envelope: writeEnvelope, tables: validConfig(), now: FIXED_NOW });
  const tables = withCommittedSnapshot('v1', baseline.response.fingerprint);
  tables.CONFIG_BRANCH[0].branch_name = 'Tên chưa được version hóa';

  const result = evaluateConfigGateway({
    envelope: { ...writeEnvelope, payload: { command: '/help', intent: 'READ_HELP', required_sheet_names: [] } },
    tables,
    now: FIXED_NOW,
  });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_VERSION_NOT_INCREMENTED');
  assert.deepEqual(result.write_plan, []);
});

test('compares multi-digit config version components numerically', () => {
  const baselineTables = validConfig();
  baselineTables.CONFIG_VERSION[0].config_version = 'v1.9';
  const baseline = evaluateConfigGateway({ envelope: writeEnvelope, tables: baselineTables, now: FIXED_NOW });
  const tables = withCommittedSnapshot('v1.9', baseline.response.fingerprint);
  tables.CONFIG_VERSION[0].config_version = 'v1.10';
  tables.CONFIG_BRANCH[0].branch_name = 'Chi nhánh đã nâng version';

  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });

  assert.equal(result.ok, true);
  assert.equal(result.response.config_version, 'v1.10');
  assert.equal(result.write_plan.length, 4);
});

test('stores a versioned config snapshot before routing when the config version advanced', () => {
  const baseline = evaluateConfigGateway({ envelope: writeEnvelope, tables: validConfig(), now: FIXED_NOW });
  const tables = withCommittedSnapshot('v1', baseline.response.fingerprint);
  tables.CONFIG_VERSION[0].config_version = 'v2';
  tables.CONFIG_BRANCH[0].branch_name = 'Chi nhánh đã version hóa';

  const result = evaluateConfigGateway({
    envelope: { ...writeEnvelope, payload: { command: '/kiemke', intent: 'ROUTE_COMMAND', required_sheet_names: [] } },
    tables,
    now: FIXED_NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.response.config_version, 'v2');
  assert.equal(result.write_plan.length, 4);
  assert.equal(result.write_plan[0].row.operation_type, 'CONFIG_SNAPSHOT');
  assert.equal(result.write_plan[0].row.request_id, 'cfg-v2');
  assert.equal(result.write_plan[0].row.idempotency_key, result.response.config_snapshot_id);
});

test('blocks business routing during configuration maintenance', () => {
  const tables = validConfig();
  tables.CONFIG_VERSION[0].maintenance_mode = 'YES';
  const result = evaluateConfigGateway({
    envelope: { ...writeEnvelope, payload: { command: '/kiemke', intent: 'ROUTE_COMMAND', required_sheet_names: [] } },
    tables,
    now: FIXED_NOW,
  });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_MAINTENANCE');
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
    fingerprint: baseline.response.fingerprint,
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

test('does not reuse a legacy snapshot whose stored fingerprint is inconsistent', () => {
  const tables = validConfigWithRouterTables();
  const baseline = evaluateConfigGateway({ envelope: writeEnvelope, tables: validConfigWithRouterTables(), now: FIXED_NOW });
  const legacyPayload = JSON.parse(baseline.diagnostics.normalized_config_json);
  for (const rows of Object.values(legacyPayload)) rows.forEach((row) => { row.row_number = '2'; });
  tables.CONFIG_SNAPSHOT = [completeRow('CONFIG_SNAPSHOT', {
    config_snapshot_id: 'cfg-v1-legacy-wrong-fingerprint',
    config_version: 'v1',
    schema_version: '1.0',
    fingerprint: 'wrong-legacy-fingerprint',
    normalized_config_json: JSON.stringify(legacyPayload),
    operation_id: 'op-legacy-wrong-fingerprint',
    status: 'COMMITTED',
    created_at: FIXED_NOW,
  })];
  tables.OPERATION = [completeRow('OPERATION', { operation_id: 'op-legacy-wrong-fingerprint', operation_type: 'START_OPERATION', status: 'COMMITTED' })];

  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_VERSION_NOT_INCREMENTED');
});

test('does not reuse an exact snapshot whose stored fingerprint is inconsistent', () => {
  const tables = validConfig();
  const baseline = evaluateConfigGateway({ envelope: writeEnvelope, tables: validConfig(), now: FIXED_NOW });
  tables.CONFIG_SNAPSHOT = [completeRow('CONFIG_SNAPSHOT', {
    config_snapshot_id: 'cfg-v1-exact-wrong-fingerprint',
    config_version: 'v1',
    schema_version: '1.0',
    fingerprint: 'wrong-fingerprint',
    normalized_config_json: baseline.diagnostics.normalized_config_json,
    operation_id: 'op-exact-wrong-fingerprint',
    status: 'COMMITTED',
    created_at: FIXED_NOW,
  })];
  tables.OPERATION = [completeRow('OPERATION', {
    operation_id: 'op-exact-wrong-fingerprint',
    operation_type: 'START_OPERATION',
    status: 'COMMITTED',
  })];

  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_VERSION_NOT_INCREMENTED');
});

test('stores an oversized snapshot as a reversible columnar payload below the Sheets cell limit', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_THONG_BAO.push(...Array.from({ length: 300 }, (_, index) => ({
    message_key: `EXTRA_MESSAGE_${index}`,
    message_text: 'Same configured message text',
    locale: 'vi-VN',
    trang_thai: 'ACTIVE',
  })));

  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);

  const snapshotRow = result.write_plan.find((step) => step.sheet === 'CONFIG_SNAPSHOT' && step.action === 'APPEND').row;
  assert.ok(result.diagnostics.normalized_config_json.length > 50000);
  assert.ok(snapshotRow.normalized_config_json.length < 50000);

  const stored = JSON.parse(snapshotRow.normalized_config_json);
  assert.equal(stored.__snapshot_format, 'columnar-v1');
  assert.equal(stored.__fingerprint, result.response.fingerprint);
  assert.deepEqual(expandSnapshotPayload(stored), JSON.parse(result.diagnostics.normalized_config_json));
});

test('rejects a write when a required router message template is missing', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_THONG_BAO = tables.CONFIG_THONG_BAO.filter((row) => row.message_key !== 'ROUTER_COMMAND_ACCEPTED');
  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_MESSAGE_MISSING');
  assert.deepEqual(result.write_plan, []);
});

test('rejects a write when a required router message template is blank', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_THONG_BAO.find((row) => row.message_key === 'ROUTER_COMMAND_ACCEPTED').message_text = '';
  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_MESSAGE_MISSING');
  assert.deepEqual(result.write_plan, []);
});

test('does not reuse a packed snapshot whose payload no longer matches its fingerprint', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_THONG_BAO.push(...Array.from({ length: 300 }, (_, index) => ({
    message_key: `EXTRA_MESSAGE_${index}`,
    message_text: 'Same configured message text',
    locale: 'vi-VN',
    trang_thai: 'ACTIVE',
  })));
  const baseline = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  const snapshot = baseline.write_plan.find((step) => step.sheet === 'CONFIG_SNAPSHOT' && step.action === 'APPEND').row;
  const packed = JSON.parse(snapshot.normalized_config_json);
  const messageIndex = packed.sheets.CONFIG_THONG_BAO.columns.indexOf('message_text');
  packed.sheets.CONFIG_THONG_BAO.rows[0][messageIndex] = 'tampered';
  tables.CONFIG_SNAPSHOT = [completeRow('CONFIG_SNAPSHOT', {
    ...snapshot,
    normalized_config_json: JSON.stringify(packed),
    status: 'COMMITTED',
  })];
  tables.OPERATION = [completeRow('OPERATION', {
    operation_id: 'op-packed',
    operation_type: 'START_OPERATION',
    status: 'COMMITTED',
  })];
  tables.CONFIG_SNAPSHOT[0].operation_id = 'op-packed';

  const result = evaluateConfigGateway({ envelope: writeEnvelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_VERSION_NOT_INCREMENTED');
});
