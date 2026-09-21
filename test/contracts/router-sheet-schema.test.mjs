import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTER_SHEET_DEFINITIONS } from '../../src/contracts/core-sheet-schema.mjs';

test('declares router configuration sheets with stable ASCII columns', () => {
  assert.deepEqual(ROUTER_SHEET_DEFINITIONS.CONFIG_ROLE, [
    'role_code', 'role_name', 'description_vi', 'trang_thai',
  ]);
  assert.deepEqual(ROUTER_SHEET_DEFINITIONS.CONFIG_LENH, [
    'command_code', 'command_text', 'syntax', 'description_vi',
    'permission_code', 'topic_type', 'worker_workflow', 'example', 'ordinal', 'trang_thai',
  ]);
});
