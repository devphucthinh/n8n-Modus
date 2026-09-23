import { sourceFile, codeNode } from './helpers.mjs';

export async function gatewayCode() {
  return codeNode(`
${await sourceFile('src/contracts/core-sheet-schema.mjs')}
${await sourceFile('src/contracts/workflow-envelope.mjs')}
${await sourceFile('src/config-gateway/sha256.mjs')}
${await sourceFile('src/config-gateway/evaluate-config.mjs')}

const assembled = $input.first()?.json ?? {};
const triggerInput = assembled.envelope ? assembled : $('Execute Workflow Trigger').first()?.json ?? {};
const readRows = (name) => {
  try {
    return $items('Read ' + name).map((item) => item.json).filter((row) => row && Object.keys(row).length > 0);
  } catch {
    return [];
  }
};
const tables = assembled.tables ?? Object.fromEntries(['CONFIG_SCHEMA', 'CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', 'CONFIG_SNAPSHOT', 'OPERATION', 'ERROR_BIA', 'CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH', 'EVENT_LOG', 'RETRY_CONTEXT'].map((name) => [name, readRows(name)]));
const envelope = normalizeEnvelope(assembled.envelope ?? triggerInput.envelope ?? triggerInput);
const decision = evaluateConfigGateway({ envelope, tables, now: new Date().toISOString() });
return [{ json: decision }];
`);
}

export async function assembleCode() {
  return codeNode(`
const triggerInput = $('Execute Workflow Trigger').first()?.json ?? {};
const readRows = (name) => {
  try {
    return $items('Read ' + name).map((item) => item.json).filter((row) => row && Object.keys(row).length > 0);
  } catch {
    return [];
  }
};
const tables = Object.fromEntries(['CONFIG_SCHEMA', 'CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', 'CONFIG_SNAPSHOT', 'OPERATION', 'ERROR_BIA', 'CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH', 'EVENT_LOG', 'RETRY_CONTEXT'].map((name) => [name, readRows(name)]));
return [{ json: { envelope: triggerInput.envelope ?? triggerInput, tables } }];
`);
}

export function retryContextLookupCode() {
  return codeNode(`
const input = $('Execute Workflow Trigger').first()?.json ?? {};
const payload = (input.envelope ?? input).payload ?? {};
const requested = String(payload.command ?? '').trim().toLowerCase() === '/retry'
  && Array.isArray(payload.required_sheet_names)
  && payload.required_sheet_names.includes('RETRY_CONTEXT');
const errorId = String(payload.error_id ?? payload.args?.[0] ?? '').trim();
let errorRows = [];
try { errorRows = $('Read ERROR_BIA').all().map((item) => item.json); } catch { /* no matching error */ }
const latestError = errorId ? errorRows.filter((row) => String(row.error_id ?? '').trim() === errorId).at(-1) : null;
const operationId = String(latestError?.operation_id ?? '').trim();
return [{ json: { operation_id: operationId, retry_context_requested: Boolean(requested && errorId && operationId) } }];
`);
}

export function planRowCode(index) {
  return codeNode(`
const result = $('Evaluate Config Gateway').first()?.json ?? {};
const entry = result.write_plan?.[${index}];
if (!entry) return [];
const row = entry.row ?? { ...(entry.match ?? {}), ...(entry.patch ?? {}) };
return [{ json: row }];
`);
}

export function errorInputCode() {
  return codeNode(`
const result = $('Evaluate Config Gateway').first()?.json ?? {};
const triggerInput = $('Execute Workflow Trigger').first()?.json ?? {};
const envelope = triggerInput.envelope ?? triggerInput;
return [{ json: {
  error: result.response ?? result,
  context: {
    request_id: envelope.request_id,
    operation_id: envelope.operation_id,
    workflow: 'WF01_V2_CONFIG_GATEWAY',
    config_version: envelope.config_version,
    branch_id: envelope.branch_id,
    idempotency_key: envelope.payload?.idempotency_key,
  },
  reply_target: triggerInput.reply_target ?? null,
} }];
`);
}
