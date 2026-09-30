import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { buildWorkflow } from '../../tools/kiem-ke-bia-v2/build-workflows.mjs';
import { acceptInventoryCount } from '../../src/kiem-ke-bia-v2/logic/wf06-count-intake.mjs';

const now = '2026-09-29T10:00:00.000Z';
const rules = { item_id: 'beer-1', item_code: 'B001', item_name: 'Synthetic Lager', inventory_unit: 'bottle', decimal_places: 2, quantity_step: 0.25, minimum_quantity: 0, maximum_quantity: 200 };
const envelope = { request_id: 'req-count-1', operation_id: 'op-count-1', idempotency_key: 'idem-count-1', event_type: 'INVENTORY_COUNT', branch_id: 'branch-1', actor_user_id: 'user-1', business_date: '2026-09-29', config_snapshot_id: 'snapshot-7' };
const session = (overrides = {}) => ({ session_id: 'session-1', branch_id: 'branch-1', business_date: '2026-09-29', config_snapshot_id: 'snapshot-7', status: 'ACTIVE_SESSION', session_revision: 0, expires_at: '2026-09-29T11:00:00.000Z', snapshot_json: JSON.stringify({ config_snapshot_id: 'snapshot-7', catalog: [rules] }), ...overrides });
const count = (payload = {}, options = {}) => acceptInventoryCount({ envelope, session: session(options.session), currentCounts: options.currentCounts ?? [], payload: { action: 'COUNT', session_id: 'session-1', item_id: 'beer-1', quantity: 1.25, expected_revision: 0, idempotency_key: envelope.idempotency_key, ...payload }, now: options.now ?? now });

function runGeneratedDecision({ payload, stateRows = [{ state_id: 'session-1', branch_id: 'branch-1', topic_type: 'INVENTORY_SESSION', status: 'ACTIVE_SESSION', operation_id: 'op-open' }], countRows = [], operationRows = [] }) {
  const workflow = buildWorkflow('WF06');
  const code = workflow.nodes.find((node) => node.name === 'Build WF06 Count Decision').parameters.jsCode;
  const namedItems = {
    'Normalize WF06 Input': [{ json: { envelope: { ...envelope, payload } } }],
    'Call WF01 Config Gateway': [{ json: { ok: true, config_version: 7, config_snapshot_id: 'snapshot-7' } }],
    'Read OPERATION': [{ json: { operation_id: 'op-open', request_id: 'req-open', event_type: 'OPEN_SESSION', idempotency_key: 'idem-open', branch_id: 'branch-1', config_snapshot_id: 'snapshot-7', workflow_code: 'WF05', status: 'COMMITTED', commit_state: 'COMMITTED' } }, ...operationRows.map((json) => ({ json }))],
    'Read PHIEN_KIEM_KE': [{ json: { ...session(), operation_id: 'op-open' } }],
    'Read BIA_LOG': countRows.map((json) => ({ json })),
    'Read STATE_CHO': stateRows.map((json) => ({ json })),
  };
  const lookup = (name) => ({ first: () => namedItems[name]?.[0] ?? null });
  const FixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return Date.parse(now); }
  };
  const script = new vm.Script(`(function(){\n${code}\n})`, { filename: 'Build WF06 Count Decision' });
  return script.runInNewContext({ Date: FixedDate, $: lookup, $items: (name) => namedItems[name] ?? [], $input: { first: () => ({ json: {} }) } })()[0].json;
}

test('WF06 accepts an intentional zero and prepares one append-only count version', () => {
  const result = count({ quantity: 0 });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'PREPARED');
  assert.equal(result.rows.BIA_LOG[0].ton_thuc_te, 0);
  assert.equal(result.rows.BIA_LOG[0].revision, 1);
  assert.equal(result.rows.PHIEN_KIEM_KE, undefined);
});

