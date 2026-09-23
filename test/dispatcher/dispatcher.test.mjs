import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDispatchKey,
  planDispatch,
  recordHeartbeat,
} from '../../src/dispatcher/decide-dispatch.mjs';
import {
  prepareDispatchClaim,
  verifyDispatchClaim,
} from '../../src/dispatcher/claim-dispatch.mjs';
import { buildWorkerFailureEnvelope } from '../../src/dispatcher/worker-failure.mjs';
import { buildDispatchNotice } from '../../src/dispatcher/notifications.mjs';

const now = '2026-09-23T16:50:00.000Z';

function schedule(overrides = {}) {
  return {
    schedule_id: 'lich-kiem-ke',
    job_code: 'OPEN_INVENTORY',
    branch_id: 'CN_HN',
    local_time: '23:45',
    timezone: 'Asia/Ho_Chi_Minh',
    days_of_week: 'MON,TUE,WED,THU,FRI,SAT,SUN',
    grace_window_minutes: '30',
    retry_limit: '2',
    retry_delay_minutes: '10',
    worker_workflow: 'WF05_V2_MO_PHIEN_KIEM_KE',
    enabled: 'YES',
    trang_thai: 'ACTIVE',
    ...overrides,
  };
}

test('dispatch_key is stable across repeated ticks and restarts', () => {
  assert.equal(buildDispatchKey(schedule(), '2026-09-23'), 'lich-kiem-ke:CN_HN:2026-09-23');
  assert.equal(buildDispatchKey(schedule(), '2026-09-23'), buildDispatchKey(schedule(), '2026-09-23'));
});

test('plans a missed job inside the configured grace window without changing business_date', () => {
  const result = planDispatch({
    now: '2026-09-23T16:50:00.000Z',
    schedules: [schedule()],
    branches: [{ branch_id: 'CN_HN', trang_thai: 'ACTIVE' }],
    history: [],
    activeSessions: [],
    configSnapshotId: 'cfg-v2-fp',
  });

  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].kind, 'DISPATCH');
  assert.equal(result.actions[0].dispatch_key, 'lich-kiem-ke:CN_HN:2026-09-23');
  assert.equal(result.actions[0].business_date, '2026-09-23');
  assert.equal(result.actions[0].config_snapshot_id, 'cfg-v2-fp');
});

test('records an outside-grace warning and does not dispatch the wrong date', () => {
  const result = planDispatch({
    now: '2026-09-23T17:20:01.000Z',
    schedules: [schedule()],
    branches: [{ branch_id: 'CN_HN', trang_thai: 'ACTIVE' }],
    history: [],
    activeSessions: [],
    configSnapshotId: 'cfg-v2-fp',
  });

  assert.equal(result.actions.filter((action) => action.kind === 'DISPATCH').length, 0);
  assert.equal(result.actions[0].kind, 'WARNING');
  assert.equal(result.actions[0].reason, 'OUTSIDE_GRACE_WINDOW');
  assert.equal(result.actions[0].notice_code, 'DISPATCH_OUTSIDE_GRACE_WINDOW');
  assert.equal(result.actions[0].business_date, '2026-09-23');
});

test('skips inactive branches and branches with an active session', () => {
  const result = planDispatch({
    now,
    schedules: [schedule({ schedule_id: 'inactive', branch_id: 'CN_INACTIVE' }), schedule({ schedule_id: 'active', branch_id: 'CN_ACTIVE' })],
    branches: [
      { branch_id: 'CN_INACTIVE', trang_thai: 'INACTIVE' },
      { branch_id: 'CN_ACTIVE', trang_thai: 'ACTIVE' },
    ],
    history: [],
    activeSessions: [{ session_id: 'session-1', branch_id: 'CN_ACTIVE', status: 'ACTIVE' }],
    configSnapshotId: 'cfg-v2-fp',
  });

  assert.deepEqual(result.actions.map((action) => action.reason).sort(), ['ACTIVE_SESSION_EXISTS', 'BRANCH_INACTIVE']);
  assert.deepEqual(result.actions.map((action) => action.notice_code).sort(), ['DISPATCH_ACTIVE_SESSION_EXISTS', 'DISPATCH_BRANCH_INACTIVE']);
  assert.equal(result.actions.filter((action) => action.kind === 'DISPATCH').length, 0);
});

