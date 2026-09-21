import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIT_SHEET_DEFINITIONS, ROUTER_SHEET_DEFINITIONS } from '../../src/contracts/core-sheet-schema.mjs';

test('declares router configuration sheets with stable ASCII columns', () => {
  assert.deepEqual(ROUTER_SHEET_DEFINITIONS.CONFIG_ROLE, [
    'role_code', 'role_name', 'description_vi', 'trang_thai',
  ]);
  assert.deepEqual(ROUTER_SHEET_DEFINITIONS.CONFIG_LENH, [
    'command_code', 'command_text', 'syntax', 'description_vi',
    'permission_code', 'topic_type', 'worker_workflow', 'example', 'ordinal', 'trang_thai',
  ]);
});

test('declares an operational access audit sheet without mixing it into business config', () => {
  assert.deepEqual(AUDIT_SHEET_DEFINITIONS.EVENT_LOG, [
    'event_id', 'event_type', 'request_id', 'operation_id', 'actor_user_id', 'branch_id', 'topic_type', 'command', 'outcome', 'error_code', 'created_at', 'trang_thai',
  ]);
});
