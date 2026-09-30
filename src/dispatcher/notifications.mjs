const notificationAsText = (value) => (value == null ? '' : String(value).trim());

function configuredValue(rows, key) {
  return notificationAsText((rows ?? []).find((row) => notificationAsText(row.config_key) === key && notificationAsText(row.trang_thai).toUpperCase() !== 'INACTIVE')?.config_value);
}

export function dispatcherNotificationTarget({ configGlobal = [] } = {}) {
  const chatId = configuredValue(configGlobal, 'DISPATCHER_NOTIFICATION_CHAT_ID');
  if (!chatId) return null;
  return {
    chat_id: chatId,
    message_thread_id: configuredValue(configGlobal, 'DISPATCHER_NOTIFICATION_THREAD_ID'),
    branch_id: '',
  };
}

export function buildDispatchNotice({ action = {}, configGlobal = [], messages = {}, configVersion = null } = {}) {
  const noticeCode = notificationAsText(action.notice_code);
  if (!noticeCode) return null;
  const operationId = notificationAsText(action.operation_id) || `op-dispatch-${notificationAsText(action.dispatch_key).replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const requestId = notificationAsText(action.request_id) || operationId;
  return {
    error: {
      error_code: noticeCode,
      error_class: 'OPERATIONAL',
      retryable: false,
      message_key: noticeCode,
      message: notificationAsText(messages[noticeCode]) || noticeCode,
      operation_id: operationId,
      request_id: requestId,
      workflow: 'WF04_V2_DISPATCHER',
      node: 'Dispatcher Decision',
      config_version: configVersion,
    },
    context: {
      workflow: 'WF04_V2_DISPATCHER',
      node: 'Dispatcher Decision',
      operation_id: operationId,
      request_id: requestId,
      dispatch_key: notificationAsText(action.dispatch_key),
      branch_id: notificationAsText(action.branch_id),
      config_snapshot_id: notificationAsText(action.config_snapshot_id) || null,
    },
    messages,
    reply_target: dispatcherNotificationTarget({ configGlobal }),
  };
}
