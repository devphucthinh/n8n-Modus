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
  assert.equal(result.response.data.config_tables.CONFIG_LENH.length, 3);
});

test('gateway keeps status-only calls compatible when router sheets are absent', () => {
  const tables = validConfigWithRouterTables();
  for (const name of ['CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH']) delete tables[name];
  const result = evaluateConfigGateway({ envelope, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.deepEqual(result.response.data.config_tables, {});
});
