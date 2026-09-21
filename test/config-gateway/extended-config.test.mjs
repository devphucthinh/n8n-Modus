import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConfigGateway } from '../../src/config-gateway/evaluate-config.mjs';
import { ALL_SHEET_DEFINITIONS } from '../../src/contracts/core-sheet-schema.mjs';
import { envelope, FIXED_NOW, validConfig } from '../fixtures/config/valid-config.mjs';

const completeRow = (sheetName, values = {}) => Object.fromEntries(
  ALL_SHEET_DEFINITIONS[sheetName].map((column) => [column, values[column] ?? '']),
);

function declareExtendedSchema(tables, sheetNames) {
  for (const sheetName of sheetNames) {
    for (const columnName of ALL_SHEET_DEFINITIONS[sheetName]) {
      tables.CONFIG_SCHEMA.push(completeRow('CONFIG_SCHEMA', {
        schema_rule_id: `rule-${sheetName}-${columnName}`,
        schema_version: '1.0',
        sheet_name: sheetName,
        column_name: columnName,
        data_type: 'STRING',
        required: 'NO',
        unique_group: '',
        reference_sheet: '',
        reference_column: '',
        allowed_values: '',
        ordinal: '1',
        description_vi: `Shared contract ${sheetName}.${columnName}`,
        trang_thai: 'ACTIVE',
      }));
    }
  }
}

test('returns requested catalog, mappings and dispatcher config from the accepted snapshot', () => {
  const tables = validConfig();
  const requested = ['CONFIG_LICH', 'CONFIG_BIA', 'CONFIG_QUY_DOI', 'CONFIG_MAPPING_NHAP', 'CONFIG_MAPPING_BAN'];
  declareExtendedSchema(tables, requested);
  tables.CONFIG_LICH = [completeRow('CONFIG_LICH', {
    schedule_id: 'SCHED-01', job_code: 'SALES_CUTOFF', worker_workflow: 'WF09_V2_BAO_CAO_BAN', branch_id: 'CN_HN',
    timezone: 'Asia/Ho_Chi_Minh', days_of_week: '*', local_time: '23:45', grace_minutes: '15', max_attempts: '3', trang_thai: 'ACTIVE',
  })];
  tables.CONFIG_BIA = [completeRow('CONFIG_BIA', {
    item_id: 'TIGER', item_code: 'TIGER', item_name: 'Tiger', inventory_unit: 'chai', tracked: 'YES', ordinal: '1', trang_thai: 'ACTIVE',
  })];
  tables.CONFIG_QUY_DOI = [completeRow('CONFIG_QUY_DOI', {
    conversion_id: 'CONV-01', item_id: 'TIGER', source_unit: 'két', target_unit: 'chai', numerator: '24', denominator: '1',
    effective_from: '2026-01-01', effective_to: '', trang_thai: 'ACTIVE',
  })];
  tables.CONFIG_MAPPING_NHAP = [completeRow('CONFIG_MAPPING_NHAP', {
    mapping_id: 'MAP-N-01', source_alias: 'Tiger chai', item_id: 'TIGER', source_unit: 'chai', effective_from: '2026-01-01', trang_thai: 'ACTIVE',
  })];
  tables.CONFIG_MAPPING_BAN = [completeRow('CONFIG_MAPPING_BAN', {
    sales_mapping_id: 'MAP-S-01', source_config_id: 'POS-A', source_item_code: 'TIGER', source_item_name: 'Tiger', item_id: 'TIGER', trang_thai: 'ACTIVE',
  })];

  const result = evaluateConfigGateway({
    envelope: { ...envelope, payload: { intent: 'START_OPERATION', required_sheet_names: requested } },
    tables,
    now: FIXED_NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.response.data.config_tables.CONFIG_BIA[0].item_id, 'TIGER');
  assert.equal(result.response.data.catalog[0].ma_bia, 'TIGER');
  assert.equal(result.response.data.catalog[0].don_vi_dem, 'chai');
  assert.equal(result.response.data.dispatcher_tables.CONFIG_LICH[0].schedule_id, 'SCHED-01');
  assert.equal(result.response.config_snapshot.config_snapshot_id, result.response.config_snapshot_id);
  assert.equal(result.response.config_snapshot.config_version, 'v1');
  assert.ok(result.diagnostics.normalized_config_json.includes('CONFIG_BIA'));
});

test('requires schema rules before exposing a requested extended table', () => {
  const tables = validConfig();
  tables.CONFIG_BIA = [completeRow('CONFIG_BIA', { item_id: 'TIGER' })];
  const result = evaluateConfigGateway({
    envelope: { ...envelope, payload: { intent: 'START_OPERATION', required_sheet_names: ['CONFIG_BIA'] } },
    tables,
    now: FIXED_NOW,
  });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_SCHEMA_INCOMPLETE');
  assert.equal(result.response.sheet_name, 'CONFIG_BIA');
  assert.deepEqual(result.write_plan, []);
});

test('extended config changes participate in snapshot fingerprinting', () => {
  const baselineTables = validConfig();
  const baseline = evaluateConfigGateway({ envelope, tables: baselineTables, now: FIXED_NOW });
  const tables = validConfig();
  tables.CONFIG_BIA = [completeRow('CONFIG_BIA', { item_id: 'TIGER', item_name: 'Tiger' })];
  const snapshot = completeRow('CONFIG_SNAPSHOT', {
    config_snapshot_id: 'cfg-v1-old', config_version: 'v1', schema_version: '1.0', fingerprint: baseline.response.fingerprint,
    normalized_config_json: baseline.diagnostics.normalized_config_json, operation_id: 'op-old', status: 'COMMITTED', created_at: FIXED_NOW,
  });
  tables.CONFIG_SNAPSHOT = [snapshot];
  tables.OPERATION = [completeRow('OPERATION', { operation_id: 'op-old', status: 'COMMITTED' })];
  const result = evaluateConfigGateway({ envelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_VERSION_NOT_INCREMENTED');
});
