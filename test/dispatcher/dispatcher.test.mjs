import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDispatchPlan,
  decideDispatch,
  dispatchIdentity,
  evaluateSchedule,
} from '../../src/dispatcher/decide-dispatch.mjs';
import { parseScheduleRows } from '../../src/dispatcher/parse-schedule.mjs';
import { decideHeartbeat } from '../../src/dispatcher/heartbeat.mjs';

const branchRows = [
  {
    branch_id: 'CN_HN',
    timezone: 'Asia/Ho_Chi_Minh',
    trang_thai: 'ACTIVE',
  },
];

const scheduleRow = (overrides = {}) => ({
  schedule_id: 'lich-open-count',
  job_code: 'OPEN_COUNT_SESSION',
  worker_workflow: 'WF05_V2_MO_PHIEN_KIEM_KE',
  branch_id: 'CN_HN',
  timezone: '',
  days_of_week: 'MON,TUE,WED,THU,FRI,SAT,SUN',
  local_time: '08:00',
  grace_minutes: '20',
  max_attempts: '3',
  trang_thai: 'ACTIVE',
  ...overrides,
});

const schedule = (overrides = {}) => parseScheduleRows({
  rows: [scheduleRow(overrides)],
  branchRows,
})[0];

const dispatchInput = (overrides = {}) => ({
  schedule: schedule(),
  now: '2026-09-19T01:10:00.000Z',
  historyRows: [],
  requestId: 'req-dispatch-tick-001',
  configVersion: 'v2',
  ...overrides,
});

test('classifies a timezone-aware schedule as not due before its local run time and due at the run time', () => {
  const parsed = schedule();
  const before = evaluateSchedule({ schedule: parsed, now: '2026-09-19T00:59:00.000Z' });
  const atTime = evaluateSchedule({ schedule: parsed, now: '2026-09-19T01:00:00.000Z' });

  assert.equal(before.phase, 'NOT_DUE');
  assert.equal(atTime.phase, 'DUE');
  assert.equal(atTime.occurrence.local_date, '2026-09-19');
  assert.equal(atTime.occurrence.local_time, '08:00');
});

test('disabled schedule never produces a dispatch decision', () => {
  const result = decideDispatch(dispatchInput({ schedule: schedule({ trang_thai: 'INACTIVE' }) }));

  assert.equal(result.action, 'SKIP');
  assert.equal(result.reason, 'DISABLED');
  assert.equal(result.envelope, undefined);
});

test('dispatches a missed occurrence inside the grace window with a stable envelope', () => {
  const result = decideDispatch(dispatchInput());

  assert.equal(result.action, 'DISPATCH');
  assert.equal(result.reason, 'GRACE_CATCH_UP');
  assert.equal(result.attempt_number, 1);
  assert.equal(result.envelope.event_type, 'SCHEDULED_JOB');
  assert.equal(result.envelope.branch_id, 'CN_HN');
  assert.equal(result.envelope.business_date, '2026-09-19');
  assert.equal(result.envelope.config_version, 'v2');
  assert.equal(result.envelope.payload.dispatch_key, result.dispatch_key);
  assert.equal(result.envelope.operation_id, result.operation_id);
});

test('warns once when an occurrence is outside its grace window', () => {
  const first = decideDispatch(dispatchInput({ now: '2026-09-19T02:00:00.000Z' }));
  const second = decideDispatch(dispatchInput({
    now: '2026-09-19T02:10:00.000Z',
    historyRows: [first.history_row],
  }));

  assert.equal(first.action, 'WARN');
  assert.equal(first.reason, 'OUTSIDE_WINDOW');
  assert.equal(first.warning.code, 'DISPATCH_OUTSIDE_WINDOW');
  assert.equal(second.action, 'SKIP');
  assert.equal(second.reason, 'WARNING_ALREADY_RECORDED');
});

test('skips a dispatch key already claimed by another dispatcher attempt', () => {
  const parsed = schedule();
  const identity = dispatchIdentity({
    schedule: parsed,
    occurrence: evaluateSchedule({ schedule: parsed, now: '2026-09-19T01:10:00.000Z' }).occurrence,
  });
  const result = decideDispatch(dispatchInput({
    historyRows: [{
      record_type: 'JOB',
      dispatch_key: identity.dispatch_key,
      operation_id: identity.operation_id,
      status: 'CLAIMED',
      attempt_number: '1',
      updated_at: '2026-09-19T01:10:00.000Z',
    }],
  }));

  assert.equal(result.action, 'SKIP');
  assert.equal(result.reason, 'ALREADY_IN_FLIGHT');
  assert.equal(result.dispatch_key, identity.dispatch_key);
  assert.equal(result.operation_id, identity.operation_id);
});

