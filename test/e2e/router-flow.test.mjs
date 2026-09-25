import test from 'node:test';
import assert from 'node:assert/strict';
import { runRouterFlow } from '../../src/telegram-router/run-router-flow.mjs';
import { FIXED_NOW, validConfigWithRouterTables } from '../fixtures/config/valid-config.mjs';
import { telegramStatusUpdate } from '../telegram-router/status-command.test.mjs';

test('routes each configured command by topic and returns the standard envelope', () => {
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables: validConfigWithRouterTables(), now: FIXED_NOW });
  assert.equal(result.decision.kind, 'ROUTE');
  assert.equal(result.decision.route.topic_type, 'KIEM_KE');
  assert.equal(result.decision.route.worker_workflow, 'WF05RouterTest001');
  assert.equal(result.decision.reservation.row.idempotency_key, 'tg-9001');
  assert.equal(result.decision.reservation.row.status, 'PREPARED');
  assert.equal(result.envelope.operation_id, 'tg-9001');
  assert.equal(result.decision.worker_envelope.operation_id, result.envelope.operation_id);
  assert.equal(result.decision.worker_envelope.request_id, result.envelope.request_id);
  assert.equal(result.decision.worker_envelope.payload.idempotency_key, result.envelope.payload.idempotency_key);
  assert.equal(result.decision.worker_envelope.branch_id, 'CN_HN');
  assert.equal(result.decision.worker_envelope.config_version, 'v1');
  assert.equal(result.decision.worker_envelope.config_snapshot_id, result.gateway.response.config_snapshot_id);
  assert.equal(result.decision.worker_envelope.event_type, 'ROUTE_COMMAND');
});

test('routes only a complete numeric admin alert destination outside the worker envelope', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_GLOBAL.push(
    { config_key: 'ERROR_ALERT_CHAT_ID', config_value: '-1000000000001', value_type: 'STRING', description_vi: 'Admin chat', trang_thai: 'ACTIVE' },
    { config_key: 'ERROR_ALERT_THREAD_ID', config_value: '909', value_type: 'STRING', description_vi: 'Admin topic', trang_thai: 'ACTIVE' },
  );

  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });

  assert.deepEqual(result.decision.error_alert_target, { chat_id: '-1000000000001', message_thread_id: '909' });
  assert.equal('error_alert_target' in result.decision.worker_envelope, false);
  assert.deepEqual(result.gateway.response.data.context_tables.CONFIG_GLOBAL.map((row) => row.config_key), ['ERROR_ALERT_CHAT_ID', 'ERROR_ALERT_THREAD_ID']);
});

test('does not configure an admin alert destination when either ID is missing or invalid', () => {
  const cases = [
    [{ config_key: 'ERROR_ALERT_CHAT_ID', config_value: '-1000000000001', value_type: 'STRING', trang_thai: 'ACTIVE' }],
    [
      { config_key: 'ERROR_ALERT_CHAT_ID', config_value: 'REPLACE_WITH_ADMIN_CHAT_ID', value_type: 'STRING', trang_thai: 'ACTIVE' },
      { config_key: 'ERROR_ALERT_THREAD_ID', config_value: '909', value_type: 'STRING', trang_thai: 'ACTIVE' },
    ],
    [
      { config_key: 'ERROR_ALERT_CHAT_ID', config_value: '-1000000000001', value_type: 'STRING', trang_thai: 'ACTIVE' },
      { config_key: 'ERROR_ALERT_THREAD_ID', config_value: '0', value_type: 'STRING', trang_thai: 'ACTIVE' },
    ],
  ];

  for (const alertRows of cases) {
    const tables = validConfigWithRouterTables();
    tables.CONFIG_GLOBAL.push(...alertRows);
    const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });
    assert.equal(result.decision.error_alert_target, undefined);
  }
});

test('does not reserve or acknowledge a command without a configured worker workflow ID', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_LENH.find((row) => row.command_text === '/kiemke').worker_workflow = '';

  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });
  const help = runRouterFlow({ update: telegramStatusUpdate({ text: '/help' }), tables, now: FIXED_NOW });

  assert.equal(result.decision.kind, 'DENY');
  assert.equal(result.decision.reservation, undefined);
  assert.doesNotMatch(result.reply.text, /Đã tiếp nhận lệnh/);
  assert.match(result.reply.text, /worker-unavailable/i);
  assert.doesNotMatch(help.reply.text, /\/kiemke/);
});

