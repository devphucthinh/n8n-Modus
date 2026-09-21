import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEnvelope } from '../../src/contracts/workflow-envelope.mjs';

test('normalizes a status request without inventing business configuration', () => {
  const result = normalizeEnvelope({
    request_id: 'req-001',
    operation_id: 'op-001',
    event_type: 'TELEGRAM_UPDATE',
    actor_user_id: '10001',
    payload: { command: '/trangthai', intent: 'READ_STATUS' },
  });

  assert.equal(result.request_id, 'req-001');
  assert.equal(result.payload.intent, 'READ_STATUS');
  assert.equal(result.business_date, null);
  assert.equal(result.branch_id, null);
  assert.equal(result.config_snapshot_id, null);
});

test('rejects a request without immutable IDs', () => {
  assert.throws(
    () => normalizeEnvelope({ event_type: 'TELEGRAM_UPDATE', payload: {} }),
    /request_id.*operation_id/,
  );
});

test('does not mutate the caller payload', () => {
  const payload = { command: '/trangthai' };
  const result = normalizeEnvelope({ request_id: 'r', operation_id: 'o', payload });
  result.payload.command = '/changed';
  assert.equal(payload.command, '/trangthai');
});
