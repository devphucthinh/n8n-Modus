import test from 'node:test';
import assert from 'node:assert/strict';
import { openOrReuseInventorySession } from '../../src/inventory-session/open-session.mjs';

const input = {
  envelope: {
    request_id: 'req-dispatch-1',
    operation_id: 'op-dispatch-1',
    branch_id: 'CN_HN',
    business_date: '2026-09-23',
    payload: { dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23' },
  },
  configSnapshotId: 'cfg-v2-fp',
  topics: [{ topic_id: 'topic-kiem-ke', branch_id: 'CN_HN', topic_type: 'KIEM_KE', chat_id: '-100100', message_thread_id: '77', trang_thai: 'ACTIVE' }],
};

test('reuses the existing active session and never creates a second one', () => {
  const result = openOrReuseInventorySession({
    ...input,
    sessions: [{ session_id: 'session-existing', branch_id: 'CN_HN', business_date: '2026-09-22', config_snapshot_id: 'cfg-old', status: 'ACTIVE' }],
  });

  assert.equal(result.status, 'REUSED');
  assert.equal(result.session.session_id, 'session-existing');
  assert.equal(result.write_plan.length, 1);
  assert.equal(result.write_plan[0].sheet, 'EVENT_LOG');
});

test('opens a session with the dispatch business date and config snapshot and audits it', () => {
  const result = openOrReuseInventorySession({ ...input, sessions: [] });

  assert.equal(result.status, 'OPENED');
  assert.equal(result.session.business_date, '2026-09-23');
  assert.equal(result.session.config_snapshot_id, 'cfg-v2-fp');
  assert.equal(result.session.topic_id, 'topic-kiem-ke');
  assert.equal(result.write_plan[0].sheet, 'PHIEN_KIEM_KE');
  assert.equal(result.write_plan[1].sheet, 'EVENT_LOG');
  assert.equal(result.write_plan[0].row.dispatch_key, input.envelope.payload.dispatch_key);
});
