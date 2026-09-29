import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildWorkflow } from '../../tools/kiem-ke-bia-v2/build-workflows.mjs';
import { handleWorkflowError, safeSystemFallback } from '../../src/kiem-ke-bia-v2/logic/wf02-error-handler.mjs';
import * as wf02 from '../../src/kiem-ke-bia-v2/logic/wf02-error-handler.mjs';
import { schemaManifest } from '../../tools/kiem-ke-bia-v2/schema-manifest.mjs';

function normalize(input) {
  const node = buildWorkflow('WF02').nodes.find((entry) => entry.name === 'Normalize Workflow Error');
  assert.ok(node);
  const sandbox = { $input: { first: () => ({ json: input }) } };
  return vm.runInNewContext(`(function () { ${node.parameters.jsCode} })()`, sandbox)[0].json;
}

test('WF02 preserves each approved error class and retries only TRANSIENT', () => {
  for (const errorClass of ['VALIDATION', 'AUTHORIZATION', 'CONFLICT', 'TRANSIENT', 'CONFIGURATION', 'EXTERNAL', 'SYSTEM', 'MANUAL_REVIEW']) {
    const result = normalize({ error: { error_code: 'HANDLED_FAILURE', error_class: errorClass }, context: { request_id: 'req-1', operation_id: 'op-1' }, reply_target: {} });
    assert.equal(result.error_class, errorClass);
    assert.equal(result.retryable, errorClass === 'TRANSIENT');
    assert.equal(result.error_row.retryable, errorClass === 'TRANSIENT');
  }
});

test('WF02 notification decision uses supplied WF01 policy and suppresses duplicate identity', () => {
  const input = { error: { error_code: 'HANDLED_FAILURE', error_class: 'TRANSIENT' }, context: { request_id: 'req-1', operation_id: 'op-1', workflow_code: 'WF03', branch_id: 'BR1', authorization: 'private-template-marker' }, now: '2026-09-29T00:00:00.000Z' };
  const policy = { notifications: [{ event_type: 'WF02_ERROR', branch_id: 'BR1', topic_type: 'ERROR', enabled: true, trang_thai: 'ACTIVE', cooldown_minutes: 10, template_text: 'Alert {{error_id}} / {{error_code}} / {{branch_id}} / {{authorization}}' }], topics: [{ branch_id: 'BR1', topic_type: 'ERROR', chat_id: '-10012345', message_thread_id: '42', trang_thai: 'ACTIVE' }] };
  const first = handleWorkflowError({ ...input, policy });
  assert.equal(first.notification.send, true);
  assert.equal(first.notification.chat_id, '-10012345');
  assert.equal(first.notification.text, `Alert ${first.error_id} / HANDLED_FAILURE / BR1 / `);
  assert.equal(first.notification.text.includes('private-template-marker'), false);
  assert.equal(typeof wf02.makeNotificationDeliveredEvent, 'function');
  const delivered = wf02.makeNotificationDeliveredEvent({ errorRecord: first, deliveredAt: '2026-09-29T00:00:01.000Z' });
  assert.equal(delivered.status, 'COMMITTED');
  assert.equal(delivered.event_type, 'WF02_NOTIFICATION_DELIVERED');
  assert.ok(schemaManifest.statusValues.includes(delivered.status));
  const replay = handleWorkflowError({ ...input, now: '2026-09-29T00:00:02.000Z', policy: { ...policy, delivered_events: [delivered] } });
  assert.equal(replay.notification.send, false);
  const afterCooldown = handleWorkflowError({ ...input, now: '2026-09-29T00:11:00.000Z', policy: { ...policy, delivered_events: [delivered] } });
  assert.equal(afterCooldown.notification.send, true);
  const failedSendReplay = handleWorkflowError({ ...input, policy: { ...policy, delivered_events: [] } });
  assert.equal(failedSendReplay.notification.send, true);
  const cooled = handleWorkflowError({ ...input, context: { ...input.context, execution_id: 'second' }, policy: { ...policy, notifications: [{ ...policy.notifications[0], cooldown_minutes: 10 }], delivered_events: [{ ...delivered, event_payload_json: JSON.stringify({ error_code: 'HANDLED_FAILURE', error_class: 'TRANSIENT', workflow_code: 'WF03', branch_id: 'BR1' }), created_at: '2026-09-28T23:55:00.000Z' }] } });
  assert.equal(cooled.notification.send, false);
});

