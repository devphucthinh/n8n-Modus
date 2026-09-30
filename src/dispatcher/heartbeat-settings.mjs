const heartbeatConfigText = (value) => (value == null ? '' : String(value).trim());
const heartbeatConfigActive = 'ACTIVE';

export const isPositiveSafeInteger = (value) => {
  const text = heartbeatConfigText(value);
  return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text));
};

export const isValidHeartbeatAlertTarget = (chatId, threadId) => {
  const chat = heartbeatConfigText(chatId);
  const thread = heartbeatConfigText(threadId);
  return /^-?\d{1,20}$/.test(chat) && !/^-?0+$/.test(chat)
    && /^\d{1,16}$/.test(thread) && !/^0+$/.test(thread);
};

export function validateDispatcherHeartbeatSettings(configGlobal = []) {
  const invalid = () => ({
    ok: false,
    error_code: 'HEARTBEAT_CONFIG_INVALID',
    sheet_name: 'CONFIG_GLOBAL',
    column_name: 'config_value',
  });
  if (!Array.isArray(configGlobal)) return invalid();

  const activeRows = (key) => configGlobal
    .filter((row) => heartbeatConfigText(row?.config_key) === key
      && heartbeatConfigText(row?.trang_thai).toUpperCase() === heartbeatConfigActive);
  const thresholdRows = activeRows('DISPATCHER_HEARTBEAT_THRESHOLD');
  const chatRows = activeRows('DISPATCHER_NOTIFICATION_CHAT_ID');
  const threadRows = activeRows('DISPATCHER_NOTIFICATION_THREAD_ID');
  const threshold = heartbeatConfigText(thresholdRows[0]?.config_value);
  const chatId = heartbeatConfigText(chatRows[0]?.config_value);
  const threadId = heartbeatConfigText(threadRows[0]?.config_value);
  if ([thresholdRows, chatRows, threadRows].some((rows) => rows.length !== 1)
    || !isPositiveSafeInteger(threshold)
    || !isValidHeartbeatAlertTarget(chatId, threadId)) return invalid();

  return {
    ok: true,
    threshold,
    notificationTarget: { chat_id: chatId, message_thread_id: threadId, branch_id: '' },
  };
}
