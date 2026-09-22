import test from 'node:test';
import assert from 'node:assert/strict';
import { planRetry } from '../../src/telegram-router/retry-command.mjs';
import { FIXED_NOW, validConfigWithRouterTables } from '../fixtures/config/valid-config.mjs';

test('retry keeps the original operation key and rejects non-retryable errors', () => {
  const tables = validConfigWithRouterTables();
  const retryCommand = tables.CONFIG_LENH.find((row) => row.command_text === '/retry');
  const result = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', permissionCode: retryCommand.permission_code, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.equal(result.retry.operation_id, 'op-original-42');
  assert.equal(result.retry.idempotency_key, 'tg-original-42');

  tables.ERROR_BIA[0].retryable = 'NO';
  const denied = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', permissionCode: retryCommand.permission_code, tables, now: FIXED_NOW });
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
  const result = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', tables, now: FIXED_NOW, permissionCode: retryCommand.permission_code });
  assert.equal(result.ok, true);
});

test('retry rejects a non-ADMIN role even when it has the retry permission', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_USER.push({ user_id: '10003', display_name: 'Kiểm kê có quyền nhầm', branch_id: 'CN_HN', trang_thai: 'ACTIVE' });
  tables.CONFIG_USER_ROLE.push({ user_role_id: 'ur-10003', user_id: '10003', role_code: 'KIEM_KE', branch_id: '*', effective_from: FIXED_NOW, effective_to: '', trang_thai: 'ACTIVE' });
  tables.CONFIG_ROLE_PERMISSION.push({ role_permission_id: 'rp-invalid-admin', role_code: 'KIEM_KE', permission_code: 'ADMIN_RETRY', trang_thai: 'ACTIVE' });

  const result = planRetry({ actorUserId: '10003', errorId: 'err-42', permissionCode: 'ADMIN_RETRY', tables, now: FIXED_NOW });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'USER_NOT_AUTHORIZED');
});
