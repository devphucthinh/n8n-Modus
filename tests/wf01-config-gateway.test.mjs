import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { schemaManifest } from '../tools/kiem-ke-bia-v2/schema-manifest.mjs';
import * as workflowBuilder from '../tools/kiem-ke-bia-v2/build-workflows.mjs';

const { buildWF01Workflow } = workflowBuilder;


test('CONFIG_SNAPSHOT workbook contract stores normalized configuration content', () => {
  const snapshot = schemaManifest.sheets.find((sheet) => sheet.name === 'CONFIG_SNAPSHOT');
  assert.ok(snapshot.headers.includes('normalized_config_json'));
  assert.ok(snapshot.headers.includes('config_fingerprint'));
  assert.ok(snapshot.headers.includes('branch_scope'));
  assert.ok(!snapshot.headers.includes('snapshot_json'));
});

const logicPath = new URL('../src/kiem-ke-bia-v2/logic/wf01-config-gateway.mjs', import.meta.url);
const sourcePath = existsSync(logicPath)
  ? logicPath
  : new URL('../src/WF01_Evaluate_Config_Gateway.js', import.meta.url);
const script = readFileSync(sourcePath, 'utf8');
const scriptBoundary = 'const assembled = $input.first()?.json ?? {};';
const prefix = (script.includes(scriptBoundary) ? script.slice(0, script.indexOf(scriptBoundary)) : script)
  .replace(/^import .*;\s*$/gm, '')
  .replace(/^export\s+(?=(?:function|const|class)\b)/gm, '')
  .replace(/^export\s*\{[^}]+\};?\s*$/gm, '');

assert.ok(prefix, 'Evaluate Config Gateway source must be present in the import artifact');

function loadGateway({ withoutStructuredClone = false } = {}) {
  const context = {
    schemaManifest,
    TextEncoder,
    Uint8Array,
    Uint32Array,
    DataView,
    JSON,
    Date,
    Map,
    Set,
    Object,
    String,
    Number,
    Boolean,
    Array,
    Math,
    RegExp,
    TypeError,
    Error,
    structuredClone: withoutStructuredClone ? undefined : structuredClone,
  };
  vm.runInNewContext(`${prefix}\nthis.__gateway = { evaluateConfigGateway, normalizeEnvelope, expandSnapshotPayload, extractSheetReadOutput: typeof extractSheetReadOutput === 'function' ? extractSheetReadOutput : null, extractSheetValueRange: typeof extractSheetValueRange === 'function' ? extractSheetValueRange : null };`, context);
  return context.__gateway;
}

const definitions = Object.fromEntries(schemaManifest.sheets
  .filter((sheet) => ['CONFIG_SCHEMA', 'CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', 'CONFIG_SNAPSHOT', 'OPERATION', 'ERROR_BIA', 'CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH', 'CONFIG_CUTOVER', 'EVENT_LOG'].includes(sheet.name))
  .map((sheet) => [sheet.name, sheet.headers]));

function completeRow(sheetName, row) {
  return Object.fromEntries(definitions[sheetName].map((field) => [field, row[field] ?? '']));
}

function sheetHeaderSentinel(sheetName) {
  const headers = schemaManifest.sheets.find((sheet) => sheet.name === sheetName).headers;
  return { json: { row_number: 'row_number', ...Object.fromEntries(headers.map((header) => [header, header])) } };
}

function schemaRows() {
  return Object.entries(definitions).flatMap(([sheetName, columns]) => columns.map((columnName, ordinal) => ({
    schema_id: `schema-${sheetName}-${columnName}`,
    schema_version: '1.0',
    sheet_name: sheetName,
    field_name: columnName,
    data_type: 'STRING',
    required: 'NO',
    key_type: '',
    reference: '',
    allowed_values: '',
    ordinal: String(ordinal + 1),
    default_value: '',
    validation_rule: '',
    sensitive: 'NO',
    description: '',
    trang_thai: 'ACTIVE',
  })));
}

function acceptedVersionRow(snapshot) {
  return completeRow('CONFIG_VERSION', {
    config_version_id: `accepted-${snapshot.config_snapshot_id}`,
    config_version: snapshot.config_version,
    schema_version: snapshot.schema_version,
    maintenance_mode: 'NO',
    config_snapshot_id: snapshot.config_snapshot_id,
    generated_at: snapshot.created_at,
    content_fingerprint: snapshot.config_fingerprint,
    status: 'ACTIVE',
  });
}

function tablesWithSnapshots(snapshots) {
  return {
    __headers: Object.fromEntries(schemaManifest.sheets.map((sheet) => [sheet.name, sheet.headers])),
    CONFIG_SCHEMA: schemaRows(),
    CONFIG_VERSION: [
      completeRow('CONFIG_VERSION', { config_version_id: 'ver-1', config_version: 'v1.3', schema_version: '1.0', maintenance_mode: 'NO', generated_at: '2026-09-22T09:00:00.000Z', generated_by: 'test', source_workbook_id: 'test', source_revision: '1', content_fingerprint: '', status: 'ACTIVE', notes: 'test' }),
      ...snapshots.filter((snapshot) => ['PREPARED', 'COMMITTED'].includes(snapshot.status)).map(acceptedVersionRow),
    ],
    CONFIG_GLOBAL: [],
    CONFIG_BRANCH: [],
    CONFIG_USER: [],
    CONFIG_THONG_BAO: [],
    CONFIG_SNAPSHOT: snapshots.map((snapshot) => completeRow('CONFIG_SNAPSHOT', snapshot)),
    OPERATION: snapshots.map((snapshot) => completeRow('OPERATION', {
      operation_id: snapshot.operation_id,
      request_id: snapshot.operation_id,
      event_type: 'READ_STATUS',
      idempotency_key: snapshot.operation_id,
      status: 'COMMITTED',
      commit_state: 'COMMITTED',
      workflow_code: 'WF01',
      config_version: snapshot.config_version,
      config_snapshot_id: snapshot.config_snapshot_id,
      created_at: snapshot.created_at,
      updated_at: snapshot.created_at,
    })),
    ERROR_BIA: [],
    CONFIG_ROLE: [],
    CONFIG_PERMISSION: [],
    CONFIG_USER_ROLE: [],
    CONFIG_ROLE_PERMISSION: [],
    CONFIG_TOPIC: [],
    CONFIG_LENH: [],
    EVENT_LOG: [],
  };
}

