import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTelegramUpdate } from '../../src/telegram-router/normalize-status-update.mjs';
import { formatHelp } from '../../src/telegram-router/command-catalog.mjs';
import { telegramStatusUpdate } from './status-command.test.mjs';
import { validConfigWithRouterTables } from '../fixtures/config/valid-config.mjs';

test('parses bot suffix, arguments and forum topic without losing the stable key', () => {
  const result = normalizeTelegramUpdate(telegramStatusUpdate({ text: '/retry@kkb_bot err-42 arg' }));
  assert.equal(result.command, '/retry');
  assert.deepEqual(result.args, ['err-42', 'arg']);
  assert.equal(result.envelope.operation_id, 'tg-9001');
  assert.equal(result.reply_target.message_thread_id, '77');
});

test('normalizes a callback query using the callback message as reply target', () => {
  const result = normalizeTelegramUpdate({
    update_id: 9002,
    callback_query: {
      id: 'callback-1',
      from: { id: '10001' },
      data: '/help',
      message: { chat: { id: '-100100' }, message_thread_id: 77 },
    },
  });
  assert.equal(result.command, '/help');
  assert.equal(result.callback.id, 'callback-1');
  assert.deepEqual(result.reply_target, { chat_id: '-100100', message_thread_id: '77' });
});

test('help renders all active configured commands and omits inactive commands', () => {
  const result = formatHelp({ tables: validConfigWithRouterTables() });
  assert.match(result.text, /\/kiemke/);
  assert.match(result.text, /Cú pháp/);
  assert.match(result.text, /Quyền/);
  assert.doesNotMatch(result.text, /\/an/);
});

test('help omits commands without an explicit ACTIVE status', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_LENH.push({ command_code: 'CMD_BLANK', command_text: '/blank', syntax: '/blank', description_vi: 'Không bật', permission_code: '', topic_type: '', worker_workflow: '', example: '/blank', ordinal: '99', trang_thai: '' });
  const result = formatHelp({ tables });
  assert.doesNotMatch(result.text, /\/blank/);
});

test('help keeps the full configured catalog before workflow message chunking', () => {
  const tables = validConfigWithRouterTables();
  for (let index = 0; index < 80; index += 1) {
    tables.CONFIG_LENH.push({ command_code: `CMD_LONG_${index}`, command_text: `/long${index}`, syntax: `/long${index}`, description_vi: 'x'.repeat(80), permission_code: '', topic_type: '', worker_workflow: '', example: `/long${index}`, ordinal: String(100 + index), trang_thai: 'ACTIVE' });
  }
  const result = formatHelp({ tables });
  assert.ok(result.text.length > 4096);
  assert.match(result.text, /\/long79/);
});