test('rejects an ambiguous active chat and topic mapping instead of routing the first match', () => {
  const tables = validConfigWithRouterTables();
  const existing = tables.CONFIG_TOPIC.find((row) => row.topic_type === 'KIEM_KE');
  tables.CONFIG_BRANCH.push({ ...tables.CONFIG_BRANCH[0], branch_id: 'CN_OTHER', branch_name: 'Branch inactive', trang_thai: 'INACTIVE' });
  tables.CONFIG_TOPIC.push({
    ...existing,
    topic_id: 'duplicate-topic-mapping',
    branch_id: 'CN_OTHER',
    topic_type: 'NHAP_HANG',
  });

  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });

  assert.equal(result.decision.kind, 'DENY');
  assert.equal(result.decision.reservation, undefined);
  assert.doesNotMatch(result.reply.text, /Đã tiếp nhận lệnh/);
});

test('does not expose gateway ledger writes as a router audit plan for status', () => {
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/trangthai' }), tables: validConfigWithRouterTables(), now: FIXED_NOW });
  assert.equal(result.decision.kind, 'STATUS');
  assert.deepEqual(result.decision.write_plan, []);
});

test('denies inactive users even for /trangthai and records an access audit', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_USER[0].trang_thai = 'INACTIVE';
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/trangthai' }), tables, now: FIXED_NOW });
  assert.equal(result.decision.kind, 'DENY');
  assert.equal(result.decision.write_plan[0].sheet, 'EVENT_LOG');
  assert.match(result.reply.text, /Mã lỗi/);
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

test('does not dispatch a repeated operation while its reservation is still prepared', () => {
  const tables = validConfigWithRouterTables();
  const first = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });
  tables.OPERATION.push(first.decision.reservation.row);

  const repeated = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });

  assert.equal(repeated.decision.kind, 'DUPLICATE');
  assert.equal(repeated.decision.reservation, undefined);
  assert.deepEqual(repeated.decision.write_plan, []);
});

test('does not replay a worker after an operation was marked failed', () => {
  const tables = validConfigWithRouterTables();
  tables.OPERATION.push({
    operation_id: 'tg-9001', request_id: 'tg-9001', operation_type: 'ROUTE_COMMAND', idempotency_key: 'tg-9001',
    expected_row_count: '1', actual_row_count: '', checksum: '', error_id: 'err-tg-9001-worker-failed',
    created_at: FIXED_NOW, updated_at: FIXED_NOW, status: 'FAILED',
  });

  const repeated = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });

  assert.equal(repeated.decision.kind, 'DUPLICATE');
  assert.equal(repeated.decision.reservation, undefined);
});

test('returns a safe error instead of an empty reply when a router message is missing', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_THONG_BAO = tables.CONFIG_THONG_BAO.filter((row) => row.message_key !== 'ROUTER_COMMAND_ACCEPTED');
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });
  assert.equal(result.decision.kind, 'DENY');
  assert.match(result.reply.text, /error_id|err-/i);
});

test('returns a safe error instead of an empty reply when a router message is blank', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_THONG_BAO.find((row) => row.message_key === 'ROUTER_COMMAND_ACCEPTED').message_text = '';
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });
  assert.equal(result.decision.kind, 'DENY');
  assert.match(result.reply.text, /error_id|CONFIG_MESSAGE_MISSING|err-/i);
});

test('uses localized administrator guidance when no configured error template is available', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_THONG_BAO = [];

  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });

  assert.equal(result.gateway.ok, false);
  assert.match(result.reply.text, /Không thể hoàn tất thao tác/);
  assert.match(result.reply.text, /Mã lỗi: err-/);
  assert.match(result.reply.text, /quản trị viên/);
  assert.doesNotMatch(result.reply.text, /^ERROR\b/);
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

test('allows branch-scoped retry permission but fails closed when source payload is absent', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_USER_ROLE.find((row) => row.user_id === 'admin-1').branch_id = 'CN_HN';
  tables.OPERATION.push({
    operation_id: 'op-original-42', request_id: 'tg-original-42', operation_type: 'ROUTE_COMMAND', idempotency_key: 'idem-original-42',
    expected_row_count: '1', actual_row_count: '', checksum: '', status: 'FAILED', error_id: 'err-42', created_at: FIXED_NOW, updated_at: FIXED_NOW,
  });

  const result = runRouterFlow({ update: telegramStatusUpdate({ userId: 'admin-1', text: '/retry err-42' }), tables, now: FIXED_NOW });

  assert.equal(result.decision.kind, 'RETRY_UNAVAILABLE');
  assert.equal(result.decision.retry.operation_id, 'op-original-42');
  assert.equal(result.decision.retry.idempotency_key, 'idem-original-42');
  assert.match(result.reply.text, /retry-payload-unavailable/i);
  assert.doesNotMatch(result.reply.text, /Đã tiếp nhận yêu cầu retry/);
});

