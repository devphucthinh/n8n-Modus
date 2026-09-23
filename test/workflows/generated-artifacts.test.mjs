import test from 'node:test';
import assert from 'node:assert/strict';
import { TextEncoder } from 'node:util';
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envelope, validConfig, validConfigWithRouterTables } from '../fixtures/config/valid-config.mjs';
import { FIXED_NOW } from '../fixtures/config/valid-config.mjs';
import { normalizeTelegramUpdate } from '../../src/telegram-router/normalize-status-update.mjs';
import { requiredSheetNames } from '../../src/telegram-router/required-sheet-names.mjs';
import { evaluateConfigGateway } from '../../src/config-gateway/evaluate-config.mjs';
import { availableWorkerTargets } from '../../src/telegram-router/worker-targets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowDir = path.join(root, 'workflows');
const GOOGLE_SHEET_ID = '1wQ76EpIx35Trkx5JZg8GZ0xZsEBcKAFA6eb7nKDvLu4';
const WF01_WORKFLOW_NAME = 'WF01_V2_CONFIG_GATEWAY';
const WF02_WORKFLOW_NAME = 'WF02_V2_ERROR_HANDLER';
const WORKER_TARGETS = availableWorkerTargets();

async function loadGeneratedWorkflows() {
  const files = (await readdir(workflowDir)).filter((file) => file.endsWith('.json')).sort();
  return Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(workflowDir, file), 'utf8'))));
}