test('WF01 pure gateway logic is a dedicated source module', () => {
  assert.equal(existsSync(logicPath), true);
});

test('WF01 builder reads each required sheet once and persists in commit order', () => {
  const workflow = buildWF01Workflow();
  const reads = workflow.nodes.filter((node) => node.name.startsWith('Read '));
  const readNames = reads.map((node) => node.name.slice('Read '.length));
  const expectedReadNames = [...new Set([...schemaManifest.sheets.filter((sheet) => sheet.group === 'config').map((sheet) => sheet.name), 'CONFIG_SNAPSHOT', 'OPERATION', 'ERROR_BIA', 'EVENT_LOG'])];
  assert.deepEqual(readNames, expectedReadNames);
  assert.equal(new Set(readNames).size, readNames.length);
  assert.equal(reads.every((node) => node.type === 'n8n-nodes-base.httpRequest'
    && node.parameters.method === 'GET'
    && node.parameters.authentication === 'predefinedCredentialType'
    && node.parameters.nodeCredentialType === 'googleSheetsOAuth2Api'
    && node.parameters.sendQuery === true
    && node.parameters.options.response.response.responseFormat === 'json'
    && JSON.stringify(Object.keys(node.credentials ?? {})) === JSON.stringify(['googleSheetsOAuth2Api'])
    && node.credentials.googleSheetsOAuth2Api.name === 'GOOGLE_SHEETS_KKB_V2'
    && node.executeOnce === true), true);
  assert.equal(reads.every((node) => {
    const query = Object.fromEntries((node.parameters.queryParameters?.parameters ?? []).map(({ name, value }) => [name, value]));
    return query.majorDimension === 'ROWS'
      && query.valueRenderOption === 'UNFORMATTED_VALUE'
      && query.dateTimeRenderOption === 'FORMATTED_STRING';
  }), true);
  assert.equal(reads.length, new Set(readNames).size);
  assert.equal(workflow.nodes.some((node) => node.type === 'n8n-nodes-base.googleSheets' && node.parameters.operation === 'read'), false);
  assert.equal(reads.every((node) => node.parameters.url.includes('/v4/spreadsheets/GOOGLE_SHEET_ID_CONFIGURE/values/')), true);

  const alwaysReadNames = new Set(['CONFIG_SCHEMA', 'CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', 'CONFIG_SNAPSHOT', 'OPERATION', 'ERROR_BIA', 'CONFIG_CUTOVER']);
  const optionalReadNames = expectedReadNames.filter((name) => !alwaysReadNames.has(name));
  const readGates = workflow.nodes.filter((node) => node.name.startsWith('WF01 Read ') && node.name.endsWith(' Requested'));
  assert.deepEqual(readGates.map((node) => node.name.slice('WF01 Read '.length, -' Requested'.length)), optionalReadNames);
  for (const name of optionalReadNames) {
    const gateName = `WF01 Read ${name} Requested`;
    const readName = `Read ${name}`;
    const gate = workflow.nodes.find((node) => node.name === gateName);
    const condition = gate.parameters.conditions.conditions[0];
    assert.match(condition.leftValue, /required_sheet_names/);
    assert.match(condition.leftValue, new RegExp(name));
    const readIndex = readNames.indexOf(name);
    const nextReadName = readNames[readIndex + 1] ?? null;
    const continuation = nextReadName && !alwaysReadNames.has(nextReadName)
      ? `WF01 Read ${nextReadName} Requested`
      : nextReadName ? `Read ${nextReadName}` : 'Evaluate WF01 Configuration';
    assert.equal(workflow.connections[gateName].main[0][0].node, readName);
    assert.equal(workflow.connections[gateName].main[1][0].node, continuation);
    assert.equal(workflow.connections[readName].main[0][0].node, continuation);
  }

  const evaluate = workflow.nodes.find((node) => node.name === 'Evaluate WF01 Configuration');
  assert.ok(evaluate.parameters.jsCode.includes('evaluateConfigGateway'));
  assert.ok(evaluate.parameters.jsCode.includes("extractSheetValueRange($items('Read ' + name)[0]?.json, name)"));
  assert.ok(evaluate.parameters.jsCode.includes('tables.__headers = headers'));
  assert.equal(readFileSync(new URL('../src/WF01_Evaluate_Config_Gateway.js', import.meta.url), 'utf8').trimEnd(), evaluate.parameters.jsCode);
  assert.doesNotThrow(() => new vm.Script(`(function () {\n${evaluate.parameters.jsCode}\n})`));
  const orderedWrites = workflow.nodes.filter((node) => node.name.startsWith('WF01 Prepare') || node.name.startsWith('WF01 Append') || node.name.startsWith('WF01 Commit')).map((node) => node.name);
  assert.equal(JSON.stringify(orderedWrites), JSON.stringify([
    'WF01 Prepare OPERATION', 'WF01 Append CONFIG_VERSION', 'WF01 Append CONFIG_SNAPSHOT', 'WF01 Commit OPERATION',
  ]));
  assert.equal(workflow.nodes.some((node) => node.name === 'Upsert CONFIG_VERSION'), false);
  const versionAppend = workflow.nodes.find((node) => node.name === 'WF01 Append CONFIG_VERSION');
  assert.equal(versionAppend.parameters.operation, 'append');
  const operationWrites = workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.googleSheets' && node.parameters.operation !== 'read' && node.parameters.sheetName.value === 'OPERATION');
  assert.equal(operationWrites.every((node) => node.parameters.columns.matchingColumns?.[0] === 'idempotency_key'), true);
  const versionGuard = workflow.connections['WF01 Has Append CONFIG_VERSION'].main;
  assert.equal(versionGuard[0][0].node, 'WF01 Map Append CONFIG_VERSION');
  assert.equal(versionGuard[1][0].node, 'Append CONFIG_SNAPSHOT');
  assert.equal(workflow.connections['WF01 Commit OPERATION'].main[0][0].node, 'Return WF01 Result');
  assert.equal(workflow._kkb_v2.implementation_status, 'IMPLEMENTED_TEST_ONLY');
});

