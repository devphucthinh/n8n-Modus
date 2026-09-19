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
