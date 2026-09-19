import { sourceFile, codeNode } from './helpers.mjs';

export async function gatewayCode() {
  return codeNode(`
${await sourceFile('src/contracts/core-sheet-schema.mjs')}
${await sourceFile('src/config-gateway/sha256.mjs')}
${await sourceFile('src/config-gateway/evaluate-config.mjs')}

const triggerInput = $('Execute Workflow Trigger').first()?.json ?? {};
const tables = Object.fromEntries(['CONFIG_SCHEMA', 'CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', 'CONFIG_SNAPSHOT', 'OPERATION', 'ERROR_BIA'].map((name) => [name, $items('Read ' + name).map((item) => item.json)]));
const decision = evaluateConfigGateway({ envelope: triggerInput.envelope ?? triggerInput, tables, now: new Date().toISOString() });
return [{ json: decision }];
`);
}

export async function assembleCode() {
  return codeNode(`
const triggerInput = $('Execute Workflow Trigger').first()?.json ?? {};
const tables = Object.fromEntries(['CONFIG_SCHEMA', 'CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', 'CONFIG_SNAPSHOT', 'OPERATION', 'ERROR_BIA'].map((name) => [name, $items('Read ' + name).map((item) => item.json)]));
return [{ json: { envelope: triggerInput.envelope ?? triggerInput, tables } }];
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
const envelope = $('Execute Workflow Trigger').first()?.json?.envelope ?? $('Execute Workflow Trigger').first()?.json ?? {};
return [{ json: {
  error: result.response ?? result,
  context: {
    request_id: envelope.request_id,
    operation_id: envelope.operation_id,
    workflow: 'WF01_V2_CONFIG_GATEWAY',
  },
} }];
`);
}
