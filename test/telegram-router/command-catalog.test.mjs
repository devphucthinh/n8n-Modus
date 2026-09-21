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
