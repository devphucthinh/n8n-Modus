import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gatewayCode, assembleCode, planRowCode, errorInputCode } from '../workflow-src/WF01_V2_CONFIG_GATEWAY.mjs';
import { errorCode, errorRowCode, returnErrorCode } from '../workflow-src/WF02_V2_ERROR_HANDLER.mjs';
import { normalizeCode, decisionCode } from '../workflow-src/WF03_V2_TELEGRAM_ROUTER.mjs';
import { dispatcherCode } from '../workflow-src/WF04_V2_DISPATCHER.mjs';
import { inventorySessionCode } from '../workflow-src/WF05_V2_MO_PHIEN_KIEM_KE.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'workflows');
const CORE_SHEETS = ['CONFIG_SCHEMA', 'CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', 'CONFIG_SNAPSHOT', 'OPERATION', 'ERROR_BIA'];
const ROUTER_SHEETS = ['CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH', 'EVENT_LOG'];
const DISPATCHER_SHEETS = ['CONFIG_LICH'];
const OPTIONAL_SHEETS = [...ROUTER_SHEETS, ...DISPATCHER_SHEETS];
const GOOGLE_SHEET_ID = '1wQ76EpIx35Trkx5JZg8GZ0xZsEBcKAFA6eb7nKDvLu4';
const WF01_WORKFLOW_ID = 'WEL83s9bZeB3ixxF';
const WF02_WORKFLOW_ID = 'MoG6coBccYkIS0nK';
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
  const routerReads = OPTIONAL_SHEETS.map((sheet, index) => {
    const item = googleSheetNode(`Read ${sheet}`, sheet);
    item.position = pos(520, -360 + index * 90);
    return item;
  });
  const routerSelectors = OPTIONAL_SHEETS.map((sheet, index) => node({
    name: `Router sheet ${sheet} requested?`,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.2,
    parameters: booleanIfParameters(requestedSheetCondition(sheet)),
    position: pos(760, 520 + index * 90),
    notes: `Read ${sheet} only when required_sheet_names includes this sheet.`,
  }));
  const assemble = node({ name: 'Assemble Config Tables', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await assembleCode() }, position: pos(560, 0) });
  const decision = node({ name: 'Evaluate Config Gateway', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await gatewayCode() }, position: pos(820, 0) });
  const routerRequested = node({ name: 'Router tables requested?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{Array.isArray($('Execute Workflow Trigger').first()?.json?.envelope?.payload?.required_sheet_names) && $('Execute Workflow Trigger').first().json.envelope.payload.required_sheet_names.length > 0}}"), position: pos(520, 520), notes: 'Only read router tabs for commands that request them; /trangthai remains compatible with a core-only Sheet.' });
  const branch = node({ name: 'Gateway OK?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{$json.ok === true}}'), position: pos(1080, 0) });
  const writeRequired = node({ name: 'Write plan required?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{($json.write_plan?.length ?? 0) > 0}}'), position: pos(1330, -100) });
  const prepareOperationRow = node({ name: 'Prepare OPERATION row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: planRowCode(0) }, position: pos(1570, -100) });
  const prepareOperation = googleSheetNode('Prepare OPERATION', 'OPERATION', 'append', { columns: { mappingMode: 'autoMapInputData' } });
  prepareOperation.position = pos(1810, -100);
  const prepareSnapshotRow = node({ name: 'Prepare CONFIG_SNAPSHOT row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: planRowCode(1) }, position: pos(2050, -100) });
  const prepareSnapshot = googleSheetNode('Prepare CONFIG_SNAPSHOT', 'CONFIG_SNAPSHOT', 'append', { columns: { mappingMode: 'autoMapInputData' } });
  prepareSnapshot.position = pos(2290, -100);
  const commitSnapshotRow = node({ name: 'Commit CONFIG_SNAPSHOT row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: planRowCode(2) }, position: pos(2530, -100) });
  const commitSnapshot = googleSheetUpdateNode('Commit CONFIG_SNAPSHOT', 'CONFIG_SNAPSHOT', 'config_snapshot_id');
  commitSnapshot.position = pos(2770, -100);
  const commitOperationRow = node({ name: 'Commit OPERATION row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: planRowCode(3) }, position: pos(3010, -100) });
  const commitOperation = googleSheetUpdateNode('Commit OPERATION', 'OPERATION', 'operation_id', ['operation_id', 'status', 'actual_row_count', 'updated_at']);
  commitOperation.position = pos(3250, -100);
  const returnStatus = node({ name: 'Return Gateway Result', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const input = $input.first()?.json ?? {}; if (input.reply_target?.chat_id && input.response?.message_safe) return []; const result = $('Evaluate Config Gateway').first()?.json ?? {}; return [{ json: result }];" }, position: pos(3490, -100) });
  const errorInput = node({ name: 'Prepare Error Handler Input', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: errorInputCode() }, position: pos(1570, 180) });
  const errorCall = node({ name: 'Call Error Handler', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: WF02_WORKFLOW_ID, mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(1810, 180), notes: 'Bound to WF02_V2_ERROR_HANDLER in the current n8n Cloud project.' });
  const nodes = [trigger, ...reads, routerRequested, ...routerSelectors, ...routerReads, assemble, decision, branch, writeRequired, prepareOperationRow, prepareOperation, prepareSnapshotRow, prepareSnapshot, commitSnapshotRow, commitSnapshot, commitOperationRow, commitOperation, returnStatus, errorInput, errorCall];
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
      link(connections, selector.name, assemble.name, 1);
      link(connections, read.name, assemble.name);
    }
  }
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
  return baseWorkflow('WF01_V2_CONFIG_GATEWAY', nodes, connections);
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
  const callGateway = node({ name: 'Call Config Gateway', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: WF01_WORKFLOW_ID, mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(780, -160), notes: 'Bound to WF01_V2_CONFIG_GATEWAY in the current n8n Cloud project.' });
  const callUnsupportedGateway = node({ name: 'Call Config Gateway - Command Check', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: WF01_WORKFLOW_ID, mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(780, 120), notes: 'Reads configured message templates through the current WF01 Config Gateway without invoking a business worker.' });
  const decision = node({ name: 'Router Decision', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await decisionCode() }, position: pos(1040, -40), notes: 'Reads Sheet-driven roles/permissions/topics/commands and writes denied-access events to EVENT_LOG.' });
  const routeCheck = node({ name: 'Route reservation required?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{$json.decision?.kind === 'ROUTE'}}"), position: pos(1240, -180), notes: 'Reserve the route idempotency key before acknowledging an accepted command.' });
  const projectReservation = node({ name: 'Project OPERATION reservation', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const reservation = $json.decision?.reservation; if (!reservation?.row) return []; return [{ json: reservation.row }];" }, position: pos(1460, -240) });
  const appendReservation = googleSheetNode('Append OPERATION reservation', 'OPERATION', 'appendOrUpdate', { columns: { mappingMode: 'autoMapInputData', matchingColumns: ['idempotency_key'] } });
  appendReservation.position = pos(1680, -240);
  const auditCheck = node({ name: 'Router audit write required?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{($json.decision?.write_plan?.length ?? 0) > 0}}'), position: pos(1260, 120) });
  const projectAudit = node({ name: 'Project EVENT_LOG row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const entry = $json.decision?.write_plan?.[0]; if (!entry) return []; return [{ json: entry.row }];" }, position: pos(1480, 120) });
  const appendAudit = googleSheetNode('Append EVENT_LOG', 'EVENT_LOG', 'appendOrUpdate', { columns: { mappingMode: 'autoMapInputData', matchingColumns: ['event_id'] } });
  appendAudit.position = pos(1700, 120);
  const restoreReply = node({ name: 'Restore Router Reply', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const reply = $('Router Decision').first()?.json ?? {}; return [{ json: reply }];" }, position: pos(1920, 40), notes: 'Restores reply_target/text after Google Sheets replaces the item with the appended row.' });
  const splitReply = node({ name: 'Split Router Reply', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const source = $json; const chars = Array.from(String(source.text ?? '')); const limit = 4096; if (chars.length === 0) return [{ json: { ...source, text: '' } }]; const chunks = []; for (let index = 0; index < chars.length; index += limit) chunks.push({ json: { ...source, text: chars.slice(index, index + limit).join('') } }); return chunks;" }, position: pos(2140, 40), notes: 'Telegram text limit is technical; preserve every /help line by sending multiple chunks.' });
  const send = node({ name: 'Send Telegram Reply', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, parameters: { resource: 'message', operation: 'sendMessage', chatId: '={{$json.reply_target.chat_id}}', text: '={{$json.text}}', additionalFields: { message_thread_id: '={{$json.reply_target.message_thread_id}}' } }, credentials: { telegramApi: { name: TELEGRAM_CREDENTIAL } }, position: pos(2360, 40) });
  const callbackCheck = node({ name: 'Callback query?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{!!$('Normalize Telegram Update').first()?.json?.callback?.id}}"), position: pos(1540, -40), notes: 'Only callback_query updates need answerQuery; normal messages skip this branch.' });
  const callbackAnswer = node({ name: 'Answer Telegram Callback', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, parameters: { resource: 'callback', operation: 'answerQuery', queryId: "={{$('Normalize Telegram Update').first()?.json?.callback?.id}}", additionalFields: {} }, credentials: { telegramApi: { name: TELEGRAM_CREDENTIAL } }, position: pos(1780, -40), notes: 'Acknowledges the inline-keyboard callback so Telegram clears its loading indicator.' });
  const nodes = [trigger, normalize, statusCheck, callGateway, callUnsupportedGateway, decision, routeCheck, projectReservation, appendReservation, auditCheck, projectAudit, appendAudit, restoreReply, splitReply, send, callbackCheck, callbackAnswer];
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
  link(connections, appendReservation.name, restoreReply.name);
  link(connections, auditCheck.name, projectAudit.name, 0);
  link(connections, auditCheck.name, restoreReply.name, 1);
  link(connections, projectAudit.name, appendAudit.name);
  link(connections, appendAudit.name, restoreReply.name);
  link(connections, restoreReply.name, splitReply.name);
  link(connections, splitReply.name, send.name);
  link(connections, callbackCheck.name, callbackAnswer.name, 0);
  return baseWorkflow('WF03_V2_TELEGRAM_ROUTER', nodes, connections);
}

async function buildDispatcherWorkflow() {
  const schedule = node({ name: 'Technical Tick 10 Minutes', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] } }, position: pos(0, 0), notes: 'Technical wake-up only. Business schedule is read from CONFIG_LICH through WF01.' });
  const execute = executeTrigger('Execute Dispatcher Trigger');
  const request = node({ name: 'Prepare Dispatcher Gateway Request', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const input = $input.first()?.json ?? {}; const envelope = input.envelope ?? {}; const executionId = typeof $execution !== 'undefined' && $execution.id ? $execution.id : String(Date.now()); return [{json: { envelope: { request_id: envelope.request_id || 'dispatch-' + executionId, operation_id: envelope.operation_id || 'dispatch-' + executionId, event_type: 'SCHEDULED_JOB', actor_user_id: 'SYSTEM', branch_id: null, business_date: null, config_version: null, payload: { intent: 'READ_STATUS', required_sheet_names: ['CONFIG_LICH', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_THONG_BAO'] } } }}];" }, position: pos(260, 0) });
  const callGateway = node({ name: 'Call Config Gateway', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: WF01_WORKFLOW_ID, mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(520, 0), notes: 'Requests CONFIG_LICH and receives the immutable config_snapshot_id.' });
  const readHistory = googleSheetNode('Read DISPATCH_HISTORY', 'DISPATCH_HISTORY');
  readHistory.position = pos(780, 0);
  const readSessions = googleSheetNode('Read PHIEN_KIEM_KE', 'PHIEN_KIEM_KE');
  readSessions.position = pos(1040, 0);
  const readHeartbeat = googleSheetNode('Read HEARTBEAT', 'HEARTBEAT');
  readHeartbeat.position = pos(1300, 0);
  const decide = node({ name: 'Decide Dispatcher Actions', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await dispatcherCode() }, position: pos(1560, 0) });
  const heartbeatCheck = node({ name: 'Heartbeat action?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{$json.kind === 'HEARTBEAT'}}"), position: pos(1560, -160) });
  const appendHeartbeat = googleSheetNode('Append HEARTBEAT', 'HEARTBEAT', 'append', { columns: { mappingMode: 'autoMapInputData' } });
  appendHeartbeat.position = pos(1820, -260);
  const noticeCheck = node({ name: 'Critical or recovery notice?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{!!$json.notice}}"), position: pos(2080, -260) });
  const prepareNotice = node({ name: 'Prepare Dispatcher Notice', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const row = $input.first()?.json ?? {}; const gateway = $('Call Config Gateway').first()?.json ?? {}; const code = 'DISPATCHER_' + String(row.notice || '').toUpperCase(); const messages = gateway.response?.messages || {}; const branch = (gateway.response?.data?.config_tables?.CONFIG_BRANCH || []).find((item) => item.owner_chat_id); return [{json: { error: { error_code: code, error_class: row.notice === 'CRITICAL' ? 'CRITICAL' : 'OPERATIONAL', retryable: false, message_safe: messages[code] || code, operation_id: row.heartbeat_id, request_id: row.heartbeat_id, workflow: 'WF04_V2_DISPATCHER', node: 'Heartbeat', config_version: gateway.response?.config_version || null }, context: { workflow: 'WF04_V2_DISPATCHER', operation_id: row.heartbeat_id, request_id: row.heartbeat_id }, reply_target: branch ? { chat_id: branch.owner_chat_id } : null }}];" }, position: pos(2340, -260) });
  const callError = node({ name: 'Call Error Handler', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: WF02_WORKFLOW_ID, mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(2600, -260), notes: 'Critical and recovery notices use configured safe messages and Error Handler audit/notification policy.' });
  const dispatchCheck = node({ name: 'Dispatch action?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{$json.kind === 'DISPATCH'}}"), position: pos(1820, -40) });
  const recordOutcome = googleSheetNode('Record Dispatch Outcome', 'DISPATCH_HISTORY', 'appendOrUpdate', { columns: { mappingMode: 'defineBelow', value: { dispatch_key: '={{$json.dispatch_key}}', schedule_id: '={{$json.schedule_id}}', job_code: '={{$json.job_code}}', branch_id: '={{$json.branch_id}}', business_date: '={{$json.business_date}}', status: '={{$json.kind === \'WARNING\' ? \'WARNING\' : \'SKIPPED\'}}', skip_reason: '={{$json.reason}}', config_snapshot_id: '={{$json.config_snapshot_id}}', updated_at: '={{$now}}' }, matchingColumns: ['dispatch_key'] } });
  recordOutcome.position = pos(2080, 100);
  const claim = googleSheetNode('Claim DISPATCH_HISTORY', 'DISPATCH_HISTORY', 'appendOrUpdate', { columns: { mappingMode: 'defineBelow', value: { dispatch_key: '={{$json.dispatch_key}}', schedule_id: '={{$json.schedule_id}}', job_code: '={{$json.job_code}}', branch_id: '={{$json.branch_id}}', business_date: '={{$json.business_date}}', scheduled_at: '={{$json.scheduled_at}}', status: 'CLAIMED', attempt_count: '={{$json.attempt_count}}', config_snapshot_id: '={{$json.config_snapshot_id}}', updated_at: '={{$now}}' }, matchingColumns: ['dispatch_key'] } });
  claim.position = pos(2080, -40);
  const worker = node({ name: 'Execute Configured Worker', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: '={{$json.worker_workflow}}', options: { waitForSubWorkflow: true } }, position: pos(2340, -40), notes: 'Worker workflow ID comes from CONFIG_LICH; this node does not select a business worker by hard-coded schedule.' });
  worker.continueOnFail = true;
  const finalize = node({ name: 'Finalize Dispatch History', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const claim = $('Claim DISPATCH_HISTORY').first()?.json ?? {}; const worker = $input.first()?.json ?? {}; const failed = worker.ok !== true; const updatedAt = new Date().toISOString(); const retryAt = failed && Number(claim.retry_delay_minutes) > 0 ? new Date(Date.parse(updatedAt) + Number(claim.retry_delay_minutes) * 60000).toISOString() : ''; return [{json: { ...claim, status: failed ? 'FAILED' : 'SUCCESS', failure_count: failed ? String(Number(claim.failure_count || 0) + 1) : '0', last_error_code: failed ? String(worker.error_code || 'WORKER_FAILED') : '', retry_at: retryAt, updated_at: updatedAt }}];" }, position: pos(2860, -40) });
  const finalizeWrite = googleSheetNode('Update DISPATCH_HISTORY', 'DISPATCH_HISTORY', 'update', { columns: { mappingMode: 'defineBelow', value: { dispatch_key: '={{$json.dispatch_key}}', status: '={{$json.status}}', failure_count: '={{$json.failure_count}}', last_error_code: '={{$json.last_error_code}}', retry_at: '={{$json.retry_at}}', updated_at: '={{$json.updated_at}}' }, matchingColumns: ['dispatch_key'] } });
  finalizeWrite.position = pos(3120, -40);
  const result = node({ name: 'Return Dispatcher Result', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "return $input.all();" }, position: pos(3380, -40) });
  const nodes = [schedule, execute, request, callGateway, readHistory, readSessions, readHeartbeat, decide, heartbeatCheck, appendHeartbeat, noticeCheck, prepareNotice, callError, dispatchCheck, recordOutcome, claim, worker, finalize, finalizeWrite, result];
  const connections = {};
  link(connections, schedule.name, request.name);
  link(connections, execute.name, request.name);
  link(connections, request.name, callGateway.name);
  link(connections, callGateway.name, readHistory.name);
  link(connections, readHistory.name, readSessions.name);
  link(connections, readSessions.name, readHeartbeat.name);
  link(connections, readHeartbeat.name, decide.name);
  link(connections, decide.name, heartbeatCheck.name);
  link(connections, heartbeatCheck.name, appendHeartbeat.name, 0);
  link(connections, heartbeatCheck.name, dispatchCheck.name, 1);
  link(connections, appendHeartbeat.name, noticeCheck.name);
  link(connections, noticeCheck.name, prepareNotice.name, 0);
  link(connections, noticeCheck.name, result.name, 1);
  link(connections, prepareNotice.name, callError.name);
  link(connections, callError.name, result.name);
  link(connections, dispatchCheck.name, claim.name, 0);
  link(connections, dispatchCheck.name, recordOutcome.name, 1);
  link(connections, recordOutcome.name, result.name);
  link(connections, claim.name, worker.name);
  link(connections, worker.name, finalize.name);
  link(connections, finalize.name, finalizeWrite.name);
  link(connections, finalizeWrite.name, result.name);
  return baseWorkflow('WF04_V2_DISPATCHER', nodes, connections);
}

async function buildInventorySessionWorkflow() {
  const execute = executeTrigger();
  const request = node({ name: 'Prepare Session Gateway Request', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const input = $input.first()?.json ?? {}; const incoming = input.envelope ?? input; return [{json: { envelope: { ...incoming, event_type: 'SCHEDULED_JOB', payload: { ...(incoming.payload || {}), required_sheet_names: ['CONFIG_TOPIC'], intent: 'READ_STATUS', dispatch_key: input.dispatch_key || incoming.payload?.dispatch_key, config_snapshot_id: input.config_snapshot_id || incoming.payload?.config_snapshot_id } } }}];" }, position: pos(260, 0) });
  const callGateway = node({ name: 'Call Config Gateway', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: WF01_WORKFLOW_ID, mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(520, 0), notes: 'Reads the configured KIEM_KE topic and preserves the dispatcher snapshot context.' });
  const readSessions = googleSheetNode('Read PHIEN_KIEM_KE', 'PHIEN_KIEM_KE');
  readSessions.position = pos(780, 0);
  const decide = node({ name: 'Open or Reuse Inventory Session', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await inventorySessionCode() }, position: pos(1040, 0) });
  const prepareSession = node({ name: 'Prepare PHIEN_KIEM_KE row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const result = $('Open or Reuse Inventory Session').first()?.json ?? {}; const entry = (result.write_plan || []).find((item) => item.sheet === 'PHIEN_KIEM_KE'); return entry?.row ? [{json: entry.row}] : [];" }, position: pos(1300, -100) });
  const prepareAudit = node({ name: 'Prepare EVENT_LOG row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const result = $('Open or Reuse Inventory Session').first()?.json ?? {}; const entry = (result.write_plan || []).find((item) => item.sheet === 'EVENT_LOG'); return entry?.row ? [{json: entry.row}] : [];" }, position: pos(1300, 100) });
  const sessionWrite = googleSheetNode('Write PHIEN_KIEM_KE', 'PHIEN_KIEM_KE', 'appendOrUpdate', { columns: { mappingMode: 'autoMapInputData', matchingColumns: ['session_id'] } });
  sessionWrite.position = pos(1560, -100);
  const auditWrite = googleSheetNode('Write EVENT_LOG', 'EVENT_LOG', 'appendOrUpdate', { columns: { mappingMode: 'autoMapInputData', matchingColumns: ['event_id'] } });
  auditWrite.position = pos(1560, 100);
  const result = node({ name: 'Return Inventory Session Result', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "return $('Open or Reuse Inventory Session').all();" }, position: pos(1820, 0) });
  const nodes = [execute, request, callGateway, readSessions, decide, prepareSession, prepareAudit, sessionWrite, auditWrite, result];
  const connections = {};
  link(connections, execute.name, request.name);
  link(connections, request.name, callGateway.name);
  link(connections, callGateway.name, readSessions.name);
  link(connections, readSessions.name, decide.name);
  link(connections, decide.name, prepareSession.name);
  link(connections, decide.name, prepareAudit.name);
  link(connections, prepareSession.name, sessionWrite.name);
  link(connections, prepareAudit.name, auditWrite.name);
  link(connections, sessionWrite.name, result.name);
  link(connections, auditWrite.name, result.name);
  return baseWorkflow('WF05_V2_MO_PHIEN_KIEM_KE', nodes, connections);
}

const workflows = [await buildGatewayWorkflow(), await buildErrorWorkflow(), await buildRouterWorkflow(), await buildDispatcherWorkflow(), await buildInventorySessionWorkflow()];
await mkdir(outputDir, { recursive: true });
for (const workflow of workflows) {
  const filename = `${workflow.name}.json`;
  await writeFile(path.join(outputDir, filename), `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
}
console.log(`Built ${workflows.length} V2 workflows in ${outputDir}`);