test('WF06 rejects blank count without producing any write rows', () => {
  const result = count({ quantity: '   ' });

  assert.equal(result.error_code, 'COUNT_BLANK');
  assert.deepEqual(result.rows, {});
});

test('WF06 rejects negative count without producing any write rows', () => {
  const result = count({ quantity: '-0.25' });

  assert.equal(result.error_code, 'COUNT_NEGATIVE');
  assert.deepEqual(result.rows, {});
});

test('WF06 enforces the item decimal-place limit without rounding', () => {
  const result = count({ quantity: '1.234' });

  assert.equal(result.error_code, 'COUNT_PRECISION_INVALID');
  assert.deepEqual(result.rows, {});
});

test('WF06 enforces the configured input step exactly', () => {
  const result = count({ quantity: '1.10' });

  assert.equal(result.error_code, 'COUNT_STEP_INVALID');
  assert.deepEqual(result.rows, {});
});

test('WF06 enforces configured minimum and maximum bounds', () => {
  const below = count({ quantity: '-0.25' });
  const above = count({ quantity: '200.25' });

  assert.equal(below.error_code, 'COUNT_NEGATIVE');
  assert.equal(above.error_code, 'COUNT_OUT_OF_BOUNDS');
  assert.deepEqual(above.rows, {});
});

test('WF06 rejects incomplete or conflicting item count rules as configuration errors', () => {
  const missingStep = count({}, { session: session({ snapshot_json: JSON.stringify({ config_snapshot_id: 'snapshot-7', catalog: [{ ...rules, quantity_step: null }] }) }) });
  const excludesZero = count({}, { session: session({ snapshot_json: JSON.stringify({ config_snapshot_id: 'snapshot-7', catalog: [{ ...rules, minimum_quantity: 1 }] }) }) });

  assert.equal(missingStep.error_code, 'CONFIG_COUNT_RULES_INVALID');
  assert.equal(excludesZero.error_code, 'CONFIG_COUNT_RULES_INVALID');
  assert.deepEqual(missingStep.rows, {});
});

test('WF06 rejects an action based on a stale session revision', () => {
  const result = count({ expected_revision: 0 }, { session: session({ session_revision: 3 }) });

  assert.equal(result.error_code, 'REVISION_CONFLICT');
  assert.equal(result.current_revision, 3);
  assert.deepEqual(result.rows, {});
});

test('WF06 requires an explicit non-negative integer revision instead of coercing null or blank to zero', () => {
  const nullRevision = count({ expected_revision: null });
  const blankRevision = count({ expected_revision: '' });
  const booleanRevision = count({ expected_revision: true });

  assert.equal(nullRevision.error_code, 'REVISION_REQUIRED');
  assert.equal(blankRevision.error_code, 'REVISION_REQUIRED');
  assert.equal(booleanRevision.error_code, 'REVISION_REQUIRED');
  assert.deepEqual(nullRevision.rows, {});
});

test('WF06 rejects expired sessions without changing count history or state', () => {
  const historical = [{ entry_id: 'entry-old', session_id: 'session-1', ma_bia: 'B001', ton_thuc_te: 1, revision: 1, status: 'COMMITTED' }];
  const result = count({}, { session: session({ expires_at: now }), currentCounts: historical });

  assert.equal(result.error_code, 'SESSION_EXPIRED');
  assert.deepEqual(result.rows, {});
  assert.equal(historical.length, 1);
});

test('WF06 preview is read-only and does not commit count or session state', () => {
  const result = count({ action: 'PREVIEW' });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'PREVIEW');
  assert.deepEqual(result.rows, {});
  assert.equal(result.should_call_wf07, false);
});

