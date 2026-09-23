import test from 'node:test';
import assert from 'node:assert/strict';
import { planRetry } from '../../src/telegram-router/retry-command.mjs';
import { FIXED_NOW, validConfigWithRouterTables } from '../fixtures/config/valid-config.mjs';

test('retry fails closed when the original command payload is not persisted', () => {
  const tables = validConfigWithRouterTables();
  const retryCommand = tables.CONFIG_LENH.find((row) => row.command_text === '/retry');
  const result = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', permissionCode: retryCommand.permission_code, tables, now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'ERROR_RETRY_CONTEXT_MISSING');
  assert.equal(result.retry, undefined);

  tables.ERROR_BIA[0].retryable = 'NO';
  const denied = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', permissionCode: retryCommand.permission_code, tables, now: FIXED_NOW });
  assert.equal(denied.ok, false);
  assert.equal(denied.response.error_code, 'ERROR_NOT_RETRYABLE');
});

test('reports missing source payload without resolving a worker that cannot be called', () => {
  const tables = validConfigWithRouterTables();
  tables.ERROR_BIA[0].workflow = 'WF_NOT_CONFIGURED';
  const retryCommand = tables.CONFIG_LENH.find((row) => row.command_text === '/retry');

  const result = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', permissionCode: retryCommand.permission_code, tables, now: FIXED_NOW });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'ERROR_RETRY_CONTEXT_MISSING');
});

test('retry permission is resolved from the command catalog instead of a code literal', () => {
  const tables = validConfigWithRouterTables();
  const retryCommand = tables.CONFIG_LENH.find((row) => row.command_text === '/retry');
  retryCommand.permission_code = 'RETRY_CUSTOM';
  tables.CONFIG_ROLE_PERMISSION = tables.CONFIG_ROLE_PERMISSION.filter((row) => row.permission_code !== 'ADMIN_RETRY');
  tables.CONFIG_PERMISSION.push({ permission_code: 'RETRY_CUSTOM', permission_name: 'Retry tùy chỉnh', description_vi: '', trang_thai: 'ACTIVE' });
  tables.CONFIG_ROLE_PERMISSION.push({ role_permission_id: 'rp-custom', role_code: 'ADMIN', permission_code: 'RETRY_CUSTOM', trang_thai: 'ACTIVE' });
  const result = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', tables, now: FIXED_NOW, permissionCode: retryCommand.permission_code });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'ERROR_RETRY_CONTEXT_MISSING');
});

test('configured branch permission does not bypass missing original retry payload', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_USER.push({ user_id: 'branch-admin', display_name: 'Branch admin', branch_id: 'CN_HN', trang_thai: 'ACTIVE' });
  tables.CONFIG_ROLE.push({ role_code: 'RETRY_OPERATOR', role_name: 'Retry operator', description_vi: '', trang_thai: 'ACTIVE' });
  tables.CONFIG_USER_ROLE.push({ user_role_id: 'ur-branch-admin', user_id: 'branch-admin', role_code: 'RETRY_OPERATOR', branch_id: 'CN_HN', effective_from: FIXED_NOW, effective_to: '', trang_thai: 'ACTIVE' });
  tables.CONFIG_ROLE_PERMISSION.push({ role_permission_id: 'rp-branch-retry', role_code: 'RETRY_OPERATOR', permission_code: 'ADMIN_RETRY', trang_thai: 'ACTIVE' });
  const retryCommand = tables.CONFIG_LENH.find((row) => row.command_text === '/retry');
  const topic = tables.CONFIG_TOPIC.find((row) => row.topic_type === 'KIEM_KE');

  const result = planRetry({ actorUserId: 'branch-admin', errorId: 'err-42', permissionCode: retryCommand.permission_code, topic, tables, now: FIXED_NOW });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'ERROR_RETRY_CONTEXT_MISSING');
});

