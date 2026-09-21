const commandPattern = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/i;
const text = (value) => (value == null ? '' : String(value));

function sourceParts(update) {
  const callback = update?.callback_query;
  const message = update?.message ?? update?.edited_message ?? callback?.message;
  const actor = message?.from ?? callback?.from;
  return { callback, message, actor };
}

function parseCommand(rawText) {
  const raw = text(rawText).trim();
  const match = commandPattern.exec(raw);
  if (!match) return { command: '', args: [], intent: 'COMMAND_NOT_AVAILABLE', raw_text: raw };
  const command = `/${match[1].toLowerCase()}`;
  const args = text(match[2]).trim() ? text(match[2]).trim().split(/\s+/).slice(0, 20) : [];
  const intent = command === '/trangthai' ? 'READ_STATUS' : command === '/help' ? 'READ_HELP' : command === '/retry' ? 'MANUAL_RETRY' : 'ROUTE_COMMAND';
  return { command, args, intent, raw_text: raw };
}

export function normalizeTelegramUpdate(update) {
  const updateId = update?.update_id;
  const { callback, message, actor } = sourceParts(update);
  if (updateId == null || !message?.chat?.id || !actor?.id) {
    throw new Error('Telegram update requires update_id, message.chat.id and message.from.id');
  }
  const parsed = parseCommand(callback?.data ?? message.text);
  const stableId = text(updateId);
  const replyTarget = {
    chat_id: text(message.chat.id),
    message_thread_id: message.message_thread_id == null ? null : text(message.message_thread_id),
  };
  return {
    envelope: {
      request_id: `tg-${stableId}`,
      operation_id: `tg-${stableId}`,
      event_type: 'TELEGRAM_UPDATE',
      actor_user_id: text(actor.id),
      branch_id: null,
      business_date: null,
      config_version: null,
      payload: {
        command: parsed.command,
        intent: parsed.intent,
        args: parsed.args,
        raw_text: parsed.raw_text,
        callback_id: callback?.id ? text(callback.id) : null,
        callback_data: callback?.data ? text(callback.data) : null,
      },
    },
    reply_target: replyTarget,
    command: parsed.command,
    args: parsed.args,
    callback: callback ? { id: text(callback.id), data: text(callback.data) } : null,
  };
}

export function normalizeStatusUpdate(update) {
  const normalized = normalizeTelegramUpdate(update);
  const isStatus = normalized.command === '/trangthai';
  return {
    ...normalized,
    envelope: {
      ...normalized.envelope,
      payload: {
        ...normalized.envelope.payload,
        intent: isStatus ? 'READ_STATUS' : 'COMMAND_NOT_AVAILABLE',
      },
    },
    command: isStatus ? '/trangthai' : normalized.command,
  };
}
