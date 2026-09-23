import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gatewayCode, assembleCode, retryContextLookupCode, planRowCode, errorInputCode } from '../workflow-src/WF01_V2_CONFIG_GATEWAY.mjs';
import { errorCode, errorRowCode, returnErrorCode } from '../workflow-src/WF02_V2_ERROR_HANDLER.mjs';
import { normalizeCode, decisionCode } from '../workflow-src/WF03_V2_TELEGRAM_ROUTER.mjs';
import { availableWorkerTargets } from '../src/telegram-router/worker-targets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'workflows');
const CORE_SHEETS = ['CONFIG_SCHEMA', 'CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', 'CONFIG_SNAPSHOT', 'OPERATION', 'ERROR_BIA'];
const ROUTER_SHEETS = ['CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH', 'EVENT_LOG'];
const GOOGLE_SHEET_ID = '1wQ76EpIx35Trkx5JZg8GZ0xZsEBcKAFA6eb7nKDvLu4';
const GOOGLE_CREDENTIAL = 'GOOGLE_SHEETS_KKB_V2';
const TELEGRAM_CREDENTIAL = 'TELEGRAM_KKB_V2';

const id = (name) => `kkb-v2-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
const pos = (x, y) => [x, y];

function node({ name, type, typeVersion = 2, parameters = {}, position = [0, 0], credentials, notes }) {
  return { parameters, id: id(name), name, type, typeVersion, position, ...(credentials ? { credentials } : {}), ...(notes ? { notes } : {}) };
}

function googleSheetNode(name, sheetName, operation = 'read', extra = {}) {
  const parameters = {
    operation,
    documentId: { __rl: true, value: GOOGLE_SHEET_ID, mode: 'id' },
    sheetName: { __rl: true, value: sheetName, mode: 'name' },
    options: { returnAll: true },
    ...extra,
  };
  const result = node({ name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, parameters, credentials: { googleSheetsOAuth2Api: { name: GOOGLE_CREDENTIAL } } });
  if (operation === 'read') {
    // Read nodes can receive one item for every upstream row. Execute once
    // prevents a linear chain of reads from multiplying Google Sheets calls.
    result.alwaysOutputData = true;
    result.executeOnce = true;
  }
  return result;
}

function googleSheetUpdateNode(name, sheetName, matchingColumn, columns = [matchingColumn, 'status']) {
  return googleSheetNode(name, sheetName, 'update', {
    columns: {
      mappingMode: 'defineBelow',
      value: Object.fromEntries(columns.map((column) => [column, `={{$json.${column}}}`])),
      matchingColumns: [matchingColumn],
      schema: columns.map((idValue) => ({ id: idValue, displayName: idValue, required: false, defaultMatch: idValue === matchingColumn, display: true, type: 'string', canBeUsedToMatch: true })),
      attemptToConvertTypes: false,
      convertFieldsToString: true,
    },
  });
}

function workflowListReference() {
  return { __rl: true, value: '', mode: 'list' };
}

function executeTrigger(name = 'Execute Workflow Trigger') {
  return node({ name, type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1 });
}

function link(connections, from, to, output = 0) {
  connections[from] ??= { main: [] };
  connections[from].main[output] ??= [];
  connections[from].main[output].push({ node: to, type: 'main', index: 0 });
}

function requestedSheetCondition(sheetName) {
  return `={{Array.isArray($('Execute Workflow Trigger').first()?.json?.envelope?.payload?.required_sheet_names) && $('Execute Workflow Trigger').first().json.envelope.payload.required_sheet_names.includes('${sheetName}')}}`;
}

function booleanIfParameters(leftValue) {
  return {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ leftValue, rightValue: true, operator: { type: 'boolean', operation: 'true' } }],
      combinator: 'and',
    },
    options: {},
  };
}

function baseWorkflow(name, nodes, connections) {
  return {
    name,
    nodes,
    connections,
    active: false,
    settings: { executionOrder: 'v1' },
    versionId: id(`${name}-version`),
    meta: { templateCredsSetupCompleted: false },
    pinData: {},
    tags: [],
  };
}

async function buildGatewayWorkflow() {
  const trigger = executeTrigger();
  const reads = CORE_SHEETS.map((sheet, index) => {
    const item = googleSheetNode(`Read ${sheet}`, sheet);
    item.position = pos(260, -360 + index * 90);
    return item;
  });
  const routerReads = ROUTER_SHEETS.map((sheet, index) => {
    const item = googleSheetNode(`Read ${sheet}`, sheet);
    item.position = pos(520, -360 + index * 90);
    return item;
  });
  const routerSelectors = ROUTER_SHEETS.map((sheet, index) => node({
    name: `Router sheet ${sheet} requested?`,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    parameters: booleanIfParameters(requestedSheetCondition(sheet)),
    position: pos(760, 520 + index * 90),
    notes: `Read ${sheet} only when required_sheet_names includes this sheet.`,
  }));
  const resolveRetryContext = node({ name: 'Resolve Retry Context Lookup', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: retryContextLookupCode() }, position: pos(1040, 520), notes: 'Find the latest requested ERROR_BIA row and project only its operation_id.' });
  const retryContextRequested = node({ name: 'Retry context requested?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{$json.retry_context_requested === true}}'), position: pos(1260, 520) });
  const readRetryContext = googleSheetNode('Read RETRY_CONTEXT', 'RETRY_CONTEXT', 'read', {
    filtersUI: { values: [{ lookupColumn: 'operation_id', lookupValue: '={{$json.operation_id}}' }] },
    options: { returnFirstMatch: true },
  });
  readRetryContext.position = pos(1480, 520);
  const assemble = node({ name: 'Assemble Config Tables', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await assembleCode() }, position: pos(560, 0) });
  const decision = node({ name: 'Evaluate Config Gateway', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await gatewayCode() }, position: pos(820, 0) });
  const routerRequested = node({ name: 'Router tables requested?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{Array.isArray($('Execute Workflow Trigger').first()?.json?.envelope?.payload?.required_sheet_names) && $('Execute Workflow Trigger').first().json.envelope.payload.required_sheet_names.length > 0}}"), position: pos(520, 520), notes: 'Only read router tabs for commands that request them; /trangthai remains compatible with a core-only Sheet.' });
  const branch = node({ name: 'Gateway OK?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{$json.ok === true}}'), position: pos(1080, 0) });
  const writeRequired = node({ name: 'Write plan required?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{($json.write_plan?.length ?? 0) > 0}}'), position: pos(1330, -100) });
  const prepareOperationRow = node({ name: 'Prepare OPERATION row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: planRowCode(0) }, position: pos(1570, -100) });
  const prepareOperation = googleSheetNode('Prepare OPERATION', 'OPERATION', 'appendOrUpdate', { columns: { mappingMode: 'autoMapInputData', matchingColumns: ['operation_id'] } });
  prepareOperation.position = pos(1810, -100);
  const prepareSnapshotRow = node({ name: 'Prepare CONFIG_SNAPSHOT row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: planRowCode(1) }, position: pos(2050, -100) });
  const prepareSnapshot = googleSheetNode('Prepare CONFIG_SNAPSHOT', 'CONFIG_SNAPSHOT', 'appendOrUpdate', { columns: { mappingMode: 'autoMapInputData', matchingColumns: ['config_snapshot_id'] } });
  prepareSnapshot.position = pos(2290, -100);
  const commitSnapshotRow = node({ name: 'Commit CONFIG_SNAPSHOT row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: planRowCode(2) }, position: pos(2530, -100) });
  const commitSnapshot = googleSheetUpdateNode('Commit CONFIG_SNAPSHOT', 'CONFIG_SNAPSHOT', 'config_snapshot_id');
  commitSnapshot.position = pos(2770, -100);
  const commitOperationRow = node({ name: 'Commit OPERATION row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: planRowCode(3) }, position: pos(3010, -100) });
  const commitOperation = googleSheetUpdateNode('Commit OPERATION', 'OPERATION', 'operation_id', ['operation_id', 'status', 'actual_row_count', 'updated_at']);
  commitOperation.position = pos(3250, -100);
  const returnStatus = node({ name: 'Return Gateway Result', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const input = $input.first()?.json ?? {}; if (input.reply_target?.chat_id && input.response?.message_safe) return []; const result = $('Evaluate Config Gateway').first()?.json ?? {}; return [{ json: result }];" }, position: pos(3490, -100) });
  const errorInput = node({ name: 'Prepare Error Handler Input', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: errorInputCode() }, position: pos(1570, 180) });
  const errorCall = node({ name: 'Call Error Handler', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: workflowListReference(), options: { waitForSubWorkflow: true } }, position: pos(1810, 180), notes: 'After import, select WF02_V2_ERROR_HANDLER from the n8n workflow list.' });
  const nodes = [trigger, ...reads, routerRequested, ...routerSelectors, ...routerReads, resolveRetryContext, retryContextRequested, readRetryContext, assemble, decision, branch, writeRequired, prepareOperationRow, prepareOperation, prepareSnapshotRow, prepareSnapshot, commitSnapshotRow, commitSnapshot, commitOperationRow, commitOperation, returnStatus, errorInput, errorCall];
  const connections = {};
  link(connections, trigger.name, reads[0].name);
  for (let index = 0; index < reads.length - 1; index += 1) link(connections, reads[index].name, reads[index + 1].name);
  link(connections, reads.at(-1).name, routerRequested.name);
  link(connections, routerRequested.name, routerSelectors[0].name, 0);
  link(connections, routerRequested.name, assemble.name, 1);
  for (let index = 0; index < routerSelectors.length; index += 1) {
    const selector = routerSelectors[index];
    const read = routerReads[index];
    const next = routerSelectors[index + 1]?.name;
    if (next) {
      link(connections, selector.name, read.name, 0);
      link(connections, selector.name, next, 1);
      link(connections, read.name, next);
    } else {
      link(connections, selector.name, read.name, 0);
      link(connections, selector.name, resolveRetryContext.name, 1);
      link(connections, read.name, resolveRetryContext.name);
    }
  }
  link(connections, resolveRetryContext.name, retryContextRequested.name);
  link(connections, retryContextRequested.name, readRetryContext.name, 0);
  link(connections, retryContextRequested.name, assemble.name, 1);
  link(connections, readRetryContext.name, assemble.name);
  link(connections, assemble.name, decision.name);
  link(connections, decision.name, branch.name);
  link(connections, branch.name, writeRequired.name, 0);
  link(connections, branch.name, errorInput.name, 1);
  link(connections, writeRequired.name, prepareOperationRow.name, 0);
  link(connections, writeRequired.name, returnStatus.name, 1);
  link(connections, prepareOperationRow.name, prepareOperation.name);
  link(connections, prepareOperation.name, prepareSnapshotRow.name);
  link(connections, prepareSnapshotRow.name, prepareSnapshot.name);
  link(connections, prepareSnapshot.name, commitSnapshotRow.name);
  link(connections, commitSnapshotRow.name, commitSnapshot.name);
  link(connections, commitSnapshot.name, commitOperationRow.name);
  link(connections, commitOperationRow.name, commitOperation.name);
  link(connections, commitOperation.name, returnStatus.name);
  link(connections, errorInput.name, errorCall.name);
  link(connections, errorCall.name, returnStatus.name);
  const workflow = baseWorkflow('WF01_V2_CONFIG_GATEWAY', nodes, connections);
  workflow.settings.redactionPolicy = 'all';
  return workflow;
}

async function buildErrorWorkflow() {
  const execute = executeTrigger();
  const trigger = node({ name: 'Error Trigger', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: pos(0, 220) });
  const normalize = node({ name: 'Normalize Workflow Error', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await errorCode() }, position: pos(300, 80) });
  const errorRow = node({ name: 'Project ERROR_BIA row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await errorRowCode() }, position: pos(300, -40) });
  const append = googleSheetNode('Append ERROR_BIA', 'ERROR_BIA', 'append', { columns: { mappingMode: 'autoMapInputData' } });
  append.position = pos(580, -40);
  const replyCheck = node({ name: 'Reply target exists?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{!!$json.reply_target?.chat_id}}'), position: pos(580, 200) });
  const send = node({ name: 'Send Safe Error Reply', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, parameters: { resource: 'message', operation: 'sendMessage', chatId: '={{$json.reply_target.chat_id}}', text: '={{$json.response.message_safe}}', additionalFields: { message_thread_id: '={{$json.reply_target.message_thread_id}}' } }, credentials: { telegramApi: { name: TELEGRAM_CREDENTIAL } }, position: pos(860, 220) });
  const result = node({ name: 'Return Error Result', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: returnErrorCode() }, position: pos(1110, 80) });
  const nodes = [execute, trigger, normalize, errorRow, append, replyCheck, send, result];
  const connections = {};
  link(connections, execute.name, normalize.name);
  link(connections, trigger.name, normalize.name);
  link(connections, normalize.name, errorRow.name);
  link(connections, errorRow.name, append.name);
  link(connections, normalize.name, replyCheck.name);
  link(connections, replyCheck.name, send.name, 0);
  link(connections, append.name, result.name);
  link(connections, send.name, result.name);
  return baseWorkflow('WF02_V2_ERROR_HANDLER', nodes, connections);
}

async function buildRouterWorkflow() {
  const trigger = node({ name: 'Telegram Trigger', type: 'n8n-nodes-base.telegramTrigger', typeVersion: 1.2, parameters: { updates: ['message', 'edited_message', 'callback_query'] }, credentials: { telegramApi: { name: TELEGRAM_CREDENTIAL } }, position: pos(0, 0) });
  const normalize = node({ name: 'Normalize Telegram Update', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await normalizeCode() }, position: pos(260, -80) });
  const statusCheck = node({ name: 'Status command?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{$json.command === '/trangthai'}}"), position: pos(520, -80) });
  const callGateway = node({ name: 'Call Config Gateway', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: workflowListReference(), options: { waitForSubWorkflow: true } }, position: pos(780, -160), notes: 'After import, select WF01_V2_CONFIG_GATEWAY from the n8n workflow list.' });
  const callUnsupportedGateway = node({ name: 'Call Config Gateway - Command Check', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: workflowListReference(), options: { waitForSubWorkflow: true } }, position: pos(780, 120), notes: 'After import, select WF01_V2_CONFIG_GATEWAY from the n8n workflow list. Reads configured message templates without invoking a business worker.' });
  const decision = node({ name: 'Router Decision', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await decisionCode() }, position: pos(1040, -40), notes: 'Reads Sheet-driven roles/permissions/topics/commands and writes denied-access events to EVENT_LOG.' });
  const routeCheck = node({ name: 'Route reservation required?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{$json.decision?.kind === 'ROUTE'}}"), position: pos(1240, -180), notes: 'Reserve a router-specific idempotency key before invoking a business worker.' });
  const projectReservation = node({ name: 'Project OPERATION reservation', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const reservation = $json.decision?.reservation; if (!reservation?.row) return []; return [{ json: reservation.row }];" }, position: pos(1460, -240) });
  const appendReservation = googleSheetNode('Append OPERATION reservation', 'OPERATION', 'appendOrUpdate', { columns: { mappingMode: 'autoMapInputData', matchingColumns: ['idempotency_key'] } });
  appendReservation.position = pos(1680, -240);
  const prepareWorkerDispatch = node({ name: 'Prepare Worker Dispatch', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const source = $('Router Decision').first()?.json ?? {}; const decision = source.decision ?? {}; const command = decision.route; const reservation = decision.reservation; const workerTarget = command?.worker_target ?? command?.worker_workflow; if (!command?.envelope || !workerTarget || !reservation?.row) return []; return [{ json: { ...command.envelope, envelope: command.envelope, worker_target: workerTarget, reply_target: source.reply_target, router_text: source.text, messages: source.messages ?? {}, reservation: reservation.row } }];" }, position: pos(1900, -240), notes: 'Projects a clean standard envelope into the child call; router metadata is used only by the parent reply/error path.' });
  const workerChecks = availableWorkerTargets().map((target, index) => node({
    name: `Worker target ${target.workflow_name}?`,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    parameters: booleanIfParameters(`={{$json.worker_target === '${target.workflow_name}'}}`),
    position: pos(2120 + index * 300, -360),
    notes: `Dispatches only to the configured target ${target.workflow_name}.`,
  }));
  const workerCalls = availableWorkerTargets().map((target, index) => {
    const call = node({ name: target.node_name, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: workflowListReference(), options: { waitForSubWorkflow: true } }, position: pos(2340 + index * 300, -480), notes: `After import, select ${target.workflow_name} from the n8n workflow list.` });
    call.onError = 'continueErrorOutput';
    return call;
  });
  const projectWorkerEnvelopes = availableWorkerTargets().map((target, index) => node({ name: `Project Standard Envelope ${target.workflow_name}`, type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const envelope = $json.envelope; if (!envelope?.request_id || !envelope?.operation_id || !envelope?.payload) return []; return [{ json: envelope }];" }, position: pos(2340 + index * 300, -600), notes: 'The called workflow receives only the standard envelope object.' }));
  const workerResultCheck = node({ name: 'Worker result successful?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{$json.ok === true}}'), position: pos(3360, -500), notes: 'Only an explicit standard-envelope success may commit the router reservation; returned failures and malformed results go through WF02.' });
  const prepareWorkerSuccess = node({ name: 'Prepare Worker Success Reservation', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const dispatch = $('Prepare Worker Dispatch').first()?.json ?? {}; const result = $input.first()?.json ?? {}; const reservation = dispatch.reservation ?? {}; return [{ json: { idempotency_key: reservation.idempotency_key, status: result.ok === true ? 'COMMITTED' : 'FAILED', actual_row_count: result.ok === true ? '1' : '0', updated_at: new Date().toISOString(), worker_result: result } }];" }, position: pos(3580, -500) });
  const commitWorkerReservation = googleSheetUpdateNode('Commit Router Dispatch Reservation', 'OPERATION', 'idempotency_key', ['idempotency_key', 'status', 'actual_row_count', 'updated_at']);
  commitWorkerReservation.position = pos(3800, -500);
  const restoreWorkerReply = node({ name: 'Restore Worker Reply', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const source = $('Router Decision').first()?.json ?? {}; const result = $('Prepare Worker Success Reservation').first()?.json?.worker_result ?? {}; const explicit = result.message_safe ?? result.response?.message_safe; const code = /^[A-Z0-9_]+$/.test(String(result.error_code ?? '')) ? String(result.error_code) : 'WORKER_FAILED'; const text = typeof explicit === 'string' && explicit.trim() ? explicit : result.ok === false ? `Không thể hoàn tất thao tác. Mã lỗi: ${code}` : source.text; return [{ json: { ...source, text: String(text ?? '').slice(0, 4096) } }];" }, position: pos(4020, -500), notes: 'Uses only the worker safe message or configured router acknowledgement; raw exception objects are never sent to Telegram.' });
  const prepareWorkerError = node({ name: 'Prepare Worker Error Handler Input', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const dispatch = $('Prepare Worker Dispatch').first()?.json ?? {}; const item = $input.first()?.json ?? {}; const source = $('Router Decision').first()?.json ?? {}; return [{ json: { error: item.error ?? item, context: { request_id: dispatch.request_id, operation_id: dispatch.operation_id, workflow: dispatch.worker_target, node: 'Execute Sub-workflow', config_version: dispatch.config_version, branch_id: dispatch.branch_id, idempotency_key: dispatch.payload?.idempotency_key }, reply_target: dispatch.reply_target, messages: source.messages ?? {} } }];" }, position: pos(3580, -220) });
  const callWorkerErrorHandler = node({ name: 'Call Error Handler - Worker Failure', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: workflowListReference(), options: { waitForSubWorkflow: true } }, position: pos(3800, -220), notes: 'After import, select WF02_V2_ERROR_HANDLER from the n8n workflow list.' });
  const prepareFailedReservation = node({ name: 'Prepare Failed Router Reservation', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const dispatch = $('Prepare Worker Dispatch').first()?.json ?? {}; const reservation = dispatch.reservation ?? {}; return [{ json: { idempotency_key: reservation.idempotency_key, status: 'FAILED', actual_row_count: '0', updated_at: new Date().toISOString() } }];" }, position: pos(4020, -220) });
  const failWorkerReservation = googleSheetUpdateNode('Fail Router Dispatch Reservation', 'OPERATION', 'idempotency_key', ['idempotency_key', 'status', 'actual_row_count', 'updated_at']);
  failWorkerReservation.position = pos(4240, -220);
  const auditCheck = node({ name: 'Router audit write required?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{($json.decision?.write_plan?.length ?? 0) > 0}}'), position: pos(1260, 120) });
  const projectAudit = node({ name: 'Project EVENT_LOG row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const entry = $json.decision?.write_plan?.[0]; if (!entry) return []; return [{ json: entry.row }];" }, position: pos(1480, 120) });
  const appendAudit = googleSheetNode('Append EVENT_LOG', 'EVENT_LOG', 'appendOrUpdate', { columns: { mappingMode: 'autoMapInputData', matchingColumns: ['event_id'] } });
  appendAudit.position = pos(1700, 120);
  const restoreReply = node({ name: 'Restore Router Reply', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const reply = $('Router Decision').first()?.json ?? {}; return [{ json: reply }];" }, position: pos(4440, 40), notes: 'Restores reply_target/text after Google Sheets replaces the item with the appended row.' });
  const splitReply = node({ name: 'Split Router Reply', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const source = $json; const chars = Array.from(String(source.text ?? '')); const limit = 4096; if (chars.length === 0) return [{ json: { ...source, text: '' } }]; const chunks = []; for (let index = 0; index < chars.length; index += limit) chunks.push({ json: { ...source, text: chars.slice(index, index + limit).join('') } }); return chunks;" }, position: pos(2140, 40), notes: 'Telegram text limit is technical; preserve every /help line by sending multiple chunks.' });
  const send = node({ name: 'Send Telegram Reply', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, parameters: { resource: 'message', operation: 'sendMessage', chatId: '={{$json.reply_target.chat_id}}', text: '={{$json.text}}', additionalFields: { message_thread_id: '={{$json.reply_target.message_thread_id}}' } }, credentials: { telegramApi: { name: TELEGRAM_CREDENTIAL } }, position: pos(2360, 40) });
  const callbackCheck = node({ name: 'Callback query?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{!!$('Normalize Telegram Update').first()?.json?.callback?.id}}"), position: pos(1540, -40), notes: 'Only callback_query updates need answerQuery; normal messages skip this branch.' });
  const callbackAnswer = node({ name: 'Answer Telegram Callback', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, parameters: { resource: 'callback', operation: 'answerQuery', queryId: "={{$('Normalize Telegram Update').first()?.json?.callback?.id}}", additionalFields: {} }, credentials: { telegramApi: { name: TELEGRAM_CREDENTIAL } }, position: pos(1780, -40), notes: 'Acknowledges the inline-keyboard callback so Telegram clears its loading indicator.' });
  const nodes = [trigger, normalize, statusCheck, callGateway, callUnsupportedGateway, decision, routeCheck, projectReservation, appendReservation, prepareWorkerDispatch, ...workerChecks, ...projectWorkerEnvelopes, ...workerCalls, workerResultCheck, prepareWorkerSuccess, commitWorkerReservation, restoreWorkerReply, prepareWorkerError, callWorkerErrorHandler, prepareFailedReservation, failWorkerReservation, auditCheck, projectAudit, appendAudit, restoreReply, splitReply, send, callbackCheck, callbackAnswer];
  const connections = {};
  link(connections, trigger.name, normalize.name);
  link(connections, normalize.name, statusCheck.name);
  link(connections, normalize.name, callbackCheck.name);
  link(connections, statusCheck.name, callGateway.name, 0);
  link(connections, statusCheck.name, callUnsupportedGateway.name, 1);
  link(connections, callGateway.name, decision.name);
  link(connections, callUnsupportedGateway.name, decision.name);
  link(connections, decision.name, routeCheck.name);
  link(connections, routeCheck.name, projectReservation.name, 0);
  link(connections, routeCheck.name, auditCheck.name, 1);
  link(connections, projectReservation.name, appendReservation.name);
  link(connections, appendReservation.name, prepareWorkerDispatch.name);
  workerChecks.forEach((check, index) => {
    if (index === 0) link(connections, prepareWorkerDispatch.name, check.name);
    else link(connections, workerChecks[index - 1].name, check.name, 1);
    link(connections, check.name, projectWorkerEnvelopes[index].name, 0);
    link(connections, projectWorkerEnvelopes[index].name, workerCalls[index].name);
    link(connections, workerCalls[index].name, workerResultCheck.name, 0);
    link(connections, workerCalls[index].name, prepareWorkerError.name, 1);
  });
  link(connections, workerResultCheck.name, prepareWorkerSuccess.name, 0);
  link(connections, workerResultCheck.name, prepareWorkerError.name, 1);
  link(connections, workerChecks.at(-1).name, restoreReply.name, 1);
  link(connections, prepareWorkerSuccess.name, commitWorkerReservation.name);
  link(connections, commitWorkerReservation.name, restoreWorkerReply.name);
  link(connections, restoreWorkerReply.name, splitReply.name);
  link(connections, prepareWorkerError.name, callWorkerErrorHandler.name);
  link(connections, callWorkerErrorHandler.name, prepareFailedReservation.name);
  link(connections, prepareFailedReservation.name, failWorkerReservation.name);
  link(connections, auditCheck.name, projectAudit.name, 0);
  link(connections, auditCheck.name, restoreReply.name, 1);
  link(connections, projectAudit.name, appendAudit.name);
  link(connections, appendAudit.name, restoreReply.name);
  link(connections, restoreReply.name, splitReply.name);
  link(connections, splitReply.name, send.name);
  link(connections, callbackCheck.name, callbackAnswer.name, 0);
  return baseWorkflow('WF03_V2_TELEGRAM_ROUTER', nodes, connections);
}

const workflows = [await buildGatewayWorkflow(), await buildErrorWorkflow(), await buildRouterWorkflow()];
await mkdir(outputDir, { recursive: true });
for (const workflow of workflows) {
  const filename = `${workflow.name}.json`;
  await writeFile(path.join(outputDir, filename), `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
}
console.log(`Built ${workflows.length} V2 workflows in ${outputDir}`);
