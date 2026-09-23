import test from 'node:test';
import assert from 'node:assert/strict';
import { planDispatch, recordHeartbeat } from '../../src/dispatcher/decide-dispatch.mjs';
import { prepareDispatchClaim, verifyDispatchClaim } from '../../src/dispatcher/claim-dispatch.mjs';
import { openOrReuseInventorySession } from '../../src/inventory-session/open-session.mjs';

const schedule = {
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
};

const envelope = {
  request_id: 'req-dispatch-1',
  operation_id: 'op-dispatch-1',
  branch_id: 'CN_HN',
  business_date: '2026-09-23',
  payload: { dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23' },
};

test('dispatcher seam emits one configured business action and a stable claim contract', () => {
  const result = planDispatch({
    now: '2026-09-23T16:50:00.000Z',
    schedules: [schedule],
    branches: [{ branch_id: 'CN_HN', trang_thai: 'ACTIVE' }],
    history: [],
    activeSessions: [],
    configSnapshotId: 'cfg-v2-fp',
  });
  const action = result.actions.find((item) => item.kind === 'DISPATCH');
  const claim = prepareDispatchClaim({ action, claimToken: 'execution-a', requestId: 'req-a' });

  assert.equal(result.actions.length, 1);
  assert.equal(claim.dispatch_key, 'lich-kiem-ke:CN_HN:2026-09-23');
  assert.equal(claim.operation_id, 'op-dispatch-lich-kiem-ke_CN_HN_2026-09-23');
  assert.equal(verifyDispatchClaim({ action: claim, persistedRow: claim }), true);
  assert.equal(verifyDispatchClaim({ action: claim, persistedRow: { ...claim, claim_token: 'execution-b' } }), false);
});

test('dispatcher seam records heartbeat threshold transitions once', () => {
  const critical = recordHeartbeat({
    now: '2026-09-23T16:50:00.000Z',
    previous: { status: 'FAILED', failure_count: '2', critical_notified: 'NO' },
    failure: true,
    threshold: '3',
  });
  const recovery = recordHeartbeat({
    now: '2026-09-23T17:00:00.000Z',
    previous: { status: 'FAILED', failure_count: '3', critical_notified: 'YES' },
    failure: false,
    threshold: '3',
  });

  assert.equal(critical.notice, 'CRITICAL');
  assert.equal(recovery.notice, 'RECOVERY');
});

test('inventory session seam preserves business date and snapshot through a staged commit', () => {
  const result = openOrReuseInventorySession({
    envelope,
    configSnapshotId: 'cfg-v2-fp',
    topics: [{ topic_id: 'topic-kiem-ke', branch_id: 'CN_HN', topic_type: 'KIEM_KE', chat_id: '-100100', message_thread_id: '77', trang_thai: 'ACTIVE' }],
    sessions: [],
    now: '2026-09-23T16:50:00.000Z',
  });

  assert.equal(result.status, 'OPENED');
  assert.equal(result.session.business_date, '2026-09-23');
  assert.equal(result.session.config_snapshot_id, 'cfg-v2-fp');
  assert.equal(result.operation.status, 'PREPARED');
  assert.equal(result.write_plan.every((entry) => entry.phase === 'PREPARE'), true);
  assert.equal(result.commit_plan.at(-1).patch.status, 'COMMITTED');
});

test('inventory session seam returns a configured topic-creation request when no topic exists', () => {
  const result = openOrReuseInventorySession({
    envelope,
    configSnapshotId: 'cfg-v2-fp',
    topics: [],
    sessions: [],
    branch: { branch_id: 'CN_HN', forum_chat_id: '-100200', trang_thai: 'ACTIVE' },
    configGlobal: [{ config_key: 'INVENTORY_TOPIC_NAME', config_value: 'Kiểm kê bia - CN_HN', trang_thai: 'ACTIVE' }],
  });

  assert.equal(result.status, 'TOPIC_CREATE_REQUIRED');
  assert.equal(result.topic_request.method, 'createForumTopic');
  assert.equal(result.topic_request.chat_id, '-100200');
  assert.equal(result.config_topic_row.topic_type, 'KIEM_KE');
});