test('a claimed or completed dispatch is not emitted again', () => {
  const result = planDispatch({
    now: '2026-09-23T16:50:00.000Z',
    schedules: [schedule()],
    branches: [{ branch_id: 'CN_HN', trang_thai: 'ACTIVE' }],
    history: [{ dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23', status: 'CLAIMED', attempt_count: '1' }],
    activeSessions: [],
    configSnapshotId: 'cfg-v2-fp',
  });

  assert.equal(result.actions.length, 0);
});

test('only the execution that owns the persisted claim may invoke the worker', () => {
  const planned = planDispatch({
    now: '2026-09-23T16:50:00.000Z',
    schedules: [schedule()],
    branches: [{ branch_id: 'CN_HN', trang_thai: 'ACTIVE' }],
    history: [],
    activeSessions: [],
    configSnapshotId: 'cfg-v2-fp',
  }).actions[0];
  const first = prepareDispatchClaim({ action: planned, claimToken: 'execution-a', requestId: 'req-a' });
  const second = prepareDispatchClaim({ action: planned, claimToken: 'execution-b', requestId: 'req-b' });

  assert.equal(first.operation_id, second.operation_id);
  assert.equal(first.claim_token, 'execution-a');
  assert.equal(verifyDispatchClaim({ action: first, persistedRow: first }), true);
  assert.equal(verifyDispatchClaim({ action: first, persistedRow: second }), false);
  assert.equal(verifyDispatchClaim({ action: second, persistedRow: second }), true);
});

test('worker failure is normalized into the shared Error Handler envelope', () => {
  const envelope = buildWorkerFailureEnvelope({
    action: {
      dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23',
      operation_id: 'op-dispatch-lich-kiem-ke_CN_HN_2026-09-23',
      request_id: 'req-dispatch-a',
      config_snapshot_id: 'cfg-v2-fp',
    },
    worker: { ok: false, error_code: 'INVENTORY_TOPIC_NOT_CONFIGURED', retryable: true },
    now: '2026-09-23T16:51:00.000Z',
  });

  assert.equal(envelope.error.error_code, 'INVENTORY_TOPIC_NOT_CONFIGURED');
  assert.equal(envelope.error.retryable, true);
  assert.equal(envelope.error.operation_id, 'op-dispatch-lich-kiem-ke_CN_HN_2026-09-23');
  assert.equal(envelope.error.request_id, 'req-dispatch-a');
  assert.equal(envelope.context.dispatch_key, 'lich-kiem-ke:CN_HN:2026-09-23');
  assert.equal(envelope.context.config_snapshot_id, 'cfg-v2-fp');
  assert.equal(buildWorkerFailureEnvelope({ action: envelope.context, worker: { ok: true } }), null);
});

test('dispatch notices use the configured destination and configured message key', () => {
  const notice = buildDispatchNotice({
    action: {
      kind: 'SKIP',
      reason: 'ACTIVE_SESSION_EXISTS',
      notice_code: 'DISPATCH_ACTIVE_SESSION_EXISTS',
      dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23',
      branch_id: 'CN_HN',
      operation_id: 'op-dispatch-1',
      request_id: 'req-dispatch-1',
      config_snapshot_id: 'cfg-v2-fp',
    },
    configGlobal: [
      { config_key: 'DISPATCHER_NOTIFICATION_CHAT_ID', config_value: '-100999', trang_thai: 'ACTIVE' },
      { config_key: 'DISPATCHER_NOTIFICATION_THREAD_ID', config_value: '88', trang_thai: 'ACTIVE' },
    ],
    messages: { DISPATCH_ACTIVE_SESSION_EXISTS: 'Đã có phiên kiểm kê đang hoạt động.' },
  });

  assert.equal(notice.error.error_code, 'DISPATCH_ACTIVE_SESSION_EXISTS');
  assert.equal(notice.error.message_key, 'DISPATCH_ACTIVE_SESSION_EXISTS');
  assert.equal(notice.reply_target.chat_id, '-100999');
  assert.equal(notice.reply_target.message_thread_id, '88');
  assert.equal(notice.reply_target.branch_id, '');
});

test('critical heartbeat uses configured threshold and recovery is emitted once', () => {
  const first = recordHeartbeat({ now, previous: { status: 'FAILED', failure_count: '2', critical_notified: 'NO' }, failure: true, threshold: '3' });
  assert.equal(first.failure_count, 3);
  assert.equal(first.notice, 'CRITICAL');

  const recovery = recordHeartbeat({ now, previous: { status: 'FAILED', failure_count: '3', critical_notified: 'YES' }, failure: false, threshold: '3' });
  assert.equal(recovery.failure_count, 0);
  assert.equal(recovery.notice, 'RECOVERY');

  const healthy = recordHeartbeat({ now, previous: { status: 'HEALTHY', failure_count: '0', critical_notified: 'NO' }, failure: false, threshold: '3' });
  assert.equal(healthy.notice, null);
});
