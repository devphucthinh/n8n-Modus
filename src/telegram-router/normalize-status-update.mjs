const commandPattern = /^\/(trangthai)(?:@[A-Za-z0-9_]+)?(?:\s+.*)?$/i;

const text = (value) => (value == null ? '' : String(value));

export function normalizeStatusUpdate(update) {
  const message = update?.message ?? update?.edited_message;
  const updateId = update?.update_id;
  if (updateId == null || !message?.chat?.id || !message?.from?.id) {
    throw new Error('Telegram update requires update_id, message.chat.id and message.from.id');
  }
  const commandText = text(message.text).trim();
  const isStatus = commandPattern.test(commandText);
  const stableId = text(updateId);
  return {
    envelope: {
      request_id: `tg-${stableId}`,
      operation_id: `tg-${stableId}`,
      event_type: 'TELEGRAM_UPDATE',
      actor_user_id: text(message.from.id),
      branch_id: null,
      business_date: null,
      config_version: null,
      payload: {
        command: commandText.split(/\s+/, 1)[0] || '',
        intent: isStatus ? 'READ_STATUS' : 'COMMAND_NOT_AVAILABLE',
      },
    },
    reply_target: {
      chat_id: text(message.chat.id),
      message_thread_id: message.message_thread_id == null ? null : text(message.message_thread_id),
    },
    command: isStatus ? '/trangthai' : commandText.split(/\s+/, 1)[0] || '',
  };
}
