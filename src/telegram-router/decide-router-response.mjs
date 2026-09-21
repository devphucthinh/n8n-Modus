const routerText = (value) => (value == null ? '' : String(value).trim());
const routerActive = (row) => routerText(row?.trang_thai).toUpperCase() === 'ACTIVE';

function routerMessages(gatewayResult, context) {
  const map = new Map(Object.entries(gatewayResult?.response?.messages ?? {}));
  for (const row of context?.CONFIG_THONG_BAO ?? []) {
    if (routerActive(row)) map.set(routerText(row.message_key), routerText(row.message_text));
  }
  return map;
}

function routerRender(template, values) {
  return routerText(template).replace(/\{([a-z0-9_]+)\}/gi, (_match, key) => routerText(values[key]));
}

function routerErrorText(gatewayResult, context, errorCode, errorId) {
  const map = routerMessages(gatewayResult, context);
  const key = errorCode === 'COMMAND_NOT_AVAILABLE' ? 'COMMAND_NOT_AVAILABLE' : errorCode === 'USER_NOT_ACTIVE' ? 'USER_NOT_ACTIVE' : 'ERROR_GENERIC';
  return routerRender(map.get(key) || map.get('ERROR_GENERIC') || 'Không thể hoàn tất thao tác. Mã lỗi: {error_id}', { error_id: errorId || 'unknown' }).slice(0, 4096);
}

function routerStatusText(gatewayResult) {
  const response = gatewayResult?.response ?? {};
  const messages = routerMessages(gatewayResult, {});
  const lines = [
    routerRender(messages.get('STATUS_HEADER'), response),
    routerRender(messages.get('STATUS_GATEWAY_HEALTH_LINE'), response),
    routerRender(messages.get('STATUS_CONFIG_LINE'), response),
    routerRender(messages.get('STATUS_BRANCH_COUNT_LINE'), response),
    ...(response.active_branches ?? []).map((branch) => routerRender(messages.get('STATUS_BRANCH_LINE'), branch)),
    routerRender(messages.get('STATUS_MAINTENANCE_LINE'), response),
  ];
  return lines.filter(Boolean).join('\n').slice(0, 4096);
}

function routerHelpText(config) {
  const rows = (config.CONFIG_LENH ?? []).filter(routerActive).sort((left, right) => Number(routerText(left.ordinal) || 0) - Number(routerText(right.ordinal) || 0));
  const lines = ['Danh sách lệnh Kiểm kê bia V2:'];
  for (const row of rows) {
    const command = routerText(row.command_text) || routerText(row.command_code);
    const syntax = routerText(row.syntax) || command;
    lines.push(`${command} — ${routerText(row.description_vi) || 'Chưa có mô tả'}`);
    lines.push(`  Cú pháp: ${syntax}`);
    lines.push(`  Quyền: ${routerText(row.permission_code) || 'Không yêu cầu'}`);
    lines.push(`  Ví dụ: ${routerText(row.example) || syntax}`);
  }
  return lines.join('\n').slice(0, 4096);
}

function routerWithinWindow(row, now) {
  const current = Date.parse(now);
  const from = routerText(row.effective_from);
  const to = routerText(row.effective_to);
  return (!from || current >= Date.parse(from)) && (!to || current <= Date.parse(to));
}

function routerAuthorized({ actorUserId, command, topic, config, context, now }) {
  const user = (context.CONFIG_USER ?? []).find((row) => routerText(row.user_id) === routerText(actorUserId));
  if (!user || !routerActive(user)) return false;
  if (command === '/trangthai') return true;
  const commandRow = (config.CONFIG_LENH ?? []).find((row) => routerActive(row) && routerText(row.command_text).toLowerCase() === routerText(command).toLowerCase());
  const permission = routerText(commandRow?.permission_code);
  if (!permission) return true;
  if (!topic || !routerActive(topic)) return false;
  const permissions = new Set((config.CONFIG_PERMISSION ?? []).filter(routerActive).map((row) => routerText(row.permission_code)));
  if (!permissions.has(permission)) return false;
  const roles = new Set((config.CONFIG_ROLE ?? []).filter(routerActive).map((row) => routerText(row.role_code)));
  const mappings = (config.CONFIG_ROLE_PERMISSION ?? []).filter((row) => routerActive(row) && routerText(row.permission_code) === permission);
  return (config.CONFIG_USER_ROLE ?? []).some((row) => routerActive(row)
    && routerText(row.user_id) === routerText(actorUserId)
    && routerWithinWindow(row, now)
    && (routerText(row.branch_id) === '*' || routerText(row.branch_id) === routerText(topic.branch_id))
    && roles.has(routerText(row.role_code))
    && mappings.some((mapping) => routerText(mapping.role_code) === routerText(row.role_code)));
}

