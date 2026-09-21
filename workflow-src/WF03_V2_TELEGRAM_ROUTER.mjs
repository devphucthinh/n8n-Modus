import { sourceFile, codeNode } from './helpers.mjs';

export async function normalizeCode() {
  return codeNode(`
${await sourceFile('src/telegram-router/normalize-status-update.mjs')}

const update = $input.first()?.json ?? {};
const normalized = normalizeTelegramUpdate(update);
normalized.envelope.payload.required_sheet_names = normalized.command === '/trangthai'
  ? []
  : ['CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH', 'EVENT_LOG'];
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
