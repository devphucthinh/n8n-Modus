import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
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

function planAt({ at = now, scheduleRow = schedule(), history = [], activeSessions = [], operations, branchStatus = 'ACTIVE', claimLeaseMinutes } = {}) {
  return planDispatch({
    now: at,
    schedules: [scheduleRow],
    branches: [{ branch_id: 'CN_HN', trang_thai: branchStatus }],
    history,
    activeSessions,
    operations,
    configSnapshotId: 'cfg-current',
    claimLeaseMinutes,
  }).actions;
}

function committedOpening(dispatchKey = 'lich-kiem-ke:CN_HN:2026-09-23') {
  return { operation_id: 'op-open-1', operation_type: 'OPEN_INVENTORY_SESSION', idempotency_key: dispatchKey, status: 'COMMITTED' };
}

test('dispatch_key is stable across repeated ticks and restarts', () => {
  assert.equal(buildDispatchKey(schedule(), '2026-09-23'), 'lich-kiem-ke:CN_HN:2026-09-23');
  assert.equal(buildDispatchKey(schedule(), '2026-09-23'), buildDispatchKey(schedule(), '2026-09-23'));
});

test('an invalid active schedule timezone returns a structured fail-closed result', () => {
  const result = planDispatch({
    now,
    schedules: [schedule({ timezone: 'Not/A_Real_Time_Zone' })],
    branches: [{ branch_id: 'CN_HN', trang_thai: 'ACTIVE' }],
    history: [],
    activeSessions: [],
    configSnapshotId: 'cfg-current',
  });

  assert.deepEqual(result, {
    actions: [],
    error_code: 'CONFIG_TIMEZONE_INVALID',
    sheet_name: 'CONFIG_LICH',
    column_name: 'timezone',
  });
});

test('duplicate active schedules for the same job, branch, and business date fail closed', () => {
  const result = planDispatch({
    now,
    schedules: [
      schedule({ schedule_id: 'lich-kiem-ke-a' }),
      schedule({ schedule_id: 'lich-kiem-ke-b' }),
    ],
    branches: [{ branch_id: 'CN_HN', trang_thai: 'ACTIVE' }],
    history: [],
    activeSessions: [],
    configSnapshotId: 'cfg-current',
  });

  assert.deepEqual(result, {
    actions: [],
    error_code: 'CONFIG_DUPLICATE_EFFECTIVE_SCHEDULE',
    sheet_name: 'CONFIG_LICH',
    column_name: 'job_code',
  });
});

test('a future schedule cannot let a due duplicate dispatch before the conflict is detected', () => {
  const result = planDispatch({
    now: '2026-09-23T16:50:00.000Z',
    schedules: [
      schedule({ schedule_id: 'lich-kiem-ke-a', local_time: '23:45' }),
      schedule({ schedule_id: 'lich-kiem-ke-b', local_time: '23:55' }),
    ],
    branches: [{ branch_id: 'CN_HN', trang_thai: 'ACTIVE' }],
    history: [],
    activeSessions: [],
    configSnapshotId: 'cfg-current',
  });

  assert.deepEqual(result, {
    actions: [],
    error_code: 'CONFIG_DUPLICATE_EFFECTIVE_SCHEDULE',
    sheet_name: 'CONFIG_LICH',
    column_name: 'job_code',
  });
});

test('distinct active jobs in one branch remain independently dispatchable', () => {
  const result = planDispatch({
    now,
    schedules: [
      schedule({ schedule_id: 'lich-kiem-ke', job_code: 'OPEN_INVENTORY' }),
      schedule({ schedule_id: 'lich-bao-cao', job_code: 'DAILY_REPORT', worker_workflow: 'WF10_V2_DAILY_REPORT' }),
    ],
    branches: [{ branch_id: 'CN_HN', trang_thai: 'ACTIVE' }],
    configSnapshotId: 'cfg-current',
  });

  assert.deepEqual(result.actions.map(({ kind, job_code, branch_id }) => ({ kind, job_code, branch_id })), [
    { kind: 'DISPATCH', job_code: 'OPEN_INVENTORY', branch_id: 'CN_HN' },
    { kind: 'DISPATCH', job_code: 'DAILY_REPORT', branch_id: 'CN_HN' },
  ]);
});

