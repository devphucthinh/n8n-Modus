import test from 'node:test';
import assert from 'node:assert/strict';
import { runRouterFlow } from '../../src/telegram-router/run-router-flow.mjs';
import { FIXED_NOW, validConfigWithRetryContext, validConfigWithRouterTables } from '../fixtures/config/valid-config.mjs';
import { telegramStatusUpdate } from '../telegram-router/status-command.test.mjs';

test('routes each configured command by topic and returns the standard envelope', () => {
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables: validConfigWithRouterTables(), now: FIXED_NOW });
  assert.equal(result.decision.kind, 'ROUTE');
  assert.equal(result.decision.route.topic_type, 'KIEM_KE');
  assert.equal(result.decision.route.worker_workflow, 'WF05_V2_MO_PHIEN_KIEM_KE');
  assert.equal(result.decision.route.worker_target, 'WF05_V2_MO_PHIEN_KIEM_KE');
  assert.equal(result.decision.reservation.row.idempotency_key, 'router-tg-9001');
  assert.equal(result.decision.reservation.row.operation_id, 'router-tg-9001');
  assert.equal(result.decision.reservation.row.status, 'PREPARED');
  assert.equal(result.envelope.operation_id, 'tg-9001');
  assert.equal(result.decision.route.envelope.request_id, 'tg-9001');
  assert.equal(result.decision.route.envelope.operation_id, 'tg-9001');
  assert.equal(result.decision.route.envelope.actor_user_id, '10001');
  assert.equal(result.decision.route.envelope.branch_id, 'CN_HN');
  assert.equal(result.decision.route.envelope.config_version, 'v1');
  assert.equal(result.decision.route.envelope.payload.idempotency_key, 'tg-9001');
  assert.equal(result.decision.route.envelope.payload.command, '/kiemke');
  assert.equal(result.decision.route.envelope.payload.command_code, 'CMD_KIEM_KE');
  assert.equal(result.decision.route.envelope.event_type, 'TELEGRAM_COMMAND');
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

test('replays a prepared router reservation with the same idempotency key to resume an interrupted dispatch', () => {
  const tables = validConfigWithRouterTables();
  const first = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });
  tables.OPERATION.push({ ...first.decision.reservation.row });

  const replay = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });

  assert.equal(replay.decision.kind, 'ROUTE');
  assert.equal(replay.decision.reservation.row.operation_id, first.decision.reservation.row.operation_id);
  assert.equal(replay.decision.reservation.row.idempotency_key, first.decision.reservation.row.idempotency_key);
});

test('replayed callback with a new update_id resumes the same operation identity', () => {
  const tables = validConfigWithRouterTables();
  const callbackUpdate = (updateId) => ({
    update_id: updateId,
    callback_query: {
      id: 'callback-replay-1',
      from: { id: '10001' },
      data: '/kiemke',
      message: { chat: { id: '-100100' }, message_thread_id: 77 },
    },
  });
  const first = runRouterFlow({ update: callbackUpdate(9001), tables, now: FIXED_NOW });
  tables.OPERATION.push({ ...first.decision.reservation.row });

  const replay = runRouterFlow({ update: callbackUpdate(9002), tables, now: FIXED_NOW });

  assert.equal(replay.decision.kind, 'ROUTE');
  assert.equal(replay.decision.reservation.row.operation_id, first.decision.reservation.row.operation_id);
  assert.equal(replay.decision.reservation.row.idempotency_key, first.decision.reservation.row.idempotency_key);
  assert.equal(replay.decision.route.envelope.operation_id, first.decision.route.envelope.operation_id);
});

test('resumes a prepared router reservation when the child operation already committed', () => {
  const tables = validConfigWithRouterTables();
  const first = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });
  tables.OPERATION.push({
    operation_id: 'tg-9001',
    request_id: 'tg-9001',
    operation_type: 'KIEM_KE',
    idempotency_key: 'tg-9001',
    expected_row_count: '1',
    actual_row_count: '1',
    checksum: 'worker-checksum',
    status: 'COMMITTED',
    error_id: '',
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
  });
  tables.OPERATION.push({ ...first.decision.reservation.row, status: 'PREPARED' });

  const replay = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables, now: FIXED_NOW });

  assert.equal(replay.decision.kind, 'ROUTE');
  assert.equal(replay.decision.reservation.row.idempotency_key, first.decision.reservation.row.idempotency_key);
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

