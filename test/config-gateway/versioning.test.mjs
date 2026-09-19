import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConfigGateway } from '../../src/config-gateway/evaluate-config.mjs';
import { envelope, FIXED_NOW, validConfig } from '../fixtures/config/valid-config.mjs';

function withCommittedSnapshot(configVersion, fingerprint, status = 'COMMITTED') {
  const tables = validConfig();
  tables.CONFIG_SNAPSHOT = [{
    config_snapshot_id: `cfg-${configVersion}-old`,
    config_version: configVersion,
    schema_version: '1.0',
    fingerprint,
    normalized_config_json: '{}',
    operation_id: 'op-old',
    status,
    created_at: FIXED_NOW,
  }];
  return tables;
}

test('blocks changed content when config_version did not increase', () => {
  const baseline = evaluateConfigGateway({ envelope, tables: validConfig(), now: FIXED_NOW });
  const tables = withCommittedSnapshot('v1', baseline.response.fingerprint);
  tables.CONFIG_BRANCH[0].branch_name = 'Chi nhánh Hà Nội đã đổi';
  const result = evaluateConfigGateway({ envelope, tables, now: FIXED_NOW });
  assert.equal(result.response.error_code, 'CONFIG_VERSION_NOT_INCREMENTED');
});

test('blocks an increased version when normalized content is unchanged', () => {
  const baseline = evaluateConfigGateway({ envelope, tables: validConfig(), now: FIXED_NOW });
  const tables = validConfig();
  tables.CONFIG_VERSION[0].config_version = 'v2';
  tables.CONFIG_SNAPSHOT = [{
    config_snapshot_id: 'cfg-v1-old',
    config_version: 'v1',
    schema_version: '1.0',
    fingerprint: baseline.response.fingerprint,
    normalized_config_json: baseline.diagnostics.normalized_config_json,
    operation_id: 'op-old',
    status: 'COMMITTED',
    created_at: FIXED_NOW,
  }];
  const result = evaluateConfigGateway({ envelope, tables, now: FIXED_NOW });
  assert.equal(result.response.error_code, 'CONFIG_VERSION_EMPTY_CHANGE');
});

test('ignores PREPARED snapshots when finding the accepted predecessor', () => {
  const tables = validConfig();
  tables.CONFIG_SNAPSHOT = [{
    config_snapshot_id: 'cfg-v1-prepared',
    config_version: 'v1',
    schema_version: '1.0',
    fingerprint: 'not-the-current-content',
    normalized_config_json: '{}',
    operation_id: 'op-prepared',
    status: 'PREPARED',
    created_at: FIXED_NOW,
  }];
  const result = evaluateConfigGateway({ envelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
});