test('non-WF01 builders retain their existing Google Sheets read nodes', () => {
  for (const code of ['WF02', 'WF04', 'WF05']) {
    const workflow = workflowBuilder.buildWorkflow(code);
    const reads = workflow.nodes.filter((node) => node.name.startsWith('Read '));
    assert.ok(reads.length > 0, `${code} should still contain its configured sheet reads`);
    assert.equal(reads.every((node) => node.type === 'n8n-nodes-base.googleSheets'
      && node.parameters.operation === 'read'), true, `${code} should keep the existing Google Sheets read implementation`);
  }
});

test('projects OPERATION using exactly the manifest fields and commits by its idempotency key', () => {
  const gateway = loadGateway();
  const idempotencyKey = 'idem-wf01-stable';
  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-operation-projection', operation_id: 'op-operation-projection', event_type: 'CONFIG_READ', payload: { idempotency_key: idempotencyKey } },
    tables: tablesWithSnapshots([]),
    now: '2026-09-22T09:12:01.000Z',
  });
  const operationHeaders = schemaManifest.sheets.find((sheet) => sheet.name === 'OPERATION').headers;
  const prepared = result.write_plan.find((step) => step.sheet === 'OPERATION' && step.action === 'APPEND');
  const committed = result.write_plan.find((step) => step.sheet === 'OPERATION' && step.action === 'UPDATE');

  assert.deepEqual(Object.keys(prepared.row), operationHeaders);
  assert.deepEqual(Object.keys(committed.row), operationHeaders);
  assert.equal(prepared.row.idempotency_key, idempotencyKey);
  assert.equal(prepared.row.event_type, 'CONFIG_READ');
  assert.equal(prepared.row.commit_state, 'PREPARED');
  assert.equal(prepared.row.config_snapshot_id, result.response.config_snapshot_id);
  assert.equal(prepared.row.workflow_code, 'WF01');
  assert.equal(JSON.stringify(committed.match), JSON.stringify({ idempotency_key: idempotencyKey }));
});

test('writes accepted version and snapshot before the operation visibility-gate commit', () => {
  const gateway = loadGateway();
  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-commit-order', operation_id: 'op-commit-order', event_type: 'CONFIG_READ', payload: {} },
    tables: tablesWithSnapshots([]),
    now: '2026-09-22T09:12:02.000Z',
  });
  const writes = result.write_plan.map((step) => `${step.sheet}:${step.action}`);

  assert.equal(JSON.stringify(writes), JSON.stringify([
    'OPERATION:APPEND',
    'CONFIG_VERSION:APPEND',
    'CONFIG_SNAPSHOT:APPEND',
    'OPERATION:UPDATE',
  ]));
  assert.equal(result.write_plan.at(-1).patch.status, 'COMMITTED');
});

test('appends deterministic CONFIG_VERSION history without changing the operator input row', () => {
  const gateway = loadGateway();
  const tables = tablesWithSnapshots([]);
  const operatorRowBefore = { ...tables.CONFIG_VERSION[0] };
  const envelope = { request_id: 'req-version-history', operation_id: 'op-version-history', event_type: 'CONFIG_READ', payload: {} };
  const first = gateway.evaluateConfigGateway({ envelope, tables, now: '2026-09-22T09:12:03.000Z' });
  const history = first.write_plan.find((step) => step.sheet === 'CONFIG_VERSION' && step.action === 'APPEND');
  const headers = schemaManifest.sheets.find((sheet) => sheet.name === 'CONFIG_VERSION').headers;

  assert.deepEqual(Object.keys(history.row), headers);
  assert.notEqual(history.row.config_version_id, operatorRowBefore.config_version_id);
  assert.equal(history.row.config_version, operatorRowBefore.config_version);
  assert.equal(history.row.config_snapshot_id, first.response.config_snapshot_id);
  assert.equal(history.row.content_fingerprint, first.response.config_fingerprint);
  assert.equal(history.row.status, 'ACTIVE');
  assert.deepEqual(tables.CONFIG_VERSION[0], operatorRowBefore);
});

test('selects exact ACTIVE version rows and rejects a populated fingerprint mismatch', () => {
  const gateway = loadGateway();
  const tables = tablesWithSnapshots([]);
  tables.CONFIG_VERSION.push(completeRow('CONFIG_VERSION', { ...tables.CONFIG_VERSION[0], config_version_id: 'ver-prepared', status: 'PREPARED' }));
  const accepted = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-strict-version-status', operation_id: 'op-strict-version-status', event_type: 'SYSTEM', payload: {} },
    tables,
    now: '2026-09-22T09:12:04.000Z',
  });
  assert.equal(accepted.ok, true, JSON.stringify(accepted.response));

  const mismatchTables = tablesWithSnapshots([]);
  mismatchTables.CONFIG_VERSION[0].content_fingerprint = 'sha256:stale';
  const mismatch = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-version-fingerprint', operation_id: 'op-version-fingerprint', event_type: 'SYSTEM', payload: {} },
    tables: mismatchTables,
    now: '2026-09-22T09:12:05.000Z',
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.response.error_code, 'CONFIG_VERSION_FINGERPRINT_MISMATCH');
  assert.equal(mismatch.write_plan.length, 0);
});

test('does not compare predecessors from a different normalized requested-table set', () => {
  const gateway = loadGateway();
  const firstTables = tablesWithSnapshots([]);
  firstTables.CONFIG_TOPIC = [completeRow('CONFIG_TOPIC', { topic_id: 'topic-a', branch_id: 'BRANCH_A', trang_thai: 'ACTIVE' })];
  const first = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-scope-a', operation_id: 'op-scope-a', branch_id: 'BRANCH_A', event_type: 'SYSTEM', payload: { required_sheet_names: ['CONFIG_TOPIC'] } },
    tables: firstTables,
    now: '2026-09-22T09:12:06.000Z',
  });
  const firstSnapshot = first.write_plan.find((step) => step.sheet === 'CONFIG_SNAPSHOT' && step.action === 'APPEND').row;
  const secondTables = tablesWithSnapshots([{ ...firstSnapshot, status: 'COMMITTED' }]);
  secondTables.CONFIG_TOPIC = firstTables.CONFIG_TOPIC;
  secondTables.CONFIG_LENH = [completeRow('CONFIG_LENH', { command_code: 'CMD_A', branch_id: 'BRANCH_A', trang_thai: 'ACTIVE' })];
  const second = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-scope-b', operation_id: 'op-scope-b', branch_id: 'BRANCH_A', event_type: 'SYSTEM', payload: { required_sheet_names: ['CONFIG_LENH'] } },
    tables: secondTables,
    now: '2026-09-22T09:12:07.000Z',
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true, JSON.stringify(second.response));
  assert.ok(second.write_plan.some((step) => step.sheet === 'CONFIG_SNAPSHOT' && step.action === 'APPEND'));
});

