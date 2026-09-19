import { sourceFile, codeNode } from './helpers.mjs';

export async function normalizeCode() {
  return codeNode(`
${await sourceFile('src/telegram-router/normalize-status-update.mjs')}

const update = $input.first()?.json ?? {};
return [{ json: normalizeStatusUpdate(update) }];
`);
}

export async function formatCode() {
  return codeNode(`
${await sourceFile('src/telegram-router/format-status.mjs')}

const input = $input.first()?.json ?? {};
const normalized = $('Normalize Status Update').first()?.json ?? {};
const gatewayResult = input.gateway ?? input;
const result = formatStatus({ gatewayResult, tables: {} });
return [{ json: { reply_target: normalized.reply_target, text: result.text } }];
`);
}

export async function unsupportedCode() {
  return codeNode(`
${await sourceFile('src/telegram-router/format-status.mjs')}

const normalized = $('Normalize Status Update').first()?.json ?? {};
const input = $input.first()?.json ?? {};
const gatewayResult = input.ok === false ? input : { ...input, ok: false, response: { ...(input.response ?? {}), status: 'ERROR', error_code: 'COMMAND_NOT_AVAILABLE', error_id: 'err-' + (normalized.envelope?.operation_id ?? 'unknown') } };
const result = formatStatus({ gatewayResult, tables: {} });
return [{ json: { reply_target: normalized.reply_target, text: result.text } }];
`);
}