test('does not warn again outside the grace window after the occurrence already completed', () => {
  const initial = decideDispatch(dispatchInput({ now: '2026-09-19T01:00:00.000Z' }));
  const result = decideDispatch(dispatchInput({
    now: '2026-09-19T02:00:00.000Z',
    historyRows: [{ ...initial.history_row, status: 'SUCCEEDED' }],
  }));

  assert.equal(result.action, 'SKIP');
  assert.equal(result.reason, 'ALREADY_COMPLETED');
});

test('retries a retryable failure with the same dispatch key and operation identity', () => {
  const parsed = schedule();
  const occurrence = evaluateSchedule({ schedule: parsed, now: '2026-09-19T01:10:00.000Z' }).occurrence;
  const identity = dispatchIdentity({ schedule: parsed, occurrence });
  const result = decideDispatch(dispatchInput({
    historyRows: [{
      record_type: 'JOB',
      dispatch_key: identity.dispatch_key,
      operation_id: identity.operation_id,
      status: 'FAILED',
      retryable: 'YES',
      attempt_number: '1',
      updated_at: '2026-09-19T01:05:00.000Z',
    }],
  }));

  assert.equal(result.action, 'RETRY');
  assert.equal(result.reason, 'RETRY_FAILED');
  assert.equal(result.attempt_number, 2);
  assert.equal(result.dispatch_key, identity.dispatch_key);
  assert.equal(result.operation_id, identity.operation_id);
  assert.equal(result.history_row.attempt_number, '2');
  assert.equal(result.envelope.operation_id, identity.operation_id);
});

test('raises one critical alert at the third consecutive heartbeat failure and one recovery alert', () => {
  let heartbeatRows = [];
  const failures = [];
  for (const minute of [0, 10, 20]) {
    const result = decideHeartbeat({
      heartbeatRows,
      tickAt: `2026-09-19T01:${String(minute).padStart(2, '0')}:00.000Z`,
      success: false,
      failureThreshold: 3,
    });
    failures.push(result);
    heartbeatRows = [...heartbeatRows, result.history_row];
  }

  const recovery = decideHeartbeat({
    heartbeatRows,
    tickAt: '2026-09-19T01:30:00.000Z',
    success: true,
    failureThreshold: 3,
  });

  assert.deepEqual(failures.map((item) => item.consecutive_failures), [1, 2, 3]);
  assert.equal(failures[0].critical_alert, false);
  assert.equal(failures[1].critical_alert, false);
  assert.equal(failures[2].critical_alert, true);
  assert.equal(failures[2].alert_state, 'CRITICAL');
  assert.equal(recovery.recovery_alert, true);
  assert.equal(recovery.alert_state, 'HEALTHY');
  assert.equal(recovery.consecutive_failures, 0);

  const quietHealthy = decideHeartbeat({
    heartbeatRows: [...heartbeatRows, recovery.history_row],
    tickAt: '2026-09-19T01:40:00.000Z',
    success: true,
    failureThreshold: 3,
  });
  assert.equal(quietHealthy.recovery_alert, false);
});

test('builds a dispatcher plan containing worker envelopes and the heartbeat record', () => {
  const result = buildDispatchPlan({
    scheduleRows: [scheduleRow()],
    branchRows,
    historyRows: [],
    heartbeatRows: [],
    now: '2026-09-19T01:10:00.000Z',
    requestId: 'req-dispatch-tick-001',
    configVersion: 'v2',
    heartbeatSuccess: true,
    heartbeatFailureThreshold: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(result.dispatches.length, 1);
  assert.equal(result.dispatches[0].envelope.event_type, 'SCHEDULED_JOB');
  assert.equal(result.heartbeat.history_row.record_type, 'HEARTBEAT');
  assert.equal(result.decisions.length, 1);
  assert.equal(result.data.atomic_claim_count, 1);
  assert.equal(result.write_plan.find((step) => step.row.status === 'CLAIMED').action, 'ATOMIC_CLAIM');
});

test('rejects a schedule without an explicit weekday or branch reference', () => {
  assert.throws(() => parseScheduleRows({ rows: [scheduleRow({ days_of_week: '' })], branchRows }), /DISPATCH_CONFIG_REQUIRED:days_of_week/);
  assert.throws(() => parseScheduleRows({ rows: [scheduleRow()], branchRows: [] }), /DISPATCH_BRANCH_TABLE_MISSING/);
});