test('does not compare accepted version fingerprints from a different requested-table set', () => {
  const gateway = loadGateway();
  const acceptedTables = tablesWithSnapshots([]);
  acceptedTables.CONFIG_TOPIC = [completeRow('CONFIG_TOPIC', { topic_id: 'topic-a', branch_id: 'BRANCH_A', trang_thai: 'ACTIVE' })];
  const accepted = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-history-topic', operation_id: 'op-history-topic', branch_id: 'BRANCH_A', event_type: 'SYSTEM', payload: { required_sheet_names: ['CONFIG_TOPIC'] } },
    tables: acceptedTables,
    now: '2026-09-22T09:12:06.500Z',
  });
  const committedSnapshot = completeRow('CONFIG_SNAPSHOT', {
    ...accepted.write_plan.find((step) => step.sheet === 'CONFIG_SNAPSHOT' && step.action === 'APPEND').row,
    status: 'COMMITTED',
  });
  const tables = tablesWithSnapshots([committedSnapshot]);
  tables.CONFIG_VERSION = tables.CONFIG_VERSION.filter((row) => row.config_snapshot_id);
  tables.CONFIG_LENH = [completeRow('CONFIG_LENH', { command_code: 'CMD_A', branch_id: 'BRANCH_A', trang_thai: 'ACTIVE' })];

  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-history-command', operation_id: 'op-history-command', branch_id: 'BRANCH_A', event_type: 'SYSTEM', payload: { required_sheet_names: ['CONFIG_LENH'] } },
    tables,
    now: '2026-09-22T09:12:07.000Z',
  });

  assert.equal(accepted.ok, true, JSON.stringify(accepted.response));
  assert.equal(result.ok, true, JSON.stringify(result.response));
  assert.equal(result.diagnostics.reused_snapshot, false);
  const snapshot = result.write_plan.find((step) => step.sheet === 'CONFIG_SNAPSHOT' && step.action === 'APPEND')?.row;
  assert.ok(snapshot, 'a distinct snapshot must be prepared for the requested table set');
  assert.notEqual(snapshot.config_snapshot_id, committedSnapshot.config_snapshot_id);
  assert.deepEqual(Object.keys(gateway.expandSnapshotPayload(JSON.parse(snapshot.normalized_config_json))).sort(), ['CONFIG_BRANCH', 'CONFIG_GLOBAL', 'CONFIG_LENH', 'CONFIG_SCHEMA', 'CONFIG_THONG_BAO', 'CONFIG_USER']);
  const history = result.write_plan.find((step) => step.sheet === 'CONFIG_VERSION' && step.action === 'APPEND')?.row;
  assert.equal(history.config_snapshot_id, snapshot.config_snapshot_id);
  assert.equal(history.content_fingerprint, snapshot.config_fingerprint);
});

test('extracts raw ValueRange arrays without collapsing duplicate headers or losing first data row', () => {
  const gateway = loadGateway();
  assert.equal(typeof gateway.extractSheetValueRange, 'function');
  const expected = schemaManifest.sheets.find((sheet) => sheet.name === 'CONFIG_TOPIC').headers;
  const duplicate = [...expected];
  duplicate[1] = duplicate[0];
  const raw = gateway.extractSheetValueRange({ values: [duplicate, ['topic-first-row', 'BRANCH_A', 'ACTIVE', 'First topic']] }, 'CONFIG_TOPIC');
  assert.deepEqual(Array.from(raw.headers), duplicate);
  assert.equal(raw.values.length, 2);
  assert.deepEqual(Array.from(raw.values[1]), ['topic-first-row', 'BRANCH_A', 'ACTIVE', 'First topic']);
});

test('rejects raw missing, blank, wrong, extra, and duplicate headers before any write plan', () => {
  const gateway = loadGateway();
  const expected = schemaManifest.sheets.find((sheet) => sheet.name === 'CONFIG_TOPIC').headers;
  const malformed = [
    { values: [] },
    { values: [['topic_id', '', 'trang_thai', 'topic_name']] },
    { values: [['wrong_topic_id', ...expected.slice(1)]] },
    { values: [[...expected, 'unexpected_column']] },
    { values: [[expected[0], expected[0], ...expected.slice(2)]] },
    { values: [expected, [...expected.map(() => ''), 'value under blank header']] },
  ];
  for (const [index, valueRange] of malformed.entries()) {
    const raw = gateway.extractSheetValueRange(valueRange, 'CONFIG_TOPIC');
    const tables = tablesWithSnapshots([]);
    tables.CONFIG_TOPIC = [];
    tables.__headers.CONFIG_TOPIC = raw.headers;
    tables.__raw_values = { CONFIG_TOPIC: raw.values };
    const result = gateway.evaluateConfigGateway({
      envelope: { request_id: `req-raw-header-${index}`, operation_id: `op-raw-header-${index}`, branch_id: 'BRANCH_A', event_type: 'SYSTEM', payload: { required_sheet_names: ['CONFIG_TOPIC'] } },
      tables,
      now: '2026-09-29T09:12:08.000Z',
    });
    assert.equal(result.ok, false, JSON.stringify(result.response));
    assert.equal(result.response.error_code, 'CONFIG_HEADER_INVALID');
    assert.equal(result.write_plan.length, 0);
  }
});