test('branch-scoped retry requires the error source branch to match the active topic', () => {
  const tables = validConfigWithRouterTables();
  tables.ERROR_BIA[0].branch_id = 'CN_OTHER';
  tables.CONFIG_USER.push({ user_id: 'branch-admin', display_name: 'Branch admin', branch_id: 'CN_HN', trang_thai: 'ACTIVE' });
  tables.CONFIG_ROLE.push({ role_code: 'RETRY_OPERATOR', role_name: 'Retry operator', description_vi: '', trang_thai: 'ACTIVE' });
  tables.CONFIG_USER_ROLE.push({ user_role_id: 'ur-branch-admin', user_id: 'branch-admin', role_code: 'RETRY_OPERATOR', branch_id: 'CN_HN', effective_from: FIXED_NOW, effective_to: '', trang_thai: 'ACTIVE' });
  tables.CONFIG_ROLE_PERMISSION.push({ role_permission_id: 'rp-branch-retry', role_code: 'RETRY_OPERATOR', permission_code: 'ADMIN_RETRY', trang_thai: 'ACTIVE' });
  const topic = tables.CONFIG_TOPIC.find((row) => row.topic_type === 'KIEM_KE');
  const retryCommand = tables.CONFIG_LENH.find((row) => row.command_text === '/retry');

  const result = planRetry({ actorUserId: 'branch-admin', errorId: 'err-42', permissionCode: retryCommand.permission_code, topic, tables, now: FIXED_NOW });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'USER_NOT_AUTHORIZED');
});

test('retry refuses to replay when OPERATION has keys but no original payload', () => {
  const tables = validConfigWithRouterTables();
  tables.ERROR_BIA[0].idempotency_key = '';
  tables.OPERATION.push({ operation_id: 'op-original-42', request_id: 'tg-original-42', idempotency_key: 'tg-callback-source-7', status: 'FAILED' });
  const retryCommand = tables.CONFIG_LENH.find((row) => row.command_text === '/retry');

  const result = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', permissionCode: retryCommand.permission_code, tables, now: FIXED_NOW });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'ERROR_RETRY_CONTEXT_MISSING');
  assert.equal(result.retry, undefined);
});

test('retry fails closed when no original idempotency key was persisted', () => {
  const tables = validConfigWithRouterTables();
  tables.ERROR_BIA[0].idempotency_key = '';
  const retryCommand = tables.CONFIG_LENH.find((row) => row.command_text === '/retry');

  const result = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', permissionCode: retryCommand.permission_code, tables, now: FIXED_NOW });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'ERROR_IDEMPOTENCY_MISSING');
});

test('retry fails closed when the source branch is missing', () => {
  const tables = validConfigWithRouterTables();
  tables.ERROR_BIA[0].branch_id = '';
  const retryCommand = tables.CONFIG_LENH.find((row) => row.command_text === '/retry');

  const result = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', permissionCode: retryCommand.permission_code, tables, now: FIXED_NOW });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'ERROR_BRANCH_MISSING');
});

test('retry rejects a role without the configured retry permission', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_USER.push({ user_id: '10003', display_name: 'Kiểm kê có quyền nhầm', branch_id: 'CN_HN', trang_thai: 'ACTIVE' });
  tables.CONFIG_USER_ROLE.push({ user_role_id: 'ur-10003', user_id: '10003', role_code: 'KIEM_KE', branch_id: '*', effective_from: FIXED_NOW, effective_to: '', trang_thai: 'ACTIVE' });
  const result = planRetry({ actorUserId: '10003', errorId: 'err-42', permissionCode: 'ADMIN_RETRY', tables, now: FIXED_NOW });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'USER_NOT_AUTHORIZED');
});

test('retry rejects malformed effective dates and inactive permissions', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_USER_ROLE.find((row) => row.user_id === 'admin-1').effective_from = 'not-a-date';
  const malformedDate = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', permissionCode: 'ADMIN_RETRY', tables, now: FIXED_NOW });
  assert.equal(malformedDate.ok, false);
  assert.equal(malformedDate.response.error_code, 'USER_NOT_AUTHORIZED');

  const inactivePermissionTables = validConfigWithRouterTables();
  inactivePermissionTables.CONFIG_PERMISSION.find((row) => row.permission_code === 'ADMIN_RETRY').trang_thai = 'INACTIVE';
  const inactivePermission = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', permissionCode: 'ADMIN_RETRY', tables: inactivePermissionTables, now: FIXED_NOW });
  assert.equal(inactivePermission.ok, false);
  assert.equal(inactivePermission.response.error_code, 'USER_NOT_AUTHORIZED');
});