test('denies retry when the actor role lacks the configured retry permission', () => {
  const tables = validConfigWithRetryContext();
  tables.CONFIG_USER.push({ user_id: '10003', display_name: 'Kiểm kê có quyền nhầm', branch_id: 'CN_HN', trang_thai: 'ACTIVE' });
  tables.CONFIG_USER_ROLE.push({ user_role_id: 'ur-10003', user_id: '10003', role_code: 'KIEM_KE', branch_id: '*', effective_from: '2026-09-19T01:00:00.000Z', effective_to: '', trang_thai: 'ACTIVE' });
  const result = runRouterFlow({ update: telegramStatusUpdate({ userId: '10003', text: '/retry err-42' }), tables, now: FIXED_NOW });

  assert.equal(result.decision.kind, 'DENY');
  assert.equal(result.decision.write_plan[0].row.error_code, 'USER_NOT_AUTHORIZED');
});

test('denies retry for an expired configured global role assignment', () => {
  const tables = validConfigWithRetryContext();
  tables.CONFIG_USER_ROLE.find((row) => row.user_id === 'admin-1').effective_to = '2026-09-18T00:00:00.000Z';
  const result = runRouterFlow({ update: telegramStatusUpdate({ userId: 'admin-1', text: '/retry err-42' }), tables, now: FIXED_NOW });
  assert.equal(result.decision.kind, 'DENY');
  assert.equal(result.decision.write_plan[0].row.error_code, 'USER_NOT_AUTHORIZED');
});

test('denies retry when the configured retry permission is inactive', () => {
  const tables = validConfigWithRetryContext();
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
  assert.match(result.reply.text, /Quyền: Không yêu cầu/);
  assert.doesNotMatch(result.reply.text, /\/nhaphang/);
  assert.doesNotMatch(result.reply.text, /\/baocaobia/);
  assert.doesNotMatch(result.reply.text, /\/retry/);
});

test('fails closed on retry for a branch-scoped role when the original payload is unavailable', () => {
  const tables = validConfigWithRetryContext();
  tables.CONFIG_USER.push({ user_id: 'branch-admin', display_name: 'Branch admin', branch_id: 'CN_HN', trang_thai: 'ACTIVE' });
  tables.CONFIG_ROLE.push({ role_code: 'RETRY_OPERATOR', role_name: 'Retry operator', description_vi: '', trang_thai: 'ACTIVE' });
  tables.CONFIG_USER_ROLE.push({ user_role_id: 'ur-branch-admin', user_id: 'branch-admin', role_code: 'RETRY_OPERATOR', branch_id: 'CN_HN', effective_from: FIXED_NOW, effective_to: '', trang_thai: 'ACTIVE' });
  tables.CONFIG_ROLE_PERMISSION.push({ role_permission_id: 'rp-branch-retry', role_code: 'RETRY_OPERATOR', permission_code: 'ADMIN_RETRY', trang_thai: 'ACTIVE' });

  const result = runRouterFlow({ update: telegramStatusUpdate({ userId: 'branch-admin', text: '/retry err-42' }), tables, now: FIXED_NOW });

  assert.equal(result.decision.kind, 'DENY');
  assert.equal(result.decision.retry, undefined);
  assert.equal(result.decision.reservation, undefined);
  assert.match(result.reply.text, /Mã lỗi|error_id/i);
});

test('does not claim a configured command whose worker has not been delivered', () => {
  const tables = validConfigWithRouterTables();
  const result = runRouterFlow({ update: telegramStatusUpdate({ userId: 'admin-1', text: '/baocaobia' }), tables, now: FIXED_NOW });
  assert.equal(result.decision.kind, 'DENY');
  assert.equal(result.decision.reservation, undefined);
  const help = runRouterFlow({ update: telegramStatusUpdate({ userId: 'admin-1', text: '/help' }), tables: validConfigWithRouterTables(), now: FIXED_NOW });
  assert.doesNotMatch(help.reply.text, /\/baocaobia/);
});

