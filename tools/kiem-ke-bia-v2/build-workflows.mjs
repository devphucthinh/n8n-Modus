import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { schemaManifest } from "./schema-manifest.mjs";
import { normalizeEnvelope, sha256Hex, stableKey } from "../../src/kiem-ke-bia-v2/contracts.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = path.join(repoRoot, "outputs", "kiem-ke-bia-v2-2026-09-29");
const workflowDir = path.join(outputDir, "workflows");
const sheetNames = new Set(schemaManifest.sheets.map((entry) => entry.name));
const SHEETS_ID = "GOOGLE_SHEET_ID_CONFIGURE";
const WORKFLOW_ID = "WORKFLOW_ID_CONFIGURE";

const names = {
  WF01: "WF01_V2_CONFIG_GATEWAY",
  WF02: "WF02_V2_ERROR_HANDLER",
  WF03: "WF03_V2_TELEGRAM_ROUTER",
  WF04: "WF04_V2_DISPATCHER",
  WF05: "WF05_V2_OPEN_SESSION",
  WF06: "WF06_V2_COUNT_INTAKE",
  WF07: "WF07_V2_RECONCILE_CLOSE",
  WF08: "WF08_V2_INVOICE_INGESTION",
  WF09: "WF09_V2_SALES_INGESTION",
  WF10: "WF10_V2_REPORTING",
  WF11: "WF11_V2_WEEKLY_ARCHIVE",
  WF12: "WF12_V2_BACKUP_RECOVERY",
};

const fileNames = {
  WF01: "WF01_CONFIG_GATEWAY.json",
  WF02: "WF02_ERROR_HANDLER.json",
  WF03: "WF03_TELEGRAM_ROUTER.json",
  WF04: "WF04_DISPATCHER.json",
  WF05: "WF05_OPEN_SESSION.json",
  WF06: "WF06_COUNT_INTAKE.json",
  WF07: "WF07_RECONCILE_CLOSE.json",
  WF08: "WF08_INVOICE_INGESTION.json",
  WF09: "WF09_SALES_INGESTION.json",
  WF10: "WF10_REPORTING.json",
  WF11: "WF11_WEEKLY_ARCHIVE.json",
  WF12: "WF12_BACKUP_RECOVERY.json",
};

const workflowDependencies = {
  WF01: [],
  WF02: ["WF01"],
  WF03: ["WF01", "WF02", "WF05", "WF06", "WF08", "WF09", "WF10"],
  WF04: ["WF01", "WF02", "WF05", "WF07", "WF10", "WF11", "WF12"],
  WF05: ["WF01"],
  WF06: ["WF01", "WF07"],
  WF07: ["WF01", "WF10"],
  WF08: ["WF01", "WF07"],
  WF09: ["WF01", "WF07"],
  WF10: ["WF01"],
  WF11: ["WF01"],
  WF12: ["WF01"],
};

const importOrder = ["WF02", "WF01", "WF05", "WF06", "WF08", "WF09", "WF07", "WF10", "WF11", "WF12", "WF03", "WF04"];

const primaryKeys = {
  OPERATION: "idempotency_key",
  CONFIG_VERSION: "config_version",
  CONFIG_SNAPSHOT: "config_snapshot_id",
  ERROR_BIA: "error_id",
  HEARTBEAT: "heartbeat_id",
  DISPATCH_HISTORY: "dispatch_key",
  STATE_CHO: "state_id",
  RETRY_CONTEXT: "retry_id",
  HOA_DON_NHAP: "invoice_id",
  ANH_HOA_DON: "evidence_id",
  OCR_RAW: "ocr_raw_id",
  DONG_NHAP: "line_id",
  DOT_NHAP_BAN: "sales_upload_id",
  DONG_BAN_NGUON: "source_line_id",
  TON_DAU_KY: "opening_balance_id",
  LOG_NHAP: "row_id",
  LOG_BAN: "sales_version_id",
  PHIEN_KIEM_KE: "session_id",
  BIA_LOG: "entry_id",
  DIEU_CHINH_SO: "adjustment_id",
  BAO_CAO_NGAY: "daily_report_id",
  BAO_CAO_TUAN: "weekly_report_id",
  EVENT_LOG: "event_id",
  ARCHIVE_INDEX: "archive_id",
  BACKUP_INDEX: "backup_id",
};

function position(index) {
  return [260 + (index % 5) * 300, 220 + Math.floor(index / 5) * 180];
}

function nodeBase(id, name, type, typeVersion, index, extra = {}) {
  return {
    id,
    name,
    type,
    typeVersion,
    position: position(index),
    ...extra,
  };
}

function executeTrigger(index = 0) {
  return nodeBase("execute-trigger", "Execute Workflow Trigger", "n8n-nodes-base.executeWorkflowTrigger", 1.1, index, { parameters: {} });
}

function errorTrigger(index = 1) {
  return nodeBase("error-trigger", "Error Trigger", "n8n-nodes-base.errorTrigger", 1, index, { parameters: {} });
}

function telegramTrigger(index = 0) {
  return nodeBase("telegram-trigger", "Telegram Trigger", "n8n-nodes-base.telegramTrigger", 1.2, index, {
    parameters: { updates: ["message", "edited_message", "callback_query"] },
    webhookId: "KKB_V2_TELEGRAM_WEBHOOK_CONFIGURE",
    credentials: { telegramApi: { name: "TELEGRAM_KKB_V2" } },
  });
}

function scheduleTrigger(index = 0) {
  return nodeBase("schedule-trigger", "Technical Tick 10 Minutes", "n8n-nodes-base.scheduleTrigger", 1.2, index, {
    parameters: { rule: { interval: [{ field: "minutes", minutesInterval: 10 }] } },
  });
}

function executeWorkflowNode(id, name, index, workflowId = WORKFLOW_ID) {
  return nodeBase(id, name, "n8n-nodes-base.executeWorkflow", 1.2, index, {
    parameters: {
      workflowId: { __rl: true, value: workflowId, mode: "id" },
      options: { waitForSubWorkflow: true },
    },
  });
}

function readSheetNode(sheetName, index) {
  if (!sheetNames.has(sheetName)) throw new Error(`Unknown read sheet: ${sheetName}`);
  return nodeBase(`read-${sheetName.toLowerCase()}`, `Read ${sheetName}`, "n8n-nodes-base.googleSheets", 4.5, index, {
    parameters: {
      operation: "read",
      documentId: { __rl: true, value: SHEETS_ID, mode: "id" },
      sheetName: { __rl: true, value: sheetName, mode: "name" },
      options: { returnAll: true },
    },
    credentials: { googleSheetsOAuth2Api: { name: "GOOGLE_SHEETS_KKB_V2" } },
    alwaysOutputData: true,
    executeOnce: true,
  });
}

function readSheetValuesNode(sheetName, index) {
  if (!sheetNames.has(sheetName)) throw new Error(`Unknown read sheet: ${sheetName}`);
  const quotedSheetName = encodeURIComponent(`'${sheetName}'`);
  return nodeBase(`read-${sheetName.toLowerCase()}`, `Read ${sheetName}`, "n8n-nodes-base.httpRequest", 4.2, index, {
    parameters: {
      method: "GET",
      url: `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_ID}/values/${quotedSheetName}`,
      authentication: "predefinedCredentialType",
      nodeCredentialType: "googleSheetsOAuth2Api",
      sendQuery: true,
      queryParameters: { parameters: [
        { name: "majorDimension", value: "ROWS" },
        { name: "valueRenderOption", value: "UNFORMATTED_VALUE" },
        { name: "dateTimeRenderOption", value: "FORMATTED_STRING" },
      ] },
      options: { response: { response: { responseFormat: "json" } } },
    },
    credentials: { googleSheetsOAuth2Api: { name: "GOOGLE_SHEETS_KKB_V2" } },
    alwaysOutputData: true,
    executeOnce: true,
  });
}

function wf01RequestedReadGate(sheetName, index) {
  const requestedNames = "($('Execute Workflow Trigger').first()?.json?.envelope ?? $('Execute Workflow Trigger').first()?.json)?.payload?.required_sheet_names";
  const condition = `={{Array.isArray(${requestedNames}) && ${requestedNames}.some((name) => String(name ?? '').trim() === ${JSON.stringify(sheetName)})}}`;
  return nodeBase(`wf01-read-gate-${sheetName.toLowerCase()}`, `WF01 Read ${sheetName} Requested`, "n8n-nodes-base.if", 2.2, index, {
    parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ id: `wf01-read-${sheetName.toLowerCase()}`, leftValue: condition, rightValue: true, operator: { type: "boolean", operation: "equals" } }], combinator: "and" }, options: {} },
  });
}

function writeSheetNode(sheetName, index, operation = "appendOrUpdate") {
  if (!sheetNames.has(sheetName)) throw new Error(`Unknown write sheet: ${sheetName}`);
  const key = primaryKeys[sheetName];
  const parameters = {
    operation,
    documentId: { __rl: true, value: SHEETS_ID, mode: "id" },
    sheetName: { __rl: true, value: sheetName, mode: "name" },
    options: { returnAll: true },
    columns: { mappingMode: "autoMapInputData" },
  };
  if (operation === "appendOrUpdate" && key) parameters.columns.matchingColumns = [key];
  return nodeBase(`write-${sheetName.toLowerCase()}-${index}`, `${operation === "append" ? "Append" : "Upsert"} ${sheetName}`, "n8n-nodes-base.googleSheets", 4.5, index, {
    parameters,
    credentials: { googleSheetsOAuth2Api: { name: "GOOGLE_SHEETS_KKB_V2" } },
  });
}

function codeNode(id, name, index, jsCode, extra = {}) {
  return nodeBase(id, name, "n8n-nodes-base.code", 2, index, { parameters: { jsCode }, ...extra });
}

function callGateway(index) {
  return executeWorkflowNode("call-wf01", "Call WF01 Config Gateway", index, WORKFLOW_ID);
}

function normalizeCode(workflowCode, triggerName) {
  return `const input = $input.first()?.json ?? {};
const source = input.envelope ?? input;
const now = new Date().toISOString();
const requestId = String(source.request_id ?? input.request_id ?? '${workflowCode}-REQUEST_ID_CONFIGURE');
const operationId = String(source.operation_id ?? input.operation_id ?? requestId);
const envelope = {
  envelope_version: 'v2',
  request_id: requestId,
  operation_id: operationId,
  event_type: String(source.event_type ?? '${workflowCode}_REQUEST'),
  branch_id: source.branch_id ?? input.branch_id ?? null,
  actor_user_id: source.actor_user_id ?? input.actor_user_id ?? null,
  business_date: source.business_date ?? input.business_date ?? null,
  config_version: source.config_version ?? null,
  config_snapshot_id: source.config_snapshot_id ?? null,
  payload: source.payload ?? input.payload ?? input,
  reply_target: source.reply_target ?? input.reply_target ?? null,
};
return [{ json: { ...input, envelope, normalized_at: now, source_trigger: '${triggerName}' } }];`;
}