test('dispatch actions retain schedule_id as the physical CONFIG_LICH row identity', () => {
  const action = planAt({ scheduleRow: schedule({ schedule_id: 'physical-row-17' }) })[0];

  assert.equal(action.kind, 'DISPATCH');
  assert.equal(action.schedule_id, 'physical-row-17');
  assert.equal(action.dispatch_key, 'physical-row-17:CN_HN:2026-09-23');
});

test('distinct dispatch keys cannot collapse into the same operation or request ID', () => {
  const first = prepareDispatchClaim({ action: { dispatch_key: 'a_b:c:2026-09-23' }, claimToken: 'claim-1' });
  const second = prepareDispatchClaim({ action: { dispatch_key: 'a:b_c:2026-09-23' }, claimToken: 'claim-1' });
  assert.notEqual(first.operation_id, second.operation_id);
  assert.notEqual(first.request_id, second.request_id);
  assert.equal(first.operation_id, prepareDispatchClaim({ action: { dispatch_key: 'a_b:c:2026-09-23' }, claimToken: 'claim-2' }).operation_id);
});

test('request ID keeps the dispatch key and claim token boundary unambiguous', () => {
  const first = prepareDispatchClaim({ action: { dispatch_key: 'a:b' }, claimToken: 'c' });
  const second = prepareDispatchClaim({ action: { dispatch_key: 'a' }, claimToken: 'b:c' });
  assert.notEqual(first.request_id, second.request_id);
});

test('dispatch claim ID encoding executes without Node APIs in the n8n Code sandbox', async () => {
  const source = await readFile(new URL('../../src/dispatcher/claim-dispatch.mjs', import.meta.url), 'utf8');
  const sandbox = vm.createContext({});
  const prepare = vm.runInContext(`${source.replaceAll('export ', '')}\nprepareDispatchClaim`, sandbox);
  const claimed = prepare({ action: { dispatch_key: 'a:b_c:2026-09-23' }, claimToken: 'claim-1' });
  assert.ok(claimed.operation_id);
  assert.ok(claimed.request_id);
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
    activeSessions: [{ session_id: 'session-1', branch_id: 'CN_ACTIVE', status: 'ACTIVE', dispatch_key: 'active:CN_ACTIVE:2026-09-23' }],
    operations: [committedOpening('active:CN_ACTIVE:2026-09-23')],
    configSnapshotId: 'cfg-v2-fp',
  });

  assert.deepEqual(result.actions.map((action) => action.reason).sort(), ['ACTIVE_SESSION_EXISTS', 'BRANCH_INACTIVE']);
  assert.deepEqual(result.actions.map((action) => action.notice_code).sort(), ['DISPATCH_ACTIVE_SESSION_EXISTS', 'DISPATCH_BRANCH_INACTIVE']);
  assert.equal(result.actions.filter((action) => action.kind === 'DISPATCH').length, 0);
});

