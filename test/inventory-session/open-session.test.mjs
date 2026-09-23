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
  assert.equal(result.write_plan.length, 2);
  assert.equal(result.write_plan[0].sheet, 'OPERATION');
  assert.equal(result.write_plan[1].sheet, 'EVENT_LOG');
  assert.equal(result.commit_plan.length, 2);
});

test('opens a session with the dispatch business date and config snapshot and audits it', () => {
  const result = openOrReuseInventorySession({ ...input, sessions: [] });

  assert.equal(result.status, 'OPENED');
  assert.equal(result.session.business_date, '2026-09-23');
  assert.equal(result.session.config_snapshot_id, 'cfg-v2-fp');
  assert.equal(result.session.topic_id, 'topic-kiem-ke');
  assert.equal(result.write_plan[0].sheet, 'OPERATION');
  assert.equal(result.write_plan[1].sheet, 'PHIEN_KIEM_KE');
  assert.equal(result.write_plan[2].sheet, 'EVENT_LOG');
  assert.equal(result.write_plan[1].row.dispatch_key, input.envelope.payload.dispatch_key);
});

test('returns an immutable operation with prepared rows and an explicit commit phase', () => {
  const result = openOrReuseInventorySession({ ...input, sessions: [] });

  assert.equal(result.operation.operation_id, 'op-dispatch-1');
  assert.equal(result.operation.status, 'PREPARED');
  assert.equal(result.operation.operation_type, 'OPEN_INVENTORY_SESSION');
  assert.equal(result.operation.idempotency_key, input.envelope.payload.dispatch_key);

  assert.deepEqual(
    result.write_plan.map(({ sheet, phase, row }) => ({ sheet, phase, status: row.status ?? row.trang_thai })),
    [
      { sheet: 'OPERATION', phase: 'PREPARE', status: 'PREPARED' },
      { sheet: 'PHIEN_KIEM_KE', phase: 'PREPARE', status: 'PREPARED' },
      { sheet: 'EVENT_LOG', phase: 'PREPARE', status: 'PREPARED' },
    ],
  );
  assert.deepEqual(
    result.commit_plan.map(({ sheet, phase, patch }) => ({ sheet, phase, status: patch.status ?? patch.trang_thai })),
    [
      { sheet: 'PHIEN_KIEM_KE', phase: 'COMMIT', status: 'ACTIVE' },
      { sheet: 'EVENT_LOG', phase: 'COMMIT', status: 'COMMITTED' },
      { sheet: 'OPERATION', phase: 'COMMIT', status: 'COMMITTED' },
    ],
  );
});

test('requests a configured Telegram forum topic when the branch has no active topic', () => {
  const result = openOrReuseInventorySession({
    ...input,
    topics: [],
    sessions: [],
    branch: { branch_id: 'CN_HN', forum_chat_id: '-100200', trang_thai: 'ACTIVE' },
    configGlobal: [{ config_key: 'INVENTORY_TOPIC_NAME', config_value: 'Kiểm kê bia - CN_HN', trang_thai: 'ACTIVE' }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'TOPIC_CREATE_REQUIRED');
  assert.deepEqual(result.topic_request, { method: 'createForumTopic', chat_id: '-100200', name: 'Kiểm kê bia - CN_HN' });
  assert.deepEqual(result.config_topic_row, {
    topic_id: 'topic-CN_HN-KIEM_KE',
    branch_id: 'CN_HN',
    topic_type: 'KIEM_KE',
    chat_id: '-100200',
    message_thread_id: '',
    trang_thai: 'ACTIVE',
  });
});

test('uses the Telegram-created topic and records that creation in the session contract', () => {
  const result = openOrReuseInventorySession({
    ...input,
    topics: [],
    sessions: [],
    branch: { branch_id: 'CN_HN', forum_chat_id: '-100200', trang_thai: 'ACTIVE' },
    configGlobal: [{ config_key: 'INVENTORY_TOPIC_NAME', config_value: 'Kiểm kê bia - CN_HN', trang_thai: 'ACTIVE' }],
    createdTopic: { message_thread_id: '99' },
  });

  assert.equal(result.status, 'OPENED');
  assert.equal(result.session.message_thread_id, '99');
  assert.equal(result.session.topic_action, 'CREATE_TOPIC');
  assert.equal(result.topic_write_plan[0].row.message_thread_id, '99');
  assert.equal(result.topic_write_plan[0].sheet, 'CONFIG_TOPIC');
});