function buildDecisionCode(workflowCode, writeSheets, triggerName) {
  const keyMap = Object.fromEntries(writeSheets.map((sheetName) => [sheetName, primaryKeys[sheetName] ?? `${sheetName.toLowerCase()}_id`]));
  return `const input = $input.first()?.json ?? {};
const source = input.envelope ? input : (typeof $('${triggerName}') !== 'undefined' ? ($('${triggerName}').first()?.json ?? input) : input);
const envelope = source.envelope ?? input.envelope ?? {};
const payload = envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
const now = new Date().toISOString();
const operationId = String(envelope.operation_id ?? '${workflowCode}-OPERATION_CONFIGURE');
const rows = {};
const keyMap = ${JSON.stringify(keyMap)};
for (const sheetName of ${JSON.stringify(writeSheets)}) {
  const key = keyMap[sheetName];
  const row = {};
  row[key] = String(payload[key] ?? payload.id ?? \`${workflowCode}-\${sheetName}-\${operationId}\`);
  for (const field of ['operation_id', 'request_id', 'branch_id', 'business_date', 'config_snapshot_id', 'created_at', 'updated_at']) {
    if (envelope[field] != null) row[field] = envelope[field];
    else if (source[field] != null) row[field] = source[field];
  }
  if (Object.prototype.hasOwnProperty.call(row, 'status')) row.status = 'PREPARED';
  row.workflow_code = '${workflowCode}';
  row.write_state = 'PREPARED';
  row.commit_state = 'PREPARED';
  row.created_at = row.created_at ?? now;
  row.updated_at = now;
  rows[sheetName] = [row];
}
return [{ json: { ok: true, status: 'PREPARED', commit_state: 'PREPARED', workflow_code: '${workflowCode}', operation_id: operationId, envelope, rows, generated_at: now } }];`;
}

function projectCode(buildName, sheetName) {
  return `const source = $('${buildName}').first()?.json ?? $json;
const row = source.rows?.['${sheetName}']?.[0] ?? { operation_id: source.operation_id, status: 'PREPARED', write_state: 'PREPARED' };
return [{ json: row }];`;
}

function finalizeCode(buildName, workflowCode) {
  return `const source = $('${buildName}').first()?.json ?? $json;
return [{ json: { ...source, ok: true, status: 'COMMITTED', commit_state: 'COMMITTED', workflow_code: '${workflowCode}', committed_at: new Date().toISOString() } }];`;
}

function returnCode(finalizeName) {
  return `const result = $('${finalizeName}').first()?.json ?? $json;
return [{ json: { ok: Boolean(result.ok), status: result.status, commit_state: result.commit_state, workflow_code: result.workflow_code, operation_id: result.operation_id, request_id: result.envelope?.request_id ?? result.request_id ?? null, warnings: result.warnings ?? [], data: result.rows ?? {} } }];`;
}

function archiveBoundaryCode(workflowCode, mode) {
  return `const input = $input.first()?.json ?? {};
return [{ json: { ...input, integration: { mode: '${mode}', status: 'PENDING_EXTERNAL_BINDING', credential: '${mode === "ARCHIVE" ? "GOOGLE_DRIVE_KKB_V2" : "GOOGLE_DRIVE_KKB_V2"}', instruction: 'Bind the external file operation before activation.' }, status: 'PREPARED' } }];`;
}

function googleDriveBoundary(index, name) {
  return nodeBase(`drive-boundary-${index}`, name, "n8n-nodes-base.googleDrive", 3, index, {
    parameters: {
      resource: "file",
      operation: "upload",
      binaryPropertyName: "data",
      name: "={{$json.file_name || 'KKB_V2_EXTERNAL_FILE_CONFIGURE'}}",
      parents: { __rl: true, value: "DRIVE_FOLDER_CONFIGURE", mode: "id" },
    },
    credentials: { googleDriveOAuth2Api: { name: "GOOGLE_DRIVE_KKB_V2" } },
    disabled: true,
  });
}

function geminiBoundary(index) {
  return nodeBase("gemini-boundary", "Gemini OCR (bind before activation)", "n8n-nodes-base.httpRequest", 4.2, index, {
    parameters: {
      method: "POST",
      url: "GEMINI_ENDPOINT_CONFIGURE",
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{JSON.stringify($json.ocr_request || {})}}",
      options: {},
    },
    credentials: { httpHeaderAuth: { name: "GEMINI_KKB_V2" } },
    disabled: true,
  });
}

function connect(connections, from, to, output = 0) {
  connections[from] = connections[from] ?? { main: [] };
  connections[from].main[output] = connections[from].main[output] ?? [];
  connections[from].main[output].push({ node: to, type: "main", index: 0 });
}

function linearize(nodes, connections, triggerNames, steps) {
  for (const trigger of triggerNames) connect(connections, trigger, steps[0]);
  for (let index = 0; index < steps.length - 1; index += 1) connect(connections, steps[index], steps[index + 1]);
  return nodes;
}

function addIncompleteImplementationGuard(code, nodes, connections) {
  const triggers = nodes.filter((node) => node.type.toLowerCase().includes("trigger"));
  if (triggers.length === 0) throw new Error(`${code} has no entry trigger for its incomplete-implementation guard`);

  const downstreamByKey = new Map();
  for (const trigger of triggers) {
    for (const [outputIndex, links] of (connections[trigger.name]?.main ?? []).entries()) {
      for (const link of links ?? []) {
        const key = `${outputIndex}:${link.node}:${link.type}:${link.index}`;
        downstreamByKey.set(key, { ...link, sourceOutput: outputIndex });
      }
    }
  }

  const guardName = "Block Incomplete Workflow";
  const guard = codeNode(
    `incomplete-guard-${code.toLowerCase()}`,
    guardName,
    nodes.length,
    `throw new Error('INCOMPLETE_WORKFLOW: ${code} is an unimplemented deployment scaffold.');`,
  );
  guard.position = [260, 40];
  nodes.push(guard);

  for (const trigger of triggers) {
    connections[trigger.name] = {
      main: [[{ node: guardName, type: "main", index: 0 }]],
    };
  }
  connections[guardName] = {
    main: [[...downstreamByKey.values()].map(({ sourceOutput, ...link }) => link)],
  };
}

function workflowEnvelope(code, title, nodes, connections, triggerType, description, { incompleteGuard = true } = {}) {
  if (incompleteGuard) addIncompleteImplementationGuard(code, nodes, connections);
  return {
    name: names[code],
    nodes,
    connections,
    active: false,
    settings: { executionOrder: "v1" },
    versionId: `kkb-v2-${code.toLowerCase()}-20260929`,
    meta: { templateCredsSetupCompleted: false, package: "kiem-ke-bia-v2" },
    pinData: {},
    tags: [],
    _kkb_v2: {
      workflow_code: code,
      title,
      trigger_type: triggerType,
      description,
      implementation_status: incompleteGuard ? "INCOMPLETE" : "IMPLEMENTED_TEST_ONLY",
      activation_status: incompleteGuard ? "BLOCKED_INCOMPLETE_IMPLEMENTATION" : "BLOCKED_UNBOUND_TEST_ENVIRONMENT",
      active_on_import: false,
      credential_placeholders: ["GOOGLE_SHEETS_KKB_V2", "GOOGLE_DRIVE_KKB_V2", "TELEGRAM_KKB_V2", "GEMINI_KKB_V2"],
      sheet_id_placeholder: SHEETS_ID,
      workflow_id_placeholder: WORKFLOW_ID,
      config_binding: "Fill CONFIG_LENH.worker_workflow and CONFIG_LICH.worker_workflow after import.",
    },
  };
}

function makeGenericWorker({ code, title, triggerType, reads, writes, integrationNodes = [], specialBuildName }) {
  const nodes = [executeTrigger(0)];
  const triggerNames = ["Execute Workflow Trigger"];
  const steps = [];
  let index = 1;
  nodes.push(callGateway(index));
  steps.push("Call WF01 Config Gateway");
  index += 1;
  for (const sheetName of reads) {
    nodes.push(readSheetNode(sheetName, index));
    steps.push(`Read ${sheetName}`);
    index += 1;
  }
  for (const integration of integrationNodes) {
    const integrationNode = integration(index);
    nodes.push(integrationNode);
    steps.push(integrationNode.name);
    index += 1;
  }
  const buildName = specialBuildName ?? `Build ${code} Decision`;
  nodes.push(codeNode(`build-${code.toLowerCase()}`, buildName, index, buildDecisionCode(code, writes, "Execute Workflow Trigger")));
  steps.push(buildName);
  index += 1;
  for (const sheetName of writes) {
    const projectName = `Project ${sheetName} row`;
    nodes.push(codeNode(`project-${code.toLowerCase()}-${sheetName.toLowerCase()}`, projectName, index, projectCode(buildName, sheetName)));
    steps.push(projectName);
    index += 1;
    nodes.push(writeSheetNode(sheetName, index, sheetName === "ERROR_BIA" ? "append" : "appendOrUpdate"));
    steps.push(`${sheetName === "ERROR_BIA" ? "Append" : "Upsert"} ${sheetName}`);
    index += 1;
  }
  const finalizeName = `Finalize ${code} Commit`;
  nodes.push(codeNode(`finalize-${code.toLowerCase()}`, finalizeName, index, finalizeCode(buildName, code)));
  steps.push(finalizeName);
  index += 1;
  const returnName = `Return ${code} Result`;
  nodes.push(codeNode(`return-${code.toLowerCase()}`, returnName, index, returnCode(finalizeName)));
  steps.push(returnName);
  const connections = {};
  linearize(nodes, connections, triggerNames, steps);
  return workflowEnvelope(code, title, nodes, connections, triggerType, `Worker ${code} with config snapshot, staged writes and idempotent commit.`);
}

function embedWF01Logic() {
  const modulePath = path.join(repoRoot, "src", "kiem-ke-bia-v2", "logic", "wf01-config-gateway.mjs");
  const definitions = Object.fromEntries(schemaManifest.sheets.map((entry) => [entry.name, entry.headers]));
  const configSheets = schemaManifest.sheets.filter((entry) => entry.group === "config").map((entry) => entry.name);
  return readFileSync(modulePath, "utf8")
    .replace(/^import .*;\s*$/m, "")
    .replace(/^const ALL_SHEET_DEFINITIONS = .*;$/m, `const ALL_SHEET_DEFINITIONS = Object.freeze(${JSON.stringify(definitions)});`)
    .replace(/^const CONFIG_SHEET_NAMES = .*;$/m, `const CONFIG_SHEET_NAMES = Object.freeze(${JSON.stringify(configSheets)});`)
    .replace(/^export \{[^}]+\};?\s*$/m, "");
}

function wf01RuntimeCode(reads) {
  return `const input = $input.first()?.json ?? {};
const trigger = $('Execute Workflow Trigger').first()?.json ?? input;
const requested = trigger.envelope ?? trigger;
const headers = {};
const rawValues = {};
const readRows = (name) => {
  try {
    const extracted = extractSheetValueRange($items('Read ' + name)[0]?.json, name);
    headers[name] = extracted.headers;
    rawValues[name] = extracted.values;
    return [];
  } catch {
    headers[name] = null;
    rawValues[name] = null;
    return [];
  }
};
const tables = Object.fromEntries(${JSON.stringify(reads)}.map((name) => [name, readRows(name)]));
tables.__headers = headers;
tables.__raw_values = rawValues;
const envelope = requested.request_id && requested.operation_id ? normalizeEnvelope(requested) : requested;
return [{ json: evaluateConfigGateway({ envelope, tables, now: new Date().toISOString() }) }];`;
}

function wf01ProjectCode(sheetName, action) {
  return `const decision = $('Evaluate WF01 Configuration').first()?.json ?? {};
const step = (decision.write_plan ?? []).find((item) => item.sheet === '${sheetName}' && item.action === '${action}');
if (!step) return [{ json: { __wf01_skip_write: true } }];
return [{ json: { __wf01_skip_write: false, row: step.row ?? { ...step.match, ...step.patch } } }];`;
}

function wf01WriteGuard(name, index) {
  return nodeBase(`guard-${name.toLowerCase().replaceAll(" ", "-")}`, `WF01 Has ${name}`, "n8n-nodes-base.if", 2.2, index, {
    parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ id: "wf01-write-present", leftValue: "={{$json.__wf01_skip_write}}", rightValue: false, operator: { type: "boolean", operation: "equals" } }], combinator: "and" }, options: {} },
  });
}

