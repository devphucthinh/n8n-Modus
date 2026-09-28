import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConfigGateway } from '../../src/config-gateway/evaluate-config.mjs';
import { envelope, FIXED_NOW, validConfig } from '../fixtures/config/valid-config.mjs';
import { missingColumn } from '../fixtures/config/missing-column.mjs';
import { duplicateKey } from '../fixtures/config/duplicate-key.mjs';

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

test('returns a safe normalized error when immutable envelope IDs are missing', () => {
  const result = evaluateConfigGateway({ envelope: { payload: { intent: 'READ_STATUS' } }, tables: validConfig(), now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'ENVELOPE_INVALID');
  assert.equal(result.response.retryable, false);
  assert.equal(result.response.messages.ERROR_GENERIC, 'Không thể hoàn tất thao tác. Mã lỗi: {error_id}');
  assert.deepEqual(result.write_plan, []);
});
