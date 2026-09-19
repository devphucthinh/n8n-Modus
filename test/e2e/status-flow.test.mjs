import test from 'node:test';
import assert from 'node:assert/strict';
import { runStatusFlow } from '../../src/telegram-router/run-status-flow.mjs';
import { validConfig, FIXED_NOW } from '../fixtures/config/valid-config.mjs';
import { telegramStatusUpdate } from '../telegram-router/status-command.test.mjs';

test('active configured user receives safe global status', () => {
  const result = runStatusFlow({
    update: telegramStatusUpdate({ userId: '10001', chatId: '-100100', threadId: '77' }),
    tables: validConfig(),
    now: FIXED_NOW,
  });

  assert.equal(result.reply.chat_id, '-100100');
  assert.equal(result.reply.message_thread_id, '77');
  assert.match(result.reply.text, /Cấu hình: v1/);
  assert.match(result.reply.text, /Chi nhánh hoạt động: 1/);
  assert.doesNotMatch(result.reply.text, /forum_chat_id|owner_chat_id|token|credential|normalized_config_json/);
});

test('inactive user gets a generic configured denial', () => {
  const result = runStatusFlow({
    update: telegramStatusUpdate({ userId: '99999' }),
    tables: validConfig(),
    now: FIXED_NOW,
  });
  assert.match(result.reply.text, /Tài khoản chưa được cấp quyền hoạt động/);
  assert.doesNotMatch(result.reply.text, /CN_HN|Chi nhánh Hà Nội/);
});

test('maintenance status remains readable', () => {
  const tables = validConfig();
  tables.CONFIG_VERSION[0].maintenance_mode = 'YES';
  const result = runStatusFlow({ update: telegramStatusUpdate(), tables, now: FIXED_NOW });
  assert.match(result.reply.text, /Bảo trì cấu hình: YES/);
});

test('same Telegram update id produces stable operation identity', () => {
  const first = runStatusFlow({ update: telegramStatusUpdate(), tables: validConfig(), now: FIXED_NOW });
  const second = runStatusFlow({ update: telegramStatusUpdate(), tables: validConfig(), now: FIXED_NOW });
  assert.equal(first.envelope.operation_id, second.envelope.operation_id);
  assert.equal(first.reply.text, second.reply.text);
});

test('gateway failures are formatted without internal payloads', () => {
  const tables = validConfig();
  tables.CONFIG_BRANCH = tables.CONFIG_BRANCH.map(({ timezone: _timezone, ...row }) => row);
  const result = runStatusFlow({ update: telegramStatusUpdate(), tables, now: FIXED_NOW });
  assert.match(result.reply.text, /Không thể hoàn tất thao tác|Mã lỗi/);
  assert.doesNotMatch(result.reply.text, /CONFIG_BRANCH\.timezone|normalized_config_json|fixture-chat/);
});

test('unsupported command uses configured message without a business write plan', () => {
  const result = runStatusFlow({
    update: telegramStatusUpdate({ text: '/batky' }),
    tables: validConfig(),
    now: FIXED_NOW,
  });
  assert.match(result.reply.text, /Lệnh này chưa được bật/);
  assert.deepEqual(result.gateway.write_plan, []);
});
