import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConfigGateway } from '../../src/config-gateway/evaluate-config.mjs';
import { envelope, FIXED_NOW, validConfig } from '../fixtures/config/valid-config.mjs';
import { missingColumn } from '../fixtures/config/missing-column.mjs';
import { duplicateKey } from '../fixtures/config/duplicate-key.mjs';
import { DISPATCHER_SHEET_DEFINITIONS, OPERATIONAL_SHEET_DEFINITIONS } from '../../src/contracts/core-sheet-schema.mjs';

test('accepts valid config for a write operation and returns an immutable snapshot ID', () => {
  const operationEnvelope = { ...envelope, payload: { command: '/kiemke', intent: 'START_OPERATION' } };
  const result = evaluateConfigGateway({ envelope: operationEnvelope, tables: validConfig(), now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.match(result.response.config_snapshot_id, /^cfg-v1-[a-f0-9]{16}$/);
  assert.equal(result.write_plan.length, 4);
  assert.equal(result.write_plan[0].row.status, 'PREPARED');
  assert.equal(result.write_plan[0].row.actual_row_count, '');
  assert.deepEqual(result.write_plan[3].patch, { status: 'COMMITTED', actual_row_count: '1', updated_at: FIXED_NOW });
});

test('rejects a required missing column before any write is planned', () => {
  const result = evaluateConfigGateway({ envelope, tables: missingColumn(), now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_COLUMN_MISSING');
  assert.equal(result.response.operation_id, envelope.operation_id);
  assert.equal(result.response.retryable, false);
  assert.equal(result.response.messages.ERROR_GENERIC, 'Không thể hoàn tất thao tác. Mã lỗi: {error_id}');
  assert.deepEqual(result.write_plan, []);
});

test('rejects a duplicate configured unique key', () => {
  const result = evaluateConfigGateway({ envelope, tables: duplicateKey(), now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_DUPLICATE_KEY');
});

test('rejects an empty CONFIG_SCHEMA before planning writes', () => {
  const tables = validConfig();
  tables.CONFIG_SCHEMA = [];
  const result = evaluateConfigGateway({ envelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_SCHEMA_EMPTY');
  assert.deepEqual(result.write_plan, []);
});

test('rejects a CONFIG_SCHEMA rule version that differs from active CONFIG_VERSION', () => {
  const tables = validConfig();
  tables.CONFIG_SCHEMA[0].schema_version = '0.9';
  const result = evaluateConfigGateway({ envelope, tables, now: FIXED_NOW });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_SCHEMA_VERSION_MISMATCH');
  assert.equal(result.response.sheet_name, 'CONFIG_SCHEMA');
  assert.equal(result.response.expected_schema_version, '1.0');
  assert.equal(result.response.actual_schema_version, '0.9');
  assert.deepEqual(result.write_plan, []);
});

test('returns a safe normalized error when immutable envelope IDs are missing', () => {
  const result = evaluateConfigGateway({ envelope: { payload: { intent: 'READ_STATUS' } }, tables: validConfig(), now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'ENVELOPE_INVALID');
  assert.equal(result.response.retryable, false);
  assert.equal(result.response.messages.ERROR_GENERIC, 'Không thể hoàn tất thao tác. Mã lỗi: {error_id}');
  assert.deepEqual(result.write_plan, []);
});

test('CONFIG_BIA is validated and included in the write snapshot fingerprint', () => {
  const tables = validConfig();
  const columns = ['ma_bia', 'ten_bia', 'don_vi_dem', 'thu_tu_hien_thi', 'trang_thai'];
  tables.CONFIG_BIA = [{ ma_bia: 'B01', ten_bia: 'Bia 01', don_vi_dem: 'thùng', thu_tu_hien_thi: '10', trang_thai: 'ACTIVE' }];
  tables.CONFIG_SCHEMA.push(...columns.map((columnName, ordinal) => ({
    ...tables.CONFIG_SCHEMA[0],
    schema_rule_id: `rule-CONFIG_BIA-${columnName}`,
    sheet_name: 'CONFIG_BIA',
    column_name: columnName,
    data_type: columnName === 'thu_tu_hien_thi' ? 'INTEGER' : 'STRING',
    reference_sheet: '', reference_column: '', unique_group: columnName === 'ma_bia' ? 'CONFIG_BIA_KEY' : '',
    ordinal: String(ordinal + 1),
  })));
  const request = { ...envelope, payload: { intent: 'START_OPERATION', required_sheet_names: ['CONFIG_BIA'] } };
  const first = evaluateConfigGateway({ envelope: request, tables, now: FIXED_NOW });
  assert.equal(first.ok, true);
  assert.deepEqual(first.response.data.config_tables.CONFIG_BIA, tables.CONFIG_BIA);
  assert.match(first.diagnostics.normalized_config_json, /"CONFIG_BIA"/);
  const changed = structuredClone(tables);
  changed.CONFIG_BIA[0].ten_bia = 'Bia 01 updated';
  const second = evaluateConfigGateway({ envelope: request, tables: changed, now: FIXED_NOW });
  assert.notEqual(first.response.fingerprint, second.response.fingerprint);
});

test('CONFIG_SCHEMA accepts the exact dispatcher/session ledger columns without fingerprinting ledger data', () => {
  const tables = validConfig();
  for (const [sheetName, columns] of Object.entries(OPERATIONAL_SHEET_DEFINITIONS)) {
    tables.CONFIG_SCHEMA.push(...columns.map((columnName, ordinal) => ({
      ...tables.CONFIG_SCHEMA[0],
      schema_rule_id: `rule-${sheetName}-${columnName}`,
      sheet_name: sheetName,
      column_name: columnName,
      data_type: 'STRING',
      required: 'NO',
      unique_group: '',
      reference_sheet: '', reference_column: '',
      ordinal: String(ordinal + 1),
    })));
  }
  const result = evaluateConfigGateway({ envelope: { ...envelope, payload: { intent: 'START_OPERATION' } }, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  const normalized = JSON.parse(result.diagnostics.normalized_config_json);
  for (const sheetName of Object.keys(OPERATIONAL_SHEET_DEFINITIONS)) {
    assert.equal(Object.hasOwn(normalized, sheetName), false);
  }
});

test('CONFIG_LICH uses schedule_id as its declared identity and allows distinct jobs on one branch', () => {
  const tables = validConfig();
  const columns = DISPATCHER_SHEET_DEFINITIONS.CONFIG_LICH;
  const schedule = (schedule_id, job_code, local_time) => Object.fromEntries(columns.map((column) => [column, ({
    schedule_id, job_code, branch_id: 'CN_HN', local_time, timezone: 'Asia/Ho_Chi_Minh', days_of_week: '*',
    grace_window_minutes: '30', retry_limit: '2', retry_delay_minutes: '10', worker_workflow: 'WF05_TEST', enabled: 'YES', trang_thai: 'ACTIVE',
  })[column]]));
  tables.CONFIG_LICH = [
    schedule('schedule-inventory', 'OPEN_INVENTORY', '23:45'),
    schedule('schedule-report', 'DAILY_REPORT', '08:00'),
  ];
  tables.CONFIG_SCHEMA.push(...columns.map((column_name, ordinal) => ({
    ...tables.CONFIG_SCHEMA[0],
    schema_rule_id: `rule-CONFIG_LICH-${column_name}`,
    sheet_name: 'CONFIG_LICH',
    column_name,
    required: 'YES',
    unique_group: column_name === 'schedule_id' ? 'CONFIG_LICH_KEY' : '',
    ordinal: String(ordinal + 1),
  })));

  const result = evaluateConfigGateway({
    envelope: { ...envelope, payload: { intent: 'READ_STATUS', required_sheet_names: ['CONFIG_LICH'] } },
    tables,
    now: FIXED_NOW,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.response.data.config_tables.CONFIG_LICH.map((row) => row.job_code), ['OPEN_INVENTORY', 'DAILY_REPORT']);

  const duplicateIdentityTables = structuredClone(tables);
  duplicateIdentityTables.CONFIG_LICH[1].schedule_id = duplicateIdentityTables.CONFIG_LICH[0].schedule_id;
  const duplicateIdentity = evaluateConfigGateway({
    envelope: { ...envelope, payload: { intent: 'READ_STATUS', required_sheet_names: ['CONFIG_LICH'] } },
    tables: duplicateIdentityTables,
    now: FIXED_NOW,
  });
  assert.equal(duplicateIdentity.ok, false);
  assert.equal(duplicateIdentity.response.error_code, 'CONFIG_DUPLICATE_KEY');
  assert.equal(duplicateIdentity.response.sheet_name, 'CONFIG_LICH');
  assert.equal(duplicateIdentity.response.column_name, 'schedule_id');
});
