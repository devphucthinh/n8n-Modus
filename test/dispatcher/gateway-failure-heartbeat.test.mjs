import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_SHEET_DEFINITIONS } from '../../src/contracts/core-sheet-schema.mjs';
import { planGatewayFailureHeartbeat } from '../../src/dispatcher/gateway-failure-heartbeat.mjs';

const now = '2026-09-23T16:50:00.000Z';
const prior = {
  ...Object.fromEntries(ALL_SHEET_DEFINITIONS.HEARTBEAT.map((column) => [column, ''])),
  heartbeat_id: 'heartbeat-prior',
  heartbeat_at: '2026-09-23T16:49:00.000Z',
  status: 'FAILED',
  failure_count: '2',
  threshold: '3',
  critical_notified: 'NO',
  alert_chat_id: '-100999',
  alert_thread_id: '77',
};
const plan = (rows, gatewayErrorCode = 'CONFIG_SCHEMA_INVALID') => planGatewayFailureHeartbeat({
  rows,
  heartbeatId: 'heartbeat-current',
  now,
  gatewayErrorCode,
});

test('Gateway failure produces only a FAILED heartbeat from the latest validated persisted settings', () => {
  const output = plan([prior]);

  assert.equal(output.kind, 'HEARTBEAT');
  assert.equal(output.heartbeat_id, 'heartbeat-current');
  assert.equal(output.status, 'FAILED');
  assert.equal(output.failure_count, 3);
  assert.equal(output.threshold, 3);
  assert.equal(output.alert_chat_id, '-100999');
  assert.equal(output.alert_thread_id, '77');
  assert.equal(output.critical_notified, 'NO');
  assert.equal(output.notice, null);
  assert.equal(output.diagnostic_code, 'CONFIG_SCHEMA_INVALID');
  assert.equal(Object.hasOwn(output, 'write_plan'), false);
});

test('repeated Gateway failures increment count without creating alerts or advancing notification state', () => {
  let previous = { ...prior, status: 'HEALTHY', failure_count: '0' };
  for (let count = 1; count <= 4; count += 1) {
    const output = plan([previous]);
    assert.equal(output.status, 'FAILED');
    assert.equal(output.failure_count, count);
    assert.equal(output.notice, null);
    assert.equal(output.critical_notified, 'NO');
    previous = { ...previous, ...output };
  }
});

test('missing, unreadable, empty, or semantically invalid HEARTBEAT fails closed without a heartbeat result', () => {
  for (const [rows, expectedCode] of [
    [null, 'CONFIG_SHEET_MISSING'],
    [[], 'HEARTBEAT_CONFIG_MISSING'],
    [[{ ...prior, failure_count: 'not-a-count' }], 'HEARTBEAT_ROW_INVALID'],
  ]) {
    const output = plan(rows);
    assert.equal(output.kind, 'SCHEMA_REJECTED');
    assert.equal(output.error_code, expectedCode);
    assert.deepEqual(output.write_plan, []);
  }
});

test('heartbeat records without valid persisted threshold or destination fail closed', () => {
  for (const broken of [
    { ...prior, threshold: '', alert_chat_id: '', alert_thread_id: '' },
    { ...prior, alert_chat_id: '', alert_thread_id: '' },
  ]) {
    const output = plan([broken]);
    assert.equal(output.kind, 'SCHEMA_REJECTED');
    assert.equal(output.error_code, 'HEARTBEAT_CONFIG_INVALID');
    assert.deepEqual(output.write_plan, []);
  }
});

test('duplicate persisted heartbeat identities fail closed before selecting the latest settings', () => {
  const output = plan([
    prior,
    { ...prior, heartbeat_at: '2026-09-23T16:49:30.000Z' },
  ]);

  assert.equal(output.kind, 'SCHEMA_REJECTED');
  assert.equal(output.error_code, 'HEARTBEAT_ROW_INVALID');
  assert.equal(output.sheet_name, 'HEARTBEAT');
  assert.equal(output.column_name, 'heartbeat_id');
  assert.deepEqual(output.write_plan, []);
});