test('denies retry for an expired configured global role assignment', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_USER_ROLE.find((row) => row.user_id === 'admin-1').effective_to = '2026-09-18T00:00:00.000Z';
  const result = runRouterFlow({ update: telegramStatusUpdate({ userId: 'admin-1', text: '/retry err-42' }), tables, now: FIXED_NOW });
  assert.equal(result.decision.kind, 'DENY');
  assert.equal(result.decision.write_plan[0].row.error_code, 'USER_NOT_AUTHORIZED');
});

test('denies retry when the configured retry permission is inactive', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_PERMISSION.find((row) => row.permission_code === 'ADMIN_RETRY').trang_thai = 'INACTIVE';
  const result = runRouterFlow({ update: telegramStatusUpdate({ userId: 'admin-1', text: '/retry err-42' }), tables, now: FIXED_NOW });
  assert.equal(result.decision.kind, 'DENY');
  assert.equal(result.decision.write_plan[0].row.error_code, 'USER_NOT_AUTHORIZED');
});

test('help works when only its requested router catalog is available', () => {
  const tables = validConfigWithRouterTables();
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/help' }), tables, now: FIXED_NOW });
  assert.equal(result.gateway.ok, true);
  assert.equal(result.decision.kind, 'HELP');
  assert.match(result.reply.text, /\/kiemke/);
  assert.doesNotMatch(result.reply.text, /\/nhaphang/);
});

test('help labels permissionless commands explicitly', () => {
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/help' }), tables: validConfigWithRouterTables(), now: FIXED_NOW });

  assert.match(result.reply.text, /\/help[\s\S]*Quyền: Không yêu cầu/);
});

test('help omits commands whose topic branch is outside the actor assignment', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_USER_ROLE.push({ user_role_id: 'ur-cross-branch', user_id: '10001', role_code: 'NHAP_HANG', branch_id: 'CN_OTHER', effective_from: FIXED_NOW, effective_to: '', trang_thai: 'ACTIVE' });
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/help' }), tables, now: FIXED_NOW });
  assert.equal(result.decision.kind, 'HELP');
  assert.match(result.reply.text, /\/kiemke/);
  assert.doesNotMatch(result.reply.text, /\/nhaphang/);
});

test('does not expose or route a topic whose branch is inactive', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_BRANCH[0].trang_thai = 'INACTIVE';

  const help = runRouterFlow({ update: telegramStatusUpdate({ text: '/help' }), tables, now: FIXED_NOW });
  assert.equal(help.decision.kind, 'HELP');
  assert.doesNotMatch(help.reply.text, /\/kiemke/);

  const route = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });
  assert.equal(route.decision.kind, 'DENY');
  assert.equal(route.decision.write_plan[0].row.error_code, 'USER_NOT_AUTHORIZED');
});

test('denies a business command whose catalog row omits its permission', () => {
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
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/publicinvalid' }), tables, now: FIXED_NOW });
  assert.equal(result.decision.kind, 'DENY');
  assert.equal(result.decision.write_plan[0].row.error_code, 'USER_NOT_AUTHORIZED');

  const help = runRouterFlow({ update: telegramStatusUpdate({ text: '/help' }), tables, now: FIXED_NOW });
  assert.equal(help.decision.kind, 'HELP');
  assert.doesNotMatch(help.reply.text, /\/publicinvalid/);
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
  const operation = first.decision.reservation.row;
  assert.equal(operation.idempotency_key, 'tg-callback-callback-replay');
  tables.OPERATION.push({ ...operation, status: 'COMMITTED', actual_row_count: '1', updated_at: FIXED_NOW });
  const repeated = runRouterFlow({ update: update(9011), tables, now: FIXED_NOW });
  assert.equal(repeated.decision.kind, 'DUPLICATE');
});

test('uses callback_query.from as the actor even when the callback message has a bot sender', () => {
  const tables = validConfigWithRouterTables();
  const result = runRouterFlow({
    update: {
      update_id: 9004,
      callback_query: {
        id: 'callback-actor',
        from: { id: '10001' },
        data: 'CMD_KIEM_KE',
        message: { from: { id: '7709260866', is_bot: true }, chat: { id: '-100100' }, message_thread_id: '77' },
      },
    },
    tables,
    now: FIXED_NOW,
  });
  assert.equal(result.envelope.actor_user_id, '10001');
  assert.equal(result.decision.kind, 'ROUTE');
});

test('does not route a command through a wildcard thread mapping', () => {
  const tables = validConfigWithRouterTables();
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke', threadId: '999' }), tables, now: FIXED_NOW });
  assert.equal(result.decision.kind, 'DENY');
  assert.equal(result.decision.write_plan[0].row.error_code, 'USER_NOT_AUTHORIZED');
});
