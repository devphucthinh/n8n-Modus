import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConfigGateway } from '../../src/config-gateway/evaluate-config.mjs';
import { envelope, FIXED_NOW, validConfigWithRouterTables } from '../fixtures/config/valid-config.mjs';

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

test('gateway exposes only active error-alert destination keys to business command routing', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_GLOBAL.push(
    { config_key: 'ERROR_ALERT_CHAT_ID', config_value: '-1000000000001', value_type: 'STRING', description_vi: 'Admin chat', trang_thai: 'ACTIVE' },
    { config_key: 'ERROR_ALERT_THREAD_ID', config_value: '909', value_type: 'STRING', description_vi: 'Admin topic', trang_thai: 'ACTIVE' },
    { config_key: 'ERROR_ALERT_SECRET', config_value: 'must-not-leak', value_type: 'STRING', description_vi: 'Not part of the contract', trang_thai: 'ACTIVE' },
    { config_key: 'ERROR_ALERT_DISABLED', config_value: '-1000000000000', value_type: 'STRING', description_vi: 'Inactive route', trang_thai: 'INACTIVE' },
  );
  const result = evaluateConfigGateway({
    envelope: { ...envelope, payload: { command: '/kiemke', intent: 'ROUTE_COMMAND', required_sheet_names: ['CONFIG_LENH'] } },
    tables,
    now: FIXED_NOW,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.response.data.context_tables.CONFIG_GLOBAL, [
    { config_key: 'ERROR_ALERT_CHAT_ID', config_value: '-1000000000001', value_type: 'STRING', trang_thai: 'ACTIVE' },
    { config_key: 'ERROR_ALERT_THREAD_ID', config_value: '909', value_type: 'STRING', trang_thai: 'ACTIVE' },
  ]);
});

test('gateway does not expose error-alert destinations to read-only help calls', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_GLOBAL.push(
    { config_key: 'ERROR_ALERT_CHAT_ID', config_value: '-1000000000001', value_type: 'STRING', description_vi: 'Admin chat', trang_thai: 'ACTIVE' },
    { config_key: 'ERROR_ALERT_THREAD_ID', config_value: '909', value_type: 'STRING', description_vi: 'Admin topic', trang_thai: 'ACTIVE' },
  );
  const result = evaluateConfigGateway({
    envelope: { ...envelope, payload: { command: '/help', intent: 'READ_HELP', required_sheet_names: ['CONFIG_LENH'] } },
    tables,
    now: FIXED_NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.response.data.context_tables.CONFIG_GLOBAL, undefined);
});