export function decideRouterResponse({ normalized, gatewayResult, now = new Date().toISOString() } = {}) {
  const response = gatewayResult?.response ?? {};
  const config = response.data?.config_tables ?? {};
  const context = response.data?.context_tables ?? {};
  const command = routerText(normalized?.command).toLowerCase();
  const base = { kind: 'DENY', write_plan: [] };
  if (command === '/trangthai') return { decision: { kind: 'STATUS', write_plan: gatewayResult?.write_plan ?? [] }, text: gatewayResult?.ok ? routerStatusText(gatewayResult) : routerErrorText(gatewayResult, context, response.error_code, response.error_id) };
  if (!gatewayResult?.ok) return { decision: base, text: routerErrorText(gatewayResult, context, response.error_code, response.error_id) };
  if (command === '/help') return { decision: { kind: 'HELP', write_plan: [] }, text: routerHelpText(config) };
  if (command === '/retry') {
    const errorId = routerText(normalized?.args?.[0]);
    const user = (context.CONFIG_USER ?? []).find((row) => routerText(row.user_id) === routerText(normalized?.envelope?.actor_user_id));
    const adminRole = (config.CONFIG_ROLE ?? []).filter(routerActive).map((row) => routerText(row.role_code));
    const hasAdmin = user && routerActive(user) && (config.CONFIG_USER_ROLE ?? []).some((assignment) => routerActive(assignment) && routerText(assignment.user_id) === routerText(normalized?.envelope?.actor_user_id) && routerText(assignment.branch_id) === '*' && adminRole.includes(routerText(assignment.role_code)) && (config.CONFIG_ROLE_PERMISSION ?? []).some((mapping) => routerActive(mapping) && routerText(mapping.role_code) === routerText(assignment.role_code) && routerText(mapping.permission_code) === 'ADMIN_RETRY'));
    const error = (context.ERROR_BIA ?? []).find((row) => routerText(row.error_id) === errorId && routerText(row.status).toUpperCase() !== 'RESOLVED');
    if (!hasAdmin) return { decision: base, text: routerErrorText(gatewayResult, context, 'USER_NOT_AUTHORIZED', `err-${errorId || 'unknown'}-retry-denied`) };
    if (!error) return { decision: base, text: routerErrorText(gatewayResult, context, 'ERROR_NOT_FOUND', `err-${errorId || 'unknown'}-not-found`) };
    if (!['YES', 'TRUE', '1'].includes(routerText(error.retryable).toUpperCase())) return { decision: base, text: routerErrorText(gatewayResult, context, 'ERROR_NOT_RETRYABLE', errorId) };
    const operationId = routerText(error.operation_id);
    const idempotencyKey = routerText(error.request_id) || operationId;
    return { decision: { kind: 'RETRY', retry: { error_id: errorId, operation_id: operationId, idempotency_key: idempotencyKey }, write_plan: [] }, text: 'Đã tiếp nhận yêu cầu retry.' };
  }
  const commandRow = (config.CONFIG_LENH ?? []).find((row) => routerActive(row) && routerText(row.command_text).toLowerCase() === command);
  if (!commandRow) return { decision: base, text: routerErrorText(gatewayResult, context, 'COMMAND_NOT_AVAILABLE', `err-${routerText(normalized?.envelope?.operation_id)}`) };
  const topic = (config.CONFIG_TOPIC ?? []).find((row) => routerActive(row)
    && routerText(row.chat_id) === routerText(normalized?.reply_target?.chat_id)
    && (routerText(row.message_thread_id) === routerText(normalized?.reply_target?.message_thread_id) || !routerText(row.message_thread_id))
    && (!routerText(commandRow.topic_type) || routerText(row.topic_type) === routerText(commandRow.topic_type)));
  if (!routerAuthorized({ actorUserId: normalized?.envelope?.actor_user_id, command, topic, config, context, now })) {
    return { decision: base, text: routerErrorText(gatewayResult, context, 'USER_NOT_AUTHORIZED', `err-${routerText(normalized?.envelope?.operation_id)}-user_not_authorized`) };
  }
  return {
    decision: {
      kind: 'ROUTE',
      route: {
        command_code: routerText(commandRow.command_code),
        topic_type: routerText(commandRow.topic_type),
        worker_workflow: routerText(commandRow.worker_workflow),
        branch_id: routerText(topic?.branch_id),
        permission_code: routerText(commandRow.permission_code) || null,
        operation_id: routerText(normalized?.envelope?.operation_id),
        idempotency_key: routerText(normalized?.envelope?.request_id),
      },
      write_plan: [],
    },
    text: 'Đã tiếp nhận lệnh.',
  };
}