test('WF06 only finalizes after an explicit action and a complete count set', () => {
  const missing = count({ action: 'FINALIZE' });
  const complete = count({ action: 'FINALIZE', expected_revision: 1 }, {
    currentCounts: [{ entry_id: 'entry-1', session_id: 'session-1', ma_bia: 'B001', ton_thuc_te: 0, revision: 1, status: 'COMMITTED' }],
  });

  assert.equal(missing.error_code, 'COUNT_INCOMPLETE');
  assert.equal(missing.should_call_wf07, false);
  assert.equal(complete.ok, true);
  assert.equal(complete.status, 'PREPARED');
  assert.equal(complete.rows.PHIEN_KIEM_KE[0].status, 'CLOSED');
  assert.equal(complete.should_call_wf07, true);
});

test('WF06 treats a replay of the same count identity as a no-write replay', () => {
  const previous = { entry_id: 'entry-1', session_id: 'session-1', ma_bia: 'B001', ton_thuc_te: 1.25, revision: 1, idempotency_key: 'idem-count-1', status: 'COMMITTED' };
  const result = count({}, { currentCounts: [previous] });

  assert.equal(result.ok, true);
  assert.equal(result.replay, true);
  assert.deepEqual(result.rows, {});
});

test('WF06 resumes a pending count with the same payload but rejects a changed payload under that identity', () => {
  const pending = { entry_id: 'entry-pending-1', session_id: 'session-1', ma_bia: 'B001', ton_thuc_te: 1.25, revision: 1, idempotency_key: 'idem-count-1', status: 'PREPARED', write_state: 'PREPARED', operation_id: 'op-count-1' };
  const resume = count({}, { currentCounts: [pending] });
  const changed = count({ quantity: 1.5 }, { currentCounts: [pending] });
  const differentOperation = count({}, { currentCounts: [{ ...pending, operation_id: 'op-count-other' }] });

  assert.equal(resume.ok, true);
  assert.equal(resume.status, 'PREPARED');
  assert.equal(resume.rows.BIA_LOG[0].entry_id, 'entry-pending-1');
  assert.equal(changed.error_code, 'COUNT_IDEMPOTENCY_CONFLICT');
  assert.equal(Object.keys(changed.rows).length, 0);
  assert.equal(differentOperation.error_code, 'COUNT_IDEMPOTENCY_CONFLICT');
});

test('generated WF06 is inactive, reads each required sheet once, and calls WF07 only after finalize', () => {
  const workflow = buildWorkflow('WF06');
  const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
  const requiredReads = ['OPERATION', 'PHIEN_KIEM_KE', 'BIA_LOG', 'STATE_CHO'];
  const reconcileGate = byName.get('WF06 Should Reconcile');

  assert.equal(workflow.active, false);
  for (const sheet of requiredReads) {
    const nodes = workflow.nodes.filter((node) => node.name === `Read ${sheet}`);
    assert.equal(nodes.length, 1, `${sheet} read count`);
    assert.equal(nodes[0].executeOnce, true, `${sheet} executes once`);
  }
  assert.ok(byName.has('Call WF07 Reconcile and Close'));
  assert.equal(byName.get('Call WF07 Reconcile and Close').parameters.options.waitForSubWorkflow, true);
  assert.ok(byName.has('Append WF06 Prepared Operation'));
  assert.ok(byName.has('Append WF06 Committed Operation'));
  assert.ok(byName.has('Upsert WF06 BIA_LOG'));
  assert.ok(byName.has('Upsert WF06 EVENT_LOG'));
  const countWriter = workflow.nodes.find((node) => node.type === 'n8n-nodes-base.googleSheets' && node.parameters.sheetName?.value === 'BIA_LOG' && node.parameters.operation !== 'read');
  assert.equal(countWriter.parameters.operation, 'appendOrUpdate');
  assert.deepEqual(countWriter.parameters.columns.matchingColumns, ['entry_id']);
  const eventWriter = workflow.nodes.find((node) => node.type === 'n8n-nodes-base.googleSheets' && node.parameters.sheetName?.value === 'EVENT_LOG' && node.parameters.operation !== 'read');
  assert.equal(eventWriter.parameters.operation, 'appendOrUpdate');
  assert.deepEqual(eventWriter.parameters.columns.matchingColumns, ['event_id']);
  assert.match(reconcileGate.parameters.conditions.conditions[0].leftValue, /should_call_wf07 === true/);
  assert.deepEqual(workflow.connections[reconcileGate.name].main[0].map((edge) => edge.node), ['Prepare WF07 Input']);
  assert.deepEqual(workflow.connections[reconcileGate.name].main[1].map((edge) => edge.node), ['Return WF06 Result']);
  assert.deepEqual(workflow.connections['Call WF07 Reconcile and Close'].main[0].map((edge) => edge.node), ['Return WF06 Result']);
  for (const node of workflow.nodes.filter((entry) => entry.type === 'n8n-nodes-base.code')) {
    assert.doesNotThrow(() => new vm.Script(`(function(){\n${node.parameters.jsCode}\n})`, { filename: node.name }), node.name);
  }
});