test('help omits a command with an empty worker target that dispatch will reject', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_LENH.push({
    command_code: 'CMD_UNBOUND',
    command_text: '/unbound',
    syntax: '/unbound',
    description_vi: 'Worker chưa gán',
    permission_code: 'KIEM_KE_WRITE',
    topic_type: 'KIEM_KE',
    worker_workflow: '',
    example: '/unbound',
    ordinal: '50',
    trang_thai: 'ACTIVE',
  });

  const help = runRouterFlow({ update: telegramStatusUpdate({ text: '/help' }), tables, now: FIXED_NOW });
  const attempt = runRouterFlow({ update: telegramStatusUpdate({ text: '/unbound' }), tables, now: FIXED_NOW });

  assert.equal(help.decision.kind, 'HELP');
  assert.doesNotMatch(help.reply.text, /\/unbound/);
  assert.equal(attempt.decision.kind, 'DENY');
  assert.equal(attempt.decision.reservation, undefined);
});

test('denies branch-scoped retry when the error is not bound to that branch', () => {
  const tables = validConfigWithRetryContext();
  tables.ERROR_BIA[0].branch_id = 'CN_OTHER';
  tables.CONFIG_USER.push({ user_id: 'branch-admin', display_name: 'Branch admin', branch_id: 'CN_HN', trang_thai: 'ACTIVE' });
  tables.CONFIG_ROLE.push({ role_code: 'RETRY_OPERATOR', role_name: 'Retry operator', description_vi: '', trang_thai: 'ACTIVE' });
  tables.CONFIG_USER_ROLE.push({ user_role_id: 'ur-branch-admin', user_id: 'branch-admin', role_code: 'RETRY_OPERATOR', branch_id: 'CN_HN', effective_from: FIXED_NOW, effective_to: '', trang_thai: 'ACTIVE' });
  tables.CONFIG_ROLE_PERMISSION.push({ role_permission_id: 'rp-branch-retry', role_code: 'RETRY_OPERATOR', permission_code: 'ADMIN_RETRY', trang_thai: 'ACTIVE' });

  const result = runRouterFlow({ update: telegramStatusUpdate({ userId: 'branch-admin', text: '/retry err-42' }), tables, now: FIXED_NOW });

  assert.equal(result.decision.kind, 'DENY');
  assert.equal(result.decision.write_plan[0].row.error_code, 'USER_NOT_AUTHORIZED');
});

test('does not treat a persisted callback idempotency key as a substitute for the original payload', () => {
  const tables = validConfigWithRetryContext();
  tables.ERROR_BIA[0].idempotency_key = 'tg-callback-origin-1';
  tables.OPERATION.push({ operation_id: 'op-original-42', request_id: 'tg-original-42', operation_type: 'ROUTE_COMMAND', idempotency_key: 'tg-callback-origin-1', expected_row_count: '1', actual_row_count: '0', checksum: 'fp', status: 'FAILED', error_id: 'err-42', created_at: FIXED_NOW, updated_at: FIXED_NOW });

  const result = runRouterFlow({ update: telegramStatusUpdate({ userId: 'admin-1', text: '/retry err-42' }), tables, now: FIXED_NOW });

  assert.equal(result.decision.kind, 'DENY');
  assert.equal(result.decision.retry, undefined);
  assert.equal(result.decision.reservation, undefined);
  assert.match(result.reply.text, /Mã lỗi|error_id/i);
});

test('does not advertise retry while the original payload cannot be replayed', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_USER.push({ user_id: 'branch-admin', display_name: 'Branch admin', branch_id: 'CN_HN', trang_thai: 'ACTIVE' });
  tables.CONFIG_ROLE.push({ role_code: 'RETRY_OPERATOR', role_name: 'Retry operator', description_vi: '', trang_thai: 'ACTIVE' });
  tables.CONFIG_USER_ROLE.push({ user_role_id: 'ur-branch-admin', user_id: 'branch-admin', role_code: 'RETRY_OPERATOR', branch_id: 'CN_HN', effective_from: FIXED_NOW, effective_to: '', trang_thai: 'ACTIVE' });
  tables.CONFIG_ROLE_PERMISSION.push({ role_permission_id: 'rp-branch-retry', role_code: 'RETRY_OPERATOR', permission_code: 'ADMIN_RETRY', trang_thai: 'ACTIVE' });

  const result = runRouterFlow({ update: telegramStatusUpdate({ userId: 'branch-admin', text: '/help' }), tables, now: FIXED_NOW });

  assert.equal(result.decision.kind, 'HELP');
  assert.doesNotMatch(result.reply.text, /\/retry/);
});