function wf01ReturnCode() {
  return `const decision = $('Evaluate WF01 Configuration').first()?.json ?? {};
const response = decision.response ?? {};
const trigger = $('Execute Workflow Trigger').first()?.json ?? {};
const envelope = trigger.envelope ?? trigger;
const payload = envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
const caller = payload.caller_context && typeof payload.caller_context === 'object' ? payload.caller_context : {};
const safeId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : null;
const safeWorkflow = (value) => typeof value === 'string' && /^WF\\d{2}$/.test(value) ? value : null;
const safeNode = (value) => typeof value === 'string' && /^[A-Za-z0-9 _-]{1,80}$/.test(value) ? value : null;
const callerContext = {
  execution_id: safeId(caller.execution_id ?? envelope.execution_id),
  request_id: safeId(caller.request_id ?? envelope.request_id ?? response.request_id),
  operation_id: safeId(caller.operation_id ?? envelope.operation_id ?? response.operation_id),
  workflow_code: safeWorkflow(caller.workflow_code ?? payload.caller_workflow_code ?? envelope.workflow_code),
  node_name: safeNode(caller.node_name ?? envelope.node_name),
  branch_id: safeId(caller.branch_id ?? envelope.branch_id),
  config_snapshot_id: safeId(caller.config_snapshot_id ?? envelope.config_snapshot_id ?? response.config_snapshot_id),
  actor_user_id: safeId(caller.actor_user_id ?? envelope.actor_user_id),
  business_date: typeof (caller.business_date ?? envelope.business_date) === 'string' && /^\\d{4}-\\d{2}-\\d{2}$/.test(caller.business_date ?? envelope.business_date) ? caller.business_date ?? envelope.business_date : null,
};
const reply = payload.caller_reply_target ?? envelope.reply_target ?? trigger.reply_target ?? {};
const callerReplyTarget = typeof reply.chat_id === 'string' && /^-?\\d{1,20}$/.test(reply.chat_id)
  ? { chat_id: reply.chat_id, message_thread_id: typeof reply.message_thread_id === 'string' && /^\\d{1,20}$/.test(reply.message_thread_id) ? reply.message_thread_id : null }
  : null;
return [{ json: { ok: Boolean(decision.ok), status: decision.ok ? response.status : 'ERROR', error_code: response.error_code ?? null, error_class: response.error_class ?? null, message_safe: response.message_safe ?? response.message ?? null, request_id: response.request_id ?? null, operation_id: response.operation_id ?? null, config_version: response.config_version ?? null, config_snapshot_id: response.config_snapshot_id ?? null, config_fingerprint: response.config_fingerprint ?? null, branch_scope: response.branch_scope ?? null, data: response.data ?? {}, warnings: response.warnings ?? [], diagnostics: decision.diagnostics ?? {}, caller_context: callerContext, caller_reply_target: callerReplyTarget } }];`;
}

export function buildWF01Workflow() {
  const code = "WF01";
  const reads = [...new Set([...schemaManifest.sheets.filter((entry) => entry.group === "config").map((entry) => entry.name), "CONFIG_SNAPSHOT", "OPERATION", "ERROR_BIA", "EVENT_LOG"])];
  const alwaysReadSheets = new Set(["CONFIG_SCHEMA", "CONFIG_VERSION", "CONFIG_GLOBAL", "CONFIG_BRANCH", "CONFIG_USER", "CONFIG_THONG_BAO", "CONFIG_CUTOVER", "CONFIG_SNAPSHOT", "OPERATION", "ERROR_BIA"]);
  const nodes = [executeTrigger(0)];
  const readPlan = [];
  let index = 1;
  for (const sheetName of reads) {
    if (alwaysReadSheets.has(sheetName)) {
      nodes.push(readSheetValuesNode(sheetName, index));
      readPlan.push({ readName: `Read ${sheetName}`, gateName: null });
      index += 1;
      continue;
    }
    const gateName = `WF01 Read ${sheetName} Requested`;
    nodes.push(wf01RequestedReadGate(sheetName, index));
    index += 1;
    nodes.push(readSheetValuesNode(sheetName, index));
    readPlan.push({ readName: `Read ${sheetName}`, gateName });
    index += 1;
  }
  const evaluateName = "Evaluate WF01 Configuration";
  nodes.push(codeNode("evaluate-wf01", evaluateName, index, `${embedWF01Logic()}\n${wf01RuntimeCode(reads)}`));
  index += 1;
  const persistenceGate = "WF01 Write Required";
  nodes.push(nodeBase("wf01-write-gate", persistenceGate, "n8n-nodes-base.if", 2.2, index, {
    parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ id: "wf01-write-required", leftValue: "={{$json.ok && ($json.write_plan?.length ?? 0) > 0}}", rightValue: true, operator: { type: "boolean", operation: "equals" } }], combinator: "and" }, options: {} },
  }));
  index += 1;
  const persistSteps = [];
  const writePlan = [
    ["OPERATION", "APPEND", "Prepare OPERATION", "appendOrUpdate"],
    ["CONFIG_VERSION", "APPEND", "Append CONFIG_VERSION", "append"],
    ["CONFIG_SNAPSHOT", "APPEND", "Append CONFIG_SNAPSHOT", "append"],
    ["OPERATION", "UPDATE", "Commit OPERATION", "appendOrUpdate"],
  ];
  for (const [sheetName, action, label, writeOperation] of writePlan) {
    nodes.push(codeNode(`project-wf01-${label.toLowerCase().replaceAll(" ", "-")}`, label, index, wf01ProjectCode(sheetName, action)));
    const projectName = label;
    index += 1;
    const guardName = `WF01 Has ${label}`;
    nodes.push(wf01WriteGuard(label, index));
    index += 1;
    const mapName = `WF01 Map ${label}`;
    nodes.push(codeNode(`map-wf01-${label.toLowerCase().replaceAll(" ", "-")}`, mapName, index, "return [{ json: $json.row }];"));
    index += 1;
    const writeName = `WF01 ${label}`;
    nodes.push(writeSheetNode(sheetName, index, writeOperation));
    nodes.at(-1).name = writeName;
    index += 1;
    persistSteps.push({ projectName, guardName, mapName, writeName });
  }
  const returnName = "Return WF01 Result";
  nodes.push(codeNode("return-wf01", returnName, index, wf01ReturnCode()));
  const connections = {};
  const firstReadStep = readPlan[0];
  connect(connections, "Execute Workflow Trigger", firstReadStep.gateName ?? firstReadStep.readName);
  for (const [stepIndex, step] of readPlan.entries()) {
    const nextStep = readPlan[stepIndex + 1];
    const nextName = nextStep ? (nextStep.gateName ?? nextStep.readName) : evaluateName;
    if (step.gateName) {
      connect(connections, step.gateName, step.readName, 0);
      connect(connections, step.gateName, nextName, 1);
      connect(connections, step.readName, nextName);
    } else {
      connect(connections, step.readName, nextName);
    }
  }
  connect(connections, evaluateName, persistenceGate);
  connect(connections, persistenceGate, persistSteps[0].projectName, 0);
  connect(connections, persistenceGate, returnName, 1);
  for (let step = 0; step < persistSteps.length; step += 1) {
    const current = persistSteps[step];
    const nextProject = persistSteps[step + 1]?.projectName ?? returnName;
    connect(connections, current.projectName, current.guardName);
    connect(connections, current.guardName, current.mapName, 0);
    connect(connections, current.guardName, nextProject, 1);
    connect(connections, current.mapName, current.writeName);
    connect(connections, current.writeName, nextProject);
  }
  const errorGateName = "WF01 Route Error";
  nodes.push(nodeBase("wf01-error-gate", errorGateName, "n8n-nodes-base.if", 2.2, index + 1, {
    parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ id: "wf01-route-error", leftValue: "={{$json.ok === false && ($('Execute Workflow Trigger').first()?.json?.payload?.caller_workflow_code !== 'WF02')}}", rightValue: true, operator: { type: "boolean", operation: "equals" } }], combinator: "and" }, options: {} },
  }));
  const errorCall = executeWorkflowNode("wf01-call-error-handler", "Call Error Handler", index + 2);
  errorCall.onError = "continueRegularOutput";
  errorCall.parameters.workflowInputs = {
    mappingMode: "defineBelow",
    schema: [{ id: "error", type: "object" }, { id: "context", type: "object" }, { id: "reply_target", type: "object" }],
    value: {
      error: "={{ { error_code: $json.error_code ?? 'UNEXPECTED_ERROR', error_class: $json.error_class ?? 'CONFIGURATION' } }}",
      context: "={{ { ...($json.caller_context ?? {}), request_id: $json.caller_context?.request_id ?? $json.request_id ?? null, operation_id: $json.caller_context?.operation_id ?? $json.operation_id ?? null } }}",
      reply_target: "={{ $json.caller_reply_target ?? {} }}",
    },
  };
  nodes.push(errorCall);
  nodes.push(codeNode("wf01-return-error", "Return WF01 Error", index + 3, `const result = $('Return WF01 Result').first()?.json ?? {};
return [{ json: result }];`));
  connect(connections, returnName, errorGateName);
  connect(connections, errorGateName, "Call Error Handler", 0);
  connect(connections, "Call Error Handler", "Return WF01 Error");
  return workflowEnvelope(code, "Configuration gateway", nodes, connections, "executeWorkflow", "Validates scoped live configuration, reuses or persists immutable snapshots with staged writes.", { incompleteGuard: false });
}