test('generated WF06 validates against the committed session and frozen item rules before preparing writes', () => {
  const result = runGeneratedDecision({ payload: { action: 'COUNT', session_id: 'session-1', item_id: 'beer-1', quantity: '1.25', expected_revision: 0, idempotency_key: 'idem-count-1' } });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'PREPARED');
  assert.equal(result.should_call_wf07, false);
  assert.equal(result.rows.BIA_LOG[0].ton_thuc_te, 1.25);
  assert.equal(result.rows.BIA_LOG[0].status, 'PREPARED');
  assert.equal(result.operation.workflow_code, 'WF06');
});

test('generated WF06 refuses writes when the committed session state row is missing', () => {
  const result = runGeneratedDecision({ payload: { action: 'COUNT', session_id: 'session-1', item_id: 'beer-1', quantity: 1.25, expected_revision: 0, idempotency_key: 'idem-count-1' }, stateRows: [] });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'SESSION_STATE_INCONSISTENT');
  assert.equal(Object.keys(result.rows).length, 0);
});

test('generated WF06 detects an uncommitted partial write and resumes through the same entry key', () => {
  const pendingOperation = { operation_id: 'op-count-1', request_id: envelope.request_id, event_type: envelope.event_type, idempotency_key: envelope.idempotency_key, branch_id: envelope.branch_id, actor_user_id: envelope.actor_user_id, business_date: envelope.business_date, config_snapshot_id: envelope.config_snapshot_id, workflow_code: 'WF06', status: 'PREPARED', commit_state: 'PREPARED' };
  const pendingCount = { entry_id: 'entry-pending-1', session_id: 'session-1', branch_id: 'branch-1', business_date: '2026-09-29', config_snapshot_id: 'snapshot-7', ma_bia: 'B001', ten_bia: 'Synthetic Lager', don_vi_dem: 'bottle', ton_thuc_te: 1.25, revision: 1, idempotency_key: 'idem-count-1', operation_id: 'op-count-1', status: 'COMMITTED', write_state: 'COMMITTED' };
  const result = runGeneratedDecision({
    payload: { action: 'COUNT', session_id: 'session-1', item_id: 'beer-1', quantity: 1.25, expected_revision: 0, idempotency_key: 'idem-count-1' },
    countRows: [pendingCount],
    operationRows: [pendingOperation],
  });
  const changedPayload = runGeneratedDecision({
    payload: { action: 'COUNT', session_id: 'session-1', item_id: 'beer-1', quantity: 1.5, expected_revision: 0, idempotency_key: 'idem-count-1' },
    countRows: [pendingCount],
    operationRows: [pendingOperation],
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'PREPARED');
  assert.equal(result.replay, true);
  assert.equal(result.rows.BIA_LOG[0].entry_id, 'entry-pending-1');
  assert.equal(result.rows.BIA_LOG[0].revision, 1);
  assert.equal(changedPayload.error_code, 'COUNT_IDEMPOTENCY_CONFLICT');
  assert.equal(Object.keys(changedPayload.rows).length, 0);
});
