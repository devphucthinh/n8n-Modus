import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConfigGateway } from '../../src/config-gateway/evaluate-config.mjs';
import { envelope, FIXED_NOW, validConfig } from '../fixtures/config/valid-config.mjs';

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

test('reuses a committed snapshot for an idempotent status request', () => {
  const first = evaluateConfigGateway({ envelope, tables: validConfig(), now: FIXED_NOW });
  const tables = validConfig();
  tables.CONFIG_SNAPSHOT = [{
    config_snapshot_id: first.response.config_snapshot_id,
    config_version: 'v1',
    schema_version: '1.0',
    fingerprint: first.response.fingerprint,
    normalized_config_json: first.diagnostics.normalized_config_json,
    operation_id: envelope.operation_id,
    status: 'COMMITTED',
    created_at: FIXED_NOW,
  }];
  const result = evaluateConfigGateway({ envelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.deepEqual(result.write_plan, []);
  assert.equal(result.response.config_snapshot_id, first.response.config_snapshot_id);
});