function makeWF02() {
  const code = "WF02";
  const trigger = executeTrigger(0);
  trigger.parameters.workflowInputs = { values: [
    { name: "error", type: "object" },
    { name: "context", type: "object" },
    { name: "reply_target", type: "object" },
  ] };
  const nodes = [trigger, errorTrigger(1)];
  const buildName = "Normalize Workflow Error";
  const wf02Logic = `${sha256Hex.toString()}\n${readFileSync(path.join(repoRoot, "src", "kiem-ke-bia-v2", "logic", "wf02-error-handler.mjs"), "utf8").replace(/^import \{ sha256Hex \} from ['"]\.\.\/contracts\.mjs['"];\r?\n/m, "").replace(/^export /gm, "")}`;
  nodes.push(codeNode("normalize-wf02", buildName, 2, `${wf02Logic}
const input = $input.first()?.json ?? {};
const source = input.execution ?? {};
const context = input.context ?? { execution_id: source.id, workflow_code: input.workflow?.name, node_name: source.lastNodeExecuted };
return [{ json: handleWorkflowError({ error: input.error ?? source.error ?? {}, context, replyTarget: input.reply_target ?? input.envelope?.reply_target ?? null, policy: {}, now: new Date().toISOString() }) }];`));
  nodes.push(codeNode("wf02-policy-request", "Request WF02 Policy", 3, `const result = $('${buildName}').first()?.json ?? $json;
const context = JSON.parse(result.error_row.sanitized_context_json);
return [{ json: { envelope_version: 'v2', request_id: context.request_id ?? result.error_id, operation_id: context.operation_id ?? result.error_id, event_type: 'WF02_ERROR', branch_id: context.branch_id ?? '*', config_snapshot_id: context.config_snapshot_id ?? null, reply_target: result.reply_target, payload: { required_sheet_names: ['CONFIG_THONG_BAO', 'CONFIG_TOPIC'], caller_workflow_code: 'WF02', caller_context: context } } }];`));
  const gateway = callGateway(4);
  gateway.onError = "continueRegularOutput";
  nodes.push(gateway);
  const existingErrors = readSheetNode("ERROR_BIA", 5);
  existingErrors.onError = "continueErrorOutput";
  nodes.push(existingErrors);
  const existingEvents = readSheetNode("EVENT_LOG", 6);
  existingEvents.onError = "continueErrorOutput";
  nodes.push(existingEvents);
  const existingOperations = readSheetNode("OPERATION", 7);
  existingOperations.onError = "continueErrorOutput";
  nodes.push(existingOperations);
  nodes.push(codeNode("wf02-apply-policy", "Apply WF02 Policy", 8, `${wf02Logic}
const original = $('${buildName}').first()?.json ?? {};
const gateway = $('Call WF01 Config Gateway').first()?.json ?? {};
const tables = gateway.ok === true ? gateway.data?.config_tables ?? {} : {};
const context = JSON.parse(original.error_row.sanitized_context_json);
const priorEvents = $items('Read EVENT_LOG').map((item) => item.json ?? {});
const priorOperations = $items('Read OPERATION').map((item) => item.json ?? {});
const result = handleWorkflowError({ error: { error_code: original.error_code, error_class: original.error_class }, context, replyTarget: original.reply_target, policy: { notifications: tables.CONFIG_THONG_BAO ?? [], topics: tables.CONFIG_TOPIC ?? [], delivered_events: visibleCommittedRows(priorEvents, priorOperations) }, now: original.error_row.created_at });
return [{ json: result }];`));
  nodes.push(codeNode("wf02-prepare-transaction", "Prepare WF02 Error Transaction", 9, `${wf02Logic}
const result = $('Apply WF02 Policy').first()?.json ?? {};
const plan = planErrorTransaction({ errorRecord: result, operationalState: {
  operations: $items('Read OPERATION').map((item) => item.json ?? {}),
  errorRows: $items('Read ERROR_BIA').map((item) => item.json ?? {}),
  eventRows: $items('Read EVENT_LOG').map((item) => item.json ?? {}),
}, now: new Date().toISOString() });
return [{ json: { ...result, transaction: plan } }];`));
  const txGate = (id, name, index, field) => nodeBase(id, name, "n8n-nodes-base.if", 2.2, index, {
    parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ id, leftValue: `={{$('Prepare WF02 Error Transaction').first()?.json?.transaction?.${field} === true}}`, rightValue: true, operator: { type: "boolean", operation: "equals" } }], combinator: "and" }, options: {} },
  });
  nodes.push(txGate("wf02-append-prepared-gate", "WF02 Has Prepared Operation", 10, "append_prepared_operation"));
  nodes.push(codeNode("wf02-project-prepared", "Project WF02 Prepared Operation", 11, `const plan = $('Prepare WF02 Error Transaction').first()?.json?.transaction ?? {};
return [{ json: plan.prepared_operation ?? {} }];`));
  const preparedWrite = writeSheetNode("OPERATION", 12, "append");
  preparedWrite.name = "Append WF02 Prepared Operation";
  preparedWrite.onError = "continueErrorOutput";
  nodes.push(preparedWrite);
  nodes.push(txGate("wf02-append-error-gate", "WF02 Has ERROR_BIA Row", 13, "append_error_record"));
  nodes.push(codeNode("project-wf02-error", "Project ERROR_BIA row", 14, `const plan = $('Prepare WF02 Error Transaction').first()?.json?.transaction ?? {};
return [{ json: plan.error_row ?? {} }];`));
  const errorWrite = writeSheetNode("ERROR_BIA", 15, "append");
  errorWrite.onError = "continueErrorOutput";
  nodes.push(errorWrite);
  nodes.push(txGate("wf02-append-event-gate", "WF02 Has EVENT_LOG Row", 16, "append_event_record"));
  nodes.push(codeNode("project-wf02-event", "Project EVENT_LOG row", 17, `const plan = $('Prepare WF02 Error Transaction').first()?.json?.transaction ?? {};
return [{ json: plan.event_row ?? {} }];`));
  const eventWrite = writeSheetNode("EVENT_LOG", 18, "append");
  eventWrite.onError = "continueErrorOutput";
  nodes.push(eventWrite);
  nodes.push(txGate("wf02-append-commit-gate", "WF02 Has Committed Operation", 19, "append_commit_operation"));
  nodes.push(codeNode("wf02-project-committed", "Project WF02 Committed Operation", 20, `const plan = $('Prepare WF02 Error Transaction').first()?.json?.transaction ?? {};
return [{ json: plan.commit_operation ?? {} }];`));
  const committedWrite = writeSheetNode("OPERATION", 21, "append");
  committedWrite.name = "Append WF02 Committed Operation";
  committedWrite.onError = "continueErrorOutput";
  nodes.push(committedWrite);
  nodes.push(codeNode("wf02-notification", "Prepare Error Notification", 22, `const result = $('Apply WF02 Policy').first()?.json ?? {};
return [{ json: result.notification ?? { send: false } }];`));
  nodes.push(nodeBase("wf02-notify-gate", "WF02 Notify Allowed", "n8n-nodes-base.if", 2.2, 23, {
    parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ id: "wf02-notify", leftValue: "={{$json.send === true}}", rightValue: true, operator: { type: "boolean", operation: "equals" } }], combinator: "and" }, options: {} },
  }));
  const notify = nodeBase("wf02-send-notification", "Send Error Notification", "n8n-nodes-base.telegram", 1.2, 24, {
    parameters: { resource: "message", operation: "sendMessage", chatId: "={{$json.chat_id}}", text: "={{$json.text}}", additionalFields: { message_thread_id: "={{$json.message_thread_id}}" } },
    credentials: { telegramApi: { name: "TELEGRAM_KKB_V2" } },
    onError: "continueErrorOutput",
  });
  nodes.push(notify);
  nodes.push(codeNode("wf02-project-notification-delivered", "Project WF02 Notification Delivered", 25, `${wf02Logic}
const result = $('Apply WF02 Policy').first()?.json ?? {};
const notification = $('Prepare Error Notification').first()?.json ?? {};
const event = makeNotificationDeliveredEvent({ errorRecord: { ...result, notification }, deliveredAt: new Date().toISOString() });
return event ? [{ json: event }] : [];`));
  const deliveredEventWrite = writeSheetNode("EVENT_LOG", 26, "append");
  deliveredEventWrite.name = "Append WF02 Notification Delivered";
  deliveredEventWrite.onError = "continueErrorOutput";
  nodes.push(deliveredEventWrite);
  nodes.push(codeNode("return-wf02", "Return WF02 Result", 27, `const result = $('Apply WF02 Policy').first()?.json ?? {};
return [{ json: { ok: false, status: result.status, error_id: result.error_id, error_code: result.error_code, error_class: result.error_class, retryable: result.retryable, message_safe: result.message_safe } }];`));
  nodes.push(codeNode("wf02-system-fallback", "WF02 Safe SYSTEM Fallback", 28, `${wf02Logic}
const original = $('Apply WF02 Policy').first()?.json ?? $('${buildName}').first()?.json ?? {};
return [{ json: safeSystemFallback(original) }];`));
  const connections = {};
  for (const start of ["Execute Workflow Trigger", "Error Trigger"]) connect(connections, start, buildName);
  for (const [from, to] of [[buildName, "Request WF02 Policy"], ["Request WF02 Policy", "Call WF01 Config Gateway"], ["Call WF01 Config Gateway", "Read ERROR_BIA"], ["Read ERROR_BIA", "Read EVENT_LOG"], ["Read EVENT_LOG", "Read OPERATION"], ["Read OPERATION", "Apply WF02 Policy"], ["Apply WF02 Policy", "Prepare WF02 Error Transaction"], ["Project WF02 Prepared Operation", "Append WF02 Prepared Operation"], ["Append WF02 Prepared Operation", "WF02 Has ERROR_BIA Row"], ["Project ERROR_BIA row", "Append ERROR_BIA"], ["Append ERROR_BIA", "WF02 Has EVENT_LOG Row"], ["Project EVENT_LOG row", "Append EVENT_LOG"], ["Append EVENT_LOG", "WF02 Has Committed Operation"], ["Project WF02 Committed Operation", "Append WF02 Committed Operation"], ["Append WF02 Committed Operation", "Prepare Error Notification"], ["Prepare Error Notification", "WF02 Notify Allowed"], ["Send Error Notification", "Project WF02 Notification Delivered"], ["Project WF02 Notification Delivered", "Append WF02 Notification Delivered"], ["Append WF02 Notification Delivered", "Return WF02 Result"]]) connect(connections, from, to);
  connect(connections, "Prepare WF02 Error Transaction", "WF02 Has Prepared Operation");
  connect(connections, "WF02 Has Prepared Operation", "Project WF02 Prepared Operation", 0);
  connect(connections, "WF02 Has Prepared Operation", "WF02 Has ERROR_BIA Row", 1);
  connect(connections, "WF02 Has ERROR_BIA Row", "Project ERROR_BIA row", 0);
  connect(connections, "WF02 Has ERROR_BIA Row", "WF02 Has EVENT_LOG Row", 1);
  connect(connections, "WF02 Has EVENT_LOG Row", "Project EVENT_LOG row", 0);
  connect(connections, "WF02 Has EVENT_LOG Row", "WF02 Has Committed Operation", 1);
  connect(connections, "WF02 Has Committed Operation", "Project WF02 Committed Operation", 0);
  connect(connections, "WF02 Has Committed Operation", "Prepare Error Notification", 1);
  for (const source of ["Read ERROR_BIA", "Read EVENT_LOG", "Read OPERATION", "Append WF02 Prepared Operation", "Append ERROR_BIA", "Append EVENT_LOG", "Append WF02 Committed Operation", "Send Error Notification", "Append WF02 Notification Delivered"]) connect(connections, source, "WF02 Safe SYSTEM Fallback", 1);
  connect(connections, "WF02 Notify Allowed", "Send Error Notification", 0);
  connect(connections, "WF02 Notify Allowed", "Return WF02 Result", 1);
  return workflowEnvelope(code, "Error handler", nodes, connections, "executeWorkflow+errorTrigger", "Sanitizes and audits errors; notification policy comes from WF01.", { incompleteGuard: false });
}

