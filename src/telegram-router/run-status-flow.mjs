import { normalizeStatusUpdate } from './normalize-status-update.mjs';
import { formatStatus } from './format-status.mjs';
import { evaluateConfigGateway } from '../config-gateway/evaluate-config.mjs';

export function runStatusFlow({ update, tables, now } = {}) {
  const normalized = normalizeStatusUpdate(update);
  const gatewayResult = evaluateConfigGateway({ envelope: normalized.envelope, tables, now });
  if (normalized.command !== '/trangthai' && gatewayResult.ok) {
    gatewayResult.ok = false;
    gatewayResult.response = { ...gatewayResult.response, status: 'ERROR', error_code: 'COMMAND_NOT_AVAILABLE', error_id: `err-${normalized.envelope.operation_id}` };
    gatewayResult.write_plan = [];
  }
  const formatted = formatStatus({ gatewayResult, tables });
  return {
    envelope: normalized.envelope,
    reply_target: normalized.reply_target,
    gateway: gatewayResult,
    reply: {
      chat_id: normalized.reply_target.chat_id,
      message_thread_id: normalized.reply_target.message_thread_id,
      text: formatted.text,
    },
  };
}
