import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { buildWorkflow } from '../../tools/kiem-ke-bia-v2/build-workflows.mjs';
import { openInventorySession } from '../../src/kiem-ke-bia-v2/logic/wf05-open-session.mjs';

const now = '2026-09-29T09:00:00.000Z';
const makeEnvelope = (branchId = 'branch-1', operationId = `op-${branchId}`) => ({
  envelope_version: 'v2',
  request_id: `req-${operationId}`,
  operation_id: operationId,
  idempotency_key: `idem-${operationId}`,
  event_type: 'OPEN_INVENTORY_SESSION',
  branch_id: branchId,
  actor_user_id: 'user-1',
  business_date: '2026-09-29',
  config_version: 7,
  config_snapshot_id: 'snapshot-7',
  payload: {},
});

const snapshot = {
  config_version: 7,
  config_snapshot_id: 'snapshot-7',
  config_fingerprint: 'fingerprint-7',
  branch_scope: 'branch-1',
  config_tables: { CONFIG_GLOBAL: [{ config_key: 'inventory_session_ttl_minutes', config_value: '60', value_type: 'NUMBER', scope: 'GLOBAL', trang_thai: 'ACTIVE' }] },
};

const catalog = [
  { item_id: 'beer-1', item_code: 'B001', item_name: 'Synthetic Lager', inventory_unit: 'bottle', tracked: true, ordinal: 1, trang_thai: 'ACTIVE' },
  { item_id: 'beer-2', item_code: 'B002', item_name: 'Inactive Beer', inventory_unit: 'can', tracked: true, ordinal: 2, trang_thai: 'INACTIVE' },
  { item_id: 'other-1', item_code: 'O001', item_name: 'Not Counted', inventory_unit: 'unit', tracked: false, ordinal: 3, trang_thai: 'ACTIVE' },
];

function runCodeNode(node, namedItems, inputItems = [{ json: {} }]) {
  const lookup = (name) => ({ first: () => namedItems[name]?.[0] ?? null });
  const FixedDate = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return Date.parse(now); }
  };
  const code = new vm.Script(['(function(){', node.parameters.jsCode, '})'].join('\n'), { filename: node.name });
  return code.runInNewContext({
    Date: FixedDate,
    $input: { first: () => inputItems[0] ?? null },
    $items: (name) => namedItems[name] ?? [],
    $: lookup,
  })();
}