function makeWF03() {
  const code = "WF03";
  const nodes = [telegramTrigger(0), codeNode("normalize-telegram", "Normalize Telegram Update", 1, `const update = $input.first()?.json ?? {};
const message = update.message ?? update.edited_message ?? update.callback_query?.message ?? {};
const actor = update.callback_query?.from ?? message.from ?? {};
const text = String(update.callback_query?.data ?? message.text ?? '').trim();
const command = (text.match(/^\\/([A-Za-z0-9_]+)/)?.[1] ?? '').toLowerCase();
const args = text.split(/\\s+/).slice(1, 21);
const updateId = String(update.update_id ?? 'UPDATE_ID_CONFIGURE');
const replyTarget = { chat_id: String(message.chat?.id ?? 'CHAT_ID_CONFIGURE'), message_thread_id: message.message_thread_id == null ? null : String(message.message_thread_id) };
const envelope = { envelope_version: 'v2', request_id: \`tg-\${updateId}\`, operation_id: \`tg-\${updateId}\`, event_type: 'TELEGRAM_UPDATE', branch_id: null, actor_user_id: String(actor.id ?? 'USER_ID_CONFIGURE'), business_date: null, config_version: null, config_snapshot_id: null, payload: { command: command ? \`/\${command}\` : '', args, raw_text: text, idempotency_key: \`tg-\${updateId}\` }, reply_target: replyTarget };
return [{ json: { envelope, reply_target: replyTarget, command: envelope.payload.command, args } }];`), callGateway(2)];
const steps = ["Normalize Telegram Update", "Call WF01 Config Gateway"];
const routerName = "Router Decision";
nodes.push(codeNode("router-decision", routerName, 3, `const input = $input.first()?.json ?? {};
const normalized = $('Normalize Telegram Update').first()?.json ?? {};
const command = String(normalized.command ?? '').toLowerCase();
const operationId = String(normalized.envelope?.operation_id ?? 'WF03-OPERATION_CONFIGURE');
const isReadOnly = command === '/help' || command === '/trangthai';
const workerWorkflowId = String(input.worker_workflow_id ?? 'WORKFLOW_ID_CONFIGURE');
const route = { command, worker_workflow_id: workerWorkflowId, worker_workflow_code: String(input.worker_workflow_code ?? 'WORKER_CONFIGURE'), branch_id: input.branch_id ?? null, operation_id: operationId, idempotency_key: normalized.envelope?.payload?.idempotency_key ?? operationId };
return [{ json: { ...normalized, route, decision: isReadOnly ? 'READ_ONLY' : 'ROUTE', status: 'PREPARED', operation_id: operationId } }];`));
steps.push(routerName);
nodes.push(codeNode("reserve-operation", "Project OPERATION reservation", 4, `const source = $('Router Decision').first()?.json ?? $json;
return [{ json: { operation_id: source.operation_id, request_id: source.envelope?.request_id, event_type: source.envelope?.event_type, idempotency_key: source.route?.idempotency_key, branch_id: source.route?.branch_id, status: 'PREPARED', commit_state: 'PREPARED', workflow_code: 'WF03', created_at: new Date().toISOString(), updated_at: new Date().toISOString() } }];`));
steps.push("Project OPERATION reservation");
nodes.push(writeSheetNode("OPERATION", 5, "appendOrUpdate"));
steps.push("Upsert OPERATION");
nodes.push(executeWorkflowNode("call-worker", "Call Configured Worker", 6, "={{$json.route?.worker_workflow_id || 'WORKFLOW_ID_CONFIGURE'}}"));
steps.push("Call Configured Worker");
nodes.push(codeNode("build-reply", "Build Telegram Reply", 7, `const worker = $input.first()?.json ?? {};
const source = $('Router Decision').first()?.json ?? {};
return [{ json: { ...source, worker_result: worker, text: worker.message_safe ?? worker.text ?? (source.decision === 'READ_ONLY' ? 'Kiểm kê bia V2 đang ở chế độ read-only.' : 'Đã tiếp nhận thao tác.'), reply_target: source.reply_target } }];`));
steps.push("Build Telegram Reply");
nodes.push(nodeBase("send-telegram", "Send Telegram Reply", "n8n-nodes-base.telegram", 1.2, 8, {
    parameters: { resource: "message", operation: "sendMessage", chatId: "={{$json.reply_target.chat_id}}", text: "={{$json.text}}", additionalFields: { message_thread_id: "={{$json.reply_target.message_thread_id}}" } },
    credentials: { telegramApi: { name: "TELEGRAM_KKB_V2" } },
  }));
steps.push("Send Telegram Reply");
nodes.push(codeNode("return-wf03", "Return WF03 Result", 9, `const result = $('Build Telegram Reply').first()?.json ?? $json;
return [{ json: { ok: true, status: 'COMMITTED', operation_id: result.operation_id, request_id: result.envelope?.request_id, text: result.text, warnings: result.worker_result?.warnings ?? [] } }];`));
steps.push("Return WF03 Result");
const connections = {};
linearize(nodes, connections, ["Telegram Trigger"], steps);
return workflowEnvelope(code, "Telegram router", nodes, connections, "telegramTrigger", "Sole Telegram ingress; normalizes, reserves operation, routes to configured worker and replies safely.");
}

function makeWF04() {
  const code = "WF04";
  const nodes = [scheduleTrigger(0), executeTrigger(1), callGateway(2), readSheetNode("CONFIG_LICH", 3), readSheetNode("DISPATCH_HISTORY", 4), readSheetNode("HEARTBEAT", 5)];
  const steps = ["Call WF01 Config Gateway", "Read CONFIG_LICH", "Read DISPATCH_HISTORY", "Read HEARTBEAT"];
  const buildName = "Build Dispatcher Due Jobs";
  nodes.push(codeNode("build-wf04", buildName, 6, `const input = $input.first()?.json ?? {};
const now = new Date().toISOString();
const operationId = String(input.operation_id ?? \`WF04-\${now}\`);
return [{ json: { ok: true, status: 'PREPARED', workflow_code: 'WF04', operation_id: operationId, dispatch_key: \`tick-\${now.slice(0, 16)}\`, scheduled_at_local: now, worker_workflow_id: String(input.worker_workflow_id ?? 'WORKFLOW_ID_CONFIGURE'), job_code: String(input.job_code ?? 'JOB_CODE_CONFIGURE'), branch_id: input.branch_id ?? 'BRANCH_ID_CONFIGURE', attempt_number: 1, claim_token: \`claim-\${operationId}\`, heartbeat_id: \`heartbeat-\${operationId}\` } }];`));
steps.push(buildName);
nodes.push(writeSheetNode("DISPATCH_HISTORY", 7, "appendOrUpdate"));
steps.push("Upsert DISPATCH_HISTORY");
nodes.push(executeWorkflowNode("dispatch-worker", "Call Scheduled Worker", 8, "={{$json.worker_workflow_id || 'WORKFLOW_ID_CONFIGURE'}}"));
steps.push("Call Scheduled Worker");
nodes.push(codeNode("heartbeat-row", "Project HEARTBEAT row", 9, `const source = $('${buildName}').first()?.json ?? $json;
return [{ json: { heartbeat_id: source.heartbeat_id, workflow_code: source.job_code, worker_workflow_id: source.worker_workflow_id, branch_id: source.branch_id, dispatch_key: source.dispatch_key, operation_id: source.operation_id, status: 'COMMITTED', last_started_at: source.scheduled_at_local, last_seen_at: new Date().toISOString(), last_completed_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() } }];`));
steps.push("Project HEARTBEAT row");
nodes.push(writeSheetNode("HEARTBEAT", 10, "appendOrUpdate"));
steps.push("Upsert HEARTBEAT");
nodes.push(codeNode("return-wf04", "Return WF04 Result", 11, `const result = $('${buildName}').first()?.json ?? $json;
return [{ json: { ok: true, status: 'COMMITTED', workflow_code: 'WF04', operation_id: result.operation_id, dispatch_key: result.dispatch_key, warnings: [] } }];`));
steps.push("Return WF04 Result");
const connections = {};
connect(connections, "Technical Tick 10 Minutes", steps[0]);
connect(connections, "Execute Workflow Trigger", steps[0]);
for (let index = 0; index < steps.length - 1; index += 1) connect(connections, steps[index], steps[index + 1]);
return workflowEnvelope(code, "Dispatcher", nodes, connections, "scheduleTrigger+executeWorkflow", "Fixed ten-minute technical tick; business schedule is read from CONFIG_LICH.");
}

function makeWF08() {
  return makeGenericWorker({
    code: "WF08",
    title: "Invoice ingestion",
    triggerType: "executeWorkflow",
    reads: ["CONFIG_BIA", "CONFIG_QUY_DOI", "CONFIG_MAPPING_NHAP"],
    writes: ["HOA_DON_NHAP", "ANH_HOA_DON", "OCR_RAW", "DONG_NHAP", "LOG_NHAP"],
    integrationNodes: [(index) => googleDriveBoundary(index, "Drive Evidence Upload (bind before activation)"), geminiBoundary],
  });
}

function makeWF09() {
  return makeGenericWorker({
    code: "WF09",
    title: "Sales ingestion",
    triggerType: "executeWorkflow",
    reads: ["CONFIG_NGUON_BAN", "CONFIG_NGUON_BAN_COT", "CONFIG_MAPPING_BAN", "CONFIG_QUY_DOI"],
    writes: ["DOT_NHAP_BAN", "DONG_BAN_NGUON", "LOG_BAN"],
    integrationNodes: [(index) => googleDriveBoundary(index, "Drive Sales File Read (bind before activation)")],
  });
}