test('WF02 fallback preserves original error identity when audit fails', () => {
  const original = handleWorkflowError({ error: { error_code: 'HANDLED_FAILURE', error_class: 'VALIDATION' }, context: { operation_id: 'op-1' }, policy: {}, now: '2026-09-29T00:00:00.000Z' });
  const fallback = safeSystemFallback(original);
  assert.equal(fallback.error_id, original.error_id);
  assert.equal(fallback.error_code, 'WF02_HANDLER_FAILED');
  assert.equal(fallback.original_error_code, original.error_code);
  assert.equal(fallback.error_class, 'SYSTEM');
  assert.equal(fallback.retryable, false);
});

test('WF02 excludes nested sensitive fields from persisted and returned data', () => {
  const result = normalize({
    error: { error_code: 'UNEXPECTED_ERROR', error_class: 'SYSTEM', message: 'private-message-marker', stack: 'private-stack-marker' },
    context: {
      request_id: { value: 'req-1', authorization: 'private-auth-marker' },
      operation_id: 'op-1',
      workflow_code: { value: 'WF03', credentials: { token: 'private-token-marker' } },
      raw_payload: { nested: { authorization: 'private-payload-marker' } },
    },
    reply_target: { chat_id: 'chat-1', token: 'private-reply-marker' },
  });
  const exposed = JSON.stringify({ error_row: result.error_row, message_safe: result.message_safe, notification: result.notification });
  for (const marker of ['private-auth-marker', 'private-token-marker', 'private-payload-marker', 'private-message-marker', 'private-stack-marker', 'private-reply-marker']) {
    assert.equal(exposed.includes(marker), false, marker);
  }
});

test('WF02 stages audit rows, recovers only missing appends, and exposes rows after commit', () => {
  assert.equal(typeof wf02.planErrorTransaction, 'function');
  assert.equal(typeof wf02.visibleCommittedRows, 'function');
  const record = handleWorkflowError({ error: { error_code: 'TEST_FAILURE', error_class: 'SYSTEM' }, context: { request_id: 'req-tx', operation_id: 'op-caller', workflow_code: 'WF03', branch_id: 'BR1', config_snapshot_id: 'snapshot-tx' }, policy: {}, now: '2026-09-29T00:00:00.000Z' });
  const empty = { operations: [], errorRows: [], eventRows: [] };
  const first = wf02.planErrorTransaction({ errorRecord: record, operationalState: empty, now: '2026-09-29T00:00:00.000Z' });
  assert.equal(first.operation_id, `op-${record.error_id}`);
  assert.equal(first.append_prepared_operation, true);
  assert.equal(first.append_error_record, true);
  assert.equal(first.append_event_record, true);
  assert.equal(first.append_commit_operation, true);
  assert.equal(first.prepared_operation.status, 'PREPARED');
  assert.equal(first.prepared_operation.commit_state, 'PREPARED');
  assert.equal(first.prepared_operation.config_snapshot_id, 'snapshot-tx');
  assert.equal(first.error_row.status, 'PREPARED');
  assert.equal(first.event_row.status, 'PREPARED');
  const field = (sheet, name) => schemaManifest.sheets.find((entry) => entry.name === sheet).fields.find((entry) => entry.name === name);
  for (const [sheet, row] of [['OPERATION', first.prepared_operation], ['OPERATION', first.commit_operation], ['ERROR_BIA', first.error_row], ['EVENT_LOG', first.event_row]]) {
    const statusField = field(sheet, 'status');
    assert.ok(statusField.allowed.includes(row.status));
    assert.ok(!['OPEN_NOTIFY_PENDING', 'RECORDED'].includes(row.status));
    assert.ok(Object.keys(row).every((name) => schemaManifest.sheets.find((entry) => entry.name === sheet).headers.includes(name)));
  }
  assert.deepEqual(wf02.visibleCommittedRows([first.error_row, first.event_row], [first.prepared_operation]), []);
  const resumed = wf02.planErrorTransaction({ errorRecord: record, operationalState: { operations: [first.prepared_operation], errorRows: [first.error_row], eventRows: [] }, now: '2026-09-29T00:01:00.000Z' });
  assert.equal(resumed.append_prepared_operation, false);
  assert.equal(resumed.append_error_record, false);
  assert.equal(resumed.append_event_record, true);
  assert.equal(resumed.append_commit_operation, true);
  assert.deepEqual(wf02.visibleCommittedRows([first.error_row, resumed.event_row], [first.prepared_operation]), []);
  assert.equal(resumed.commit_operation.status, 'COMMITTED');
  assert.equal(resumed.commit_operation.commit_state, 'COMMITTED');
  assert.equal(wf02.visibleCommittedRows([first.error_row, resumed.event_row], [first.commit_operation]).length, 2);
  const replayed = wf02.planErrorTransaction({ errorRecord: record, operationalState: { operations: [first.prepared_operation, first.commit_operation], errorRows: [first.error_row], eventRows: [resumed.event_row] }, now: '2026-09-29T00:02:00.000Z' });
  assert.equal(replayed.append_prepared_operation, false);
  assert.equal(replayed.append_error_record, false);
  assert.equal(replayed.append_event_record, false);
  assert.equal(replayed.append_commit_operation, false);
});

