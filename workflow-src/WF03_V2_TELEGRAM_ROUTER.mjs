import { sourceFile, codeNode } from './helpers.mjs';

export async function normalizeCode() {
  return codeNode(`
${await sourceFile('src/telegram-router/normalize-status-update.mjs')}

const update = $input.first()?.json ?? {};
const normalized = normalizeTelegramUpdate(update);
normalized.envelope.payload.required_sheet_names = normalized.command === '/trangthai'
  ? []
  : ['CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH'];
return [{ json: normalized }];
`);
}

export async function decisionCode() {
  return codeNode(`
${await sourceFile('src/telegram-router/decide-router-response.mjs')}

const normalized = $('Normalize Telegram Update').first()?.json ?? {};
const gatewayResult = $input.first()?.json ?? {};
const result = decideRouterResponse({ normalized, gatewayResult, now: new Date().toISOString() });
return [{ json: { envelope: normalized.envelope, reply_target: normalized.reply_target, decision: result.decision, text: result.text } }];
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
