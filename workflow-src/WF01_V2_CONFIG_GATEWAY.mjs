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
const tables = assembled.tables ?? Object.fromEntries(['CONFIG_SCHEMA', 'CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', 'CONFIG_SNAPSHOT', 'OPERATION', 'ERROR_BIA', 'CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH', 'EVENT_LOG', 'CONFIG_LICH', 'CONFIG_BIA'].map((name) => [name, readRows(name)]));
const readFailures = Array.isArray(assembled.read_failures) ? assembled.read_failures : [];
if (readFailures.length) {
  const failure = readFailures.find((item) => item.error_code !== 'CONFIG_READ_UNAVAILABLE') ?? readFailures[0];
  const errorCode = failure.error_code;
  return [{ json: { ok: false, response: { status: 'ERROR', error_code: errorCode, sheet_name: failure.sheet_name }, write_plan: [], diagnostics: { error_code: errorCode } } }];
}
const envelope = normalizeEnvelope(assembled.envelope ?? triggerInput.envelope ?? triggerInput);
const decision = evaluateConfigGateway({ envelope, tables, now: new Date().toISOString() });
return [{ json: decision }];
`);
}

export async function assembleCode() {
  return codeNode(`
${await sourceFile('src/config-gateway/read-failure.mjs')}
const triggerInput = $('Execute Workflow Trigger').first()?.json ?? {};
const names = ['CONFIG_SCHEMA', 'CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', 'CONFIG_SNAPSHOT', 'OPERATION', 'ERROR_BIA', 'CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH', 'EVENT_LOG', 'CONFIG_LICH', 'CONFIG_BIA'];
const fetched = names.map((name) => {
  try { return { name, items: $items('Read ' + name) }; }
  catch { return { name, items: [] }; }
});
const tables = Object.fromEntries(fetched.map(({ name, items }) => [name, items.map((item) => item.json).filter((row) => row && Object.keys(row).length > 0)]));
const read_failures = fetched.flatMap(({ name, items }) => items.map((item) => {
  const error_code = classifySheetReadFailure(item);
  return error_code ? { sheet_name: name, error_code } : null;
}).filter(Boolean));
return [{ json: { envelope: triggerInput.envelope ?? triggerInput, tables, read_failures } }];
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
  },
  reply_target: triggerInput.reply_target ?? null,
} }];
`);
}
