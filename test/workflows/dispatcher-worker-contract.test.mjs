import test from 'node:test';
import assert from 'node:assert/strict';
import { planDispatch } from '../../src/dispatcher/decide-dispatch.mjs';
import { prepareDispatchClaim, verifyDispatchClaim } from '../../src/dispatcher/claim-dispatch.mjs';
import { openOrReuseInventorySession } from '../../src/inventory-session/open-session.mjs';

test('the dispatcher worker contract carries one claim identity into a prepared inventory session', () => {
  const dispatchKey = 'nightly-inventory:CN_TEST:2026-09-23';
  const planned = planDispatch({
    now: '2026-09-23T16:50:00.000Z',
    schedules: [{
      schedule_id: 'nightly-inventory', job_code: 'OPEN_INVENTORY', branch_id: 'CN_TEST',
      local_time: '23:45', timezone: 'Asia/Ho_Chi_Minh', days_of_week: '*',
      grace_window_minutes: '30', retry_limit: '2', retry_delay_minutes: '10',
      worker_workflow: 'configured-worker', enabled: 'YES', trang_thai: 'ACTIVE',
    }],
    branches: [{ branch_id: 'CN_TEST', trang_thai: 'ACTIVE' }],
    configSnapshotId: 'snapshot-42',
  });
  assert.deepEqual(planned.actions.map((action) => action.kind), ['DISPATCH']);

  const action = planned.actions[0];
  const claim = prepareDispatchClaim({ action, claimToken: 'claim-42', requestId: 'request-42' });
  assert.equal(claim.dispatch_key, dispatchKey);
  assert.equal(verifyDispatchClaim({ action: claim, persistedRow: claim }), true);

  const envelope = {
    request_id: claim.request_id,
    operation_id: claim.operation_id,
    event_type: 'SCHEDULED_JOB',
    actor_user_id: 'SYSTEM',
    branch_id: claim.branch_id,
    business_date: claim.business_date,
    payload: {
      dispatch_key: claim.dispatch_key,
      idempotency_key: claim.dispatch_key,
      config_snapshot_id: claim.config_snapshot_id,
    },
  };
  const session = openOrReuseInventorySession({
    envelope,
    configSnapshotId: 'snapshot-42',
    expectedConfigSnapshotId: 'snapshot-42',
    topics: [{ topic_id: 'topic-42', branch_id: 'CN_TEST', topic_type: 'KIEM_KE', chat_id: '-10042', message_thread_id: '42', trang_thai: 'ACTIVE' }],
    branch: { branch_id: 'CN_TEST' },
    beers: [{ ma_bia: 'B42', ten_bia: 'Test beer', don_vi_dem: 'thung', thu_tu_hien_thi: '1', trang_thai: 'ACTIVE' }],
    configGlobal: [{ config_key: 'INVENTORY_PAGE_SIZE', config_value: '8', trang_thai: 'ACTIVE' }],
    operations: [],
    sessions: [],
    now: '2026-09-23T16:50:01.000Z',
  });

  assert.equal(session.ok, true);
  assert.equal(session.status, 'OPENED');
  assert.equal(session.operation.operation_id, claim.operation_id);
  assert.equal(session.operation.request_id, claim.request_id);
  assert.equal(session.operation.idempotency_key, dispatchKey);
  assert.equal(session.session.dispatch_key, dispatchKey);
  assert.equal(session.session.business_date, claim.business_date);
  assert.equal(session.session.config_snapshot_id, claim.config_snapshot_id);
  assert.equal(session.write_plan[0].row.status, 'PREPARED');
  assert.equal(session.commit_plan.at(-1).match.operation_id, claim.operation_id);
});
