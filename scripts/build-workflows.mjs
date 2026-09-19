import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gatewayCode, assembleCode, planRowCode, errorInputCode } from '../workflow-src/WF01_V2_CONFIG_GATEWAY.mjs';
import { errorCode } from '../workflow-src/WF02_V2_ERROR_HANDLER.mjs';
import { normalizeCode, formatCode, unsupportedCode } from '../workflow-src/WF03_V2_TELEGRAM_ROUTER.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'workflows');
const SHEETS = ['CONFIG_SCHEMA', 'CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', 'CONFIG_SNAPSHOT', 'OPERATION', 'ERROR_BIA'];
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
  return node({ name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, parameters, credentials: { googleSheetsOAuth2Api: { name: GOOGLE_CREDENTIAL } } });
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
  const reads = SHEETS.map((sheet, index) => {
    const item = googleSheetNode(`Read ${sheet}`, sheet);
    item.position = pos(260, -360 + index * 90);
    return item;
  });
  const assemble = node({ name: 'Assemble Config Tables', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await assembleCode() }, position: pos(560, 0) });
  const decision = node({ name: 'Evaluate Config Gateway', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await gatewayCode() }, position: pos(820, 0) });
  const branch = node({ name: 'Gateway OK?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: { conditions: { boolean: [{ value: '={{$json.ok}}', operation: 'isTrue' }] } }, position: pos(1080, 0) });
  const writeRequired = node({ name: 'Write plan required?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: { conditions: { number: [{ value1: '={{$json.write_plan.length}}', operation: 'larger', value2: 0 }] } }, position: pos(1330, -100) });
  const prepareOperationRow = node({ name: 'Prepare OPERATION row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: planRowCode(0) }, position: pos(1570, -100) });
  const prepareOperation = googleSheetNode('Prepare OPERATION', 'OPERATION', 'append', { columns: { mappingMode: 'autoMapInputData' } });
  prepareOperation.position = pos(1810, -100);
  const prepareSnapshotRow = node({ name: 'Prepare CONFIG_SNAPSHOT row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: planRowCode(1) }, position: pos(2050, -100) });
  const prepareSnapshot = googleSheetNode('Prepare CONFIG_SNAPSHOT', 'CONFIG_SNAPSHOT', 'append', { columns: { mappingMode: 'autoMapInputData' } });
  prepareSnapshot.position = pos(2290, -100);
  const commitSnapshotRow = node({ name: 'Commit CONFIG_SNAPSHOT row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: planRowCode(2) }, position: pos(2530, -100) });
  const commitSnapshot = googleSheetNode('Commit CONFIG_SNAPSHOT', 'CONFIG_SNAPSHOT', 'update', { columns: { mappingMode: 'autoMapInputData' } });
  commitSnapshot.position = pos(2770, -100);
  const commitOperationRow = node({ name: 'Commit OPERATION row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: planRowCode(3) }, position: pos(3010, -100) });
  const commitOperation = googleSheetNode('Commit OPERATION', 'OPERATION', 'update', { columns: { mappingMode: 'autoMapInputData' } });
  commitOperation.position = pos(3250, -100);
  const returnStatus = node({ name: 'Return Gateway Result', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const result = $('Evaluate Config Gateway').first()?.json ?? {}; return [{ json: result }];" }, position: pos(3490, -100) });
  const errorInput = node({ name: 'Prepare Error Handler Input', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: errorInputCode() }, position: pos(1570, 180) });
  const errorCall = node({ name: 'Call Error Handler', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: 'PASTE_WF02_WORKFLOW_ID', mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(1810, 180), notes: 'V2 technical placeholder; select WF02_V2_ERROR_HANDLER after import.' });
  const nodes = [trigger, ...reads, assemble, decision, branch, writeRequired, prepareOperationRow, prepareOperation, prepareSnapshotRow, prepareSnapshot, commitSnapshotRow, commitSnapshot, commitOperationRow, commitOperation, returnStatus, errorInput, errorCall];
  const connections = {};
  for (const read of reads) link(connections, trigger.name, read.name);
  for (const read of reads) link(connections, read.name, assemble.name);
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
  const append = googleSheetNode('Append ERROR_BIA', 'ERROR_BIA', 'append', { columns: { mappingMode: 'autoMapInputData' } });
  append.position = pos(580, -40);
  const replyCheck = node({ name: 'Reply target exists?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: { conditions: { string: [{ value1: '={{$json.reply_target.chat_id}}', operation: 'isNotEmpty' }] } }, position: pos(580, 200) });
  const send = node({ name: 'Send Safe Error Reply', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, parameters: { resource: 'message', operation: 'sendMessage', chatId: '={{$json.reply_target.chat_id}}', text: '={{$json.response.message_safe}}', additionalFields: { message_thread_id: '={{$json.reply_target.message_thread_id}}' } }, credentials: { telegramApi: { name: TELEGRAM_CREDENTIAL } }, position: pos(860, 220) });
  const result = node({ name: 'Return Error Result', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: 'return [{ json: $input.first()?.json ?? {} }];' }, position: pos(1110, 80) });
  const nodes = [execute, trigger, normalize, append, replyCheck, send, result];
  const connections = {};
  link(connections, execute.name, normalize.name);
  link(connections, trigger.name, normalize.name);
  link(connections, normalize.name, append.name);
  link(connections, normalize.name, replyCheck.name);
  link(connections, replyCheck.name, send.name, 0);
  link(connections, append.name, result.name);
  link(connections, send.name, result.name);
  return baseWorkflow('WF02_V2_ERROR_HANDLER', nodes, connections);
}

async function buildRouterWorkflow() {
  const trigger = node({ name: 'Telegram Trigger', type: 'n8n-nodes-base.telegramTrigger', typeVersion: 1.2, parameters: { updates: ['message'] }, credentials: { telegramApi: { name: TELEGRAM_CREDENTIAL } }, position: pos(0, 0) });
  const readMessages = googleSheetNode('Read CONFIG_THONG_BAO', 'CONFIG_THONG_BAO');
  readMessages.position = pos(260, 180);
  const normalize = node({ name: 'Normalize Status Update', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await normalizeCode() }, position: pos(260, -80) });
  const statusCheck = node({ name: 'Status command?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: { conditions: { string: [{ value1: '={{$json.command}}', operation: 'equals', value2: '/trangthai' }] } }, position: pos(520, -80) });
  const callGateway = node({ name: 'Call Config Gateway', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: 'PASTE_WF01_WORKFLOW_ID', mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(780, -160), notes: 'V2 technical placeholder; select WF01_V2_CONFIG_GATEWAY after import.' });
  const formatStatusNode = node({ name: 'Format Status Reply', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await formatCode() }, position: pos(1040, -120) });
  const formatUnsupported = node({ name: 'Format Command Not Available', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await unsupportedCode() }, position: pos(780, 120) });
  const send = node({ name: 'Send Telegram Reply', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, parameters: { resource: 'message', operation: 'sendMessage', chatId: '={{$json.reply_target.chat_id}}', text: '={{$json.text}}', additionalFields: { message_thread_id: '={{$json.reply_target.message_thread_id}}' } }, credentials: { telegramApi: { name: TELEGRAM_CREDENTIAL } }, position: pos(1300, -40) });
  const nodes = [trigger, readMessages, normalize, statusCheck, callGateway, formatStatusNode, formatUnsupported, send];
  const connections = {};
  link(connections, trigger.name, readMessages.name);
  link(connections, trigger.name, normalize.name);
  link(connections, normalize.name, statusCheck.name);
  link(connections, statusCheck.name, callGateway.name, 0);
  link(connections, statusCheck.name, formatUnsupported.name, 1);
  link(connections, callGateway.name, formatStatusNode.name);
  link(connections, formatStatusNode.name, send.name);
  link(connections, formatUnsupported.name, send.name);
  return baseWorkflow('WF03_V2_TELEGRAM_ROUTER', nodes, connections);
}

const workflows = [await buildGatewayWorkflow(), await buildErrorWorkflow(), await buildRouterWorkflow()];
await mkdir(outputDir, { recursive: true });
for (const workflow of workflows) {
  const filename = `${workflow.name}.json`;
  await writeFile(path.join(outputDir, filename), `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
}
console.log(`Built ${workflows.length} V2 workflows in ${outputDir}`);
