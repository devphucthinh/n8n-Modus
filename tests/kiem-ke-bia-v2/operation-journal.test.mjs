import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemaManifest } from '../../tools/kiem-ke-bia-v2/schema-manifest.mjs';
import { decideCommit, prepareOperation, visibleCommittedRows } from '../../src/kiem-ke-bia-v2/operation-journal.mjs';

test('same idempotency key replays the persisted operation instead of preparing a second identity', () => {
  const envelope = {
    request_id: 'req-journal-1',
    operation_id: 'op-journal-1',
    event_type: 'SESSION_OPEN',
    idempotency_key: 'tg-update-101',
    branch_id: 'BR-TEST-1',
    actor_user_id: 'USER-TEST-1',
    business_date: '2026-09-29',
    config_version: 3,
    config_snapshot_id: 'snapshot-test-1',
  };
  const first = prepareOperation(envelope, 'WF05', '2026-09-29T09:00:00.000Z');
  const replay = prepareOperation(
    { ...envelope, operation_id: 'op-redelivery-2' },
    'WF05',
    '2026-09-29T09:05:00.000Z',
    [first.operation],
  );

  assert.equal(first.ok, true);
  assert.equal(first.replay, false);
  assert.equal(first.appendPrepared, true);
  assert.equal(first.operation.status, 'PREPARED');
  assert.deepEqual(Object.keys(first.operation), schemaManifest.sheets.find((sheet) => sheet.name === 'OPERATION').headers);
  assert.equal(replay.ok, true);
  assert.equal(replay.replay, true);
  assert.equal(replay.appendPrepared, false);
  assert.equal(replay.operation.operation_id, 'op-journal-1');
  assert.deepEqual(replay.operation, first.operation);
});

test('same idempotency key cannot be replayed against a different config snapshot', () => {
  const envelope = {
    request_id: 'req-journal-conflict',
    operation_id: 'op-journal-conflict',
    event_type: 'SESSION_OPEN',
    idempotency_key: 'tg-update-conflict',
    branch_id: 'BR-TEST-1',
    config_snapshot_id: 'snapshot-test-1',
  };
  const prepared = prepareOperation(envelope, 'WF05', '2026-09-29T09:06:00.000Z');
  const conflicting = prepareOperation(
    { ...envelope, operation_id: 'op-journal-conflict-replayed', config_snapshot_id: 'snapshot-test-2' },
    'WF05',
    '2026-09-29T09:07:00.000Z',
    [prepared.operation],
  );

  assert.equal(conflicting.ok, false);
  assert.equal(conflicting.error_code, 'OPERATION_IDEMPOTENCY_CONFLICT');
  assert.equal(conflicting.appendPrepared, false);
  assert.equal(conflicting.operation.operation_id, 'op-journal-conflict');
});

test('partial writes remain invisible and PREPARED until every required write is observed', () => {
  const prepared = prepareOperation({
    request_id: 'req-journal-2',
    operation_id: 'op-journal-2',
    event_type: 'COUNT_SUBMITTED',
    idempotency_key: 'telegram-callback-202',
    branch_id: 'BR-TEST-1',
    actor_user_id: 'USER-TEST-1',
    business_date: '2026-09-29',
    config_snapshot_id: 'snapshot-test-1',
  }, 'WF06', '2026-09-29T09:10:00.000Z');
  const requiredWrites = ['COUNT_ROW', 'EVENT_LOG_ROW'];
  const records = [{ operation_id: 'op-journal-2', record_id: 'count-test-1' }];
  const partial = decideCommit(prepared.operation, requiredWrites, ['COUNT_ROW']);

  assert.equal(partial.ok, true);
  assert.equal(partial.committed, false);
  assert.deepEqual(partial.missingWrites, ['EVENT_LOG_ROW']);
  assert.equal(partial.operation.status, 'PREPARED');
  assert.equal(partial.operation.commit_state, 'PREPARED');
  assert.deepEqual(visibleCommittedRows(records, [partial.operation]), []);

  const recovered = decideCommit(partial.operation, requiredWrites, ['COUNT_ROW', 'EVENT_LOG_ROW']);
  assert.equal(recovered.committed, true);
  assert.equal(recovered.operation.status, 'COMMITTED');
  assert.equal(recovered.operation.commit_state, 'COMMITTED');
  assert.deepEqual(visibleCommittedRows(records, [recovered.operation]), records);
});
