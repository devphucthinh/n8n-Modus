import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gatewayCode, assembleCode, planRowCode, errorInputCode } from '../workflow-src/WF01_V2_CONFIG_GATEWAY.mjs';
import { errorCode, errorRowCode, returnErrorCode } from '../workflow-src/WF02_V2_ERROR_HANDLER.mjs';
import { normalizeCode, decisionCode } from '../workflow-src/WF03_V2_TELEGRAM_ROUTER.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'workflows');
const CORE_SHEETS = ['CONFIG_SCHEMA', 'CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', 'CONFIG_SNAPSHOT', 'OPERATION', 'ERROR_BIA'];
const ROUTER_SHEETS = ['CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH', 'EVENT_LOG'];
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
    documentId: { __rl: true, value: 'PASTE_GOOGLE_SHEET_ID', mode: 'id' },
    sheetName: { __rl: true, value: sheetName, mode: 'name' },
    options: { returnAll: true },
    ...extra,
  };
  const result = node({ name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, parameters, credentials: { googleSheetsOAuth2Api: { name: GOOGLE_CREDENTIAL } } });
  if (operation === 'read') result.alwaysOutputData = true;
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
  const assemble = node({ name: 'Assemble Config Tables', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await assembleCode() }, position: pos(560, 0) });
  const decision = node({ name: 'Evaluate Config Gateway', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await gatewayCode() }, position: pos(820, 0) });
  const routerRequested = node({ name: 'Router tables requested?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: { conditions: { boolean: [{ value: "={{Array.isArray($('Execute Workflow Trigger').first()?.json?.envelope?.payload?.required_sheet_names) && $('Execute Workflow Trigger').first().json.envelope.payload.required_sheet_names.length > 0}}", operation: 'isTrue' }] } }, position: pos(520, 520), notes: 'Only read router tabs for commands that request them; /trangthai remains compatible with a core-only Sheet.' });
  const branch = node({ name: 'Gateway OK?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: { conditions: { boolean: [{ value: '={{$json.ok}}', operation: 'isTrue' }] } }, position: pos(1080, 0) });
  const writeRequired = node({ name: 'Write plan required?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: { conditions: { number: [{ value1: '={{$json.write_plan.length}}', operation: 'larger', value2: 0 }] } }, position: pos(1330, -100) });
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
  const returnStatus = node({ name: 'Return Gateway Result', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const result = $('Evaluate Config Gateway').first()?.json ?? {}; return [{ json: result }];" }, position: pos(3490, -100) });
  const errorInput = node({ name: 'Prepare Error Handler Input', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: errorInputCode() }, position: pos(1570, 180) });
  const errorCall = node({ name: 'Call Error Handler', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: 'PASTE_WF02_WORKFLOW_ID', mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(1810, 180), notes: 'V2 technical placeholder; select WF02_V2_ERROR_HANDLER after import.' });
  const nodes = [trigger, ...reads, routerRequested, ...routerReads, assemble, decision, branch, writeRequired, prepareOperationRow, prepareOperation, prepareSnapshotRow, prepareSnapshot, commitSnapshotRow, commitSnapshot, commitOperationRow, commitOperation, returnStatus, errorInput, errorCall];
  const connections = {};
  link(connections, trigger.name, reads[0].name);
  for (let index = 0; index < reads.length - 1; index += 1) link(connections, reads[index].name, reads[index + 1].name);
  link(connections, reads.at(-1).name, routerRequested.name);
  link(connections, routerRequested.name, routerReads[0].name, 0);
  link(connections, routerRequested.name, assemble.name, 1);
  for (let index = 0; index < routerReads.length - 1; index += 1) link(connections, routerReads[index].name, routerReads[index + 1].name);
  link(connections, routerReads.at(-1).name, assemble.name);
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
  return baseWorkflow('WF01_V2_CONFIG_GATEWAY', nodes, connections);
}

async function buildErrorWorkflow() {
  const execute = executeTrigger();
  const trigger = node({ name: 'Error Trigger', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: pos(0, 220) });
  const normalize = node({ name: 'Normalize Workflow Error', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await errorCode() }, position: pos(300, 80) });
  const errorRow = node({ name: 'Project ERROR_BIA row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await errorRowCode() }, position: pos(300, -40) });
  const append = googleSheetNode('Append ERROR_BIA', 'ERROR_BIA', 'append', { columns: { mappingMode: 'autoMapInputData' } });
  append.position = pos(580, -40);
  const replyCheck = node({ name: 'Reply target exists?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: { conditions: { string: [{ value1: '={{$json.reply_target.chat_id}}', operation: 'isNotEmpty' }] } }, position: pos(580, 200) });
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
  const statusCheck = node({ name: 'Status command?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: { conditions: { string: [{ value1: '={{$json.command}}', operation: 'equals', value2: '/trangthai' }] } }, position: pos(520, -80) });
  const callGateway = node({ name: 'Call Config Gateway', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: 'PASTE_WF01_WORKFLOW_ID', mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(780, -160), notes: 'V2 technical placeholder; select WF01_V2_CONFIG_GATEWAY after import.' });
  const callUnsupportedGateway = node({ name: 'Call Config Gateway - Command Check', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: 'PASTE_WF01_WORKFLOW_ID', mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(780, 120), notes: 'Reads configured message templates through the Gateway without invoking a business worker.' });
  const decision = node({ name: 'Router Decision', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await decisionCode() }, position: pos(1040, -40), notes: 'Reads Sheet-driven roles/permissions/topics/commands and writes denied-access events to EVENT_LOG.' });
  const auditCheck = node({ name: 'Router audit write required?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: { conditions: { number: [{ value1: '={{$json.decision.write_plan.length}}', operation: 'larger', value2: 0 }] } }, position: pos(1260, 120) });
  const projectAudit = node({ name: 'Project EVENT_LOG row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const entry = $json.decision?.write_plan?.[0]; if (!entry) return []; return [{ json: entry.row }];" }, position: pos(1480, 120) });
  const appendAudit = googleSheetNode('Append EVENT_LOG', 'EVENT_LOG', 'append', { columns: { mappingMode: 'autoMapInputData' } });
  appendAudit.position = pos(1700, 120);
  const restoreReply = node({ name: 'Restore Router Reply', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const reply = $('Router Decision').first()?.json ?? {}; return [{ json: reply }];" }, position: pos(1920, 120), notes: 'Restores reply_target/text after Google Sheets replaces the item with the appended audit row.' });
  const send = node({ name: 'Send Telegram Reply', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, parameters: { resource: 'message', operation: 'sendMessage', chatId: '={{$json.reply_target.chat_id}}', text: '={{$json.text}}', additionalFields: { message_thread_id: '={{$json.reply_target.message_thread_id}}' } }, credentials: { telegramApi: { name: TELEGRAM_CREDENTIAL } }, position: pos(1300, -40) });
  const callbackCheck = node({ name: 'Callback query?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: { conditions: { boolean: [{ value: "={{!!$('Normalize Telegram Update').first()?.json?.callback?.id}}", operation: 'isTrue' }] } }, position: pos(1540, -40), notes: 'Only callback_query updates need answerQuery; normal messages skip this branch.' });
  const callbackAnswer = node({ name: 'Answer Telegram Callback', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, parameters: { resource: 'callback', operation: 'answerQuery', queryId: "={{$('Normalize Telegram Update').first()?.json?.callback?.id}}", additionalFields: {} }, credentials: { telegramApi: { name: TELEGRAM_CREDENTIAL } }, position: pos(1780, -40), notes: 'Acknowledges the inline-keyboard callback so Telegram clears its loading indicator.' });
  const nodes = [trigger, normalize, statusCheck, callGateway, callUnsupportedGateway, decision, auditCheck, projectAudit, appendAudit, restoreReply, send, callbackCheck, callbackAnswer];
  const connections = {};
  link(connections, trigger.name, normalize.name);
  link(connections, normalize.name, statusCheck.name);
  link(connections, statusCheck.name, callGateway.name, 0);
  link(connections, statusCheck.name, callUnsupportedGateway.name, 1);
  link(connections, callGateway.name, decision.name);
  link(connections, callUnsupportedGateway.name, decision.name);
  link(connections, decision.name, auditCheck.name);
  link(connections, auditCheck.name, projectAudit.name, 0);
  link(connections, auditCheck.name, send.name, 1);
  link(connections, projectAudit.name, appendAudit.name);
  link(connections, appendAudit.name, restoreReply.name);
  link(connections, restoreReply.name, send.name);
  link(connections, send.name, callbackCheck.name);
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
