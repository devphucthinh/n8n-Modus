import { sourceFile, codeNode } from './helpers.mjs';

export async function normalizeCode() {
  return codeNode(`
${await sourceFile('src/telegram-router/normalize-status-update.mjs')}
${await sourceFile('src/telegram-router/required-sheet-names.mjs')}

const update = $input.first()?.json ?? {};
const normalized = normalizeTelegramUpdate(update);
normalized.envelope.payload.required_sheet_names = requiredSheetNames(normalized.command);
return [{ json: normalized }];
`);
}
export async function decisionCode() {
  return codeNode(`
${await sourceFile('src/telegram-router/effective-window.mjs')}
${await sourceFile('src/telegram-router/worker-targets.mjs')}
${await sourceFile('src/telegram-router/authorize-command.mjs')}
${await sourceFile('src/telegram-router/operation-reservation.mjs')}
${await sourceFile('src/telegram-router/retry-command.mjs')}
${await sourceFile('src/telegram-router/decide-router-response.mjs')}

const normalized = $('Normalize Telegram Update').first()?.json ?? {};
const gatewayResult = $input.first()?.json ?? {};
const result = decideRouterResponse({ normalized, gatewayResult, now: new Date().toISOString() });
return [{ json: { envelope: normalized.envelope, reply_target: normalized.reply_target, decision: result.decision, text: result.text, messages: gatewayResult?.response?.messages ?? {} } }];
`);
}
