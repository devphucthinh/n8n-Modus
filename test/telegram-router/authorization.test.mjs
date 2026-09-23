import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeCommand } from '../../src/telegram-router/authorize-command.mjs';
import { FIXED_NOW, topicFor, validConfigWithRouterTables } from '../fixtures/config/valid-config.mjs';

test('active user receives permission through a branch-scoped role', () => {
  const result = authorizeCommand({ actorUserId: '10001', command: '/kiemke', topic: topicFor('KIEM_KE'), tables: validConfigWithRouterTables(), now: FIXED_NOW });
  assert.equal(result.allowed, true);
  assert.equal(result.branch_id, 'CN_HN');
  assert.deepEqual(result.role_codes, ['KIEM_KE']);
});

test('unknown and inactive users receive the same opaque denial', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_USER.push({ user_id: '10002', display_name: 'Inactive', branch_id: 'CN_HN', trang_thai: 'INACTIVE' });
  const unknown = authorizeCommand({ actorUserId: '99999', command: '/kiemke', topic: topicFor('KIEM_KE'), tables, now: FIXED_NOW });
  const inactive = authorizeCommand({ actorUserId: '10002', command: '/kiemke', topic: topicFor('KIEM_KE'), tables, now: FIXED_NOW });
  assert.deepEqual(unknown, inactive);
  assert.equal(unknown.allowed, false);
  assert.equal(unknown.denial_code, 'USER_NOT_AUTHORIZED');
});

test('denies a business command whose catalog row has no permission', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_LENH.push({
    command_code: 'CMD_PUBLIC_INVALID',
    command_text: '/publicinvalid',
    syntax: '/publicinvalid',
    description_vi: 'Lệnh nghiệp vụ thiếu quyền',
    permission_code: '',
    topic_type: 'KIEM_KE',
    worker_workflow: 'WF05_V2_MO_PHIEN_KIEM_KE',
    example: '/publicinvalid',
    ordinal: '60',
    trang_thai: 'ACTIVE',
  });
  const result = authorizeCommand({ actorUserId: '10001', command: '/publicinvalid', topic: topicFor('KIEM_KE'), tables, now: FIXED_NOW });
  assert.equal(result.allowed, false);
  assert.equal(result.denial_code, 'USER_NOT_AUTHORIZED');
});
