import { evaluateConfigGateway } from '../config-gateway/evaluate-config.mjs';
import { AUDIT_SHEET_NAMES, ROUTER_SHEET_NAMES } from '../contracts/core-sheet-schema.mjs';
import { normalizeTelegramUpdate } from './normalize-status-update.mjs';
import { decideRouterResponse } from './decide-router-response.mjs';

const asText = (value) => (value == null ? '' : String(value).trim());
const routerTables = Object.freeze([...ROUTER_SHEET_NAMES, ...AUDIT_SHEET_NAMES]);

function reply(normalized, text) {
  return {
    chat_id: normalized.reply_target.chat_id,
    message_thread_id: normalized.reply_target.message_thread_id,
    text: asText(text),
  };
}

export function runRouterFlow({ update, tables, now = new Date().toISOString() } = {}) {
  const normalized = normalizeTelegramUpdate(update);
  const callbackToken = asText(normalized.callback?.data);
  const callbackCommand = callbackToken && !normalized.command
    ? (tables?.CONFIG_LENH ?? []).find((row) => asText(row.trang_thai).toUpperCase() === 'ACTIVE'
      && [row.command_code, row.command_text].map((value) => asText(value).toLowerCase()).includes(callbackToken.toLowerCase()))?.command_text
    : null;
  const command = asText(callbackCommand) || normalized.command;
  const required = command === '/trangthai' ? [] : routerTables;
  const intent = command === '/trangthai' ? 'READ_STATUS' : command === '/help' ? 'READ_HELP' : command === '/retry' ? 'MANUAL_RETRY' : 'ROUTE_COMMAND';
  const envelope = {
    ...normalized.envelope,
    payload: { ...normalized.envelope.payload, command, intent, required_sheet_names: required },
  };
  const normalizedForDecision = { ...normalized, command, envelope };
  const gateway = evaluateConfigGateway({ envelope, tables, now });
  const result = decideRouterResponse({ normalized: normalizedForDecision, gatewayResult: gateway, now });
  return {
    envelope,
    reply_target: normalized.reply_target,
    gateway,
    decision: result.decision,
    reply: reply(normalized, result.text),
  };
}