test('accepts raw valid header arrays and validates an empty data range', () => {
  const gateway = loadGateway();
  const headers = schemaManifest.sheets.find((sheet) => sheet.name === 'CONFIG_TOPIC').headers;
  const raw = gateway.extractSheetValueRange({ values: [headers, ['topic-first-row', 'BRANCH_A', 'ACTIVE', 'First topic']] }, 'CONFIG_TOPIC');
  assert.deepEqual(Array.from(raw.headers), headers);
  assert.deepEqual(Array.from(raw.values[1]), ['topic-first-row', 'BRANCH_A', 'ACTIVE', 'First topic']);
  const empty = gateway.extractSheetValueRange({ values: [headers] }, 'CONFIG_TOPIC');
  assert.deepEqual(Array.from(empty.headers), headers);
  assert.deepEqual(Array.from(empty.values), [headers]);

  const tables = tablesWithSnapshots([]);
  tables.CONFIG_TOPIC = [];
  tables.__headers.CONFIG_TOPIC = raw.headers;
  tables.__raw_values = { CONFIG_TOPIC: raw.values };
  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-valid-raw-header', operation_id: 'op-valid-raw-header', branch_id: 'BRANCH_A', event_type: 'SYSTEM', payload: { required_sheet_names: ['CONFIG_TOPIC'] } },
    tables,
    now: '2026-09-29T09:12:09.000Z',
  });
  assert.equal(result.ok, true, JSON.stringify(result.response));
  assert.equal(result.response.data.config_tables.CONFIG_TOPIC[0].topic_id, 'topic-first-row');
});

test('replays a partially persisted operation without duplicating append-only config rows', () => {
  const gateway = loadGateway();
  const envelope = { request_id: 'req-recovery', operation_id: 'op-recovery', event_type: 'CONFIG_READ', payload: { idempotency_key: 'idem-recovery' } };
  const initial = gateway.evaluateConfigGateway({ envelope, tables: tablesWithSnapshots([]), now: '2026-09-22T09:12:09.000Z' });
  const preparedOperation = initial.write_plan.find((step) => step.sheet === 'OPERATION' && step.action === 'APPEND').row;
  const preparedVersion = initial.write_plan.find((step) => step.sheet === 'CONFIG_VERSION' && step.action === 'APPEND').row;
  const preparedSnapshot = initial.write_plan.find((step) => step.sheet === 'CONFIG_SNAPSHOT' && step.action === 'APPEND').row;
  const replayTables = tablesWithSnapshots([]);
  replayTables.OPERATION.push(preparedOperation);
  replayTables.CONFIG_VERSION.push(preparedVersion);
  replayTables.CONFIG_SNAPSHOT.push(preparedSnapshot);
  const replay = gateway.evaluateConfigGateway({ envelope, tables: replayTables, now: '2026-09-22T09:12:10.000Z' });

  assert.equal(replay.ok, true, JSON.stringify(replay.response));
  assert.equal(replay.write_plan.some((step) => step.sheet === 'CONFIG_VERSION' && step.action === 'APPEND'), false);
  assert.equal(replay.write_plan.some((step) => step.sheet === 'CONFIG_SNAPSHOT' && step.action === 'APPEND'), false);
  assert.equal(JSON.stringify(replay.write_plan.at(-1).match), JSON.stringify({ idempotency_key: 'idem-recovery' }));
  assert.equal(replay.write_plan.at(-1).patch.status, 'COMMITTED');
  assert.equal(replay.write_plan.at(-1).row.created_at, preparedOperation.created_at);
});

test('rejects a retry whose prepared idempotency key now resolves to different config content', () => {
  const gateway = loadGateway();
  const envelope = { request_id: 'req-config-drift-retry', operation_id: 'op-config-drift-retry', event_type: 'CONFIG_READ', payload: { idempotency_key: 'idem-config-drift-retry' } };
  const tables = tablesWithSnapshots([]);
  const first = gateway.evaluateConfigGateway({ envelope, tables, now: '2026-09-22T09:12:13.000Z' });
  tables.OPERATION.push(first.write_plan.find((step) => step.sheet === 'OPERATION' && step.action === 'APPEND').row);
  tables.CONFIG_GLOBAL.push(completeRow('CONFIG_GLOBAL', { config_key: 'changed', config_value: 'after-retry', value_type: 'STRING', trang_thai: 'ACTIVE' }));
  const retry = gateway.evaluateConfigGateway({ envelope, tables, now: '2026-09-22T09:12:14.000Z' });

  assert.equal(retry.ok, false);
  assert.equal(retry.response.error_code, 'OPERATION_IDEMPOTENCY_CONFLICT');
  assert.equal(retry.write_plan.length, 0);
});

test('does not accept a proposed version linked only to an uncommitted operation', () => {
  const gateway = loadGateway();
  const tables = tablesWithSnapshots([]);
  const uncommittedSnapshot = completeRow('CONFIG_SNAPSHOT', {
    config_snapshot_id: 'cfg-uncommitted', config_version: 'v1.3', schema_version: '1.0', config_fingerprint: 'prior-uncommitted-fingerprint',
    branch_scope: '*', normalized_config_json: JSON.stringify({ CONFIG_SCHEMA: [], CONFIG_GLOBAL: [], CONFIG_BRANCH: [], CONFIG_USER: [], CONFIG_THONG_BAO: [] }),
    operation_id: 'op-uncommitted', status: 'PREPARED', created_at: '2026-09-22T09:12:11.000Z',
  });
  tables.CONFIG_SNAPSHOT.push(uncommittedSnapshot);
  tables.CONFIG_VERSION.push(acceptedVersionRow(uncommittedSnapshot));
  tables.OPERATION.push(completeRow('OPERATION', {
    operation_id: 'op-uncommitted', idempotency_key: 'idem-uncommitted', status: 'PREPARED', commit_state: 'PREPARED',
  }));
  tables.CONFIG_VERSION[0].config_version = 'v1.4';

  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-after-uncommitted', operation_id: 'op-after-uncommitted', event_type: 'SYSTEM', payload: {} },
    tables,
    now: '2026-09-22T09:12:12.000Z',
  });

  assert.equal(result.ok, true, JSON.stringify(result.response));
  assert.equal(result.response.config_version, 'v1.4');
  assert.ok(result.write_plan.some((step) => step.sheet === 'CONFIG_VERSION' && step.action === 'APPEND'));
});

const routerSheets = ['CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH', 'EVENT_LOG'];