function makeWF05() {
  const code = "WF05";
  const trigger = executeTrigger(0);
  trigger.parameters.workflowInputs = { values: [{ name: "envelope", type: "object" }] };

  const normalizeName = "Normalize WF05 Input";
  const gatewayName = "Call WF01 Config Gateway";
  const gatewayGateName = "WF01 Config Ready";
  const buildName = "Build WF05 Open Session Transaction";
  const commitGateName = "WF05 Has Session Plan";
  const appendGateName = "WF05 Append Prepared Operation";
  const nodes = [trigger];
  const connections = {};
  let index = 1;

  nodes.push(codeNode("normalize-wf05", normalizeName, index++, `${normalizeEnvelope.toString()}
const input = $input.first()?.json ?? {};
const supplied = input.envelope ?? input;
const normalized = normalizeEnvelope(supplied, 'WF05');
if (!normalized.ok) return [{ json: { ok: false, status: 'ERROR', ...normalized.error, request_id: supplied?.request_id ?? null, operation_id: supplied?.operation_id ?? null } }];
const envelope = { ...normalized.envelope, payload: { ...(normalized.envelope.payload ?? {}), required_sheet_names: ['CONFIG_BIA', 'CONFIG_TOPIC', 'CONFIG_LICH', 'CONFIG_GLOBAL'] } };
return [{ json: { envelope } }];`));
  nodes.push(callGateway(index++));
  const gatewayGate = nodeBase("wf05-gateway-ready", gatewayGateName, "n8n-nodes-base.if", 2.2, index++, {
    parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ id: "wf05-gateway-ready", leftValue: `={{$('${gatewayName}').first()?.json?.ok === true}}`, rightValue: true, operator: { type: "boolean", operation: "equals" } }], combinator: "and" }, options: {} },
  });
  nodes.push(gatewayGate);

  const operationRead = readSheetNode("OPERATION", index++);
  const sessionRead = readSheetNode("PHIEN_KIEM_KE", index++);
  const stateRead = readSheetNode("STATE_CHO", index++);
  nodes.push(operationRead, sessionRead, stateRead);

  const journalSource = readFileSync(path.join(repoRoot, "src", "kiem-ke-bia-v2", "operation-journal.mjs"), "utf8").replace(/^export /gm, "");
  const sessionSource = readFileSync(path.join(repoRoot, "src", "kiem-ke-bia-v2", "logic", "wf05-open-session.mjs"), "utf8")
    .replace(/^import \{ stableKey \} from ['"]\.\.\/contracts\.mjs['"];?\r?\n/m, "")
    .replace(/^export /gm, "");
  const transactionCode = `${sha256Hex.toString()}\n${stableKey.toString()}\n${journalSource}\n${sessionSource}
const gateway = $('${gatewayName}').first()?.json ?? {};
const normalized = $('${normalizeName}').first()?.json ?? {};
const sourceEnvelope = normalized.envelope ?? {};
const now = new Date().toISOString();
const rows = (name) => $items(name).map((item) => item.json ?? {});
const operations = rows('Read OPERATION');
const allSessions = visibleCommittedRows(rows('Read PHIEN_KIEM_KE'), operations);
const states = visibleCommittedRows(rows('Read STATE_CHO'), operations);
const activeSessions = allSessions.filter((row) => String(row.status ?? '').toUpperCase() === 'ACTIVE_SESSION');
const activeSessionIds = new Set(activeSessions.map((row) => String(row.session_id ?? '')));
const orphanState = states.find((row) => row.branch_id === sourceEnvelope.branch_id
  && row.topic_type === 'INVENTORY_SESSION'
  && String(row.status ?? '').toUpperCase() === 'ACTIVE_SESSION'
  && !activeSessionIds.has(String(row.state_id ?? '')));
if (orphanState) return [{ json: { ok: false, status: 'ERROR', error_code: 'SESSION_STATE_INCONSISTENT', error_class: 'MANUAL_REVIEW', retryable: false, message_safe: 'Session state requires operator review before opening another session.' } }];

const rootKey = [sourceEnvelope.idempotency_key, sourceEnvelope.payload?.idempotency_key, sourceEnvelope.request_id, sourceEnvelope.operation_id]
  .map((value) => value == null ? '' : String(value).trim()).find(Boolean);
const workerEnvelope = {
  ...sourceEnvelope,
  operation_id: stableKey(['WF05_OPERATION', sourceEnvelope.operation_id, rootKey]),
  idempotency_key: stableKey(['WF05_IDEMPOTENCY', sourceEnvelope.operation_id, rootKey]),
  parent_operation_id: sourceEnvelope.operation_id,
  config_version: gateway.config_version,
  config_snapshot_id: gateway.config_snapshot_id,
};
const prior = prepareOperation(workerEnvelope, 'WF05', now, operations);
if (!prior.ok) return [{ json: { ok: false, status: 'ERROR', error_code: prior.error_code, error_class: 'CONFLICT', retryable: false, message_safe: 'The session request conflicts with an existing operation.' } }];
if (prior.replay && isOperationCommitted(prior.operation)) {
  const session = allSessions.find((row) => String(row.operation_id ?? '') === String(prior.operation.operation_id));
  if (!session) return [{ json: { ok: false, status: 'ERROR', error_code: 'OPERATION_RESULT_MISSING', error_class: 'MANUAL_REVIEW', retryable: false, message_safe: 'The committed session result is unavailable and needs review.' } }];
  let catalog = [];
  try { catalog = JSON.parse(session.snapshot_json ?? '{}').catalog ?? []; } catch {}
  return [{ json: { ok: true, status: 'COMMITTED', replay: true, operation: prior.operation, session, data: { session_id: session.session_id, initial_revision: Number(session.session_revision ?? 0), catalog }, append_prepared_operation: false, required_writes: [], rows: {} } }];
}

const gatewayData = gateway.data?.config_tables ?? {};
const decision = openInventorySession({
  envelope: workerEnvelope,
  activeSessions,
  catalog: gatewayData.CONFIG_BIA ?? [],
  snapshot: { config_version: gateway.config_version, config_snapshot_id: gateway.config_snapshot_id, config_fingerprint: gateway.config_fingerprint, branch_scope: gateway.branch_scope, config_tables: gatewayData },
  now,
});
if (!decision.ok) return [{ json: decision }];
const operation = prior.operation;
return [{ json: {
  ...decision,
  status: 'PREPARED',
  operation,
  append_prepared_operation: prior.appendPrepared,
  required_writes: ['OPERATION_PREPARED', 'PHIEN_KIEM_KE', 'STATE_CHO', 'EVENT_LOG', 'PHIEN_KIEM_KE_COMMIT_STATE'],
  rows: { ...decision.rows, OPERATION: [{ ...operation }] },
  worker_envelope: workerEnvelope,
} }];`;
  nodes.push(codeNode("build-wf05", buildName, index++, transactionCode));

  const conditionNode = (id, name, expression) => nodeBase(id, name, "n8n-nodes-base.if", 2.2, index++, {
    parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ id, leftValue: `={{${expression}}}`, rightValue: true, operator: { type: "boolean", operation: "equals" } }], combinator: "and" }, options: {} },
  });
  const commitGate = conditionNode("wf05-has-session-plan", commitGateName, `$('${buildName}').first()?.json?.ok === true && $('${buildName}').first()?.json?.status === 'PREPARED'`);
  const preparedGate = conditionNode("wf05-needs-prepared-op", appendGateName, `$('${buildName}').first()?.json?.append_prepared_operation === true`);
  nodes.push(commitGate, preparedGate);

  const preparedProject = codeNode("project-wf05-prepared-operation", "Project WF05 Prepared Operation", index++, `const plan = $('${buildName}').first()?.json ?? {};
return [{ json: plan.rows?.OPERATION?.[0] ?? {} }];`);
  const preparedWrite = writeSheetNode("OPERATION", index++, "append");
  preparedWrite.name = "Append WF05 Prepared Operation";
  preparedWrite.onError = "continueErrorOutput";
  const sessionProjectAfterAppend = codeNode("project-wf05-session-after-reserve", "Project WF05 Session After Reserve", index++, `const plan = $('${buildName}').first()?.json ?? {};
return [{ json: { ...(plan.rows?.PHIEN_KIEM_KE?.[0] ?? {}), write_state: 'PREPARED' } }];`);
  const sessionProjectOnReplay = codeNode("project-wf05-session-on-replay", "Project WF05 Session Resume", index++, `const plan = $('${buildName}').first()?.json ?? {};
return [{ json: { ...(plan.rows?.PHIEN_KIEM_KE?.[0] ?? {}), write_state: 'PREPARED' } }];`);
  const sessionPreparedWrite = writeSheetNode("PHIEN_KIEM_KE", index++, "appendOrUpdate");
  sessionPreparedWrite.name = "Upsert WF05 Prepared Session";
  sessionPreparedWrite.onError = "continueErrorOutput";
  const stateProject = codeNode("project-wf05-state", "Project WF05 Session State", index++, `const plan = $('${buildName}').first()?.json ?? {};
return [{ json: plan.rows?.STATE_CHO?.[0] ?? {} }];`);
  const stateWrite = writeSheetNode("STATE_CHO", index++, "appendOrUpdate");
  stateWrite.name = "Upsert WF05 Session State";
  stateWrite.onError = "continueErrorOutput";
  const eventProject = codeNode("project-wf05-event", "Project WF05 Open Event", index++, `const plan = $('${buildName}').first()?.json ?? {};
return [{ json: plan.rows?.EVENT_LOG?.[0] ?? {} }];`);
  const eventWrite = writeSheetNode("EVENT_LOG", index++, "append");
  eventWrite.name = "Append WF05 Open Event";
  eventWrite.onError = "continueErrorOutput";
  const sessionCommitProject = codeNode("project-wf05-session-commit-state", "Project WF05 Session Commit State", index++, `const plan = $('${buildName}').first()?.json ?? {};
return [{ json: { ...(plan.rows?.PHIEN_KIEM_KE?.[0] ?? {}), write_state: 'COMMITTED', updated_at: new Date().toISOString() } }];`);
  const sessionCommitWrite = writeSheetNode("PHIEN_KIEM_KE", index++, "appendOrUpdate");
  sessionCommitWrite.name = "Upsert WF05 Committed Session State";
  sessionCommitWrite.onError = "continueErrorOutput";
  const commitDecisionName = "Decide WF05 Journal Commit";
  const commitDecision = codeNode("decide-wf05-commit", commitDecisionName, index++, `${sha256Hex.toString()}\n${stableKey.toString()}\n${journalSource}
const plan = $('${buildName}').first()?.json ?? {};
const decision = decideCommit(plan.operation, plan.required_writes ?? [], ['OPERATION_PREPARED', 'PHIEN_KIEM_KE', 'STATE_CHO', 'EVENT_LOG', 'PHIEN_KIEM_KE_COMMIT_STATE']);
return [{ json: { ...decision, now: new Date().toISOString(), data: plan.data, worker_envelope: plan.worker_envelope, operation_id: plan.operation?.operation_id } }];`);
  const decisionGate = conditionNode("wf05-commit-ready", "WF05 Commit Ready", `$('${commitDecisionName}').first()?.json?.ok === true && $('${commitDecisionName}').first()?.json?.committed === true`);
  const committedProject = codeNode("project-wf05-committed-operation", "Project WF05 Committed Operation", index++, `const decision = $('${commitDecisionName}').first()?.json ?? {};
const operation = decision.operation ?? {};
return [{ json: { ...operation, status: 'COMMITTED', commit_state: 'COMMITTED', committed_at: decision.now, updated_at: decision.now } }];`);
  const committedWrite = writeSheetNode("OPERATION", index++, "append");
  committedWrite.name = "Append WF05 Committed Operation";
  committedWrite.onError = "continueErrorOutput";
  const successReturn = codeNode("return-wf05-success", "Return WF05 Result", index++, `const plan = $('${buildName}').first()?.json ?? {};
const decision = $('${commitDecisionName}').first()?.json ?? {};
const envelope = plan.worker_envelope ?? {};
return [{ json: { ok: true, status: 'COMMITTED', replay: false, workflow_code: 'WF05', request_id: envelope.request_id ?? null, operation_id: decision.operation_id ?? null, parent_operation_id: envelope.parent_operation_id ?? null, branch_id: envelope.branch_id ?? null, business_date: envelope.business_date ?? null, config_snapshot_id: envelope.config_snapshot_id ?? null, data: plan.data ?? {}, warnings: [] } }];`);
  const noCommitReturn = codeNode("return-wf05-no-commit", "Return WF05 Non-Commit Result", index++, `const plan = $('${buildName}').first()?.json ?? {};
if (plan.ok === false) return [{ json: plan }];
return [{ json: { ok: plan.ok === true, status: plan.status ?? 'ERROR', replay: plan.replay === true, workflow_code: 'WF05', request_id: plan.worker_envelope?.request_id ?? $('${normalizeName}').first()?.json?.envelope?.request_id ?? null, operation_id: plan.operation?.operation_id ?? plan.session?.operation_id ?? null, data: plan.data ?? {}, error_code: plan.error_code ?? null, error_class: plan.error_class ?? null, retryable: plan.retryable === true, message_safe: plan.message_safe ?? null } }];`);
  const gatewayErrorReturn = codeNode("return-wf05-gateway-error", "Return WF01 Configuration Error", index++, `const result = $('${gatewayName}').first()?.json ?? {};
return [{ json: { ok: false, status: 'ERROR', workflow_code: 'WF05', request_id: result.request_id ?? null, operation_id: result.operation_id ?? null, error_code: result.error_code ?? 'CONFIGURATION_UNAVAILABLE', error_class: result.error_class ?? 'CONFIGURATION', retryable: result.retryable === true, message_safe: result.message_safe ?? 'Validated configuration is unavailable.' } }];`);
  const writeErrorReturn = codeNode("return-wf05-write-error", "Return WF05 Write Failure", index++, `const error = $input.first()?.json?.error ?? {};
const plan = $('${buildName}').first()?.json ?? {};
return [{ json: { ok: false, status: 'ERROR', workflow_code: 'WF05', request_id: plan.worker_envelope?.request_id ?? $('${normalizeName}').first()?.json?.envelope?.request_id ?? null, operation_id: plan.operation?.operation_id ?? null, error_code: 'SESSION_WRITE_FAILED', error_class: 'SYSTEM', retryable: true, message_safe: 'Session changes were not committed; retry with the same request identity.' } }];`);
  nodes.push(preparedProject, preparedWrite, sessionProjectAfterAppend, sessionProjectOnReplay, sessionPreparedWrite, stateProject, stateWrite, eventProject, eventWrite, sessionCommitProject, sessionCommitWrite, commitDecision, decisionGate, committedProject, committedWrite, successReturn, noCommitReturn, gatewayErrorReturn, writeErrorReturn);

  connect(connections, "Execute Workflow Trigger", normalizeName);
  connect(connections, normalizeName, gatewayName);
  connect(connections, gatewayName, gatewayGateName);
  connect(connections, gatewayGateName, "Read OPERATION", 0);
  connect(connections, gatewayGateName, "Return WF01 Configuration Error", 1);
  connect(connections, "Read OPERATION", "Read PHIEN_KIEM_KE");
  connect(connections, "Read PHIEN_KIEM_KE", "Read STATE_CHO");
  connect(connections, "Read STATE_CHO", buildName);
  connect(connections, buildName, commitGateName);
  connect(connections, commitGateName, appendGateName, 0);
  connect(connections, commitGateName, "Return WF05 Non-Commit Result", 1);
  connect(connections, appendGateName, "Project WF05 Prepared Operation", 0);
  connect(connections, appendGateName, "Project WF05 Session Resume", 1);
  connect(connections, "Project WF05 Prepared Operation", "Append WF05 Prepared Operation");
  connect(connections, "Append WF05 Prepared Operation", "Project WF05 Session After Reserve");
  connect(connections, "Append WF05 Prepared Operation", "Return WF05 Write Failure", 1);
  connect(connections, "Project WF05 Session After Reserve", "Upsert WF05 Prepared Session");
  connect(connections, "Project WF05 Session Resume", "Upsert WF05 Prepared Session");
  connect(connections, "Upsert WF05 Prepared Session", "Project WF05 Session State");
  connect(connections, "Upsert WF05 Prepared Session", "Return WF05 Write Failure", 1);
  connect(connections, "Project WF05 Session State", "Upsert WF05 Session State");
  connect(connections, "Upsert WF05 Session State", "Project WF05 Open Event");
  connect(connections, "Upsert WF05 Session State", "Return WF05 Write Failure", 1);
  connect(connections, "Project WF05 Open Event", "Append WF05 Open Event");
  connect(connections, "Append WF05 Open Event", "Project WF05 Session Commit State");
  connect(connections, "Append WF05 Open Event", "Return WF05 Write Failure", 1);
  connect(connections, "Project WF05 Session Commit State", "Upsert WF05 Committed Session State");
  connect(connections, "Upsert WF05 Committed Session State", commitDecisionName);
  connect(connections, "Upsert WF05 Committed Session State", "Return WF05 Write Failure", 1);
  connect(connections, commitDecisionName, "WF05 Commit Ready");
  connect(connections, "WF05 Commit Ready", "Project WF05 Committed Operation", 0);
  connect(connections, "WF05 Commit Ready", "Return WF05 Non-Commit Result", 1);
  connect(connections, "Project WF05 Committed Operation", "Append WF05 Committed Operation");
  connect(connections, "Append WF05 Committed Operation", "Return WF05 Result");
  connect(connections, "Append WF05 Committed Operation", "Return WF05 Write Failure", 1);

  return workflowEnvelope(code, "Open inventory session", nodes, connections, "executeWorkflow", "Opens one branch-scoped inventory session with a frozen config/catalog snapshot and replay-safe staged writes.");
}