test('WF02 error operation identity includes request ID when caller operation ID is absent', () => {
  const base = { error: { error_code: 'USER_NOT_ACTIVE', error_class: 'AUTHORIZATION' }, context: { workflow_code: 'WF03', node_name: 'Authorize User', branch_id: 'BR1' }, policy: {}, now: '2026-09-29T00:00:00.000Z' };
  const first = handleWorkflowError({ ...base, context: { ...base.context, request_id: 'req-one' } });
  const second = handleWorkflowError({ ...base, context: { ...base.context, request_id: 'req-two' } });
  assert.notEqual(first.error_id, second.error_id);
  const firstPlan = wf02.planErrorTransaction({ errorRecord: first, operationalState: {}, now: base.now });
  const secondPlan = wf02.planErrorTransaction({ errorRecord: second, operationalState: {}, now: base.now });
  assert.notEqual(firstPlan.operation_id, secondPlan.operation_id);
  const stableContext = { request_id: 'req-stable', operation_id: 'op-stable', workflow_code: 'WF03', node_name: 'Authorize User' };
  const replayOne = handleWorkflowError({ ...base, context: { ...stableContext, execution_id: 'exec-one' } });
  const replayTwo = handleWorkflowError({ ...base, context: { ...stableContext, execution_id: 'exec-two' } });
  assert.equal(replayOne.error_id, replayTwo.error_id);
});

test('WF02 error_id follows the approved SHA-256 vector in pure logic and generated Code node', () => {
  const context = { request_id: 'req-vector', operation_id: 'op-vector', workflow_code: 'WF03', node_name: 'Authorize User' };
  const input = { error: { error_code: 'USER_NOT_ACTIVE', error_class: 'AUTHORIZATION' }, context, policy: {}, now: '2026-09-29T00:00:00.000Z' };
  const expected = 'err-4d9d735b3d3870f227e5c4ec9871632d91e709648caca371422aee1e952a3b9b';

  assert.equal(handleWorkflowError(input).error_id, expected);
  assert.equal(normalize(input).error_id, expected);
});

test('WF02 retains allowlisted caller identity and reply routing while excluding nested secrets', () => {
  const result = normalize({
    error: { error_code: 'USER_NOT_ACTIVE', error_class: 'AUTHORIZATION' },
    context: { execution_id: 'exec-7', request_id: 'req-7', operation_id: 'op-7', workflow_code: 'WF03', node_name: 'Authorize User', branch_id: 'BR1', config_snapshot_id: 'snap-2', actor_user_id: 'user-8', business_date: '2026-09-28', headers: { authorization: 'private-auth-marker' } },
    reply_target: { chat_id: '-100123', message_thread_id: '42', token: 'private-token-marker' },
  });
  const safeContext = JSON.parse(result.error_row.sanitized_context_json);
  assert.deepEqual(JSON.parse(JSON.stringify(safeContext)), { request_id: 'req-7', operation_id: 'op-7', workflow_code: 'WF03', node_name: 'Authorize User', execution_id: 'exec-7', config_snapshot_id: 'snap-2', branch_id: 'BR1', actor_user_id: 'user-8', business_date: '2026-09-28' });
  assert.deepEqual(JSON.parse(JSON.stringify(result.reply_target)), { chat_id: '-100123', message_thread_id: '42' });
  assert.equal(result.error_class, 'AUTHORIZATION');
  const exposed = JSON.stringify({ result, safeContext });
  assert.equal(exposed.includes('private-auth-marker'), false);
  assert.equal(exposed.includes('private-token-marker'), false);
});