const coreSnapshot = completeRow('CONFIG_SNAPSHOT', {
  config_snapshot_id: 'cfg-v1.2-core',
  config_version: 'v1.2',
  schema_version: '1.0',
  config_fingerprint: 'fingerprint-core',
  branch_scope: '*',
  normalized_config_json: JSON.stringify({ CONFIG_SCHEMA: [], CONFIG_GLOBAL: [], CONFIG_BRANCH: [], CONFIG_USER: [], CONFIG_THONG_BAO: [] }),
  operation_id: 'op-core',
  status: 'COMMITTED',
  created_at: '2026-09-22T06:39:36.135Z',
});

const routerSnapshot = completeRow('CONFIG_SNAPSHOT', {
  config_snapshot_id: 'cfg-v1.2-router',
  config_version: 'v1.2',
  schema_version: '1.0',
  config_fingerprint: 'fingerprint-router',
  branch_scope: '*',
  normalized_config_json: JSON.stringify({ CONFIG_SCHEMA: [], CONFIG_GLOBAL: [], CONFIG_BRANCH: [], CONFIG_USER: [], CONFIG_THONG_BAO: [], CONFIG_ROLE: [], CONFIG_PERMISSION: [], CONFIG_USER_ROLE: [], CONFIG_ROLE_PERMISSION: [], CONFIG_TOPIC: [{ topic_id: 'TOPIC-224' }], CONFIG_LENH: [] }),
  operation_id: 'op-router',
  status: 'COMMITTED',
  created_at: '2026-09-22T08:12:31.993Z',
});

test('accepts committed snapshots with the same version when their scopes differ', () => {
  const gateway = loadGateway();
  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-new', operation_id: 'op-new', event_type: 'SYSTEM', payload: { required_sheet_names: routerSheets } },
    tables: tablesWithSnapshots([coreSnapshot, routerSnapshot]),
    now: '2026-09-22T09:10:00.000Z',
  });

  assert.equal(result.ok, true, JSON.stringify(result.response));
  assert.equal(result.response.config_version, 'v1.3');
  assert.equal(result.write_plan[0].sheet, 'OPERATION');
});

test('still rejects a changed configuration in the same snapshot scope without a version bump', () => {
  const gateway = loadGateway();
  const tables = tablesWithSnapshots([{
    ...routerSnapshot,
    config_version: 'v1.3',
    config_fingerprint: 'fingerprint-old-router',
  }]);
  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-same-scope', operation_id: 'op-same-scope', event_type: 'SYSTEM', payload: { required_sheet_names: routerSheets } },
    tables,
    now: '2026-09-22T09:11:00.000Z',
  });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_VERSION_NOT_INCREMENTED');
});

test('rejects schema rules that do not match the active CONFIG_VERSION schema version', () => {
  const gateway = loadGateway();
  const tables = tablesWithSnapshots([]);
  tables.CONFIG_SCHEMA[0].schema_version = '9.9';

  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-schema-version', operation_id: 'op-schema-version', event_type: 'SYSTEM', payload: {} },
    tables,
    now: '2026-09-22T09:11:15.000Z',
  });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_SCHEMA_VERSION_MISMATCH');
  assert.equal(result.response.sheet_name, 'CONFIG_SCHEMA');
  assert.equal(result.write_plan.length, 0);
});

test('rejects ambiguous active CONFIG_VERSION rows', () => {
  const gateway = loadGateway();
  const tables = tablesWithSnapshots([]);
  tables.CONFIG_VERSION.push(completeRow('CONFIG_VERSION', { ...tables.CONFIG_VERSION[0], config_version_id: 'ver-2', config_version: 'v1.4', status: 'ACTIVE' }));

  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-active-versions', operation_id: 'op-active-versions', event_type: 'SYSTEM', payload: {} },
    tables,
    now: '2026-09-22T09:11:20.000Z',
  });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_VERSION_AMBIGUOUS');
  assert.equal(result.write_plan.length, 0);
});

test('reports the missing schema field and returns no write plan', () => {
  const gateway = loadGateway();
  const tables = tablesWithSnapshots([]);
  const incompleteHeader = completeRow('CONFIG_GLOBAL', { config_key: 'TEST', value_type: 'STRING', description: '', trang_thai: 'ACTIVE' });
  delete incompleteHeader.config_value;
  tables.CONFIG_GLOBAL = [incompleteHeader];

  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-schema-gap', operation_id: 'op-schema-gap', event_type: 'SYSTEM', payload: {} },
    tables,
    now: '2026-09-22T09:11:30.000Z',
  });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_COLUMN_MISSING');
  assert.equal(result.response.sheet_name, 'CONFIG_GLOBAL');
  assert.equal(result.response.column_name, 'config_value');
  assert.match(result.response.message, /CONFIG_GLOBAL\.config_value/);
  assert.equal(result.write_plan.length, 0);
});

test('reports an invalid reference at its sheet and field and returns no write plan', () => {
  const gateway = loadGateway();
  const tables = tablesWithSnapshots([]);
  tables.CONFIG_GLOBAL = [completeRow('CONFIG_GLOBAL', { config_key: 'TEST', config_value: 'MISSING_BRANCH', value_type: 'STRING', description: '', trang_thai: 'ACTIVE' })];
  tables.CONFIG_SCHEMA = tables.CONFIG_SCHEMA.map((row) => row.sheet_name === 'CONFIG_GLOBAL' && row.field_name === 'config_value'
    ? { ...row, reference: 'CONFIG_BRANCH.branch_id' }
    : row);

  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-reference-gap', operation_id: 'op-reference-gap', event_type: 'SYSTEM', payload: {} },
    tables,
    now: '2026-09-22T09:11:45.000Z',
  });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_REFERENCE_INVALID');
  assert.equal(result.response.error_class, 'CONFIGURATION');
  assert.equal(result.response.message_safe, result.response.message);
  assert.equal(result.response.retryable, false);
  assert.equal(result.response.sheet_name, 'CONFIG_GLOBAL');
  assert.equal(result.response.column_name, 'config_value');
  assert.equal(result.write_plan.length, 0);
});

