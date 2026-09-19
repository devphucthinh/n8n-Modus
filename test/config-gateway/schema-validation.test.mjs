import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConfigGateway } from '../../src/config-gateway/evaluate-config.mjs';
import { envelope, FIXED_NOW, validConfig } from '../fixtures/config/valid-config.mjs';
import { missingColumn } from '../fixtures/config/missing-column.mjs';
import { duplicateKey } from '../fixtures/config/duplicate-key.mjs';

test('accepts valid config and returns an immutable snapshot ID', () => {
  const result = evaluateConfigGateway({ envelope, tables: validConfig(), now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.match(result.response.config_snapshot_id, /^cfg-v1-[a-f0-9]{16}$/);
  assert.equal(result.write_plan.length, 4);
});

test('rejects a required missing column before any write is planned', () => {
  const result = evaluateConfigGateway({ envelope, tables: missingColumn(), now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_COLUMN_MISSING');
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