function makeWF06() {
  const code = "WF06";
  const normalizeName = "Normalize WF06 Input";
  const gatewayName = "Call WF01 Config Gateway";
  const gatewayGateName = "WF06 Config Ready";
  const buildName = "Build WF06 Count Decision";
  const planGateName = "WF06 Has Write Plan";
  const preparedGateName = "WF06 Needs Prepared Operation";
  const commitDecisionName = "Decide WF06 Journal Commit";
  const commitGateName = "WF06 Commit Ready";
  const reconcileGateName = "WF06 Should Reconcile";
  const nodes = [executeTrigger(0)];
  const connections = {};
  let index = 1;
  const gateNode = (id, name, expression) => nodeBase(id, name, "n8n-nodes-base.if", 2.2, index++, {
    parameters: { conditions: { options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 }, conditions: [{ id, leftValue: `={{${expression}}}`, rightValue: true, operator: { type: "boolean", operation: "equals" } }], combinator: "and" }, options: {} },
  });

  nodes.push(codeNode("normalize-wf06", normalizeName, index++, `${normalizeEnvelope.toString()}
const input = $input.first()?.json ?? {};
const source = input.envelope ?? input;
const normalized = normalizeEnvelope(source, 'WF06');
if (!normalized.ok) return [{ json: { ok: false, status: 'ERROR', ...normalized.error, request_id: source?.request_id ?? null, operation_id: source?.operation_id ?? null, rows: {}, should_call_wf07: false } }];
const envelope = normalized.envelope;
return [{ json: { envelope: { ...envelope, payload: { ...(envelope.payload ?? {}), required_sheet_names: ['CONFIG_BIA', 'CONFIG_GLOBAL', 'CONFIG_SCHEMA'] } } } }];`));
  nodes.push(callGateway(index++));
  nodes.push(gateNode("wf06-config-ready", gatewayGateName, `$('${gatewayName}').first()?.json?.ok === true`));

  const readSheets = ["OPERATION", "PHIEN_KIEM_KE", "BIA_LOG", "STATE_CHO"];
  for (const sheetName of readSheets) nodes.push(readSheetNode(sheetName, index++));

  const journalSource = readFileSync(path.join(repoRoot, "src", "kiem-ke-bia-v2", "operation-journal.mjs"), "utf8").replace(/^export /gm, "");
  const countSource = readFileSync(path.join(repoRoot, "src", "kiem-ke-bia-v2", "logic", "wf06-count-intake.mjs"), "utf8")
    .replace(/^import \{ stableKey \} from ['"]\.\.\/contracts\.mjs['"];?\r?\n/m, "")
    .replace(/^export /gm, "");
  const buildCode = `${sha256Hex.toString()}\n${stableKey.toString()}\n${journalSource}\n${countSource}
const normalized = $('${normalizeName}').first()?.json ?? {};
const inputEnvelope = normalized.envelope ?? {};
const payload = inputEnvelope.payload && typeof inputEnvelope.payload === 'object' ? inputEnvelope.payload : {};
const gateway = $('${gatewayName}').first()?.json ?? {};
if (gateway.ok !== true) return [{ json: { ok: false, status: 'ERROR', error_code: gateway.error_code ?? 'CONFIGURATION_UNAVAILABLE', error_class: 'CONFIGURATION', rows: {}, should_call_wf07: false } }];
const rows = (name) => $items(name).map((item) => item.json ?? {});
const operations = rows('Read OPERATION');
const sessions = visibleCommittedRows(rows('Read PHIEN_KIEM_KE'), operations)
  .filter((row) => String(row.branch_id ?? '') === String(inputEnvelope.branch_id ?? '') && String(row.status ?? '').toUpperCase() === 'ACTIVE_SESSION');
const requestedSessionId = String(payload.session_id ?? '').trim();
const candidates = requestedSessionId ? sessions.filter((row) => String(row.session_id ?? '') === requestedSessionId) : sessions;
if (candidates.length !== 1) return [{ json: { ok: false, status: 'ERROR', error_code: candidates.length ? 'SESSION_AMBIGUOUS' : 'SESSION_NOT_FOUND', error_class: candidates.length ? 'CONFLICT' : 'VALIDATION', rows: {}, should_call_wf07: false } }];
const session = candidates[0];
const sessionState = visibleCommittedRows(rows('Read STATE_CHO'), operations).find((row) => String(row.state_id ?? '') === String(session.session_id ?? '')
  && String(row.branch_id ?? '') === String(session.branch_id ?? '')
  && String(row.topic_type ?? '') === 'INVENTORY_SESSION'
  && String(row.status ?? '').toUpperCase() === 'ACTIVE_SESSION');
if (!sessionState) return [{ json: { ok: false, status: 'ERROR', error_code: 'SESSION_STATE_INCONSISTENT', error_class: 'MANUAL_REVIEW', rows: {}, should_call_wf07: false } }];
const committedOperationIds = new Set(operations.filter(isOperationCommitted).map((operation) => String(operation.operation_id ?? '')));
const currentCounts = rows('Read BIA_LOG')
  .filter((row) => String(row.session_id ?? '') === String(session.session_id ?? ''))
  .map((row) => committedOperationIds.has(String(row.operation_id ?? ''))
    ? row
    : { ...row, status: 'PREPARED', write_state: 'PREPARED' });
const workerEnvelope = { ...inputEnvelope, config_version: session.config_version ?? inputEnvelope.config_version, config_snapshot_id: session.config_snapshot_id };
const now = new Date().toISOString();
const decision = acceptInventoryCount({ envelope: workerEnvelope, session, currentCounts, payload, now });
if (!decision.ok || decision.status !== 'PREPARED') return [{ json: { ...decision, workflow_code: 'WF06', worker_envelope: workerEnvelope } }];
const prior = prepareOperation(workerEnvelope, 'WF06', now, operations);
if (!prior.ok) return [{ json: { ok: false, status: 'ERROR', error_code: prior.error_code, error_class: 'CONFLICT', rows: {}, should_call_wf07: false } }];
if (prior.replay && isOperationCommitted(prior.operation)) return [{ json: { ok: true, status: 'COMMITTED', replay: true, rows: {}, should_call_wf07: false, data: decision.data, operation: prior.operation, worker_envelope: workerEnvelope } }];
const required = [...(decision.required_writes ?? [])];
if (prior.appendPrepared) required.unshift('OPERATION_PREPARED');
return [{ json: { ...decision, operation: prior.operation, append_prepared_operation: prior.appendPrepared, required_writes: required, worker_envelope: workerEnvelope } }];`;
  nodes.push(codeNode("build-wf06", buildName, index++, buildCode));
  nodes.push(gateNode("wf06-has-write-plan", planGateName, `$('${buildName}').first()?.json?.ok === true && $('${buildName}').first()?.json?.status === 'PREPARED'`));
  nodes.push(gateNode("wf06-needs-prepared-operation", preparedGateName, `$('${buildName}').first()?.json?.append_prepared_operation === true`));

  const preparedProject = codeNode("project-wf06-prepared-operation", "Project WF06 Prepared Operation", index++, `const plan = $('${buildName}').first()?.json ?? {};
return [{ json: plan.operation ?? {} }];`);
  const preparedWrite = writeSheetNode("OPERATION", index++, "append");
  preparedWrite.name = "Append WF06 Prepared Operation";
  preparedWrite.onError = "continueErrorOutput";
  nodes.push(preparedProject, preparedWrite);

  const stages = [
    { sheet: "BIA_LOG", operation: "appendOrUpdate", id: "wf06-bia-log" },
    { sheet: "PHIEN_KIEM_KE", operation: "appendOrUpdate", id: "wf06-session" },
    { sheet: "STATE_CHO", operation: "appendOrUpdate", id: "wf06-state" },
    { sheet: "EVENT_LOG", operation: "appendOrUpdate", id: "wf06-event" },
  ];
  for (const stage of stages) {
    const projectName = `Project WF06 ${stage.sheet}`;
    const gateName = `WF06 Has ${stage.sheet}`;
    nodes.push(codeNode(`${stage.id}-project`, projectName, index++, `const plan = $('${buildName}').first()?.json ?? {};
const row = plan.rows?.['${stage.sheet}']?.[0];
if (!row) return [{ json: { __wf06_skip_write: true } }];
const persisted = { ...row, status: row.status === 'PREPARED' ? 'COMMITTED' : row.status, write_state: row.write_state === 'PREPARED' ? 'COMMITTED' : row.write_state };
return [{ json: { __wf06_skip_write: false, row: persisted } }];`));
    nodes.push(gateNode(`${stage.id}-gate`, gateName, `$('${projectName}').first()?.json?.__wf06_skip_write === false`));
    const writer = writeSheetNode(stage.sheet, index++, stage.operation);
    writer.name = `${stage.operation === "append" ? "Append" : "Upsert"} WF06 ${stage.sheet}`;
    writer.onError = "continueErrorOutput";
    nodes.push(writer);
  }

  const businessProjectors = stages.map((stage) => `Project WF06 ${stage.sheet}`);
  const commitDecision = codeNode("decide-wf06-commit", commitDecisionName, index++, `${sha256Hex.toString()}\n${stableKey.toString()}\n${journalSource}
const plan = $('${buildName}').first()?.json ?? {};
const decision = decideCommit(plan.operation, plan.required_writes ?? [], plan.required_writes ?? []);
return [{ json: { ...decision, plan, now: new Date().toISOString() } }];`);
  const commitGate = gateNode("wf06-commit-ready", commitGateName, `$('${commitDecisionName}').first()?.json?.ok === true && $('${commitDecisionName}').first()?.json?.committed === true`);
  const committedProject = codeNode("project-wf06-committed-operation", "Project WF06 Committed Operation", index++, `const result = $('${commitDecisionName}').first()?.json ?? {};
const operation = result.operation ?? {};
return [{ json: { ...operation, status: 'COMMITTED', commit_state: 'COMMITTED', committed_at: result.now, updated_at: result.now } }];`);
  const committedWrite = writeSheetNode("OPERATION", index++, "append");
  committedWrite.name = "Append WF06 Committed Operation";
  committedWrite.onError = "continueErrorOutput";
  const reconcileGate = gateNode("wf06-should-reconcile", reconcileGateName, `$('${buildName}').first()?.json?.should_call_wf07 === true`);
  const reconcileInput = codeNode("prepare-wf07-input", "Prepare WF07 Input", index++, `const plan = $('${buildName}').first()?.json ?? {};
const envelope = plan.worker_envelope ?? {};
return [{ json: { envelope: { ...envelope, event_type: 'RECONCILE_AND_CLOSE', payload: { ...(envelope.payload ?? {}), session_id: plan.data?.session_id ?? null, count_finalize_operation_id: plan.operation?.operation_id ?? null } } } }];`);
  const reconcileCall = executeWorkflowNode("call-wf07", "Call WF07 Reconcile and Close", index++);
  const successReturn = codeNode("return-wf06-result", "Return WF06 Result", index++, `const plan = $('${buildName}').first()?.json ?? {};
const reconciliation = $input.first()?.json ?? {};
return [{ json: { ok: true, status: 'COMMITTED', replay: plan.replay === true, workflow_code: 'WF06', request_id: plan.worker_envelope?.request_id ?? null, operation_id: plan.operation?.operation_id ?? null, data: plan.data ?? {}, reconciliation: reconciliation.workflow_code === 'WF07' ? reconciliation.data ?? {} : null } }];`);
  const decisionReturn = codeNode("return-wf06-decision", "Return WF06 Decision", index++, `const result = $('${buildName}').first()?.json ?? $json;
return [{ json: { ...result, workflow_code: 'WF06' } }];`);
  const gatewayError = codeNode("return-wf06-gateway-error", "Return WF01 Configuration Error", index++, `const result = $('${gatewayName}').first()?.json ?? {};
return [{ json: { ok: false, status: 'ERROR', workflow_code: 'WF06', error_code: result.error_code ?? 'CONFIGURATION_UNAVAILABLE', error_class: result.error_class ?? 'CONFIGURATION', retryable: result.retryable === true, message_safe: result.message_safe ?? 'Validated configuration is unavailable.', rows: {}, should_call_wf07: false } }];`);
  const writeError = codeNode("return-wf06-write-error", "Return WF06 Write Failure", index++, `const plan = $('${buildName}').first()?.json ?? {};
return [{ json: { ok: false, status: 'ERROR', workflow_code: 'WF06', error_code: 'COUNT_WRITE_FAILED', error_class: 'SYSTEM', retryable: true, message_safe: 'Count changes were not committed; retry with the same request identity.', operation_id: plan.operation?.operation_id ?? null } }];`);
  const commitError = codeNode("return-wf06-commit-error", "Return WF06 Commit Failure", index++, `const result = $('${commitDecisionName}').first()?.json ?? {};
return [{ json: { ok: false, status: 'ERROR', workflow_code: 'WF06', error_code: result.error_code ?? 'COUNT_COMMIT_INCOMPLETE', error_class: 'SYSTEM', retryable: true, message_safe: 'Count changes are still hidden until all required writes are committed.' } }];`);
  nodes.push(commitDecision, commitGate, committedProject, committedWrite, reconcileGate, reconcileInput, reconcileCall, successReturn, decisionReturn, gatewayError, writeError, commitError);

  connect(connections, "Execute Workflow Trigger", normalizeName);
  connect(connections, normalizeName, gatewayName);
  connect(connections, gatewayName, gatewayGateName);
  connect(connections, gatewayGateName, "Read OPERATION", 0);
  connect(connections, gatewayGateName, "Return WF01 Configuration Error", 1);
  connect(connections, "Read OPERATION", "Read PHIEN_KIEM_KE");
  connect(connections, "Read PHIEN_KIEM_KE", "Read BIA_LOG");
  connect(connections, "Read BIA_LOG", "Read STATE_CHO");
  connect(connections, "Read STATE_CHO", buildName);
  connect(connections, buildName, planGateName);
  connect(connections, planGateName, preparedGateName, 0);
  connect(connections, planGateName, "Return WF06 Decision", 1);
  connect(connections, preparedGateName, "Project WF06 Prepared Operation", 0);
  connect(connections, preparedGateName, businessProjectors[0], 1);
  connect(connections, "Project WF06 Prepared Operation", "Append WF06 Prepared Operation");
  connect(connections, "Append WF06 Prepared Operation", businessProjectors[0]);
  connect(connections, "Append WF06 Prepared Operation", "Return WF06 Write Failure", 1);
  for (let stageIndex = 0; stageIndex < stages.length; stageIndex += 1) {
    const stage = stages[stageIndex];
    const projectName = businessProjectors[stageIndex];
    const gateName = `WF06 Has ${stage.sheet}`;
    const writeName = `${stage.operation === "append" ? "Append" : "Upsert"} WF06 ${stage.sheet}`;
    const next = businessProjectors[stageIndex + 1] ?? commitDecisionName;
    connect(connections, projectName, gateName);
    connect(connections, gateName, writeName, 0);
    connect(connections, gateName, next, 1);
    connect(connections, writeName, next);
    connect(connections, writeName, "Return WF06 Write Failure", 1);
  }
  connect(connections, commitDecisionName, commitGateName);
  connect(connections, commitGateName, "Project WF06 Committed Operation", 0);
  connect(connections, commitGateName, "Return WF06 Commit Failure", 1);
  connect(connections, "Project WF06 Committed Operation", "Append WF06 Committed Operation");
  connect(connections, "Append WF06 Committed Operation", reconcileGateName);
  connect(connections, "Append WF06 Committed Operation", "Return WF06 Write Failure", 1);
  connect(connections, reconcileGateName, "Prepare WF07 Input", 0);
  connect(connections, reconcileGateName, "Return WF06 Result", 1);
  connect(connections, "Prepare WF07 Input", "Call WF07 Reconcile and Close");
  connect(connections, "Call WF07 Reconcile and Close", "Return WF06 Result");

  return workflowEnvelope(code, "Count intake", nodes, connections, "executeWorkflow", "Validates snapshot-scoped inventory counts, stages versioned BIA_LOG writes, and invokes WF07 only after explicit finalize.");
}

function makeWF11() {
  return makeGenericWorker({
    code: "WF11",
    title: "Weekly archive",
    triggerType: "executeWorkflow",
    reads: ["BAO_CAO_NGAY", "LOG_NHAP", "LOG_BAN", "BIA_LOG", "EVENT_LOG"],
    writes: ["ARCHIVE_INDEX"],
    integrationNodes: [(index) => codeNode("archive-boundary", "Archive Workbook Operation Boundary", index, archiveBoundaryCode("WF11", "ARCHIVE"))],
  });
}

function makeWF12() {
  return makeGenericWorker({
    code: "WF12",
    title: "Backup and recovery",
    triggerType: "executeWorkflow",
    reads: ["CONFIG_SCHEMA", "OPERATION", "ERROR_BIA", "BACKUP_INDEX"],
    writes: ["BACKUP_INDEX"],
    integrationNodes: [(index) => codeNode("backup-boundary", "Backup/Restore File Operation Boundary", index, archiveBoundaryCode("WF12", "BACKUP"))],
  });
}

const workflowFactories = {
  WF01: buildWF01Workflow,
  WF02: makeWF02,
  WF03: makeWF03,
  WF04: makeWF04,
  WF05: makeWF05,
  WF06: makeWF06,
  WF07: () => makeGenericWorker({ code: "WF07", title: "Reconcile and close", triggerType: "executeWorkflow", reads: ["TON_DAU_KY", "LOG_NHAP", "LOG_BAN", "BIA_LOG", "DIEU_CHINH_SO"], writes: ["BAO_CAO_NGAY"] }),
  WF08: makeWF08,
  WF09: makeWF09,
  WF10: () => makeGenericWorker({ code: "WF10", title: "Reporting", triggerType: "executeWorkflow", reads: ["BAO_CAO_NGAY", "LOG_NHAP", "LOG_BAN"], writes: ["BAO_CAO_TUAN"] }),
  WF11: makeWF11,
  WF12: makeWF12,
};

export function buildWorkflow(code) {
  const factory = workflowFactories[code];
  if (!factory) throw new Error(`Unknown workflow: ${code}`);
  return factory();
}

async function main() {
  const workflowArg = process.argv.find((argument) => argument === "--workflow") ? process.argv[process.argv.indexOf("--workflow") + 1] : process.argv.find((argument) => argument.startsWith("--workflow="))?.split("=", 2)[1];
  if (workflowArg) {
    if (workflowArg !== "WF01") throw new Error(`Targeted build is limited to WF01, received ${workflowArg}`);
    const outputArgIndex = process.argv.indexOf("--output");
    const sourceArgIndex = process.argv.indexOf("--source-output");
    const targetPath = path.resolve(outputArgIndex >= 0 ? process.argv[outputArgIndex + 1] : path.join(workflowDir, fileNames.WF01));
    const sourcePath = path.resolve(sourceArgIndex >= 0 ? process.argv[sourceArgIndex + 1] : path.join(repoRoot, "src", "WF01_Evaluate_Config_Gateway.js"));
    const workflow = buildWF01Workflow();
    const evaluateNode = workflow.nodes.find((node) => node.name === "Evaluate WF01 Configuration");
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(targetPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
    await fs.writeFile(sourcePath, `${evaluateNode.parameters.jsCode}\n`, "utf8");
    console.log(JSON.stringify({ workflow: "WF01", targetPath, sourcePath, nodeCount: workflow.nodes.length }, null, 2));
    return;
  }

  await fs.mkdir(workflowDir, { recursive: true });
  const manifest = {
    package: "kiem-ke-bia-v2",
    generatedDate: "2026-09-29",
    implementationStatus: "INCOMPLETE",
    activationStatus: "BLOCKED_INCOMPLETE_IMPLEMENTATION",
    importOrder,
    workflows: [],
  };
  for (const code of Object.keys(names)) {
    const workflow = workflowFactories[code]();
    const outputPath = path.join(workflowDir, fileNames[code]);
    await fs.writeFile(outputPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
    const triggers = workflow.nodes.filter((node) => /Trigger$/.test(node.type.split(".").at(-1)) || node.type.includes("Trigger"));
    const reads = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.googleSheets" && node.parameters.operation === "read").map((node) => node.parameters.sheetName.value);
    const writes = workflow.nodes.filter((node) => node.type === "n8n-nodes-base.googleSheets" && node.parameters.operation !== "read").map((node) => node.parameters.sheetName.value);
    manifest.workflows.push({
      code,
      name: names[code],
      file: fileNames[code],
      dependencies: workflowDependencies[code],
      active: workflow.active,
      implementationStatus: workflow._kkb_v2.implementation_status,
      activationStatus: workflow._kkb_v2.activation_status,
      triggerTypes: triggers.map((node) => node.type),
      readSheets: reads,
      writeSheets: writes,
      nodeCount: workflow.nodes.length,
      credentialPlaceholders: workflow._kkb_v2.credential_placeholders,
    });
  }
  await fs.writeFile(path.join(outputDir, "WORKFLOW_MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputDir, workflowCount: manifest.workflows.length, importOrder, files: manifest.workflows.map((entry) => entry.file) }, null, 2));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