test('fingerprints only active rows in the requested branch scope', () => {
  const gateway = loadGateway();
  const tables = tablesWithSnapshots([]);
  tables.CONFIG_BRANCH = [
    completeRow('CONFIG_BRANCH', { branch_id: 'BRANCH_A', branch_code: 'A', branch_name: 'A', timezone: 'Asia/Ho_Chi_Minh', locale: 'vi-VN', status: 'ACTIVE' }),
    completeRow('CONFIG_BRANCH', { branch_id: 'BRANCH_B', branch_code: 'B', branch_name: 'B', timezone: 'Asia/Ho_Chi_Minh', locale: 'vi-VN', status: 'ACTIVE' }),
  ];
  tables.CONFIG_GLOBAL = [
    completeRow('CONFIG_GLOBAL', { config_key: 'ACTIVE_SETTING', config_value: 'A', value_type: 'STRING', description: '', trang_thai: 'ACTIVE' }),
    completeRow('CONFIG_GLOBAL', { config_key: 'INACTIVE_SETTING', config_value: 'B', value_type: 'STRING', description: '', trang_thai: 'INACTIVE' }),
  ];
  tables.CONFIG_TOPIC = [
    completeRow('CONFIG_TOPIC', { topic_id: 'TOPIC_A', branch_id: 'BRANCH_A', topic_type: 'COUNT', chat_id: 'CHAT_A', message_thread_id: 'THREAD_A', trang_thai: 'ACTIVE' }),
    completeRow('CONFIG_TOPIC', { topic_id: 'TOPIC_B', branch_id: 'BRANCH_B', topic_type: 'COUNT', chat_id: 'CHAT_B', message_thread_id: 'THREAD_B', trang_thai: 'ACTIVE' }),
  ];

  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-branch-scope', operation_id: 'op-branch-scope', event_type: 'SYSTEM', branch_id: 'BRANCH_A', payload: { required_sheet_names: ['CONFIG_TOPIC'] } },
    tables,
    now: '2026-09-22T09:12:30.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.response.branch_scope, 'BRANCH_A');
  assert.equal(result.write_plan.find((step) => step.sheet === 'CONFIG_SNAPSHOT' && step.action === 'APPEND').row.branch_scope, 'BRANCH_A');
  const normalized = JSON.parse(result.diagnostics.normalized_config_json);
  assert.deepEqual(normalized.CONFIG_BRANCH.map((row) => row.branch_id), ['BRANCH_A']);
  assert.deepEqual(normalized.CONFIG_GLOBAL.map((row) => row.config_key), ['ACTIVE_SETTING']);
  assert.deepEqual(result.response.data.config_tables.CONFIG_TOPIC.map((row) => row.branch_id), ['BRANCH_A']);
});

test('continues an existing snapshot unchanged during maintenance mode', () => {
  const gateway = loadGateway();
  const stored = completeRow('CONFIG_SNAPSHOT', {
    config_snapshot_id: 'cfg-existing', config_version: 'v1.3', schema_version: '1.0', config_fingerprint: 'fingerprint-existing',
    branch_scope: 'BRANCH_A', normalized_config_json: '{"CONFIG_BRANCH":[{"branch_id":"BRANCH_A"}]}', operation_id: 'op-snapshot', status: 'COMMITTED', created_at: '2026-09-22T09:00:00.000Z',
  });
  const tables = tablesWithSnapshots([stored]);
  tables.CONFIG_VERSION[0].maintenance_mode = 'YES';

  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-continue', operation_id: 'op-continue', operation_type: 'CONTINUE_SESSION', config_snapshot_id: 'cfg-existing', branch_id: 'BRANCH_A', payload: {} },
    tables,
    now: '2026-09-22T09:12:45.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.response.config_snapshot_id, 'cfg-existing');
  assert.equal(result.response.config_version, 'v1.3');
  assert.equal(result.response.data.normalized_config_json, stored.normalized_config_json);
  assert.equal(result.write_plan.length, 0);
});

test('blocks a new operation during maintenance mode without making a write plan', () => {
  const gateway = loadGateway();
  const tables = tablesWithSnapshots([]);
  tables.CONFIG_VERSION[0].maintenance_mode = 'YES';

  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-maintenance-start', operation_id: 'op-maintenance-start', operation_type: 'START_OPERATION', payload: {} },
    tables,
    now: '2026-09-22T09:12:50.000Z',
  });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_MAINTENANCE');
  assert.equal(result.write_plan.length, 0);
});

test('blocks a new operation when CONFIG_CUTOVER keeps V1 primary', () => {
  const gateway = loadGateway();
  const tables = tablesWithSnapshots([]);
  tables.CONFIG_CUTOVER = [completeRow('CONFIG_CUTOVER', { cutover_id: 'cutover-test', mode: 'V1_PRIMARY', v1_enabled: 'YES', v2_enabled: 'NO', trang_thai: 'ACTIVE' })];

  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-cutover', operation_id: 'op-cutover', operation_type: 'START_OPERATION', payload: {} },
    tables,
    now: '2026-09-22T09:12:55.000Z',
  });

  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_CUTOVER_BLOCKED');
  assert.equal(result.write_plan.length, 0);
});

test('includes active cutover policy in the immutable configuration snapshot', () => {
  const gateway = loadGateway();
  const tables = tablesWithSnapshots([]);
  tables.CONFIG_CUTOVER = [completeRow('CONFIG_CUTOVER', { cutover_id: 'cutover-test', mode: 'SHADOW', v1_enabled: 'YES', v2_enabled: 'YES', trang_thai: 'ACTIVE' })];

  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-cutover-snapshot', operation_id: 'op-cutover-snapshot', operation_type: 'START_OPERATION', payload: {} },
    tables,
    now: '2026-09-22T09:13:00.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(JSON.parse(result.diagnostics.normalized_config_json).CONFIG_CUTOVER?.[0]?.mode, 'SHADOW');
});

test('allows a new version for a narrower scope when another scope changed', () => {
  const gateway = loadGateway();
  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-core', operation_id: 'op-core-new', event_type: 'SYSTEM', payload: {} },
    tables: tablesWithSnapshots([coreSnapshot]),
    now: '2026-09-22T09:12:00.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.response.config_version, 'v1.3');
  assert.equal(result.write_plan.some((step) => step.sheet === 'CONFIG_SNAPSHOT' && step.action === 'APPEND'), true);
});

