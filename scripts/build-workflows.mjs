import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gatewayCode, assembleCode, planRowCode, errorInputCode } from '../workflow-src/WF01_V2_CONFIG_GATEWAY.mjs';
import { errorCode, errorRowCode, returnErrorCode } from '../workflow-src/WF02_V2_ERROR_HANDLER.mjs';
import { normalizeCode, decisionCode } from '../workflow-src/WF03_V2_TELEGRAM_ROUTER.mjs';
import { dispatcherCode, validateCurrentHeartbeatSettingsCode, verifyClaimCode, verifyRunningClaimCode, rejectedClaimOutcomeCode, workerFailureCode, dispatcherNoticeCode, postWorkerHeartbeatCode } from '../workflow-src/WF04_V2_DISPATCHER.mjs';
import { inventorySessionCode, bubbleCode } from '../workflow-src/WF05_V2_MO_PHIEN_KIEM_KE.mjs';
import { SAFE_ERROR_TEMPLATE } from '../src/telegram-router/decide-router-response.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'workflows');
const CORE_SHEETS = ['CONFIG_SCHEMA', 'CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', 'CONFIG_SNAPSHOT', 'OPERATION', 'ERROR_BIA'];
const ROUTER_SHEETS = ['CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH', 'EVENT_LOG'];
const DISPATCHER_SHEETS = ['CONFIG_LICH'];
const INVENTORY_SHEETS = ['CONFIG_BIA'];
const OPTIONAL_SHEETS = [...ROUTER_SHEETS, ...DISPATCHER_SHEETS, ...INVENTORY_SHEETS];
const GOOGLE_SHEET_ID = '1wQ76EpIx35Trkx5JZg8GZ0xZsEBcKAFA6eb7nKDvLu4';
const WF01_WORKFLOW_ID = 'WEL83s9bZeB3ixxF';
const WF01_HEARTBEAT_GATEWAY_WORKFLOW_ID = 'BIND_WF01_HEARTBEAT_GATEWAY_WORKFLOW_ID_BEFORE_IMPORT';
const WF04_WORKFLOW_ID = 'BIND_WF04_WORKFLOW_ID_BEFORE_IMPORT';
const WF02_WORKFLOW_ID = 'MoG6coBccYkIS0nK';
const GOOGLE_CREDENTIAL = 'GOOGLE_SHEETS_KKB_V2';
const TELEGRAM_CREDENTIAL = 'TELEGRAM_KKB_V2';
const SAFE_ERROR_TEMPLATE_LITERAL = JSON.stringify(SAFE_ERROR_TEMPLATE);

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
  return `={{${writeOperationExpression()} || (Array.isArray($('Execute Workflow Trigger').first()?.json?.envelope?.payload?.required_sheet_names) && $('Execute Workflow Trigger').first().json.envelope.payload.required_sheet_names.includes('${sheetName}'))}}`;
}

function googleSheetAppendOrUpdateNode(name, sheetName, matchingColumn, columns) {
  return googleSheetNode(name, sheetName, 'appendOrUpdate', {
    columns: {
      mappingMode: 'autoMapInputData',
      matchingColumns: [matchingColumn],
      schema: columns.map((idValue) => ({ id: idValue, displayName: idValue, required: false, defaultMatch: idValue === matchingColumn, display: true, type: 'string', canBeUsedToMatch: true })),
      attemptToConvertTypes: false,
      convertFieldsToString: true,
    },
  });
}

function addMappedColumnsSchema(sheetNode, matchingColumn) {
  const columns = sheetNode.parameters.columns;
  columns.schema = Object.keys(columns.value).map((idValue) => ({
    id: idValue, displayName: idValue, required: false,
    defaultMatch: idValue === matchingColumn, display: true,
    type: 'string', canBeUsedToMatch: true,
  }));
  columns.attemptToConvertTypes = false;
  columns.convertFieldsToString = true;
  return sheetNode;
}