test('exports exactly one Telegram Trigger across the V2 workflows', async () => {
  const workflows = await loadGeneratedWorkflows();
  const v2 = workflows.filter((workflow) => workflow.name.startsWith('WF0'));
  const triggers = v2.flatMap((workflow) => workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.telegramTrigger'));
  assert.equal(triggers.length, 1);
  assert.equal(workflows.find((workflow) => workflow.name === 'WF03_V2_TELEGRAM_ROUTER').active, false);
});

test('exports contain the configured Sheet ID and credential names but no secrets', async () => {
  const workflows = await loadGeneratedWorkflows();
  const text = JSON.stringify(workflows);
  assert.doesNotMatch(text, /PASTE_GOOGLE_SHEET_ID/);
  const sheetNodes = workflows.flatMap((workflow) => workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.googleSheets'));
  assert.ok(sheetNodes.length > 0);
  assert.ok(sheetNodes.every((node) => node.parameters.documentId?.value === GOOGLE_SHEET_ID));
  assert.match(text, /GOOGLE_SHEETS_KKB_V2/);
  assert.match(text, /TELEGRAM_KKB_V2/);
  assert.doesNotMatch(text, /\b\d{8,}:[A-Za-z0-9_-]{20,}\b|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._-]+/);
});

test('workflow references are left for selection by readable name after import', async () => {
  const workflows = await loadGeneratedWorkflows();
  const expectedNames = new Map([
    ['Call Error Handler', WF02_WORKFLOW_NAME],
    ['Call Config Gateway', WF01_WORKFLOW_NAME],
    ['Call Config Gateway - Command Check', WF01_WORKFLOW_NAME],
    ['Call Error Handler - Worker Failure', WF02_WORKFLOW_NAME],
  ]);
  for (const target of WORKER_TARGETS) expectedNames.set(target.node_name, target.workflow_name);
  const calls = workflows.flatMap((workflow) => workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.executeWorkflow'));

  assert.equal(calls.length, expectedNames.size);
  for (const call of calls) {
    assert.deepEqual(call.parameters.workflowId, { __rl: true, value: '', mode: 'list' });
    assert.match(call.notes, new RegExp(`select ${expectedNames.get(call.name)} from the n8n workflow list`, 'i'));
  }
});

test('exports every IF node with the n8n v2 conditions schema', async () => {
  const workflows = await loadGeneratedWorkflows();
  const ifNodes = workflows.flatMap((workflow) => workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.if'));
  assert.ok(ifNodes.length > 0);
  for (const node of ifNodes) {
    const conditions = node.parameters?.conditions;
    assert.equal(conditions?.boolean, undefined, `${node.name} uses legacy boolean conditions`);
    assert.equal(conditions?.string, undefined, `${node.name} uses legacy string conditions`);
    assert.equal(conditions?.number, undefined, `${node.name} uses legacy number conditions`);
    assert.equal(conditions?.combinator, 'and', `${node.name} has no v2 combinator`);
    assert.ok(Array.isArray(conditions?.conditions) && conditions.conditions.length > 0, `${node.name} has no v2 conditions`);
    for (const condition of conditions.conditions) {
      assert.equal(typeof condition.leftValue, 'string', `${node.name} has no leftValue`);
      assert.notEqual(condition.leftValue.trim(), '', `${node.name} has an empty leftValue`);
      assert.equal(typeof condition.operator, 'object', `${node.name} has no v2 operator`);
    }
  }
});

test('exports workflow dependencies as named list selections, not saved workspace IDs', async () => {
  const workflows = await loadGeneratedWorkflows();
  const text = JSON.stringify(workflows);
  assert.doesNotMatch(text, /WEL83s9bZeB3ixxF|MoG6coBccYkIS0nK/);

  const gateway = workflows.find((workflow) => workflow.name === 'WF01_V2_CONFIG_GATEWAY');
  const errorCall = gateway.nodes.find((node) => node.name === 'Call Error Handler');
  assert.equal(errorCall.parameters.workflowId?.value, '');
  assert.equal(errorCall.parameters.workflowId?.mode, 'list');
  assert.ok(errorCall.notes.includes(WF02_WORKFLOW_NAME));

  const router = workflows.find((workflow) => workflow.name === 'WF03_V2_TELEGRAM_ROUTER');
  for (const name of ['Call Config Gateway', 'Call Config Gateway - Command Check']) {
    const gatewayCall = router.nodes.find((node) => node.name === name);
    assert.equal(gatewayCall.parameters.workflowId?.value, '');
    assert.equal(gatewayCall.parameters.workflowId?.mode, 'list');
    assert.ok(gatewayCall.notes.includes(WF01_WORKFLOW_NAME));
  }
});

test('exports stage and target immutable ledger rows', async () => {
  const workflows = await loadGeneratedWorkflows();
  const gateway = workflows.find((workflow) => workflow.name === 'WF01_V2_CONFIG_GATEWAY');
  const snapshotCommit = gateway.nodes.find((node) => node.name === 'Commit CONFIG_SNAPSHOT');
  const operationCommit = gateway.nodes.find((node) => node.name === 'Commit OPERATION');
  assert.deepEqual(snapshotCommit.parameters.columns.matchingColumns, ['config_snapshot_id']);
  assert.deepEqual(operationCommit.parameters.columns.matchingColumns, ['operation_id']);
  assert.deepEqual(operationCommit.parameters.columns.schema.map((column) => column.id), ['operation_id', 'status', 'actual_row_count', 'updated_at']);
  assert.ok(gateway.nodes.some((node) => node.name === 'Prepare CONFIG_SNAPSHOT row'));
  assert.equal(gateway.nodes.find((node) => node.name === 'Prepare OPERATION')?.parameters.operation, 'appendOrUpdate');
  assert.equal(gateway.nodes.find((node) => node.name === 'Prepare CONFIG_SNAPSHOT')?.parameters.operation, 'appendOrUpdate');

  const errorWorkflow = workflows.find((workflow) => workflow.name === 'WF02_V2_ERROR_HANDLER');
  assert.ok(errorWorkflow.nodes.some((node) => node.name === 'Project ERROR_BIA row'));
});

test('keeps live configuration reads behind the Config Gateway', async () => {
  const workflows = await loadGeneratedWorkflows();
  const router = workflows.find((workflow) => workflow.name === 'WF03_V2_TELEGRAM_ROUTER');
  assert.equal(router.nodes.filter((node) => node.type === 'n8n-nodes-base.googleSheets' && node.parameters.operation === 'read').length, 0);
  const gateway = workflows.find((workflow) => workflow.name === 'WF01_V2_CONFIG_GATEWAY');
  const reads = gateway.nodes.filter((node) => node.name.startsWith('Read '));
  assert.equal(reads.length, 17);
  assert.ok(gateway.nodes.some((node) => node.name === 'Router tables requested?'));
  for (const sheet of ['CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH', 'EVENT_LOG']) {
    const selector = gateway.nodes.find((node) => node.name === `Router sheet ${sheet} requested?`);
    assert.ok(selector, `missing selector for ${sheet}`);
    assert.match(selector.parameters.conditions.conditions[0].leftValue, new RegExp(`includes\\('${sheet}'\\)`));
  }
  assert.ok(reads.every((node) => node.alwaysOutputData === true));
  assert.ok(reads.every((node) => node.executeOnce === true));
  assert.deepEqual(gateway.connections['Router sheet EVENT_LOG requested?'].main[1].map((target) => target.node), ['Resolve Retry Context Lookup']);
  assert.deepEqual(gateway.connections['Read EVENT_LOG'].main[0].map((target) => target.node), ['Resolve Retry Context Lookup']);
  assert.deepEqual(gateway.connections['Execute Workflow Trigger'].main[0].map((target) => target.node), ['Read CONFIG_SCHEMA']);
});

test('Gateway resolves the latest error operation before a filtered retry-context read', async () => {
  const workflows = await loadGeneratedWorkflows();
  const gateway = workflows.find((workflow) => workflow.name === 'WF01_V2_CONFIG_GATEWAY');
  const resolver = gateway.nodes.find((node) => node.name === 'Resolve Retry Context Lookup');
  const read = gateway.nodes.find((node) => node.name === 'Read RETRY_CONTEXT');
  assert.ok(resolver);
  assert.equal(read?.parameters.filtersUI.values[0].lookupColumn, 'operation_id');
  assert.equal(read?.parameters.filtersUI.values[0].lookupValue, '={{$json.operation_id}}');
  const trigger = { envelope: { payload: { command: '/retry', args: ['err-42'], required_sheet_names: ['RETRY_CONTEXT'] } } };
  const errors = [
    { error_id: 'err-42', operation_id: 'op-old' },
    { error_id: 'err-other', operation_id: 'op-unrelated' },
    { error_id: 'err-42', operation_id: 'op-latest' },
  ];
  const sandbox = { $: (name) => ({
    first: () => ({ json: name === 'Execute Workflow Trigger' ? trigger : {} }),
    all: () => name === 'Read ERROR_BIA' ? errors.map((json) => ({ json })) : [],
  }) };
  vm.createContext(sandbox);
  const output = await vm.runInContext(`(async () => { ${resolver.parameters.jsCode}\n})()`, sandbox, { timeout: 1000 });
  assert.equal(output[0].json.operation_id, 'op-latest');
  assert.equal(output[0].json.retry_context_requested, true);
  trigger.envelope.payload.command = '/help';
  assert.equal((await vm.runInContext(`(async () => { ${resolver.parameters.jsCode}\n})()`, sandbox, { timeout: 1000 }))[0].json.retry_context_requested, false);
});

test('does not dereference optional router reads that were skipped', async () => {
  const workflows = await loadGeneratedWorkflows();
  const gateway = workflows.find((workflow) => workflow.name === 'WF01_V2_CONFIG_GATEWAY');
  const assemble = gateway.nodes.find((node) => node.name === 'Assemble Config Tables');
  const evaluate = gateway.nodes.find((node) => node.name === 'Evaluate Config Gateway');
  assert.match(assemble.parameters.jsCode, /try\s*\{/);
  assert.match(assemble.parameters.jsCode, /catch\s*\{/);
  assert.match(evaluate.parameters.jsCode, /\$input\.first\(\)\?\.json/);
  assert.match(evaluate.parameters.jsCode, /assembled\.tables/);
});

test('does not duplicate a reply after Error Handler sends a validation error', async () => {
  const workflows = await loadGeneratedWorkflows();
  const gateway = workflows.find((workflow) => workflow.name === 'WF01_V2_CONFIG_GATEWAY');
  const errorInput = gateway.nodes.find((node) => node.name === 'Prepare Error Handler Input');
  const returnStatus = gateway.nodes.find((node) => node.name === 'Return Gateway Result');
  assert.deepEqual(gateway.connections['Call Error Handler'].main[0].map((target) => target.node), ['Return Gateway Result']);
  assert.match(errorInput.parameters.jsCode, /reply_target/);
  assert.match(returnStatus.parameters.jsCode, /reply_target/);
  assert.match(returnStatus.parameters.jsCode, /return \[\];/);
});

test('suppresses the parent reply when Error Handler already returned a Telegram reply', async () => {
  const workflows = await loadGeneratedWorkflows();
  const gateway = workflows.find((workflow) => workflow.name === 'WF01_V2_CONFIG_GATEWAY');
  const returnStatus = gateway.nodes.find((node) => node.name === 'Return Gateway Result');
  const sandbox = {
    $input: { first: () => ({ json: { reply_target: { chat_id: 'chat-1' }, response: { message_safe: 'Đã gửi lỗi.' } } }) },
    $: () => ({ first: () => ({ json: { ok: false, response: { error_code: 'CONFIG_INVALID' } } }) }),
  };
  vm.createContext(sandbox);
  const output = await vm.runInContext(`(async () => { ${returnStatus.parameters.jsCode}\n})()`, sandbox, { timeout: 1000 });
  assert.equal(Array.isArray(output), true);
  assert.equal(output.length, 0);
});

test('does not depend on structuredClone in n8n Code nodes', async () => {
  const workflows = await loadGeneratedWorkflows();
  const code = workflows.flatMap((workflow) => workflow.nodes)
    .filter((node) => node.type === 'n8n-nodes-base.code')
    .map((node) => node.parameters?.jsCode ?? '')
    .join('\n');
  assert.doesNotMatch(code, /\bstructuredClone\s*\(/);
});

test('executes Config Gateway code without structuredClone in an n8n-like sandbox', async () => {
  const workflows = await loadGeneratedWorkflows();
  const gateway = workflows.find((workflow) => workflow.name === 'WF01_V2_CONFIG_GATEWAY');
  const evaluator = gateway.nodes.find((node) => node.name === 'Evaluate Config Gateway');
  const sandbox = {
    $input: { first: () => ({ json: { envelope, tables: validConfig() } }) },
    $items: () => [],
    $: () => ({ first: () => ({ json: {} }) }),
    structuredClone: undefined,
    TextEncoder,
  };

  vm.createContext(sandbox);
  const output = await vm.runInContext(`(async () => { ${evaluator.parameters.jsCode}\n})()`, sandbox, { timeout: 1000 });

  assert.equal(output[0].json.ok, true);
  assert.equal(output[0].json.response.status, 'OK');
});

test('generated Config Gateway keeps Google Sheets metadata out of snapshot cells', async () => {
  const workflows = await loadGeneratedWorkflows();
  const gateway = workflows.find((workflow) => workflow.name === 'WF01_V2_CONFIG_GATEWAY');
  const evaluator = gateway.nodes.find((node) => node.name === 'Evaluate Config Gateway');
  const tables = validConfigWithRouterTables();
  for (const rows of Object.values(tables)) {
    if (Array.isArray(rows)) rows.forEach((row, index) => { row.row_number = String(index + 2); });
  }
  const sandbox = {
    $input: { first: () => ({ json: { envelope: { ...envelope, payload: { command: '/kiemke', intent: 'START_OPERATION' } }, tables } }) },
    $items: () => [],
    $: () => ({ first: () => ({ json: {} }) }),
    structuredClone: undefined,
    TextEncoder,
  };

  vm.createContext(sandbox);
  const output = await vm.runInContext(`(async () => { ${evaluator.parameters.jsCode}\n})()`, sandbox, { timeout: 1000 });
  const snapshotPayload = output[0].json.write_plan[1].row.normalized_config_json;
  assert.doesNotMatch(snapshotPayload, /row_number/);
  assert.ok(snapshotPayload.length < 50000);
});

test('Gateway artifact selects a single retry context read only for /retry and redacts saved executions', async () => {
  const workflows = await loadGeneratedWorkflows();
  const gateway = workflows.find((workflow) => workflow.name === 'WF01_V2_CONFIG_GATEWAY');
  assert.equal(gateway.settings.redactionPolicy, 'all');
  const selector = gateway.nodes.find((node) => node.name === 'Retry context requested?');
  const read = gateway.nodes.find((node) => node.name === 'Read RETRY_CONTEXT');
  assert.ok(selector);
  assert.ok(read);
  assert.equal(read.executeOnce, true);
  assert.equal(read.alwaysOutputData, true);
  assert.equal(read.parameters.sheetName.value, 'RETRY_CONTEXT');
  assert.match(JSON.stringify(read.parameters), /operation_id/);
  assert.deepEqual(gateway.connections[selector.name].main[0].map((target) => target.node), [read.name]);
  assert.deepEqual(gateway.connections[selector.name].main[1].map((target) => target.node), ['Assemble Config Tables']);
  assert.deepEqual(gateway.connections[read.name].main[0].map((target) => target.node), ['Assemble Config Tables']);
});

test('generated Router Decision executes with the no-permission help label in an n8n-like sandbox', async () => {
  const workflows = await loadGeneratedWorkflows();
  const router = workflows.find((workflow) => workflow.name === 'WF03_V2_TELEGRAM_ROUTER');
  const decision = router.nodes.find((node) => node.name === 'Router Decision');
  const update = {
    update_id: 9001,
    message: { from: { id: '10001' }, chat: { id: '-100100' }, message_thread_id: '77', text: '/help' },
  };
  const normalized = normalizeTelegramUpdate(update);
  normalized.envelope.payload.required_sheet_names = requiredSheetNames('/help');
  const gatewayResult = evaluateConfigGateway({ envelope: normalized.envelope, tables: validConfigWithRouterTables(), now: FIXED_NOW });
  const sandbox = {
    $input: { first: () => ({ json: gatewayResult }) },
    $: () => ({ first: () => ({ json: normalized }) }),
  };

  vm.createContext(sandbox);
  const output = await vm.runInContext(`(() => { ${decision.parameters.jsCode}\n})()`, sandbox, { timeout: 1000 });

  assert.match(output[0].json.text, /Quyền: Không yêu cầu/);

  const routeUpdate = {
    update_id: 9002,
    message: { from: { id: '10001' }, chat: { id: '-100100' }, message_thread_id: '77', text: '/kiemke' },
  };
  const routeNormalized = normalizeTelegramUpdate(routeUpdate);
  routeNormalized.envelope.payload.required_sheet_names = requiredSheetNames('/kiemke');
  const routeGatewayResult = evaluateConfigGateway({ envelope: routeNormalized.envelope, tables: validConfigWithRouterTables(), now: FIXED_NOW });
  const routeSandbox = {
    $input: { first: () => ({ json: routeGatewayResult }) },
    $: () => ({ first: () => ({ json: routeNormalized }) }),
  };
  vm.createContext(routeSandbox);
  const routeOutput = await vm.runInContext(`(() => { ${decision.parameters.jsCode}\n})()`, routeSandbox, { timeout: 1000 });

  assert.equal(routeOutput[0].json.decision.kind, 'ROUTE');
  assert.equal(routeOutput[0].json.decision.reservation.row.operation_id, 'router-tg-9002');

  const retryUpdate = {
    update_id: 9003,
    message: { from: { id: 'admin-1' }, chat: { id: '-100100' }, message_thread_id: '77', text: '/retry err-42' },
  };
  const retryNormalized = normalizeTelegramUpdate(retryUpdate);
  retryNormalized.envelope.payload.required_sheet_names = requiredSheetNames('/retry');
  const retryGatewayResult = evaluateConfigGateway({ envelope: retryNormalized.envelope, tables: validConfigWithRouterTables(), now: FIXED_NOW });
  const retrySandbox = {
    $input: { first: () => ({ json: retryGatewayResult }) },
    $: () => ({ first: () => ({ json: retryNormalized }) }),
  };
  vm.createContext(retrySandbox);
  const retryOutput = await vm.runInContext(`(() => { ${decision.parameters.jsCode}\n})()`, retrySandbox, { timeout: 1000 });

  assert.equal(retryOutput[0].json.decision.kind, 'DENY');
  assert.equal(retryOutput[0].json.decision.reservation, undefined);
});

test('generated Config Gateway packs oversized snapshots below the Sheets cell limit', async () => {
  const workflows = await loadGeneratedWorkflows();
  const gateway = workflows.find((workflow) => workflow.name === 'WF01_V2_CONFIG_GATEWAY');
  const evaluator = gateway.nodes.find((node) => node.name === 'Evaluate Config Gateway');
  const tables = validConfigWithRouterTables();
  tables.CONFIG_THONG_BAO.push(...Array.from({ length: 300 }, (_, index) => ({
    message_key: `EXTRA_MESSAGE_${index}`,
    message_text: 'Same configured message text',
    locale: 'vi-VN',
    trang_thai: 'ACTIVE',
  })));
  const sandbox = {
    $input: { first: () => ({ json: { envelope: { ...envelope, payload: { command: '/kiemke', intent: 'START_OPERATION' } }, tables } }) },
    $items: () => [],
    $: () => ({ first: () => ({ json: {} }) }),
    structuredClone: undefined,
    TextEncoder,
  };

  vm.createContext(sandbox);
  const output = await vm.runInContext(`(async () => { ${evaluator.parameters.jsCode}\n})()`, sandbox, { timeout: 1000 });
  const result = output[0].json;
  const snapshotPayload = result.write_plan[1].row.normalized_config_json;
  const stored = JSON.parse(snapshotPayload);
  const messageIndex = stored.sheets.CONFIG_THONG_BAO.columns.indexOf('message_text');

  assert.ok(result.diagnostics.normalized_config_json.length > 50000);
  assert.ok(snapshotPayload.length < 50000);
  assert.equal(stored.__snapshot_format, 'columnar-v1');
  assert.equal(stored.__fingerprint, result.response.fingerprint);
  assert.ok(stored.sheets.CONFIG_THONG_BAO.rows.some((row) => row[messageIndex] === 'Same configured message text'));
});

test('WF03 carries router table requests and keeps command policy Sheet-driven', async () => {
  const workflows = await loadGeneratedWorkflows();
  const router = workflows.find((workflow) => workflow.name === 'WF03_V2_TELEGRAM_ROUTER');
  assert.equal(router.nodes.filter((node) => node.type === 'n8n-nodes-base.telegramTrigger').length, 1);
  const decision = router.nodes.find((node) => node.name === 'Router Decision');
  assert.ok(decision);
  assert.match(decision.parameters.jsCode, /CONFIG_LENH/);
  const normalize = router.nodes.find((node) => node.name === 'Normalize Telegram Update');
  assert.ok(normalize.parameters.jsCode.includes('requiredSheetNames(normalized.command)'));
  assert.ok(normalize.parameters.jsCode.includes('const HELP_ROUTER_SHEETS = Object.freeze(['));
  assert.ok(normalize.parameters.jsCode.includes("if (normalized === '/help') return [...HELP_ROUTER_SHEETS]"));
  assert.doesNotMatch(JSON.stringify(router), /KIEM_KE_WRITE/);
  assert.ok(router.nodes.some((node) => node.name === 'Append EVENT_LOG'));
  assert.ok(router.nodes.some((node) => node.name === 'Append OPERATION reservation'));
  assert.ok(router.nodes.some((node) => node.name === 'Split Router Reply'));
  const reservation = router.nodes.find((node) => node.name === 'Append OPERATION reservation');
  const audit = router.nodes.find((node) => node.name === 'Append EVENT_LOG');
  assert.equal(reservation.parameters.operation, 'appendOrUpdate');
  assert.deepEqual(reservation.parameters.columns.matchingColumns, ['idempotency_key']);
  assert.equal(audit.parameters.operation, 'appendOrUpdate');
  assert.deepEqual(audit.parameters.columns.matchingColumns, ['event_id']);
});

test('WF03 preserves the reply after audit writes and acknowledges callback queries', async () => {
  const workflows = await loadGeneratedWorkflows();
  const router = workflows.find((workflow) => workflow.name === 'WF03_V2_TELEGRAM_ROUTER');
  assert.ok(router.nodes.some((node) => node.name === 'Restore Router Reply'));
  assert.deepEqual(router.connections['Append EVENT_LOG'].main[0].map((target) => target.node), ['Restore Router Reply']);
  assert.deepEqual(router.connections['Restore Router Reply'].main[0].map((target) => target.node), ['Split Router Reply']);
  const callback = router.nodes.find((node) => node.name === 'Answer Telegram Callback');
  assert.equal(callback.parameters.resource, 'callback');
  assert.equal(callback.parameters.operation, 'answerQuery');
  assert.deepEqual(router.connections['Normalize Telegram Update'].main[0].map((target) => target.node), ['Status command?', 'Callback query?']);
});

test('WF03 invokes a selected worker with only the standard envelope and handles child errors', async () => {
  const workflows = await loadGeneratedWorkflows();
  const router = workflows.find((workflow) => workflow.name === 'WF03_V2_TELEGRAM_ROUTER');
  const prepare = router.nodes.find((node) => node.name === 'Prepare Worker Dispatch');
  assert.ok(prepare);
  assert.doesNotMatch(prepare.parameters.jsCode, /decision\.kind === 'RETRY'/);
  assert.match(prepare.parameters.jsCode, /command\?\.worker_target \?\? command\?\.worker_workflow/);
  const routeCheck = router.nodes.find((node) => node.name === 'Route reservation required?');
  assert.match(routeCheck.parameters.conditions.conditions[0].leftValue, /decision\?\.kind === 'ROUTE'/);
  assert.doesNotMatch(routeCheck.parameters.conditions.conditions[0].leftValue, /RETRY/);

  for (const target of WORKER_TARGETS) {
    const call = router.nodes.find((node) => node.name === target.node_name);
    const projection = router.nodes.find((node) => node.name === `Project Standard Envelope ${target.workflow_name}`);
    const check = router.nodes.find((node) => node.name === `Worker target ${target.workflow_name}?`);
    assert.ok(call, `missing call for ${target.workflow_name}`);
    assert.equal(call.onError, 'continueErrorOutput');
    assert.ok(projection, `missing envelope projection for ${target.workflow_name}`);
    assert.match(projection.parameters.jsCode, /return \[\{ json: envelope \}\]/);
    assert.deepEqual(router.connections[check.name].main[0].map((targetNode) => targetNode.node), [projection.name]);
    assert.deepEqual(router.connections[projection.name].main[0].map((targetNode) => targetNode.node), [call.name]);
    assert.deepEqual(router.connections[call.name].main[0].map((targetNode) => targetNode.node), ['Worker result successful?']);
    assert.deepEqual(router.connections[call.name].main[1].map((targetNode) => targetNode.node), ['Prepare Worker Error Handler Input']);
  }

  const projectReservation = router.nodes.find((node) => node.name === 'Project OPERATION reservation');
  assert.match(projectReservation.parameters.jsCode, /decision\?\.reservation/);
  assert.doesNotMatch(projectReservation.parameters.jsCode, /RETRY/);
  const workerResultCheck = router.nodes.find((node) => node.name === 'Worker result successful?');
  assert.ok(workerResultCheck);
  assert.match(workerResultCheck.parameters.conditions.conditions[0].leftValue, /\$json\.ok === true/);
  assert.deepEqual(router.connections['Worker result successful?'].main[0].map((target) => target.node), ['Prepare Worker Success Reservation']);
  assert.deepEqual(router.connections['Worker result successful?'].main[1].map((target) => target.node), ['Prepare Worker Error Handler Input']);
  const prepareSuccess = router.nodes.find((node) => node.name === 'Prepare Worker Success Reservation');
  assert.match(prepareSuccess.parameters.jsCode, /result\.ok === true \? 'COMMITTED' : 'FAILED'/);
  assert.deepEqual(router.nodes.find((node) => node.name === 'Call Error Handler - Worker Failure').parameters.workflowId, { __rl: true, value: '', mode: 'list' });
  assert.deepEqual(router.connections['Append OPERATION reservation'].main[0].map((target) => target.node), ['Prepare Worker Dispatch']);
  assert.ok(router.nodes.some((node) => node.name === 'Commit Router Dispatch Reservation' && node.parameters.columns.matchingColumns[0] === 'idempotency_key'));
  assert.ok(router.nodes.some((node) => node.name === 'Fail Router Dispatch Reservation' && node.parameters.columns.matchingColumns[0] === 'idempotency_key'));
});