test('reuses a stable committed snapshot and commits only after prepared writes', () => {
  const gateway = loadGateway();
  const first = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-snapshot-create', operation_id: 'op-snapshot-create', event_type: 'SYSTEM', payload: {} },
    tables: tablesWithSnapshots([]),
    now: '2026-09-22T09:13:05.000Z',
  });
  const snapshotRow = first.write_plan.find((step) => step.sheet === 'CONFIG_SNAPSHOT' && step.action === 'APPEND').row;
  assert.equal(snapshotRow.config_fingerprint, first.response.config_fingerprint);
  assert.equal(first.write_plan[0].row.status, 'PREPARED');
  assert.equal(first.write_plan.find((step) => step.sheet === 'CONFIG_VERSION').row.status, 'ACTIVE');
  assert.equal(snapshotRow.status, 'PREPARED');
  assert.equal(JSON.stringify(first.write_plan.map((step) => step.sheet)), JSON.stringify(['OPERATION', 'CONFIG_VERSION', 'CONFIG_SNAPSHOT', 'OPERATION']));

  const replayTables = tablesWithSnapshots([{ ...snapshotRow, status: 'COMMITTED' }]);
  const replay = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-snapshot-replay', operation_id: 'op-snapshot-replay', event_type: 'SYSTEM', payload: {} },
    tables: replayTables,
    now: '2026-09-22T09:13:10.000Z',
  });

  assert.equal(replay.ok, true, JSON.stringify(replay.response));
  assert.equal(replay.diagnostics.reused_snapshot, true);
  assert.equal(replay.response.config_snapshot_id, snapshotRow.config_snapshot_id);
  assert.equal(replay.write_plan.length, 0);
});

test('keeps snapshot identities distinct across scopes even when content fingerprints match', () => {
  const gateway = loadGateway();
  const makeResult = (branchId) => gateway.evaluateConfigGateway({
    envelope: { request_id: `req-${branchId}`, operation_id: `op-${branchId}`, branch_id: branchId, event_type: 'SYSTEM', payload: {} },
    tables: tablesWithSnapshots([]),
    now: '2026-09-22T09:13:20.000Z',
  });
  const branchA = makeResult('BRANCH_A');
  const branchB = makeResult('BRANCH_B');
  const snapshotA = branchA.write_plan.find((step) => step.sheet === 'CONFIG_SNAPSHOT' && step.action === 'APPEND').row;
  const snapshotB = branchB.write_plan.find((step) => step.sheet === 'CONFIG_SNAPSHOT' && step.action === 'APPEND').row;

  assert.equal(snapshotA.config_fingerprint, snapshotB.config_fingerprint);
  assert.notEqual(snapshotA.config_snapshot_id, snapshotB.config_snapshot_id);
  assert.equal(snapshotA.branch_scope, 'BRANCH_A');
  assert.equal(snapshotB.branch_scope, 'BRANCH_B');
});

test('keeps an oversized snapshot reversible and below the Google Sheets cell limit', () => {
  const gateway = loadGateway();
  const tables = tablesWithSnapshots([]);
  tables.CONFIG_GLOBAL = Array.from({ length: 500 }, () => completeRow('CONFIG_GLOBAL', {
    config_key: 'TEST_KEY', config_value: 'VALUE', value_type: 'STRING', description: '', trang_thai: 'ACTIVE',
  }));

  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-large-snapshot', operation_id: 'op-large-snapshot', event_type: 'SYSTEM', payload: {} },
    tables,
    now: '2026-09-22T09:13:00.000Z',
  });

  assert.equal(result.ok, true, JSON.stringify(result.response));
  const snapshotRow = result.write_plan.find((step) => step.sheet === 'CONFIG_SNAPSHOT' && step.action === 'APPEND').row;
  assert.ok(result.diagnostics.normalized_config_json.length > 50000);
  assert.ok(snapshotRow.normalized_config_json.length < 50000);
  assert.equal(JSON.stringify(gateway.expandSnapshotPayload(JSON.parse(snapshotRow.normalized_config_json))), result.diagnostics.normalized_config_json);

  const replayTables = tablesWithSnapshots([{ ...snapshotRow, status: 'COMMITTED' }]);
  replayTables.CONFIG_GLOBAL = tables.CONFIG_GLOBAL;
  const replay = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-large-snapshot-replay', operation_id: 'op-large-snapshot-replay', event_type: 'SYSTEM', payload: {} },
    tables: replayTables,
    now: '2026-09-22T09:14:00.000Z',
  });

  assert.equal(replay.ok, true);
  assert.equal(replay.diagnostics.reused_snapshot, true);
  assert.equal(replay.write_plan.length, 0);
});

test('keeps normalized JSON uncompressed at the 50000-character cell boundary', () => {
  const gateway = loadGateway();
  const tables = tablesWithSnapshots([]);
  const coreSheets = ['CONFIG_SCHEMA', 'CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', 'CONFIG_SNAPSHOT', 'OPERATION', 'ERROR_BIA'];
  tables.CONFIG_SCHEMA = tables.CONFIG_SCHEMA.filter((row) => coreSheets.includes(row.sheet_name));
  tables.CONFIG_GLOBAL = [completeRow('CONFIG_GLOBAL', { config_key: 'TEST_KEY', config_value: '', value_type: 'STRING', description: '', trang_thai: 'ACTIVE' })];
  const base = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-boundary-base', operation_id: 'op-boundary-base', event_type: 'SYSTEM', payload: {} },
    tables,
    now: '2026-09-22T09:13:30.000Z',
  });
  tables.CONFIG_GLOBAL[0].config_value = 'X'.repeat(50000 - base.diagnostics.normalized_config_json.length);

  const result = gateway.evaluateConfigGateway({
    envelope: { request_id: 'req-boundary', operation_id: 'op-boundary', event_type: 'SYSTEM', payload: {} },
    tables,
    now: '2026-09-22T09:13:45.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.normalized_config_json.length, 50000);
  assert.equal(result.diagnostics.snapshot_storage_format, 'json-v1');
  assert.equal(result.write_plan.find((step) => step.sheet === 'CONFIG_SNAPSHOT' && step.action === 'APPEND').row.normalized_config_json.length, 50000);
});

test('normalizes envelopes without structuredClone in the n8n sandbox', () => {
  const gateway = loadGateway({ withoutStructuredClone: true });
  const envelope = gateway.normalizeEnvelope({
    request_id: 'req-clone',
    operation_id: 'op-clone',
    payload: { command: '/kiemke' },
  });

  assert.deepEqual(envelope.payload, { command: '/kiemke' });
});