test('denies branch-scoped retry permission when no matching active topic is found', () => {
  const tables = validConfigWithRetryContext();
  tables.CONFIG_BRANCH.push({ branch_id: 'CN_OTHER', branch_name: 'Other branch', forum_chat_id: '-100200', owner_chat_id: '', timezone: 'Asia/Ho_Chi_Minh', trang_thai: 'ACTIVE' });
  tables.CONFIG_USER.push({ user_id: 'branch-admin', display_name: 'Branch admin', branch_id: 'CN_OTHER', trang_thai: 'ACTIVE' });
  tables.CONFIG_ROLE.push({ role_code: 'RETRY_OPERATOR', role_name: 'Retry operator', description_vi: '', trang_thai: 'ACTIVE' });
  tables.CONFIG_USER_ROLE.push({ user_role_id: 'ur-branch-admin', user_id: 'branch-admin', role_code: 'RETRY_OPERATOR', branch_id: 'CN_OTHER', effective_from: FIXED_NOW, effective_to: '', trang_thai: 'ACTIVE' });
  tables.CONFIG_ROLE_PERMISSION.push({ role_permission_id: 'rp-branch-retry', role_code: 'RETRY_OPERATOR', permission_code: 'ADMIN_RETRY', trang_thai: 'ACTIVE' });

  const result = runRouterFlow({ update: telegramStatusUpdate({ userId: 'branch-admin', text: '/retry err-42' }), tables, now: FIXED_NOW });

  assert.equal(result.decision.kind, 'DENY');
  assert.equal(result.decision.write_plan[0].row.error_code, 'USER_NOT_AUTHORIZED');
});

test('help omits commands whose topic branch is outside the actor assignment', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_USER_ROLE.push({ user_role_id: 'ur-cross-branch', user_id: '10001', role_code: 'NHAP_HANG', branch_id: 'CN_OTHER', effective_from: FIXED_NOW, effective_to: '', trang_thai: 'ACTIVE' });
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/help' }), tables, now: FIXED_NOW });
  assert.equal(result.decision.kind, 'HELP');
  assert.match(result.reply.text, /\/kiemke/);
  assert.doesNotMatch(result.reply.text, /\/nhaphang/);
});

test('help lists only commands authorized in the exact forum topic', () => {
  const tables = validConfigWithRouterTables();
  tables.CONFIG_TOPIC.forEach((row, index) => {
    row.message_thread_id = String(77 + index);
  });
  tables.CONFIG_USER_ROLE.push({
    user_role_id: 'ur-nhap-hang-same-branch',
    user_id: '10001',
    role_code: 'NHAP_HANG',
    branch_id: 'CN_HN',
    effective_from: FIXED_NOW,
    effective_to: '',
    trang_thai: 'ACTIVE',
  });

  const inventoryHelp = runRouterFlow({
    update: telegramStatusUpdate({ text: '/help', threadId: '77' }),
    tables,
    now: FIXED_NOW,
  });
  const purchaseHelp = runRouterFlow({
    update: telegramStatusUpdate({ text: '/help', threadId: '78' }),
    tables,
    now: FIXED_NOW,
  });

  assert.match(inventoryHelp.reply.text, /\/kiemke/);
  assert.doesNotMatch(inventoryHelp.reply.text, /\/nhaphang/);
  assert.match(purchaseHelp.reply.text, /\/nhaphang/);
  assert.doesNotMatch(purchaseHelp.reply.text, /\/kiemke/);
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
  assert.equal(operation.idempotency_key, 'router-tg-callback-callback-replay');
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