function writeOperationExpression() {
  return "!['READ_STATUS', 'READ_HELP', 'COMMAND_NOT_AVAILABLE'].includes(String($('Execute Workflow Trigger').first()?.json?.envelope?.payload?.intent || 'START_OPERATION').toUpperCase())";
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

function baseWorkflow(name, nodes, connections, settings = {}) {
  return {
    name,
    nodes,
    connections,
    active: false,
    settings: { executionOrder: 'v1', ...settings },
    versionId: id(`${name}-version`),
    meta: { templateCredsSetupCompleted: false },
    pinData: {},
    tags: [],
  };
}

async function buildGatewayWorkflow({ name = 'WF01_V2_CONFIG_GATEWAY', auditFailures = true, callerPolicy = null, callerIds = null } = {}) {
  const trigger = executeTrigger();
  const reads = CORE_SHEETS.map((sheet, index) => {
    const item = googleSheetNode(`Read ${sheet}`, sheet);
    item.continueOnFail = true;
    item.position = pos(260, -360 + index * 90);
    return item;
  });
  const routerReads = OPTIONAL_SHEETS.map((sheet, index) => {
    const item = googleSheetNode(`Read ${sheet}`, sheet);
    item.continueOnFail = true;
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
  const routerRequested = node({ name: 'Router tables requested?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters(`={{${writeOperationExpression()} || (Array.isArray($('Execute Workflow Trigger').first()?.json?.envelope?.payload?.required_sheet_names) && $('Execute Workflow Trigger').first().json.envelope.payload.required_sheet_names.length > 0)}}`), position: pos(520, 520), notes: 'All versioned writes read one complete config scope; read-only status/help may request only the needed tabs.' });
  const branch = node({ name: 'Gateway OK?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{$json.ok === true}}'), position: pos(1080, 0) });
  const safeFailureAudit = node({ name: 'Gateway failure safe to audit?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters(auditFailures ? '={{true}}' : '={{false}}'), position: pos(1330, 180), notes: auditFailures ? 'Every Gateway failure is audited through WF02; caller payload cannot bypass this path.' : 'Dedicated WF04-only entry: a Gateway failure returns directly so WF04 can record its guarded FAILED heartbeat.' });
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
  const errorCall = node({ name: 'Call Error Handler', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: WF02_WORKFLOW_ID, mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(1810, 180), notes: 'Bound to WF02_V2_ERROR_HANDLER in the current n8n Cloud project.' });
  const nodes = [trigger, ...reads, routerRequested, ...routerSelectors, ...routerReads, assemble, decision, branch, safeFailureAudit, writeRequired, prepareOperationRow, prepareOperation, prepareSnapshotRow, prepareSnapshot, commitSnapshotRow, commitSnapshot, commitOperationRow, commitOperation, returnStatus, ...(auditFailures ? [errorInput, errorCall] : [])];
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
  link(connections, branch.name, safeFailureAudit.name, 1);
  if (auditFailures) {
    link(connections, safeFailureAudit.name, errorInput.name, 0);
    link(connections, errorInput.name, errorCall.name);
    link(connections, errorCall.name, returnStatus.name);
  }
  link(connections, safeFailureAudit.name, returnStatus.name, 1);
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
  const settings = callerPolicy ? { callerPolicy, callerIds } : {};
  return baseWorkflow(name, nodes, connections, settings);
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
  const prepareWorker = node({ name: 'Prepare Worker Envelope', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const decision = $('Router Decision').first()?.json?.decision ?? {}; if (decision.kind !== 'ROUTE' || !decision.route?.worker_workflow || !decision.worker_envelope) return []; return [{ json: { envelope: decision.worker_envelope } }];" }, position: pos(1900, -240), notes: 'Passes only the normalized standard envelope to the worker configured by CONFIG_LENH.' });
  const executeWorker = node({ name: 'Execute Configured Worker', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: "={{$('Router Decision').first()?.json?.decision?.route?.worker_workflow ?? ''}}", mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(2120, -240), notes: 'worker_workflow in CONFIG_LENH must be the actual n8n workflow ID. The worker receives { envelope }; it must enforce idempotency with operation_id/idempotency_key.' });
  executeWorker.onError = 'continueErrorOutput';
  executeWorker.alwaysOutputData = true;
  const workerSuccessCheck = node({ name: 'Worker succeeded?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{$json.ok === true}}'), position: pos(2340, -240), notes: 'Only an explicit ok=true result allows the Router success acknowledgement.' });
  const projectOperationCommit = node({ name: 'Project OPERATION committed', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const decision = $('Router Decision').first()?.json?.decision ?? {}; const row = decision.reservation?.row; if (!row) return []; return [{ json: { idempotency_key: row.idempotency_key, status: 'COMMITTED', actual_row_count: '1', error_id: '', updated_at: new Date().toISOString() } }];" }, position: pos(2560, -340) });
  const updateOperationCommit = googleSheetUpdateNode('Update OPERATION committed', 'OPERATION', 'idempotency_key', ['idempotency_key', 'status', 'actual_row_count', 'error_id', 'updated_at']);
  updateOperationCommit.position = pos(2780, -340);
  const prepareWorkerError = node({ name: 'Prepare Worker Error Input', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const current = $input.first()?.json ?? {}; const decision = $('Router Decision').first()?.json?.decision ?? {}; const row = decision.reservation?.row ?? {}; const envelope = decision.worker_envelope ?? {}; const workerError = current.error ?? (current.response && { error_code: current.response.error_code, message: current.response.message ?? current.response.error, retryable: current.response.retryable }) ?? { error_code: current.error_code ?? 'WORKER_FAILED', message: current.message ?? 'Configured worker did not return ok=true', retryable: current.retryable ?? false }; return [{ json: { error: workerError, context: { request_id: envelope.request_id ?? row.request_id, operation_id: row.operation_id, workflow: 'WF03_V2_TELEGRAM_ROUTER', node: 'Execute Configured Worker', config_version: envelope.config_version }, messages: { ERROR_GENERIC: decision.worker_error_message_template ?? " + SAFE_ERROR_TEMPLATE_LITERAL + " } } }];" }, position: pos(2560, -120), notes: 'Sends sanitized worker failure context through WF02 so the error is persisted in ERROR_BIA before the Router reports failure.' });
  const callErrorHandler = node({ name: 'Call WF02 Error Handler', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: WF02_WORKFLOW_ID, mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(2780, -120), notes: 'Persists worker failure to ERROR_BIA through the shared Error Handler. No reply_target is passed, preventing a duplicate Telegram message.' });
  callErrorHandler.onError = 'continueErrorOutput';
  const prepareFallbackError = node({ name: 'Prepare Fallback ERROR_BIA row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const readNode = (name) => { try { return $(name).first()?.json ?? {}; } catch { return {}; } }; const decision = readNode('Router Decision').decision ?? {}; const row = decision.reservation?.row ?? {}; const envelope = decision.worker_envelope ?? {}; if (!row.operation_id) return []; const operationId = String(row.operation_id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || 'unknown'; const errorId = `err-${operationId}-error-handler-unavailable`; const sourceError = readNode('Prepare Worker Error Input').error ?? {}; const causeCode = String(sourceError.error_code ?? sourceError.code ?? 'WORKER_FAILED').toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').slice(0, 48) || 'WORKER_FAILED'; const template = String(decision.worker_error_message_template ?? " + SAFE_ERROR_TEMPLATE_LITERAL + "); return [{ json: { error_id: errorId, error_code: 'ERROR_HANDLER_UNAVAILABLE', error_class: 'INTERNAL', retryable: 'NO', message_safe: template.replaceAll('{error_id}', errorId).slice(0, 256), workflow: 'WF03_V2_TELEGRAM_ROUTER', node: `Call WF02 Error Handler (${causeCode})`, operation_id: row.operation_id, request_id: envelope.request_id ?? row.request_id, config_version: envelope.config_version ?? '', fingerprint: '', status: 'OPEN', created_at: new Date().toISOString(), resolved_at: '' } }];" }, position: pos(3000, -240), notes: 'If WF02 cannot run, record a safe non-retryable fallback in the existing ERROR_BIA schema. Only a filtered error code is retained in the existing node field; raw error text is never copied.' });
  const appendFallbackError = googleSheetNode('Append fallback ERROR_BIA', 'ERROR_BIA', 'appendOrUpdate', { columns: { mappingMode: 'autoMapInputData', matchingColumns: ['error_id'] } });
  appendFallbackError.position = pos(3220, -240);
  appendFallbackError.onError = 'continueErrorOutput';
  const markFallbackPersisted = node({ name: 'Mark fallback ERROR_BIA persisted', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "return [{ json: { ...($json ?? {}), fallback_persisted: true } }];" }, position: pos(3440, -260), notes: 'This marker is reachable only from the successful Google Sheets append output, so admin diagnostics are never sent for an unpersisted fallback.' });
  const projectOperationFailure = node({ name: 'Project OPERATION failed', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const readNode = (name) => { try { return $(name).first()?.json ?? {}; } catch { return {}; } }; const decision = readNode('Router Decision').decision ?? {}; const row = decision.reservation?.row; if (!row) return []; const errorResult = readNode('Call WF02 Error Handler'); const fallbackResult = readNode('Append fallback ERROR_BIA'); const errorId = String(errorResult.response?.error_id ?? fallbackResult.error_id ?? '').trim(); return [{ json: { idempotency_key: row.idempotency_key, status: 'FAILED', error_id: errorId, updated_at: new Date().toISOString() } }];" }, position: pos(3440, -120) });
  const updateOperationFailure = googleSheetUpdateNode('Update OPERATION failed', 'OPERATION', 'idempotency_key', ['idempotency_key', 'status', 'error_id', 'updated_at']);
  updateOperationFailure.position = pos(3660, -120);
  const projectWorkerFailureReply = node({ name: 'Project Worker Failure Reply', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const readNode = (name) => { try { return $(name).first()?.json ?? {}; } catch { return {}; } }; const source = readNode('Router Decision'); const errorResult = readNode('Call WF02 Error Handler'); const fallbackResult = readNode('Mark fallback ERROR_BIA persisted'); const errorId = String(errorResult.response?.error_id ?? fallbackResult.error_id ?? '').trim(); const template = String(source.decision?.worker_error_message_template ?? " + SAFE_ERROR_TEMPLATE_LITERAL + "); const fallbackText = template.replaceAll('{error_id}', errorId || '—'); const clean = (value, limit = 160) => String(value ?? '').replace(/[\\u0000-\\u001f\\u007f]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, limit); const configured = source.decision?.error_alert_target ?? {}; const chatId = clean(configured.chat_id, 32); const threadId = clean(configured.message_thread_id, 20); const validTarget = /^-?\\d{1,20}$/.test(chatId) && !/^-?0+$/.test(chatId) && /^\\d{1,16}$/.test(threadId) && !/^0+$/.test(threadId); const persisted = fallbackResult.fallback_persisted === true && clean(fallbackResult.error_id, 160) && clean(fallbackResult.operation_id, 160) && clean(fallbackResult.error_code, 80); const alertText = validTarget && persisted ? ['WF03 error fallback', `error_id=${clean(fallbackResult.error_id)}`, `operation_id=${clean(fallbackResult.operation_id)}`, `config_version=${clean(fallbackResult.config_version, 80) || 'unknown'}`, `node=${clean(fallbackResult.node, 120) || 'unknown'}`, `error_code=${clean(fallbackResult.error_code, 80)}`].join('\\n').slice(0, 1200) : ''; return [{ json: { reply_target: source.reply_target, text: errorResult.response?.message_safe ?? fallbackResult.message_safe ?? fallbackText, alert_target: alertText ? { chat_id: chatId, message_thread_id: threadId } : null, alert_text: alertText } }];" }, position: pos(3880, -120), notes: 'User failure reply is preserved. A separate admin alert is produced only for a persisted WF02 fallback and a complete numeric CONFIG_GLOBAL target; alert fields are allowlisted and control characters are removed.' });
  const errorAlertCheck = node({ name: 'Error Alert Configured?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{Boolean($json.alert_text && $json.alert_target?.chat_id && $json.alert_target?.message_thread_id)}}'), position: pos(4100, -120), notes: 'Missing destination, missing persisted fallback, or invalid IDs skip the alert without interrupting the user failure reply.' });
  const prepareAdminErrorAlert = node({ name: 'Prepare Admin Error Alert', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const source = $json ?? {}; if (!source.alert_target?.chat_id || !source.alert_target?.message_thread_id || !source.alert_text) return []; return [{ json: { chat_id: source.alert_target.chat_id, message_thread_id: source.alert_target.message_thread_id, text: source.alert_text } }];" }, position: pos(4320, -240) });
  const sendAdminErrorAlert = node({ name: 'Send Admin Error Alert', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, parameters: { resource: 'message', operation: 'sendMessage', chatId: '={{$json.chat_id}}', text: '={{$json.text}}', additionalFields: { message_thread_id: '={{$json.message_thread_id}}' } }, credentials: { telegramApi: { name: TELEGRAM_CREDENTIAL } }, position: pos(4540, -240), notes: 'Sends the allowlisted, sanitized fallback diagnostic to the configured admin group/topic. Alert delivery failure continues to the normal user-facing failure reply.' });
  sendAdminErrorAlert.onError = 'continueErrorOutput';
  const restoreWorkerFailureReply = node({ name: 'Restore Worker Failure Reply', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const source = $('Project Worker Failure Reply').first()?.json ?? {}; return [{ json: { reply_target: source.reply_target, text: source.text } }];" }, position: pos(4760, -120), notes: 'Restores the user-facing failure reply whether the admin alert was skipped, delivered, or failed.' });
  const auditCheck = node({ name: 'Router audit write required?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{($json.decision?.write_plan?.length ?? 0) > 0}}'), position: pos(1260, 120) });
  const projectAudit = node({ name: 'Project EVENT_LOG row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const entry = $json.decision?.write_plan?.[0]; if (!entry) return []; return [{ json: entry.row }];" }, position: pos(1480, 120) });
  const appendAudit = googleSheetNode('Append EVENT_LOG', 'EVENT_LOG', 'appendOrUpdate', { columns: { mappingMode: 'autoMapInputData', matchingColumns: ['event_id'] } });
  appendAudit.position = pos(1700, 120);
  const restoreReply = node({ name: 'Restore Router Reply', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const reply = $('Router Decision').first()?.json ?? {}; return [{ json: reply }];" }, position: pos(1920, 40), notes: 'Restores reply_target/text after Google Sheets replaces the item with the appended row.' });
  const splitReply = node({ name: 'Split Router Reply', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const source = $json; const chars = Array.from(String(source.text ?? '')); const limit = 4096; if (chars.length === 0) return [{ json: { ...source, text: '' } }]; const chunks = []; for (let index = 0; index < chars.length; index += limit) chunks.push({ json: { ...source, text: chars.slice(index, index + limit).join('') } }); return chunks;" }, position: pos(2140, 40), notes: 'Telegram text limit is technical; preserve every /help line by sending multiple chunks.' });
  const send = node({ name: 'Send Telegram Reply', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, parameters: { resource: 'message', operation: 'sendMessage', chatId: '={{$json.reply_target.chat_id}}', text: '={{$json.text}}', additionalFields: { message_thread_id: '={{$json.reply_target.message_thread_id}}' } }, credentials: { telegramApi: { name: TELEGRAM_CREDENTIAL } }, position: pos(2360, 40) });
  const callbackCheck = node({ name: 'Callback query?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{!!$('Normalize Telegram Update').first()?.json?.callback?.id}}"), position: pos(1540, -40), notes: 'Only callback_query updates need answerQuery; normal messages skip this branch.' });
  const callbackAnswer = node({ name: 'Answer Telegram Callback', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, parameters: { resource: 'callback', operation: 'answerQuery', queryId: "={{$('Normalize Telegram Update').first()?.json?.callback?.id}}", additionalFields: {} }, credentials: { telegramApi: { name: TELEGRAM_CREDENTIAL } }, position: pos(1780, -40), notes: 'Acknowledges the inline-keyboard callback so Telegram clears its loading indicator.' });
  const nodes = [trigger, normalize, statusCheck, callGateway, callUnsupportedGateway, decision, routeCheck, projectReservation, appendReservation, prepareWorker, executeWorker, workerSuccessCheck, projectOperationCommit, updateOperationCommit, prepareWorkerError, callErrorHandler, prepareFallbackError, appendFallbackError, markFallbackPersisted, projectOperationFailure, updateOperationFailure, projectWorkerFailureReply, errorAlertCheck, prepareAdminErrorAlert, sendAdminErrorAlert, restoreWorkerFailureReply, auditCheck, projectAudit, appendAudit, restoreReply, splitReply, send, callbackCheck, callbackAnswer];
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
  link(connections, appendReservation.name, prepareWorker.name);
  link(connections, prepareWorker.name, executeWorker.name);
  link(connections, executeWorker.name, workerSuccessCheck.name, 0);
  link(connections, executeWorker.name, prepareWorkerError.name, 1);
  link(connections, workerSuccessCheck.name, projectOperationCommit.name, 0);
  link(connections, workerSuccessCheck.name, prepareWorkerError.name, 1);
  link(connections, projectOperationCommit.name, updateOperationCommit.name);
  link(connections, updateOperationCommit.name, restoreReply.name);
  link(connections, prepareWorkerError.name, callErrorHandler.name);
  link(connections, callErrorHandler.name, projectOperationFailure.name, 0);
  link(connections, callErrorHandler.name, prepareFallbackError.name, 1);
  link(connections, prepareFallbackError.name, appendFallbackError.name);
  link(connections, appendFallbackError.name, markFallbackPersisted.name, 0);
  link(connections, appendFallbackError.name, projectOperationFailure.name, 1);
  link(connections, markFallbackPersisted.name, projectOperationFailure.name);
  link(connections, projectOperationFailure.name, updateOperationFailure.name);
  link(connections, updateOperationFailure.name, projectWorkerFailureReply.name);
  link(connections, projectWorkerFailureReply.name, errorAlertCheck.name);
  link(connections, errorAlertCheck.name, prepareAdminErrorAlert.name, 0);
  link(connections, errorAlertCheck.name, restoreWorkerFailureReply.name, 1);
  link(connections, prepareAdminErrorAlert.name, sendAdminErrorAlert.name);
  link(connections, sendAdminErrorAlert.name, restoreWorkerFailureReply.name, 0);
  link(connections, sendAdminErrorAlert.name, restoreWorkerFailureReply.name, 1);
  link(connections, restoreWorkerFailureReply.name, splitReply.name);
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
  const request = node({ name: 'Prepare Dispatcher Gateway Request', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const input = $input.first()?.json ?? {}; const envelope = input.envelope ?? {}; const now = new Date().toISOString(); const entropy = [0, 1].map(() => Math.floor(Math.random() * 0x100000000).toString(36).padStart(7, '0')).join(''); const suffix = now.replace(/[^0-9A-Za-z]/g, '') + '-' + entropy; const dispatcherAttemptId = 'dispatcher-attempt-' + suffix; const heartbeatId = 'heartbeat-' + suffix; const claimToken = 'claim-' + suffix; const generatedEnvelopeId = 'dispatch-' + suffix; return [{json: { dispatcher_attempt_id: dispatcherAttemptId, heartbeat_id: heartbeatId, claim_token: claimToken, envelope: { request_id: envelope.request_id || generatedEnvelopeId, operation_id: envelope.operation_id || generatedEnvelopeId, event_type: 'SCHEDULED_JOB', actor_user_id: 'SYSTEM', branch_id: null, business_date: null, config_version: null, payload: { intent: 'START_OPERATION', required_sheet_names: ['CONFIG_LICH', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_THONG_BAO', 'CONFIG_SCHEMA', 'EVENT_LOG'] } } }}];" }, position: pos(260, 0), notes: 'Creates one V2-owned dispatcher attempt identity. The dedicated heartbeat Gateway entry is restricted by its native Execute Workflow caller allowlist; bind both workflow IDs before import. The same heartbeat ID and claim token are reused throughout this attempt.' });
  const callGateway = node({ name: 'Call Config Gateway', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: WF01_HEARTBEAT_GATEWAY_WORKFLOW_ID, mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(520, 0), notes: 'Dedicated Gateway entry returns schema/config failures directly to WF04 for guarded heartbeat handling. Bind its real workflow ID before import.' });
  callGateway.continueOnFail = true;
  const gatewayReady = node({ name: 'Gateway configuration available?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{$json.ok === true && Boolean(String($json.response?.config_snapshot_id || '').trim())}}"), position: pos(650, -180), notes: 'A rejected or incomplete Gateway result bypasses all business ledgers and reads only HEARTBEAT for a guarded FAILED record.' });
  const validateHeartbeatSettings = node({ name: 'Validate current heartbeat settings', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await validateCurrentHeartbeatSettingsCode() }, position: pos(780, -360), notes: 'Validate the current active threshold and complete alert destination before any business-ledger read.' });
  const heartbeatSettingsValid = node({ name: 'Current heartbeat settings valid?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{$json.kind === 'HEARTBEAT_CONFIG_VALID'}}"), position: pos(1040, -360) });
  const readHistory = googleSheetNode('Read DISPATCH_HISTORY', 'DISPATCH_HISTORY');
  readHistory.position = pos(780, 0);
  const readSessions = googleSheetNode('Read PHIEN_KIEM_KE', 'PHIEN_KIEM_KE');
  readSessions.position = pos(1040, 0);
  const readDispatcherOperations = googleSheetNode('Read OPERATION for dispatcher', 'OPERATION');
  readDispatcherOperations.position = pos(1170, 0);
  const readHeartbeat = googleSheetNode('Read HEARTBEAT', 'HEARTBEAT');
  readHeartbeat.continueOnFail = true;
  readHeartbeat.position = pos(1300, 0);
  const decide = node({ name: 'Decide Dispatcher Actions', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await dispatcherCode() }, position: pos(1560, 0) });
  const schemaCompatible = node({ name: 'Operational schema compatible?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{$json.kind !== 'SCHEMA_REJECTED'}}"), position: pos(1560, 180) });
  const heartbeatCheck = node({ name: 'Heartbeat action?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{$json.kind === 'HEARTBEAT'}}"), position: pos(1560, -160) });
  const appendHeartbeat = googleSheetNode('Append HEARTBEAT', 'HEARTBEAT', 'append', { columns: { mappingMode: 'autoMapInputData' } });
  appendHeartbeat.position = pos(1820, -260);
  const noticeCheck = node({ name: 'Critical or recovery notice?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{!!$json.notice}}"), position: pos(2080, -260) });
  const prepareNotice = node({ name: 'Prepare Dispatcher Notice', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await dispatcherNoticeCode() }, position: pos(2340, -260) });
  const callError = node({ name: 'Call Error Handler', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: WF02_WORKFLOW_ID, mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(2600, -260), notes: 'Critical and recovery notices use configured safe messages and Error Handler audit/notification policy.' });
  const dispatchCheck = node({ name: 'Dispatch action?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{$json.kind === 'DISPATCH'}}"), position: pos(1820, -40) });
  const recordOutcome = googleSheetNode('Record Dispatch Outcome', 'DISPATCH_HISTORY', 'appendOrUpdate', { columns: { mappingMode: 'defineBelow', value: { dispatch_key: '={{$json.dispatch_key}}', schedule_id: '={{$json.schedule_id}}', job_code: '={{$json.job_code}}', branch_id: '={{$json.branch_id}}', business_date: '={{$json.business_date}}', status: '={{$json.kind === \'WARNING\' ? \'WARNING\' : \'SKIPPED\'}}', skip_reason: '={{$json.reason}}', config_snapshot_id: '={{$json.config_snapshot_id}}', updated_at: '={{$now}}' }, matchingColumns: ['dispatch_key'] } });
  addMappedColumnsSchema(recordOutcome, 'dispatch_key');
  recordOutcome.position = pos(2080, 100);
  const dispatchNoticeCheck = node({ name: 'Dispatch notice required?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{!!$json.notice_code}}'), position: pos(2080, 220) });
  const prepareDispatchNotice = node({ name: 'Prepare Dispatch Outcome Notice', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await dispatcherNoticeCode() }, position: pos(2340, 220) });
  const callDispatchNotice = node({ name: 'Call Error Handler - Dispatch Notice', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: WF02_WORKFLOW_ID, mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(2600, 220), notes: 'Inactive branches, active sessions, and missed grace windows use the configured dispatcher destination.' });
  const claim = googleSheetNode('Claim DISPATCH_HISTORY', 'DISPATCH_HISTORY', 'appendOrUpdate', { columns: { mappingMode: 'defineBelow', value: { dispatch_key: '={{$json.dispatch_key}}', schedule_id: '={{$json.schedule_id}}', job_code: '={{$json.job_code}}', branch_id: '={{$json.branch_id}}', business_date: '={{$json.business_date}}', scheduled_at: '={{$json.scheduled_at}}', status: 'CLAIMED', attempt_count: '={{$json.attempt_count}}', retry_delay_minutes: '={{$json.retry_delay_minutes}}', retry_limit: '={{$json.retry_limit}}', worker_workflow: '={{$json.worker_workflow}}', claim_token: '={{$json.claim_token}}', operation_id: '={{$json.operation_id}}', request_id: '={{$json.request_id}}', config_snapshot_id: '={{$json.config_snapshot_id}}', updated_at: '={{$now}}' }, matchingColumns: ['dispatch_key'] } });
  addMappedColumnsSchema(claim, 'dispatch_key');
  claim.continueOnFail = true;
  claim.position = pos(2080, -40);
  const readClaim = googleSheetNode('Read DISPATCH_HISTORY after claim', 'DISPATCH_HISTORY');
  readClaim.continueOnFail = true;
  readClaim.position = pos(2340, -40);
  const verifyClaim = node({ name: 'Verify persisted dispatch claim', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await verifyClaimCode() }, position: pos(2600, -40), notes: 'A worker runs only when the read-back row still belongs to this execution token.' });
  const loop = node({ name: 'Loop Due Dispatches', type: 'n8n-nodes-base.splitInBatches', typeVersion: 3, parameters: { batchSize: 1, options: {} }, position: pos(2860, -40), notes: 'Process each verified dispatch claim separately; never let one Code node consume only the first due job.' });
  const claimVerified = node({ name: 'Claim verified?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{$json.claim_verified === true}}'), position: pos(3120, -40) });
  const markRunning = googleSheetNode('Mark Dispatch RUNNING', 'DISPATCH_HISTORY', 'update', { columns: { mappingMode: 'defineBelow', value: { dispatch_key: '={{$json.dispatch_key}}', status: 'RUNNING', claim_token: '={{$json.claim_token}}', updated_at: '={{$now}}' }, matchingColumns: ['dispatch_key'] } });
  addMappedColumnsSchema(markRunning, 'dispatch_key');
  markRunning.continueOnFail = true;
  markRunning.position = pos(3380, -40);
  const readRunning = googleSheetNode('Read DISPATCH_HISTORY after RUNNING', 'DISPATCH_HISTORY');
  readRunning.continueOnFail = true;
  readRunning.position = pos(3640, -40);
  const verifyRunning = node({ name: 'Verify RUNNING claim', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await verifyRunningClaimCode() }, position: pos(3900, -40) });
  const runningVerified = node({ name: 'RUNNING claim verified?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{$json.running_verified === true}}'), position: pos(4160, -40) });
  const rejectedOutcome = node({ name: 'Project rejected claim outcome', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await rejectedClaimOutcomeCode() }, position: pos(3380, 320) });
  const worker = node({ name: 'Execute Configured Worker', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: '={{$json.worker_workflow}}', options: { waitForSubWorkflow: true } }, position: pos(2340, -40), notes: 'Worker workflow ID comes from CONFIG_LICH; this node does not select a business worker by hard-coded schedule.' });
  worker.continueOnFail = true;
  const postWorkerHeartbeat = node({ name: 'Project post-worker HEARTBEAT', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await postWorkerHeartbeatCode() }, position: pos(2600, -240), notes: 'One heartbeat summarizes every completed or rejected job after the loop finishes. Any failed job makes the tick FAILED.' });
  const workerErrorCheck = node({ name: 'Worker failed?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{$json.ok !== true}}'), position: pos(2860, 120) });
  const prepareWorkerError = node({ name: 'Prepare Worker Error Handler Input', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await workerFailureCode() }, position: pos(3120, 120) });
  const callWorkerError = node({ name: 'Call Error Handler - Worker Failure', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: WF02_WORKFLOW_ID, mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(3380, 120), notes: 'All configured worker failures are normalized and audited by WF02.' });
  const finalize = node({ name: 'Finalize Dispatch History', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const claim = $('Verify RUNNING claim').itemMatching(0)?.json ?? {}; const worker = $input.first()?.json ?? {}; const failed = worker.ok !== true; const updatedAt = new Date().toISOString(); const retryAt = failed && Number(claim.retry_delay_minutes) > 0 ? new Date(Date.parse(updatedAt) + Number(claim.retry_delay_minutes) * 60000).toISOString() : ''; return [{json: { ...claim, status: failed ? 'FAILED' : 'SUCCESS', failure_count: failed ? String(Number(claim.failure_count || 0) + 1) : '0', last_error_code: failed ? String(worker.error_code || 'WORKER_FAILED') : '', retry_at: retryAt, updated_at: updatedAt }}];" }, position: pos(2860, -40) });
  const finalizeWrite = googleSheetNode('Update DISPATCH_HISTORY', 'DISPATCH_HISTORY', 'update', { columns: { mappingMode: 'defineBelow', value: { dispatch_key: '={{$json.dispatch_key}}', status: '={{$json.status}}', failure_count: '={{$json.failure_count}}', last_error_code: '={{$json.last_error_code}}', retry_at: '={{$json.retry_at}}', updated_at: '={{$json.updated_at}}' }, matchingColumns: ['dispatch_key'] } });
  addMappedColumnsSchema(finalizeWrite, 'dispatch_key');
  finalizeWrite.position = pos(3120, -40);
  const result = node({ name: 'Return Dispatcher Result', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "return $input.all();" }, position: pos(3380, -40) });
  const nodes = [schedule, execute, request, callGateway, gatewayReady, validateHeartbeatSettings, heartbeatSettingsValid, readHistory, readSessions, readDispatcherOperations, readHeartbeat, decide, schemaCompatible, heartbeatCheck, appendHeartbeat, noticeCheck, prepareNotice, callDispatchNotice, dispatchCheck, recordOutcome, dispatchNoticeCheck, prepareDispatchNotice, callError, claim, readClaim, verifyClaim, loop, claimVerified, markRunning, readRunning, verifyRunning, runningVerified, rejectedOutcome, worker, postWorkerHeartbeat, workerErrorCheck, prepareWorkerError, callWorkerError, finalize, finalizeWrite, result];
  const connections = {};
  link(connections, schedule.name, request.name);
  link(connections, execute.name, request.name);
  link(connections, request.name, callGateway.name);
  link(connections, callGateway.name, gatewayReady.name);
  link(connections, gatewayReady.name, validateHeartbeatSettings.name, 0);
  link(connections, gatewayReady.name, readHeartbeat.name, 1);
  link(connections, validateHeartbeatSettings.name, heartbeatSettingsValid.name);
  link(connections, heartbeatSettingsValid.name, readHistory.name, 0);
  link(connections, heartbeatSettingsValid.name, result.name, 1);
  link(connections, readHistory.name, readSessions.name);
  link(connections, readSessions.name, readDispatcherOperations.name);
  link(connections, readDispatcherOperations.name, readHeartbeat.name);
  link(connections, readHeartbeat.name, decide.name);
  link(connections, decide.name, schemaCompatible.name);
  link(connections, schemaCompatible.name, heartbeatCheck.name, 0);
  link(connections, schemaCompatible.name, result.name, 1);
  link(connections, heartbeatCheck.name, appendHeartbeat.name, 0);
  link(connections, heartbeatCheck.name, dispatchCheck.name, 1);
  link(connections, appendHeartbeat.name, noticeCheck.name);
  link(connections, noticeCheck.name, prepareNotice.name, 0);
  link(connections, noticeCheck.name, result.name, 1);
  link(connections, prepareNotice.name, callError.name);
  link(connections, callError.name, result.name);
  link(connections, dispatchCheck.name, claim.name, 0);
  link(connections, dispatchCheck.name, recordOutcome.name, 1);
  link(connections, dispatchCheck.name, dispatchNoticeCheck.name, 1);
  link(connections, recordOutcome.name, result.name);
  link(connections, dispatchNoticeCheck.name, prepareDispatchNotice.name, 0);
  link(connections, prepareDispatchNotice.name, callDispatchNotice.name);
  link(connections, callDispatchNotice.name, result.name);
  link(connections, claim.name, readClaim.name);
  link(connections, readClaim.name, verifyClaim.name);
  link(connections, verifyClaim.name, loop.name);
  // SplitInBatches v3 defines output 0 as done and output 1 as loop.
  link(connections, loop.name, postWorkerHeartbeat.name, 0);
  link(connections, loop.name, claimVerified.name, 1);
  link(connections, claimVerified.name, markRunning.name, 0);
  link(connections, claimVerified.name, rejectedOutcome.name, 1);
  link(connections, markRunning.name, readRunning.name);
  link(connections, readRunning.name, verifyRunning.name);
  link(connections, verifyRunning.name, runningVerified.name);
  link(connections, runningVerified.name, worker.name, 0);
  link(connections, runningVerified.name, rejectedOutcome.name, 1);
  link(connections, rejectedOutcome.name, loop.name);
  link(connections, postWorkerHeartbeat.name, appendHeartbeat.name);
  link(connections, worker.name, workerErrorCheck.name);
  link(connections, workerErrorCheck.name, prepareWorkerError.name, 0);
  link(connections, prepareWorkerError.name, callWorkerError.name);
  link(connections, callWorkerError.name, result.name);
  link(connections, worker.name, finalize.name);
  link(connections, finalize.name, finalizeWrite.name);
  link(connections, finalizeWrite.name, loop.name);
  return baseWorkflow('WF04_V2_DISPATCHER', nodes, connections);
}

async function buildInventorySessionWorkflow() {
  const execute = executeTrigger();
  const request = node({ name: 'Prepare Session Gateway Request', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const input = $input.first()?.json ?? {}; const incoming = input.envelope ?? input; const eventType = incoming.event_type || 'UNKNOWN'; return [{json: { envelope: { ...incoming, event_type: eventType, payload: { ...(incoming.payload || {}), required_sheet_names: eventType === 'SCHEDULED_JOB' ? ['CONFIG_TOPIC', 'CONFIG_BIA', 'CONFIG_GLOBAL', 'CONFIG_SCHEMA', 'EVENT_LOG'] : ['CONFIG_TOPIC', 'CONFIG_SCHEMA', 'EVENT_LOG'], intent: eventType === 'SCHEDULED_JOB' ? 'START_OPERATION' : 'READ_STATUS', dispatch_key: input.dispatch_key || incoming.payload?.dispatch_key, config_snapshot_id: input.config_snapshot_id || incoming.payload?.config_snapshot_id } } }}];" }, position: pos(260, 0) });
  const callGateway = node({ name: 'Call Config Gateway', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: WF01_WORKFLOW_ID, mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(520, 0), notes: 'Reads the configured KIEM_KE topic and preserves the dispatcher snapshot context.' });
  const readSessions = googleSheetNode('Read PHIEN_KIEM_KE', 'PHIEN_KIEM_KE');
  readSessions.position = pos(780, 0);
  const readOperations = googleSheetNode('Read OPERATION for inventory', 'OPERATION');
  readOperations.position = pos(910, 0);
  const decide = node({ name: 'Open or Reuse Inventory Session', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await inventorySessionCode() }, position: pos(1040, 0) });
  const selectSessionResult = node({ name: 'Select Session Result', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: 'return $input.all();' }, position: pos(2340, 180) });
  const writeRequired = node({ name: 'Session write required?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{($json.write_plan?.length ?? 0) > 0}}'), position: pos(1300, 0) });
  const prepareOperation = node({ name: 'Prepare OPERATION row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const result = $('Select Session Result').first()?.json ?? {}; const entry = (result.write_plan || []).find((item) => item.sheet === 'OPERATION' && item.phase === 'PREPARE'); return entry?.row ? [{json: entry.row}] : [];" }, position: pos(1560, -240) });
  const operationWrite = googleSheetAppendOrUpdateNode('Prepare OPERATION', 'OPERATION', 'operation_id', ['operation_id', 'request_id', 'operation_type', 'idempotency_key', 'expected_row_count', 'actual_row_count', 'checksum', 'status', 'error_id', 'created_at', 'updated_at']);
  operationWrite.position = pos(1820, -240);
  const sessionRequired = node({ name: 'New session row required?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{!!($('Select Session Result').first()?.json?.write_plan ?? []).some((entry) => entry.sheet === 'PHIEN_KIEM_KE' && entry.phase === 'PREPARE')}}"), position: pos(2080, -240) });
  const prepareSession = node({ name: 'Prepare PHIEN_KIEM_KE row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const result = $('Select Session Result').first()?.json ?? {}; const entry = (result.write_plan || []).find((item) => item.sheet === 'PHIEN_KIEM_KE' && item.phase === 'PREPARE'); return entry?.row ? [{json: entry.row}] : [];" }, position: pos(2340, -360) });
  const sessionWrite = googleSheetAppendOrUpdateNode('Prepare PHIEN_KIEM_KE', 'PHIEN_KIEM_KE', 'session_id', ['session_id', 'branch_id', 'business_date', 'config_snapshot_id', 'topic_id', 'chat_id', 'message_thread_id', 'dispatch_key', 'catalog_snapshot_json', 'catalog_count', 'page_size', 'master_message_id', 'bubble_state', 'status', 'created_at', 'updated_at']);
  sessionWrite.position = pos(2600, -360);
  const prepareAudit = node({ name: 'Prepare EVENT_LOG row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const result = $('Select Session Result').first()?.json ?? {}; const entry = (result.write_plan || []).find((item) => item.sheet === 'EVENT_LOG' && item.phase === 'PREPARE'); return entry?.row ? [{json: entry.row}] : [];" }, position: pos(2340, -100) });
  const auditWrite = googleSheetAppendOrUpdateNode('Prepare EVENT_LOG', 'EVENT_LOG', 'event_id', ['event_id', 'event_type', 'request_id', 'operation_id', 'actor_user_id', 'branch_id', 'topic_type', 'command', 'outcome', 'error_code', 'created_at', 'trang_thai']);
  auditWrite.position = pos(2600, -100);
  const bubbleAction = node({ name: 'Bubble action?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{$('Select Session Result').first()?.json?.status === 'OPENED'}}"), position: pos(2860, -100) });
  const markSendRow = node({ name: 'Mark bubble SEND_REQUESTED row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await bubbleCode("const planned = $('Select Session Result').first()?.json ?? {}; const marked = markSendRequested({ ...planned.session, status: 'PREPARED' }); return [{ json: { session_id: marked.session_id, dispatch_key: marked.dispatch_key, status: marked.status, bubble_state: marked.bubble_state, updated_at: marked.updated_at } }];") }, position: pos(3120, -360) });
  const markSend = googleSheetUpdateNode('Mark bubble SEND_REQUESTED', 'PHIEN_KIEM_KE', 'session_id', ['session_id', 'dispatch_key', 'status', 'bubble_state', 'updated_at']);
  markSend.position = pos(3380, -360);
  const readMarker = googleSheetNode('Read bubble marker', 'PHIEN_KIEM_KE');
  readMarker.position = pos(3640, -360);
  const verifyMarker = node({ name: 'Verify bubble marker', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const expected = $('Select Session Result').first()?.json?.session ?? {}; const rows = $items('Read bubble marker').map((item) => item.json).filter((row) => String(row.session_id || '') === String(expected.session_id || '')); const row = rows.length === 1 ? rows[0] : {}; const safe = !!expected.session_id && row.status === 'SEND_REQUESTED' && row.bubble_state === 'SEND_REQUESTED' && String(row.dispatch_key || '') === String(expected.dispatch_key || '') && !String(row.master_message_id || '').trim(); return [{json: {...row, safe_to_send: safe}}];" }, position: pos(3900, -360) });
  const safeToSend = node({ name: 'Safe to send bubble?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{$json.safe_to_send === true}}'), position: pos(4160, -360) });
  const prepareSend = node({ name: 'Prepare Inventory Bubble Send', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await bubbleCode("const row = $input.first()?.json ?? {}; if (row.safe_to_send !== true) throw new Error('INVENTORY_SEND_NOT_SAFE'); const rendered = renderInventoryBubble(row, { page: 1 }); return [{ json: { ...row, text: rendered.text } }];") }, position: pos(4420, -480) });
  const sendBubble = node({ name: 'Send Inventory Bubble', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, parameters: { resource: 'message', operation: 'sendMessage', chatId: '={{$json.chat_id}}', text: '={{$json.text}}', additionalFields: { message_thread_id: '={{$json.message_thread_id}}', appendAttribution: false, parse_mode: 'HTML' } }, credentials: { telegramApi: { name: TELEGRAM_CREDENTIAL } }, position: pos(4680, -480) });
  sendBubble.continueOnFail = true;
  const observeSend = node({ name: 'Observe bubble send', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await bubbleCode("const marker = $('Verify bubble marker').first()?.json ?? {}; const response = $input.first()?.json ?? {}; const outcome = observeTelegramSend(marker, response); return [{json: {...outcome.patch, can_commit: outcome.can_commit, error_code: outcome.error_code || ''}}];") }, position: pos(4940, -480) });
  const saveOutcome = googleSheetUpdateNode('Save bubble outcome', 'PHIEN_KIEM_KE', 'session_id', ['session_id', 'dispatch_key', 'master_message_id', 'bubble_state', 'status', 'updated_at']);
  saveOutcome.position = pos(5200, -480);
  const readSaved = googleSheetNode('Read saved bubble', 'PHIEN_KIEM_KE');
  readSaved.position = pos(5460, -480);
  const confirmBubble = node({ name: 'Confirm bubble identity', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const expected = $('Observe bubble send').first()?.json ?? {}; const rows = $items('Read saved bubble').map((item) => item.json).filter((row) => String(row.session_id || '') === String(expected.session_id || '')); const row = rows.length === 1 ? rows[0] : {}; const ready = expected.can_commit === true && /^[1-9]\\d*$/.test(String(expected.master_message_id || '')) && String(row.master_message_id || '') === String(expected.master_message_id) && row.bubble_state === 'SENT' && row.status === 'PREPARED' && String(row.dispatch_key || '') === String(expected.dispatch_key || ''); return [{json: {...row, ready}}];" }, position: pos(5720, -480) });
  const bubbleReady = node({ name: 'Bubble ready to commit?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{$json.ready === true}}'), position: pos(5980, -480) });
  const prepareEdit = node({ name: 'Prepare Inventory Bubble Edit', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await bubbleCode("const planned = $('Select Session Result').first()?.json ?? {}; const session = planned.session ?? {}; const action = planBubbleAction(session); if (action.action !== 'EDIT') throw new Error('INVENTORY_BUBBLE_RECONCILIATION_REQUIRED'); const rendered = renderInventoryBubble(session, { page: 1 }); return [{json: {...session, text: rendered.text}}];") }, position: pos(3120, 80) });
  const editBubble = node({ name: 'Edit Inventory Bubble', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, parameters: { resource: 'message', operation: 'editMessageText', messageType: 'message', chatId: '={{$json.chat_id}}', messageId: '={{$json.master_message_id}}', text: '={{$json.text}}', replyMarkup: 'none', additionalFields: { parse_mode: 'HTML' } }, credentials: { telegramApi: { name: TELEGRAM_CREDENTIAL } }, position: pos(3380, 80) });
  editBubble.continueOnFail = true;
  const verifyEdit = node({ name: 'Verify Bubble Edit', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await bubbleCode("const session = $('Select Session Result').first()?.json?.session ?? {}; const reply = $input.first()?.json ?? {}; return [{json: observeTelegramEdit(session, reply)}];") }, position: pos(3640, 80) });
  const editSucceeded = node({ name: 'Bubble edit succeeded?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{$json.edit_ok === true}}'), position: pos(3900, 80) });
  const returnReconciliation = node({ name: 'Return Bubble Reconciliation', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const planned = $('Select Session Result').first()?.json ?? {}; return [{json: {ok: false, status: 'ERROR', error_code: 'INVENTORY_BUBBLE_RECONCILIATION_REQUIRED', session_id: planned.session?.session_id || ''}}];" }, position: pos(6240, 220) });
  const commitSessionRequired = node({ name: 'Session commit required?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{!!($('Select Session Result').first()?.json?.commit_plan ?? []).some((entry) => entry.sheet === 'PHIEN_KIEM_KE' && entry.phase === 'COMMIT')}}"), position: pos(3640, -100) });
  const commitSessionRow = node({ name: 'Commit PHIEN_KIEM_KE row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const result = $('Select Session Result').first()?.json ?? {}; const entry = (result.commit_plan || []).find((item) => item.sheet === 'PHIEN_KIEM_KE' && item.phase === 'COMMIT'); const bubble = $('Confirm bubble identity').first()?.json ?? {}; return entry && bubble.ready === true ? [{json: {...entry.match, ...entry.patch, master_message_id: bubble.master_message_id, bubble_state: 'SENT'}}] : [];" }, position: pos(3900, -240) });
  const commitSession = googleSheetUpdateNode('Commit PHIEN_KIEM_KE', 'PHIEN_KIEM_KE', 'session_id', ['session_id', 'master_message_id', 'bubble_state', 'status', 'updated_at']);
  commitSession.position = pos(3380, -240);
  const commitAuditRow = node({ name: 'Commit EVENT_LOG row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const result = $('Select Session Result').first()?.json ?? {}; const entry = (result.commit_plan || []).find((item) => item.sheet === 'EVENT_LOG' && item.phase === 'COMMIT'); return entry ? [{json: {...entry.match, ...entry.patch}}] : [];" }, position: pos(3900, -20) });
  const commitAudit = googleSheetUpdateNode('Commit EVENT_LOG', 'EVENT_LOG', 'event_id', ['event_id', 'trang_thai']);
  commitAudit.position = pos(3380, -20);
  const commitOperationRow = node({ name: 'Commit OPERATION row', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const result = $('Select Session Result').first()?.json ?? {}; const entry = (result.commit_plan || []).find((item) => item.sheet === 'OPERATION' && item.phase === 'COMMIT'); return entry ? [{json: {...entry.match, ...entry.patch}}] : [];" }, position: pos(4420, -20) });
  const commitOperation = googleSheetUpdateNode('Commit OPERATION', 'OPERATION', 'operation_id', ['operation_id', 'status', 'actual_row_count', 'updated_at']);
  commitOperation.position = pos(3900, -20);
  const readCommittedOperation = googleSheetNode('Read committed inventory OPERATION', 'OPERATION');
  readCommittedOperation.position = pos(4680, -20);
  const readCommittedAudit = googleSheetNode('Read committed inventory EVENT_LOG', 'EVENT_LOG');
  readCommittedAudit.position = pos(4940, -20);
  const readCommittedSession = googleSheetNode('Read committed inventory PHIEN_KIEM_KE', 'PHIEN_KIEM_KE');
  readCommittedSession.position = pos(5200, -20);
  const verifyCommittedTransaction = node({ name: 'Verify committed inventory transaction', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const planned = $('Select Session Result').first()?.json ?? {}; const expected = planned.operation ?? {}; const expectedSession = planned.session ?? {}; const expectedAuditId = String((planned.commit_plan || []).find((entry) => entry.sheet === 'EVENT_LOG' && entry.phase === 'COMMIT')?.match?.event_id || ''); const expectedSessionId = String((planned.commit_plan || []).find((entry) => entry.sheet === 'PHIEN_KIEM_KE' && entry.phase === 'COMMIT')?.match?.session_id || ''); const operationRows = $items('Read committed inventory OPERATION').map((item) => item.json).filter((row) => String(row.operation_id || '') === String(expected.operation_id || '')); const auditRows = $items('Read committed inventory EVENT_LOG').map((item) => item.json).filter((row) => String(row.event_id || '') === expectedAuditId); const sessionRows = expectedSessionId ? $items('Read committed inventory PHIEN_KIEM_KE').map((item) => item.json).filter((row) => String(row.session_id || '') === expectedSessionId) : []; const operation = operationRows.length === 1 ? operationRows[0] : {}; const audit = auditRows.length === 1 ? auditRows[0] : {}; const session = sessionRows.length === 1 ? sessionRows[0] : {}; const expectedCount = String(expected.expected_row_count || ''); const requiredCount = String(expectedSessionId ? 3 : 2); let sessionCommitted = !expectedSessionId; if (expectedSessionId) { const bubble = $('Confirm bubble identity').first()?.json ?? {}; sessionCommitted = bubble.ready === true && sessionRows.length === 1 && String(session.session_id || '') === String(expectedSession.session_id || '') && String(session.branch_id || '') === String(expectedSession.branch_id || '') && String(session.business_date || '') === String(expectedSession.business_date || '') && !!String(expectedSession.config_snapshot_id || '') && String(session.config_snapshot_id || '') === String(expectedSession.config_snapshot_id || '') && String(session.dispatch_key || '') === String(expectedSession.dispatch_key || '') && String(session.dispatch_key || '') === String(expected.idempotency_key || '') && /^[1-9]\\d*$/.test(String(bubble.master_message_id || '')) && String(session.master_message_id || '') === String(bubble.master_message_id || '') && String(session.bubble_state || '').toUpperCase() === 'SENT' && String(session.status || '').toUpperCase() === 'ACTIVE'; } const committed = !!expected.operation_id && !!expectedAuditId && expectedCount === requiredCount && operationRows.length === 1 && auditRows.length === 1 && sessionCommitted && String(operation.request_id || '') === String(expected.request_id || '') && String(operation.operation_type || '') === String(expected.operation_type || '') && String(operation.idempotency_key || '') === String(expected.idempotency_key || '') && String(operation.expected_row_count || '') === expectedCount && String(operation.actual_row_count || '') === expectedCount && String(operation.status || '').toUpperCase() === 'COMMITTED' && String(audit.request_id || '') === String(expected.request_id || '') && String(audit.operation_id || '') === String(expected.operation_id || '') && String(audit.trang_thai || '').toUpperCase() === 'COMMITTED'; return [{json: {committed}}];" }, position: pos(5460, -20), notes: 'Proves the exact OPERATION and EVENT_LOG identities plus the committed PHIEN_KIEM_KE row for a three-row opening before worker-owned completion can be reported.' });
  const commitConfirmed = node({ name: 'Inventory commit confirmed?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{$json.committed === true}}'), position: pos(5460, -20) });
  const pinNeeded = node({ name: 'New bubble needs pin?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters("={{$('Select Session Result').first()?.json?.status === 'OPENED'}}"), position: pos(5720, -20) });
  const pinBubble = node({ name: 'Pin Inventory Bubble', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, parameters: { resource: 'message', operation: 'pinChatMessage', chatId: "={{$('Confirm bubble identity').first()?.json?.chat_id}}", messageId: "={{$('Confirm bubble identity').first()?.json?.master_message_id}}", additionalFields: { disable_notification: true } }, credentials: { telegramApi: { name: TELEGRAM_CREDENTIAL } }, position: pos(5720, -100) });
  pinBubble.continueOnFail = true;
  const pinOutcome = node({ name: 'Project Inventory Pin Outcome', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await bubbleCode("const session = $('Confirm bubble identity').first()?.json ?? {}; const pin = recordPinOutcome(session, $input.first()?.json); return [{json: {session_id: session.session_id, pinned: pin.pinned, pin_warning_code: pin.warning_code}}];") }, position: pos(5980, -100) });
  const pinWarningRequired = node({ name: 'Pin warning required?', type: 'n8n-nodes-base.if', typeVersion: 2.2, parameters: booleanIfParameters('={{!!$json.pin_warning_code}}'), position: pos(6240, -100) });
  const preparePinWarning = node({ name: 'Prepare Inventory Pin Warning', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: "const planned = $('Select Session Result').first()?.json ?? {}; const gateway = $('Call Config Gateway').first()?.json ?? {}; const operation = planned.operation ?? {}; return [{json: {error: {error_code: 'INVENTORY_PIN_FAILED', retryable: false, message_key: 'INVENTORY_PIN_FAILED', message: 'INVENTORY_PIN_FAILED'}, context: {request_id: operation.request_id, operation_id: operation.operation_id, workflow: 'WF05_V2_MO_PHIEN_KIEM_KE', node: 'Pin Inventory Bubble', config_version: gateway.response?.config_version}, messages: gateway.response?.messages ?? {}, reply_target: null}}];" }, position: pos(6500, -220) });
  const recordPinWarning = node({ name: 'Record Inventory Pin Warning', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { workflowId: { __rl: true, value: WF02_WORKFLOW_ID, mode: 'id' }, options: { waitForSubWorkflow: true } }, position: pos(6760, -220), notes: 'Persist sanitized pin diagnostics in ERROR_BIA without sending another inventory bubble. A failed audit write must surface rather than be reported as persisted.' });
  const result = node({ name: 'Return Inventory Session Result', type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: await bubbleCode("const planned = $('Select Session Result').first()?.json ?? {}; if (planned.ok !== true) return [{json: {ok: false, status: 'ERROR', error_code: planned.error_code || 'INVENTORY_SESSION_RESULT_INVALID'}}]; const session = planned.status === 'OPENED' ? ($('Confirm bubble identity').first()?.json ?? {}) : (planned.session ?? {}); const needsCommitProof = (planned.commit_plan || []).some((entry) => entry.sheet === 'OPERATION' && entry.phase === 'COMMIT'); let operationCommitted = false; if (needsCommitProof) { try { operationCommitted = $('Verify committed inventory transaction').first()?.json?.committed === true; } catch { operationCommitted = false; } } const proofRequired = planned.reply_handled === true || needsCommitProof; if (proofRequired && !operationCommitted) return [{json: {ok: false, status: 'ERROR', error_code: 'INVENTORY_COMMIT_RECONCILIATION_REQUIRED', operation_id: planned.operation?.operation_id, idempotency_key: planned.operation?.idempotency_key, reply_handled: false, operation_committed: false}}]; let pinResponse = null; if (planned.status === 'OPENED') { try { pinResponse = $('Pin Inventory Bubble').first()?.json ?? null; } catch {} } const pin = planned.status === 'OPENED' ? recordPinOutcome(session, pinResponse) : {pinned: null, warning_code: ''}; return [{json: {ok: true, status: planned.status, session_id: session.session_id, operation_id: planned.operation?.operation_id, idempotency_key: planned.operation?.idempotency_key, master_message_id: session.master_message_id, pin_warning_code: pin.warning_code, reply_handled: planned.reply_handled === true && operationCommitted, operation_committed: operationCommitted}}];") }, position: pos(6240, -20) });
  const nodes = [execute, request, callGateway, readSessions, readOperations, decide, selectSessionResult, writeRequired, prepareOperation, operationWrite, sessionRequired, prepareSession, sessionWrite, prepareAudit, auditWrite, bubbleAction, markSendRow, markSend, readMarker, verifyMarker, safeToSend, prepareSend, sendBubble, observeSend, saveOutcome, readSaved, confirmBubble, bubbleReady, prepareEdit, editBubble, verifyEdit, editSucceeded, returnReconciliation, commitSessionRequired, commitSessionRow, commitSession, commitAuditRow, commitAudit, commitOperationRow, commitOperation, readCommittedOperation, readCommittedAudit, readCommittedSession, verifyCommittedTransaction, commitConfirmed, pinNeeded, pinBubble, pinOutcome, pinWarningRequired, preparePinWarning, recordPinWarning, result];
  const connections = {};
  link(connections, execute.name, request.name);
  link(connections, request.name, callGateway.name);
  link(connections, callGateway.name, readSessions.name);
  link(connections, readSessions.name, readOperations.name);
  link(connections, readOperations.name, decide.name);
  link(connections, decide.name, selectSessionResult.name);
  link(connections, selectSessionResult.name, writeRequired.name);
  link(connections, writeRequired.name, prepareOperation.name, 0);
  link(connections, writeRequired.name, result.name, 1);
  link(connections, prepareOperation.name, operationWrite.name);
  link(connections, operationWrite.name, sessionRequired.name);
  link(connections, sessionRequired.name, prepareSession.name, 0);
  link(connections, sessionRequired.name, prepareAudit.name, 1);
  link(connections, prepareSession.name, sessionWrite.name);
  link(connections, sessionWrite.name, prepareAudit.name);
  link(connections, prepareAudit.name, auditWrite.name);
  link(connections, auditWrite.name, bubbleAction.name);
  link(connections, bubbleAction.name, markSendRow.name, 0);
  link(connections, bubbleAction.name, prepareEdit.name, 1);
  link(connections, markSendRow.name, markSend.name);
  link(connections, markSend.name, readMarker.name);
  link(connections, readMarker.name, verifyMarker.name);
  link(connections, verifyMarker.name, safeToSend.name);
  link(connections, safeToSend.name, prepareSend.name, 0);
  link(connections, safeToSend.name, returnReconciliation.name, 1);
  link(connections, prepareSend.name, sendBubble.name);
  link(connections, sendBubble.name, observeSend.name);
  link(connections, observeSend.name, saveOutcome.name);
  link(connections, saveOutcome.name, readSaved.name);
  link(connections, readSaved.name, confirmBubble.name);
  link(connections, confirmBubble.name, bubbleReady.name);
  link(connections, bubbleReady.name, commitSessionRequired.name, 0);
  link(connections, bubbleReady.name, returnReconciliation.name, 1);
  link(connections, prepareEdit.name, editBubble.name);
  link(connections, editBubble.name, verifyEdit.name);
  link(connections, verifyEdit.name, editSucceeded.name);
  link(connections, editSucceeded.name, commitAuditRow.name, 0);
  link(connections, editSucceeded.name, returnReconciliation.name, 1);
  link(connections, commitSessionRequired.name, commitSessionRow.name, 0);
  link(connections, commitSessionRequired.name, commitAuditRow.name, 1);
  link(connections, commitSessionRow.name, commitSession.name);
  link(connections, commitSession.name, commitAuditRow.name);
  link(connections, commitAuditRow.name, commitAudit.name);
  link(connections, commitAudit.name, commitOperationRow.name);
  link(connections, commitOperationRow.name, commitOperation.name);
  link(connections, commitOperation.name, readCommittedOperation.name);
  link(connections, readCommittedOperation.name, readCommittedAudit.name);
  link(connections, readCommittedAudit.name, readCommittedSession.name);
  link(connections, readCommittedSession.name, verifyCommittedTransaction.name);
  link(connections, verifyCommittedTransaction.name, commitConfirmed.name);
  link(connections, commitConfirmed.name, pinNeeded.name, 0);
  link(connections, commitConfirmed.name, returnReconciliation.name, 1);
  link(connections, pinNeeded.name, pinBubble.name, 0);
  link(connections, pinNeeded.name, result.name, 1);
  link(connections, pinBubble.name, pinOutcome.name);
  link(connections, pinOutcome.name, pinWarningRequired.name);
  link(connections, pinWarningRequired.name, preparePinWarning.name, 0);
  link(connections, pinWarningRequired.name, result.name, 1);
  link(connections, preparePinWarning.name, recordPinWarning.name);
  link(connections, recordPinWarning.name, result.name);
  return baseWorkflow('WF05_V2_MO_PHIEN_KIEM_KE', nodes, connections);
}

const workflows = [
  await buildGatewayWorkflow(),
  await buildGatewayWorkflow({ name: 'WF01_V2_HEARTBEAT_GATEWAY', auditFailures: false, callerPolicy: 'workflowsFromAList', callerIds: WF04_WORKFLOW_ID }),
  await buildErrorWorkflow(),
  await buildRouterWorkflow(),
  await buildDispatcherWorkflow(),
  await buildInventorySessionWorkflow(),
];
await mkdir(outputDir, { recursive: true });
for (const workflow of workflows) {
  const filename = `${workflow.name}.json`;
  await writeFile(path.join(outputDir, filename), `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
}
console.log(`Built ${workflows.length} V2 workflows in ${outputDir}`);
