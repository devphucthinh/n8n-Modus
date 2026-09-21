import test from 'node:test';
import assert from 'node:assert/strict';
import { runRouterFlow } from '../../src/telegram-router/run-router-flow.mjs';
import { FIXED_NOW, validConfigWithRouterTables } from '../fixtures/config/valid-config.mjs';
import { telegramStatusUpdate } from '../telegram-router/status-command.test.mjs';

test('routes each configured command by topic and returns the standard envelope', () => {
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables: validConfigWithRouterTables(), now: FIXED_NOW });
  assert.equal(result.decision.kind, 'ROUTE');
  assert.equal(result.decision.route.topic_type, 'KIEM_KE');
  assert.equal(result.decision.route.worker_workflow, 'WF05_V2_MO_PHIEN_KIEM_KE');
  assert.equal(result.envelope.operation_id, 'tg-9001');
});

test('does not expose gateway ledger writes as a router audit plan for status', () => {
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/trangthai' }), tables: validConfigWithRouterTables(), now: FIXED_NOW });
  assert.equal(result.decision.kind, 'STATUS');
  assert.deepEqual(result.decision.write_plan, []);
});

test('unknown command is denied without a worker call or write plan', () => {
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/unknown' }), tables: validConfigWithRouterTables(), now: FIXED_NOW });
  assert.equal(result.decision.kind, 'DENY');
  assert.equal(result.decision.write_plan.length, 0);
});

test('uses the configured acknowledgement and rejects a repeated committed operation', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_THONG_BAO.find((row) => row.message_key === 'ROUTER_COMMAND_ACCEPTED').message_text = 'Đã nhận theo cấu hình.';
  const first = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });
  assert.match(first.reply.text, /Đã nhận theo cấu hình/);
  tables.OPERATION.push({ operation_id: 'tg-9001', request_id: 'tg-9001', operation_type: 'ROUTE_COMMAND', idempotency_key: 'tg-9001', expected_row_count: '1', actual_row_count: '1', checksum: 'fp', error_id: '', created_at: FIXED_NOW, updated_at: FIXED_NOW, status: 'COMMITTED' });
  const repeated = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });
  assert.equal(repeated.decision.kind, 'DUPLICATE');
  assert.equal(repeated.decision.write_plan.length, 0);
});

test('records an opaque access-denied event for an active user without permission', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_USER_ROLE = [];
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });
  assert.equal(result.decision.kind, 'DENY');
  assert.equal(result.decision.write_plan[0].sheet, 'EVENT_LOG');
  assert.equal(result.decision.write_plan[0].row.outcome, 'DENIED');
  assert.equal(result.decision.write_plan[0].row.error_code, 'USER_NOT_AUTHORIZED');
});

test('does not append a duplicate access-denied event for a repeated update', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_USER_ROLE = [];
  const first = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });
  tables.EVENT_LOG.push(first.decision.write_plan[0].row);
  const repeated = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });
  assert.equal(repeated.decision.kind, 'DENY');
  assert.deepEqual(repeated.decision.write_plan, []);
});

test('routes a configured callback token by command_code and preserves callback identity', () => {
  const tables = validConfigWithRouterTables();
  const update = {
    update_id: 9003,
    callback_query: {
      id: 'callback-9003',
      from: { id: '10001' },
      data: 'CMD_KIEM_KE',
      message: { chat: { id: '-100100' }, message_thread_id: '77' },
    },
  };
  const result = runRouterFlow({ update, tables, now: FIXED_NOW });
  assert.equal(result.decision.kind, 'ROUTE');
  assert.equal(result.envelope.payload.callback_id, 'callback-9003');
  assert.equal(result.decision.route.command_code, 'CMD_KIEM_KE');
  assert.equal(result.decision.route.idempotency_key, 'tg-callback-callback-9003');
});

test('deduplicates a callback replay by callback id even when Telegram changes update_id', () => {
  const tables = validConfigWithRouterTables();
  const update = (updateId) => ({
    update_id: updateId,
    callback_query: {
      id: 'callback-replay',
      from: { id: '10001' },
      data: 'CMD_KIEM_KE',
      message: { chat: { id: '-100100' }, message_thread_id: '77' },
    },
  });
  const first = runRouterFlow({ update: update(9010), tables, now: FIXED_NOW });
  assert.equal(first.decision.kind, 'ROUTE');
  const operation = first.gateway.write_plan.find((entry) => entry.sheet === 'OPERATION')?.row;
  assert.equal(operation.idempotency_key, 'tg-callback-callback-replay');
  tables.OPERATION.push({ ...operation, status: 'COMMITTED', actual_row_count: '1', updated_at: FIXED_NOW });
  const repeated = runRouterFlow({ update: update(9011), tables, now: FIXED_NOW });
  assert.equal(repeated.decision.kind, 'DUPLICATE');
});
