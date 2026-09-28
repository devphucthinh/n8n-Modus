import test from 'node:test';
import assert from 'node:assert/strict';
import { planRetry } from '../../src/telegram-router/retry-command.mjs';
import { FIXED_NOW, validConfigWithRouterTables } from '../fixtures/config/valid-config.mjs';

test('retry preserves original keys but fails closed when source payload is absent', () => {
  const tables = validConfigWithRouterTables();
  const retryCommand = tables.CONFIG_LENH.find((row) => row.command_text === '/retry');
  const topic = tables.CONFIG_TOPIC.find((row) => row.topic_type === 'KIEM_KE');
  tables.OPERATION.push({ operation_id: 'op-original-42', request_id: 'tg-original-42', idempotency_key: 'idem-original-42', status: 'FAILED' });
  const result = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', permissionCode: retryCommand.permission_code, topic, tables, now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'RETRY_PAYLOAD_UNAVAILABLE');
  assert.equal(result.retry.operation_id, 'op-original-42');
  assert.equal(result.retry.idempotency_key, 'idem-original-42');

  tables.ERROR_BIA[0].retryable = 'NO';
  const denied = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', permissionCode: retryCommand.permission_code, topic, tables, now: FIXED_NOW });
  assert.equal(denied.ok, false);
  assert.equal(denied.response.error_code, 'ERROR_NOT_RETRYABLE');
});

test('retry permission is resolved from the command catalog instead of a code literal', () => {
  const tables = validConfigWithRouterTables();
  const retryCommand = tables.CONFIG_LENH.find((row) => row.command_text === '/retry');
  retryCommand.permission_code = 'RETRY_CUSTOM';
  tables.CONFIG_ROLE_PERMISSION = tables.CONFIG_ROLE_PERMISSION.filter((row) => row.permission_code !== 'ADMIN_RETRY');
  tables.CONFIG_PERMISSION.push({ permission_code: 'RETRY_CUSTOM', permission_name: 'Retry tùy chỉnh', description_vi: '', trang_thai: 'ACTIVE' });
  tables.CONFIG_ROLE_PERMISSION.push({ role_permission_id: 'rp-custom', role_code: 'ADMIN', permission_code: 'RETRY_CUSTOM', trang_thai: 'ACTIVE' });
  const topic = tables.CONFIG_TOPIC.find((row) => row.topic_type === 'KIEM_KE');
  const result = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', tables, now: FIXED_NOW, topic, permissionCode: retryCommand.permission_code });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'RETRY_PAYLOAD_UNAVAILABLE');
});

test('retry uses branch-scoped configured permission but fails closed without source payload', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_USER_ROLE.find((row) => row.user_id === 'admin-1').branch_id = 'CN_HN';
  const topic = tables.CONFIG_TOPIC.find((row) => row.topic_type === 'KIEM_KE');

  const result = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', permissionCode: 'ADMIN_RETRY', topic, tables, now: FIXED_NOW });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'RETRY_PAYLOAD_UNAVAILABLE');
  assert.equal(result.retry.operation_id, 'op-original-42');
});

test('retry rejects a topic outside the assigned branch', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_USER_ROLE.find((row) => row.user_id === 'admin-1').branch_id = 'CN_OTHER';
  const topic = tables.CONFIG_TOPIC.find((row) => row.topic_type === 'KIEM_KE');

  const result = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', permissionCode: 'ADMIN_RETRY', topic, tables, now: FIXED_NOW });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'USER_NOT_AUTHORIZED');
});

test('retry rejects malformed effective dates and inactive permissions', () => {
  const tables = validConfigWithRouterTables();
  const topic = tables.CONFIG_TOPIC.find((row) => row.topic_type === 'KIEM_KE');
  tables.CONFIG_USER_ROLE.find((row) => row.user_id === 'admin-1').effective_from = 'not-a-date';
  const malformedDate = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', permissionCode: 'ADMIN_RETRY', topic, tables, now: FIXED_NOW });
  assert.equal(malformedDate.ok, false);
  assert.equal(malformedDate.response.error_code, 'USER_NOT_AUTHORIZED');

  const inactivePermissionTables = validConfigWithRouterTables();
  inactivePermissionTables.CONFIG_PERMISSION.find((row) => row.permission_code === 'ADMIN_RETRY').trang_thai = 'INACTIVE';
  const inactivePermission = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', permissionCode: 'ADMIN_RETRY', topic, tables: inactivePermissionTables, now: FIXED_NOW });
  assert.equal(inactivePermission.ok, false);
  assert.equal(inactivePermission.response.error_code, 'USER_NOT_AUTHORIZED');
});
