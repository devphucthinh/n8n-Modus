import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStatusUpdate } from '../../src/telegram-router/normalize-status-update.mjs';
import { formatStatus } from '../../src/telegram-router/format-status.mjs';
import { envelope, FIXED_NOW, validConfig } from '../fixtures/config/valid-config.mjs';

export function telegramStatusUpdate({ userId = '10001', chatId = '-100100', threadId = '77', text = '/trangthai' } = {}) {
  return {
    update_id: 9001,
    message: {
      from: { id: userId, first_name: 'Tester' },
      chat: { id: chatId, type: 'supergroup' },
      message_thread_id: threadId,
      text,
    },
  };
}

test('normalizes /trangthai with bot suffix and stable reply target', () => {
  const result = normalizeStatusUpdate(telegramStatusUpdate({ text: '/trangthai@kkb_bot' }));
  assert.equal(result.envelope.request_id, 'tg-9001');
  assert.equal(result.envelope.operation_id, 'tg-9001');
  assert.equal(result.envelope.actor_user_id, '10001');
  assert.equal(result.envelope.payload.intent, 'READ_STATUS');
  assert.deepEqual(result.reply_target, { chat_id: '-100100', message_thread_id: '77' });
});

test('formats a global status using configurable message keys only', () => {
  const tables = validConfig();
  const result = formatStatus({
    gatewayResult: {
      ok: true,
      response: {
        gateway_health: 'OK',
        config_version: 'v1',
        active_branch_count: 1,
        active_branches: [{ branch_id: 'CN_HN', branch_name: 'Chi nhánh Hà Nội' }],
        maintenance_mode: 'NO',
      },
    },
    tables,
  });
  assert.match(result.text, /Cấu hình: v1/);
  assert.match(result.text, /Config Gateway: OK/);
  assert.match(result.text, /Chi nhánh hoạt động: 1/);
  assert.doesNotMatch(result.text, /forum_chat_id|owner_chat_id|token|credential|normalized_config_json/);
});

test('formats a safe configured error response', () => {
  const result = formatStatus({
    gatewayResult: { ok: false, response: { error_code: 'USER_NOT_ACTIVE', error_id: 'err-1' } },
    tables: validConfig(),
  });
  assert.match(result.text, /Tài khoản chưa được cấp quyền hoạt động/);
  assert.match(result.text, /err-1/);
});
