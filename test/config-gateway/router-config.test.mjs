import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConfigGateway } from '../../src/config-gateway/evaluate-config.mjs';
import { envelope, FIXED_NOW, validConfigWithRetryContext, validConfigWithRouterTables } from '../fixtures/config/valid-config.mjs';
import { requiredSheetNames } from '../../src/telegram-router/required-sheet-names.mjs';

test('gateway exposes requested router tables but does not require them for status-only calls', () => {
  const tables = validConfigWithRouterTables();
  const result = evaluateConfigGateway({
    envelope: { ...envelope, payload: { command: '/help', intent: 'READ_HELP', required_sheet_names: Object.keys(tables).filter((key) => key.startsWith('CONFIG_') && !['CONFIG_SCHEMA', 'CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', 'CONFIG_SNAPSHOT'].includes(key)) } },
    tables,
    now: FIXED_NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.response.data.config_tables.CONFIG_LENH.length, 7);
});

test('gateway keeps status-only calls compatible when router sheets are absent', () => {
  const tables = validConfigWithRouterTables();
  for (const name of ['CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH']) delete tables[name];
  const result = evaluateConfigGateway({ envelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.deepEqual(result.response.data.config_tables, {});
});

test('gateway keeps audit context on inactive-user failures', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_USER = tables.CONFIG_USER.map((row) => ({ ...row, trang_thai: 'INACTIVE' }));
  const result = evaluateConfigGateway({
    envelope: {
      ...envelope,
      actor_user_id: '10001',
      event_type: 'TELEGRAM_UPDATE',
      payload: { command: '/kiemke', intent: 'START_OPERATION', required_sheet_names: ['CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH', 'EVENT_LOG'] },
    },
    tables,
    now: FIXED_NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'USER_NOT_ACTIVE');
  assert.ok(result.response.data.context_tables.EVENT_LOG);
});

test('gateway context is projected to the minimum router fields', () => {
  const tables = validConfigWithRouterTables();
  const result = evaluateConfigGateway({
    envelope: { ...envelope, payload: { command: '/kiemke', intent: 'ROUTE_COMMAND', required_sheet_names: ['CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH', 'EVENT_LOG'] } },
    tables,
    now: FIXED_NOW,
  });
  const context = result.response.data.context_tables;
  assert.ok(context.CONFIG_USER.every((row) => Object.keys(row).every((key) => ['user_id', 'branch_id', 'trang_thai'].includes(key))));
  assert.ok(context.OPERATION.every((row) => Object.keys(row).every((key) => ['operation_id', 'request_id', 'operation_type', 'idempotency_key', 'status'].includes(key))));
  assert.equal(Object.values(context).some((rows) => rows.some((row) => 'normalized_config_json' in row)), false);
});

test('/retry receives only the requested error operation context and keeps the fingerprint stable', () => {
  const tables = validConfigWithRetryContext();
  tables.RETRY_CONTEXT = [{
    operation_id: 'op-original-42', envelope_version: '1.0', worker_envelope_json: '{}',
    envelope_sha256: 'hash', context_status: 'READY', created_at: FIXED_NOW, updated_at: FIXED_NOW,
  }, {
    operation_id: 'op-unrelated-99', envelope_version: '1.0', worker_envelope_json: 'must-not-leak',
    envelope_sha256: 'other-hash', context_status: 'READY', created_at: FIXED_NOW, updated_at: FIXED_NOW,
  }];
  const request = { ...envelope, payload: { command: '/retry', args: ['err-42'], intent: 'MANUAL_RETRY', required_sheet_names: [...requiredSheetNames('/retry'), 'RETRY_CONTEXT'] } };
  const result = evaluateConfigGateway({ envelope: request, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.equal(result.response.data.context_tables.RETRY_CONTEXT.length, 1);
  assert.equal(result.response.data.context_tables.RETRY_CONTEXT[0].operation_id, 'op-original-42');
  assert.equal(result.response.data.config_tables.RETRY_CONTEXT, undefined);
  const fingerprint = result.response.fingerprint;
  tables.RETRY_CONTEXT[0].worker_envelope_json = '{"different":"payload"}';
  assert.equal(evaluateConfigGateway({ envelope: request, tables, now: FIXED_NOW }).response.fingerprint, fingerprint);
  delete tables.RETRY_CONTEXT;
  assert.equal(evaluateConfigGateway({ envelope: request, tables, now: FIXED_NOW }).response.error_code, 'CONFIG_SHEET_MISSING');
});

test('retry fixture migrates the added columns and retry tab to schema 1.1', () => {
  const tables = validConfigWithRetryContext();
  assert.equal(tables.CONFIG_VERSION[0].config_version, 'v1.3');
  assert.equal(tables.CONFIG_VERSION[0].schema_version, '1.1');
  for (const [sheetName, columnName] of [
    ['ERROR_BIA', 'branch_id'], ['ERROR_BIA', 'idempotency_key'],
    ['RETRY_CONTEXT', 'operation_id'], ['RETRY_CONTEXT', 'worker_envelope_json'],
  ]) {
    const rule = tables.CONFIG_SCHEMA.find((row) => row.sheet_name === sheetName && row.column_name === columnName);
    assert.equal(rule?.schema_version, '1.1', `${sheetName}.${columnName}`);
  }
});

test('/help cannot receive retry payload even when the full table is available', () => {
  const tables = validConfigWithRetryContext();
  tables.RETRY_CONTEXT = [{ operation_id: 'op-original-42', envelope_version: '1.0', worker_envelope_json: 'sensitive',
    envelope_sha256: 'hash', context_status: 'READY', created_at: FIXED_NOW, updated_at: FIXED_NOW }];
  const request = { ...envelope, payload: { command: '/help', intent: 'READ_HELP', required_sheet_names: requiredSheetNames('/help') } };
  const result = evaluateConfigGateway({ envelope: request, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.equal(result.response.data.context_tables.RETRY_CONTEXT, undefined);
  assert.equal(result.response.data.config_tables.RETRY_CONTEXT, undefined);
});

test('a non-retry command cannot explicitly request the operational retry payload', () => {
  const tables = validConfigWithRetryContext();
  tables.RETRY_CONTEXT = [{ operation_id: 'op-original-42', envelope_version: '1.0', worker_envelope_json: 'sensitive',
    envelope_sha256: 'hash', context_status: 'READY', created_at: FIXED_NOW, updated_at: FIXED_NOW }];
  const request = { ...envelope, payload: { command: '/help', intent: 'READ_HELP', required_sheet_names: [...requiredSheetNames('/help'), 'RETRY_CONTEXT'] } };
  const result = evaluateConfigGateway({ envelope: request, tables, now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_SHEET_NOT_ALLOWED');
  assert.equal(JSON.stringify(result).includes('sensitive'), false);
});

test('a failed retry-context validation response never includes the stored envelope', () => {
  const tables = validConfigWithRetryContext();
  tables.RETRY_CONTEXT = [{ operation_id: 'op-original-42', envelope_version: '1.0', worker_envelope_json: 'sensitive',
    envelope_sha256: 'hash', context_status: 'READY', created_at: FIXED_NOW }];
  const request = { ...envelope, payload: { command: '/retry', args: ['err-42'], intent: 'MANUAL_RETRY', required_sheet_names: requiredSheetNames('/retry') } };
  const result = evaluateConfigGateway({ envelope: request, tables, now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_COLUMN_MISSING');
  assert.equal(JSON.stringify(result).includes('sensitive'), false);
});