test('an active inventory session does not suppress an unrelated scheduled job', () => {
  const actions = planAt({
    scheduleRow: schedule({ job_code: 'DAILY_REPORT', worker_workflow: 'WF10_V2_DAILY_REPORT' }),
    activeSessions: [{ session_id: 'session-1', branch_id: 'CN_HN', status: 'ACTIVE', dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23' }],
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'DISPATCH');
  assert.equal(actions[0].job_code, 'DAILY_REPORT');
});

test('an ACTIVE inventory session without a committed opening requires reconciliation and cannot dispatch', () => {
  const session = { session_id: 'session-1', branch_id: 'CN_HN', status: 'ACTIVE', dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23' };
  for (const operations of [
    undefined,
    [{ ...committedOpening(), status: 'PREPARED' }],
    [{ ...committedOpening(), operation_type: 'REUSE_INVENTORY_SESSION' }],
    [committedOpening('another-key')],
  ]) {
    const actions = planAt({ activeSessions: [session], operations });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].kind, 'WARNING');
    assert.equal(actions[0].reason, 'RECONCILIATION_REQUIRED');
    assert.equal(actions[0].notice_code, 'DISPATCH_RECONCILIATION_REQUIRED');
    assert.equal(actions[0].session_id, 'session-1');
    assert.equal(actions.filter((action) => action.kind === 'DISPATCH').length, 0);
  }
});

test('an ACTIVE inventory session with a committed matching opening is a normal skip', () => {
  const actions = planAt({
    activeSessions: [{ session_id: 'session-1', branch_id: 'CN_HN', status: 'ACTIVE', dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23' }],
    operations: [committedOpening()],
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'SKIP');
  assert.equal(actions[0].reason, 'ACTIVE_SESSION_EXISTS');
});

test('a completed dispatch history cannot hide an ACTIVE session missing its committed opening', () => {
  const actions = planAt({
    history: [{ dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23', status: 'SUCCESS', attempt_count: '1' }],
    activeSessions: [{ session_id: 'session-1', branch_id: 'CN_HN', status: 'ACTIVE', dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23' }],
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'WARNING');
  assert.equal(actions[0].reason, 'RECONCILIATION_REQUIRED');
  assert.equal(actions[0].session_id, 'session-1');
});

test('a claimed or completed dispatch is not emitted again', () => {
  for (const previous of [
    { status: 'CLAIMED', attempt_count: '1', operation_id: 'op-original-42', updated_at: '2026-09-23T16:45:00.000Z' },
    { status: 'SUCCESS', attempt_count: '1', updated_at: '2026-09-23T16:30:00.000Z' },
  ]) {
    const actions = planAt({
      history: [{ dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23', ...previous }],
      claimLeaseMinutes: '10',
    });
    assert.equal(actions.length, 0);
  }
});

test('multi-day grace dispatches the earliest due business date with its stable key', () => {
  for (const { at, grace, businessDate } of [
    { at: '2026-09-26T16:40:00.000Z', grace: '4320', businessDate: '2026-09-23' },
    { at: '2026-09-27T16:40:00.000Z', grace: '5760', businessDate: '2026-09-23' },
  ]) {
    const actions = planAt({ at, scheduleRow: schedule({ grace_window_minutes: grace }) });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].kind, 'DISPATCH');
    assert.equal(actions[0].business_date, businessDate);
    assert.equal(actions[0].dispatch_key, `lich-kiem-ke:CN_HN:${businessDate}`);
    assert.equal(actions[0].config_snapshot_id, 'cfg-current');
  }
});

test('completed older dates do not hide the next due date in a multi-day grace window', () => {
  const actions = planAt({
    at: '2026-09-26T16:40:00.000Z',
    scheduleRow: schedule({ grace_window_minutes: '4320' }),
    history: [
      { dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23', status: 'SUCCESS', attempt_count: '1' },
      { dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-24', status: 'SUCCESS', attempt_count: '1' },
    ],
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'DISPATCH');
  assert.equal(actions[0].business_date, '2026-09-25');
  assert.equal(actions[0].dispatch_key, 'lich-kiem-ke:CN_HN:2026-09-25');
});

test('an expired CLAIMED lease replays only the same dispatch and operation within retry_limit', () => {
  const previous = {
    dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23',
    status: 'CLAIMED',
    attempt_count: '1',
    operation_id: 'op-original-42',
    config_snapshot_id: 'cfg-original',
    updated_at: '2026-09-23T16:30:00.000Z',
  };
  const actions = planAt({ history: [previous], claimLeaseMinutes: '10' });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'DISPATCH');
  assert.equal(actions[0].dispatch_key, previous.dispatch_key);
  assert.equal(actions[0].business_date, '2026-09-23');
  assert.equal(actions[0].attempt_count, '2');
  assert.equal(actions[0].operation_id, previous.operation_id);
  assert.equal(actions[0].config_snapshot_id, previous.config_snapshot_id);
  const replay = prepareDispatchClaim({ action: actions[0], claimToken: 'execution-replay', requestId: 'req-replay' });
  assert.equal(replay.operation_id, previous.operation_id);
  assert.equal(replay.dispatch_key, previous.dispatch_key);
});

test('an explicit-offset claim timestamp uses the same lease instant', () => {
  const actions = planAt({
    history: [{ dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23', status: 'CLAIMED', attempt_count: '1', operation_id: 'op-original-42', config_snapshot_id: 'cfg-original', updated_at: '2026-09-23T23:30:00.000+07:00' }],
    claimLeaseMinutes: '10',
  });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, 'DISPATCH');
  assert.equal(actions[0].operation_id, 'op-original-42');
});

test('fresh and exhausted CLAIMED rows cannot dispatch another worker', () => {
  for (const { updatedAt, attempts, lease } of [
    { updatedAt: '2026-09-23T16:45:00.000Z', attempts: '1', lease: '10' },
    { updatedAt: '2026-09-23T16:30:00.000Z', attempts: '2', lease: '10' },
  ]) {
    const actions = planAt({
      history: [{ dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23', status: 'CLAIMED', updated_at: updatedAt, attempt_count: attempts, operation_id: 'op-original-42' }],
      claimLeaseMinutes: lease,
    });
    assert.equal(actions.filter((action) => action.kind === 'DISPATCH').length, 0);
  }
});

test('a retry keeps the failed operation ID and an active session still blocks a stale claim', () => {
  const failed = planAt({
    history: [{ dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23', status: 'FAILED', attempt_count: '1', operation_id: 'op-original-42', config_snapshot_id: 'cfg-original', updated_at: '2026-09-23T16:30:00.000Z', retry_at: '2026-09-23T16:40:00.000Z' }],
    claimLeaseMinutes: '10',
  });
  assert.equal(failed.length, 1);
  assert.equal(failed[0].operation_id, 'op-original-42');
  assert.equal(failed[0].attempt_count, '2');

  const sessionExists = planAt({
    history: [{ dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23', status: 'CLAIMED', attempt_count: '1', operation_id: 'op-original-42', config_snapshot_id: 'cfg-original', updated_at: '2026-09-23T16:30:00.000Z' }],
    activeSessions: [{ session_id: 'session-1', branch_id: 'CN_HN', status: 'ACTIVE', dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23' }],
    operations: [committedOpening()],
    claimLeaseMinutes: '10',
  });
  assert.equal(sessionExists.length, 1);
  assert.equal(sessionExists[0].kind, 'SKIP');
  assert.equal(sessionExists[0].reason, 'ACTIVE_SESSION_EXISTS');
});

test('uncertain CLAIMED and RUNNING rows request reconciliation without dispatch', () => {
  for (const { status, updatedAt, lease, operationId, snapshotId = 'cfg-original' } of [
    { status: 'CLAIMED', updatedAt: '', lease: '10', operationId: 'op-original-42' },
    { status: 'CLAIMED', updatedAt: 'not-a-date', lease: '10', operationId: 'op-original-42' },
    { status: 'CLAIMED', updatedAt: '2026-09-23T16:30:00.000Z', lease: undefined, operationId: 'op-original-42' },
    { status: 'CLAIMED', updatedAt: '2026-09-23T16:30:00.000Z', lease: '0', operationId: 'op-original-42' },
    { status: 'CLAIMED', updatedAt: '2026-09-23T16:30:00.000Z', lease: '10', operationId: '' },
    { status: 'CLAIMED', updatedAt: '2026-09-23T16:30:00.000Z', lease: '10', operationId: 'op-original-42', snapshotId: '' },
    { status: 'RUNNING', updatedAt: '2026-09-23T16:30:00.000Z', lease: '10', operationId: 'op-original-42' },
    { status: 'RUNNING', updatedAt: '', lease: '10', operationId: 'op-original-42' },
    { status: 'FAILED', updatedAt: '', lease: '10', operationId: 'op-original-42' },
    { status: 'FAILED', updatedAt: '2026-09-23T16:30:00.000Z', lease: '10', operationId: '' },
  ]) {
    const actions = planAt({
      history: [{ dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23', status, updated_at: updatedAt, attempt_count: '1', operation_id: operationId, config_snapshot_id: snapshotId }],
      claimLeaseMinutes: lease,
    });
    assert.equal(actions.length, 1, `${status}: ${updatedAt || 'missing'} / lease ${lease}`);
    assert.equal(actions[0].kind, 'WARNING', `${status}: ${updatedAt || 'missing'} / lease ${lease} / operation ${operationId || 'missing'} / snapshot ${snapshotId || 'missing'}`);
    assert.equal(actions[0].reason, 'RECONCILIATION_REQUIRED');
    assert.equal(actions[0].notice_code, 'DISPATCH_RECONCILIATION_REQUIRED');
    assert.equal(actions[0].dispatch_key, 'lich-kiem-ke:CN_HN:2026-09-23');
  }
});

test('only an active branch without a committed active session may open inventory', () => {
  for (const { branchStatus, sessionStatus, expectedKind, expectedReason } of [
    { branchStatus: 'INACTIVE', sessionStatus: null, expectedKind: 'SKIP', expectedReason: 'BRANCH_INACTIVE' },
    { branchStatus: 'ACTIVE', sessionStatus: 'ACTIVE', expectedKind: 'SKIP', expectedReason: 'ACTIVE_SESSION_EXISTS' },
    { branchStatus: 'ACTIVE', sessionStatus: 'PREPARED', expectedKind: 'DISPATCH', expectedReason: undefined },
    { branchStatus: 'ACTIVE', sessionStatus: 'CANCELLED', expectedKind: 'DISPATCH', expectedReason: undefined },
  ]) {
    const activeSessions = sessionStatus ? [{ session_id: 'session-1', branch_id: 'CN_HN', status: sessionStatus, dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23' }] : [];
    const actions = planAt({ branchStatus, activeSessions, operations: sessionStatus === 'ACTIVE' ? [committedOpening()] : [] });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].kind, expectedKind);
    assert.equal(actions[0].reason, expectedReason);
  }
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
  const target = { chat_id: '-100999', message_thread_id: '88' };
  const first = recordHeartbeat({ now, previous: { status: 'FAILED', failure_count: '2', critical_notified: 'NO' }, failure: true, threshold: '3', notificationTarget: target });
  assert.equal(first.failure_count, 3);
  assert.equal(first.notice, 'CRITICAL');

  const recovery = recordHeartbeat({ now, previous: { status: 'FAILED', failure_count: '3', critical_notified: 'YES' }, failure: false, threshold: '3', notificationTarget: target });
  assert.equal(recovery.failure_count, 0);
  assert.equal(recovery.notice, 'RECOVERY');

  const healthy = recordHeartbeat({ now, previous: { status: 'HEALTHY', failure_count: '0', critical_notified: 'NO' }, failure: false, threshold: '3', notificationTarget: target });
  assert.equal(healthy.notice, null);
});

test('three Gateway failures reuse only the last validated Sheet threshold and target, then alert once', () => {
  let previous = { status: 'HEALTHY', failure_count: '0', critical_notified: 'NO', threshold: '3', alert_chat_id: '-100999', alert_thread_id: '88' };
  const notices = [];
  for (let index = 0; index < 4; index += 1) {
    const heartbeat = recordHeartbeat({ now, previous, failure: true, threshold: null, notificationTarget: null });
    notices.push(heartbeat.notice);
    assert.equal(heartbeat.threshold, 3);
    assert.equal(heartbeat.alert_chat_id, '-100999');
    assert.equal(heartbeat.alert_thread_id, '88');
    previous = heartbeat;
  }
  assert.deepEqual(notices, [null, null, 'CRITICAL', null]);
});

test('a heartbeat without validated threshold or target fails without claiming an alert', () => {
  const result = recordHeartbeat({ now, previous: {}, failure: true, threshold: null, notificationTarget: null });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.notice, null);
  assert.equal(result.critical_notified, 'NO');
  assert.equal(result.diagnostic_code, 'HEARTBEAT_CONFIG_MISSING');
});