test('WF05 rejects a second active session for the same branch', () => {
  const result = openInventorySession({
    envelope: makeEnvelope(),
    activeSessions: [{ session_id: 'existing-1', branch_id: 'branch-1', status: 'ACTIVE_SESSION', write_state: 'COMMITTED', operation_id: 'op-existing' }],
    catalog,
    snapshot,
    now,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'SESSION_ALREADY_ACTIVE');
  assert.equal(result.error_class, 'CONFLICT');
  assert.equal(result.active_session_id, 'existing-1');
});

test('WF05 permits another branch while preserving the first branch session', () => {
  const result = openInventorySession({
    envelope: makeEnvelope('branch-2', 'op-branch-2'),
    activeSessions: [{ session_id: 'existing-1', branch_id: 'branch-1', status: 'ACTIVE_SESSION', write_state: 'COMMITTED', operation_id: 'op-existing' }],
    catalog,
    snapshot: { ...snapshot, branch_scope: 'branch-2' },
    now,
  });

  assert.equal(result.ok, true);
  assert.equal(result.session.branch_id, 'branch-2');
  assert.equal(result.session.status, 'ACTIVE_SESSION');
  assert.equal(result.session.session_revision, 0);
  assert.equal(result.session.operation_id, 'op-branch-2');
});

test('WF05 stores an immutable catalog/config snapshot and omits inactive or untracked items', () => {
  const inputCatalog = structuredClone(catalog);
  const result = openInventorySession({ envelope: makeEnvelope(), activeSessions: [], catalog: inputCatalog, snapshot, now });

  assert.equal(result.ok, true);
  const storedSnapshot = JSON.parse(result.session.snapshot_json);
  assert.equal(storedSnapshot.config_snapshot_id, 'snapshot-7');
  assert.equal(storedSnapshot.config_fingerprint, 'fingerprint-7');
  assert.deepEqual(storedSnapshot.catalog.map((item) => item.item_id), ['beer-1']);
  inputCatalog[0].item_name = 'Mutated after open';
  assert.equal(JSON.parse(result.session.snapshot_json).catalog[0].item_name, 'Synthetic Lager');
  assert.deepEqual(result.data.catalog.map((item) => item.item_id), ['beer-1']);
});

test('same-operation replay returns its session instead of conflicting with itself', () => {
  const prior = openInventorySession({ envelope: makeEnvelope(), activeSessions: [], catalog, snapshot, now });
  const replay = openInventorySession({ envelope: makeEnvelope(), activeSessions: [prior.session], catalog, snapshot, now });

  assert.equal(replay.ok, true);
  assert.equal(replay.replay, true);
  assert.equal(replay.session.session_id, prior.session.session_id);
});

test('WF05 rejects a mismatched config snapshot and an empty tracked catalog', () => {
  const mismatch = openInventorySession({ envelope: makeEnvelope(), activeSessions: [], catalog, snapshot: { ...snapshot, config_snapshot_id: 'other-snapshot' }, now });
  const emptyCatalog = openInventorySession({ envelope: makeEnvelope(), activeSessions: [], catalog: catalog.slice(1), snapshot, now });

  assert.equal(mismatch.error_code, 'CONFIG_SNAPSHOT_MISMATCH');
  assert.equal(emptyCatalog.error_code, 'CONFIG_CATALOG_EMPTY');
});

test('WF05 rejects missing, duplicate, zero, fractional, and non-numeric session TTL configuration', () => {
  const invalidTables = [
    [],
    [
      { config_key: 'inventory_session_ttl_minutes', config_value: '60', value_type: 'NUMBER', scope: 'GLOBAL', trang_thai: 'ACTIVE' },
      { config_key: 'inventory_session_ttl_minutes', config_value: '90', value_type: 'NUMBER', scope: 'GLOBAL', trang_thai: 'ACTIVE' },
    ],
    [{ config_key: 'inventory_session_ttl_minutes', config_value: '0', value_type: 'NUMBER', scope: 'GLOBAL', trang_thai: 'ACTIVE' }],
    [{ config_key: 'inventory_session_ttl_minutes', config_value: '1.5', value_type: 'NUMBER', scope: 'GLOBAL', trang_thai: 'ACTIVE' }],
    [{ config_key: 'inventory_session_ttl_minutes', config_value: 'later', value_type: 'NUMBER', scope: 'GLOBAL', trang_thai: 'ACTIVE' }],
    [{ config_key: 'inventory_session_ttl_minutes', config_value: '60', value_type: 'TEXT', scope: 'GLOBAL', trang_thai: 'ACTIVE' }],
  ];

  for (const rows of invalidTables) {
    const result = openInventorySession({
      envelope: makeEnvelope(), activeSessions: [], catalog,
      snapshot: { ...snapshot, config_tables: { CONFIG_GLOBAL: rows } }, now,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error_code, 'CONFIG_SESSION_TTL_INVALID');
  }
});

test('WF05 computes one UTC expiry from the snapshotted session TTL and preserves it in the snapshot', () => {
  const result = openInventorySession({ envelope: makeEnvelope(), activeSessions: [], catalog, snapshot, now });

  assert.equal(result.ok, true);
  assert.equal(result.session.expires_at, '2026-09-29T10:00:00.000Z');
  assert.equal(result.state.expires_at, '2026-09-29T10:00:00.000Z');
  assert.equal(JSON.parse(result.session.snapshot_json).session_ttl_minutes, 60);
});

test('WF05 allows a new session after an old session expires without mutating the old row', () => {
  const expired = { session_id: 'expired-1', branch_id: 'branch-1', status: 'ACTIVE_SESSION', expires_at: '2026-09-29T08:59:59.999Z', operation_id: 'old-op' };
  const result = openInventorySession({ envelope: makeEnvelope(), activeSessions: [expired], catalog, snapshot, now });

  assert.equal(result.ok, true);
  assert.equal(result.session.expires_at, '2026-09-29T10:00:00.000Z');
  assert.equal(expired.status, 'ACTIVE_SESSION');
  assert.equal(expired.expires_at, '2026-09-29T08:59:59.999Z');
});

test('WF05 is built as an inactive worker with typed input, one read node per sheet, and journal commit nodes', () => {
  const workflow = buildWorkflow('WF05');
  const names = workflow.nodes.map((node) => node.name);
  const readSheets = workflow.nodes
    .filter((node) => node.type === 'n8n-nodes-base.googleSheets' && node.parameters.operation === 'read')
    .map((node) => node.parameters.sheetName.value);

  assert.equal(workflow.active, false);
  assert.deepEqual(workflow.nodes[0].parameters.workflowInputs.values, [{ name: 'envelope', type: 'object' }]);
  assert.deepEqual(readSheets.sort(), ['OPERATION', 'PHIEN_KIEM_KE', 'STATE_CHO'].sort());
  assert.equal(new Set(readSheets).size, readSheets.length);
  assert.ok(workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.googleSheets'
    && node.parameters.operation === 'read').every((node) => node.executeOnce === true));
  assert.ok(names.includes('Append WF05 Prepared Operation'));
  assert.ok(names.includes('Append WF05 Committed Operation'));
  assert.ok(names.includes('Return WF05 Result'));
  const normalizeNode = workflow.nodes.find((node) => node.name === 'Normalize WF05 Input');
  const [normalized] = runCodeNode(normalizeNode, {}, [{ json: { envelope: makeEnvelope() } }]);
  assert.ok(normalized.json.envelope.payload.required_sheet_names.includes('CONFIG_GLOBAL'));
  assert.match(workflow.nodes.find((node) => node.name === 'Build WF05 Open Session Transaction').parameters.jsCode, /prepareOperation/);
  for (const node of workflow.nodes.filter((entry) => entry.type === 'n8n-nodes-base.code')) {
    assert.doesNotThrow(() => new vm.Script(['(function(){', node.parameters.jsCode, '})'].join('\n'), { filename: node.name }));
  }
});

test('generated WF05 transaction prepares child operation, branch session rows, and a commit decision', () => {
  const workflow = buildWorkflow('WF05');
  const transactionNode = workflow.nodes.find((node) => node.name === 'Build WF05 Open Session Transaction');
  const commitNode = workflow.nodes.find((node) => node.name === 'Decide WF05 Journal Commit');
  const rootEnvelope = makeEnvelope();
  const namedItems = {
    'Normalize WF05 Input': [{ json: { envelope: rootEnvelope } }],
    'Call WF01 Config Gateway': [{ json: {
      ok: true, status: 'OK', config_version: 7, config_snapshot_id: 'snapshot-7',
      config_fingerprint: 'fingerprint-7', branch_scope: 'branch-1',
      data: { config_tables: { CONFIG_BIA: catalog, ...snapshot.config_tables } },
    } }],
    'Read OPERATION': [],
    'Read PHIEN_KIEM_KE': [],
    'Read STATE_CHO': [],
  };

  const [built] = runCodeNode(transactionNode, namedItems);
  assert.equal(built.json.ok, true);
  assert.equal(built.json.operation.workflow_code, 'WF05');
  assert.equal(built.json.operation.parent_operation_id, rootEnvelope.operation_id);
  assert.notEqual(built.json.operation.operation_id, rootEnvelope.operation_id);
  assert.equal(built.json.session.operation_id, built.json.operation.operation_id);
  assert.equal(built.json.session.expires_at, '2026-09-29T10:00:00.000Z');
  assert.deepEqual(JSON.parse(JSON.stringify(built.json.required_writes)), ['OPERATION_PREPARED', 'PHIEN_KIEM_KE', 'STATE_CHO', 'EVENT_LOG', 'PHIEN_KIEM_KE_COMMIT_STATE']);

  namedItems['Build WF05 Open Session Transaction'] = [{ json: built.json }];
  const [commit] = runCodeNode(commitNode, namedItems);
  assert.equal(commit.json.ok, true);
  assert.equal(commit.json.committed, true);
  assert.equal(commit.json.operation.status, 'COMMITTED');
});

test('generated WF05 transaction resolves a committed replay without a second session write plan', () => {
  const workflow = buildWorkflow('WF05');
  const transactionNode = workflow.nodes.find((node) => node.name === 'Build WF05 Open Session Transaction');
  const rootEnvelope = makeEnvelope();
  const initial = {
    'Normalize WF05 Input': [{ json: { envelope: rootEnvelope } }],
    'Call WF01 Config Gateway': [{ json: {
      ok: true, status: 'OK', config_version: 7, config_snapshot_id: 'snapshot-7',
      config_fingerprint: 'fingerprint-7', branch_scope: 'branch-1', data: { config_tables: { CONFIG_BIA: catalog, ...snapshot.config_tables } },
    } }],
    'Read OPERATION': [], 'Read PHIEN_KIEM_KE': [], 'Read STATE_CHO': [],
  };
  const [created] = runCodeNode(transactionNode, initial);
  const committedOperation = { ...created.json.operation, status: 'COMMITTED', commit_state: 'COMMITTED' };
  const committedSession = { ...created.json.session, write_state: 'COMMITTED' };
  const replayInput = {
    ...initial,
    'Read OPERATION': [{ json: committedOperation }],
    'Read PHIEN_KIEM_KE': [{ json: committedSession }],
  };

  const [replay] = runCodeNode(transactionNode, replayInput);
  assert.equal(replay.json.ok, true);
  assert.equal(replay.json.status, 'COMMITTED');
  assert.equal(replay.json.replay, true);
  assert.equal(replay.json.data.session_id, created.json.data.session_id);
  assert.deepEqual(JSON.parse(JSON.stringify(replay.json.rows)), {});
});
