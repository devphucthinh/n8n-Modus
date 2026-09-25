import { authorizeCommand } from './authorize-command.mjs';
import { planRetry } from './retry-command.mjs';

export const SAFE_ERROR_TEMPLATE = 'Không thể hoàn tất thao tác. Mã lỗi: {error_id}. Vui lòng gửi mã này cho quản trị viên.';

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
  const response = gatewayResult?.response ?? {};
  const safeErrorId = routerText(errorId || response.error_id) || 'unknown';
  return routerRender(map.get(key) || map.get('ERROR_GENERIC') || SAFE_ERROR_TEMPLATE, { error_id: safeErrorId }).slice(0, 4096);
}

function routerStatusText(gatewayResult, context) {
  const response = gatewayResult?.response ?? {};
  const messages = routerMessages(gatewayResult, context);
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

function routerCanViewCommand(row, config, context, actorUserId, now, activeBranchIds) {
  if (routerText(row.topic_type) && !routerText(row.worker_workflow)) return false;
  const permission = routerText(row.permission_code);
  const command = routerText(row.command_text) || routerText(row.command_code);
  const tables = { ...config, ...context };
  if (!permission) return authorizeCommand({ actorUserId, command, tables, now }).allowed;
  const topicType = routerText(row.topic_type);
  const topics = (config.CONFIG_TOPIC ?? []).filter((candidate) => routerActive(candidate)
    && activeBranchIds.has(routerText(candidate.branch_id))
    && (!topicType || routerText(candidate.topic_type) === topicType));
  return topics.some((topic) => authorizeCommand({ actorUserId, command, topic, tables, now }).allowed);
}

function routerFindTopic(normalized, config, activeBranchIds, commandRow) {
  const topicType = routerText(commandRow?.topic_type);
  const matches = (config.CONFIG_TOPIC ?? []).filter((row) => routerActive(row)
    && routerText(row.chat_id) === routerText(normalized?.reply_target?.chat_id)
    && routerText(row.message_thread_id) === routerText(normalized?.reply_target?.message_thread_id));
  if (matches.length !== 1) return null;
  if (!activeBranchIds.has(routerText(matches[0].branch_id))) return null;
  return !topicType || routerText(matches[0].topic_type) === topicType ? matches[0] : null;
}

function routerHelpText(config, context, actorUserId, now, activeBranchIds) {
  const rows = (config.CONFIG_LENH ?? []).filter(routerActive)
    .filter((row) => routerCanViewCommand(row, config, context, actorUserId, now, activeBranchIds))
    .sort((left, right) => Number(routerText(left.ordinal) || 0) - Number(routerText(right.ordinal) || 0));
  const messages = routerMessages({ response: { messages: {} } }, context);
  const lines = [];
  if (messages.get('HELP_HEADER')) lines.push(routerText(messages.get('HELP_HEADER')));
  for (const row of rows) {
    const command = routerText(row.command_text) || routerText(row.command_code);
    const syntax = routerText(row.syntax) || command;
    lines.push(`${command} — ${routerText(row.description_vi)}`);
    lines.push(`  Cú pháp: ${syntax}`);
    lines.push(`  Quyền: ${routerText(row.permission_code) || 'Không yêu cầu'}`);
    lines.push(`  Ví dụ: ${routerText(row.example) || syntax}`);
  }
  return lines.join('\n');
}

function routerAuditPlan(normalized, context, errorCode, topic, now) {
  if (!Array.isArray(context?.EVENT_LOG)) return [];
  const eventKey = routerText(normalized?.envelope?.payload?.idempotency_key) || routerText(normalized?.envelope?.operation_id);
  const eventId = `evt-${eventKey}-${routerText(errorCode).toLowerCase()}`;
  if (context.EVENT_LOG.some((row) => routerText(row.event_id) === eventId)) return [];
  return [{
    sheet: 'EVENT_LOG',
    action: 'APPEND',
    row: {
      event_id: eventId,
      event_type: 'TELEGRAM_ACCESS',
      request_id: routerText(normalized?.envelope?.request_id),
      operation_id: routerText(normalized?.envelope?.operation_id),
      actor_user_id: routerText(normalized?.envelope?.actor_user_id),
      branch_id: routerText(topic?.branch_id),
      topic_type: routerText(topic?.topic_type),
      command: routerText(normalized?.command),
      outcome: 'DENIED',
      error_code: routerText(errorCode),
      created_at: now,
      trang_thai: 'COMMITTED',
    },
  }];
}

function routerAuthorized({ actorUserId, command, topic, config, context, now, activeBranchIds }) {
  if (command !== '/trangthai' && (!topic || !routerActive(topic) || !activeBranchIds.has(routerText(topic.branch_id)))) return false;
  return authorizeCommand({ actorUserId, command, topic, tables: { ...config, ...context }, now }).allowed;
}

function routerErrorAlertTarget(context) {
  const rows = (context?.CONFIG_GLOBAL ?? []).filter((row) => routerActive(row) && routerText(row.value_type).toUpperCase() === 'STRING');
  const values = new Map(rows.map((row) => [routerText(row.config_key), routerText(row.config_value)]));
  const chatId = values.get('ERROR_ALERT_CHAT_ID') ?? '';
  const threadId = values.get('ERROR_ALERT_THREAD_ID') ?? '';
  if (!/^-?\d{1,20}$/.test(chatId) || /^-?0+$/.test(chatId)) return undefined;
  if (!/^\d{1,16}$/.test(threadId) || /^0+$/.test(threadId)) return undefined;
  return { chat_id: chatId, message_thread_id: threadId };
}

export function decideRouterResponse({ normalized, gatewayResult, now = new Date().toISOString() } = {}) {
  const response = gatewayResult?.response ?? {};
  const config = response.data?.config_tables ?? {};
  const context = response.data?.context_tables ?? {};
  const activeBranchIds = new Set((response.active_branches ?? []).map((branch) => routerText(branch.branch_id)).filter(Boolean));
  const callbackToken = routerText(normalized?.callback?.data);
  const callbackCommand = callbackToken && !routerText(normalized?.command)
    ? (config.CONFIG_LENH ?? []).find((row) => routerActive(row) && [row.command_code, row.command_text].map((value) => routerText(value).toLowerCase()).includes(callbackToken.toLowerCase()))?.command_text
    : null;
  const command = routerText(callbackCommand || normalized?.command).toLowerCase();
  const base = { kind: 'DENY', write_plan: [] };
  if (!gatewayResult?.ok) return { decision: { kind: 'DENY', write_plan: response.error_code === 'USER_NOT_ACTIVE' ? routerAuditPlan(normalized, context, 'USER_NOT_AUTHORIZED', null, now) : [] }, text: routerErrorText(gatewayResult, context, response.error_code, response.error_id) };
  if (command === '/trangthai') return { decision: { kind: 'STATUS', write_plan: [] }, text: routerStatusText(gatewayResult, context) };
  const operationKeys = [normalized?.envelope?.operation_id, normalized?.envelope?.request_id, normalized?.envelope?.payload?.idempotency_key].map(routerText).filter(Boolean);
  if ((context.OPERATION ?? []).some((row) => ['COMMITTED', 'PREPARED', 'FAILED'].includes(routerText(row.status).toUpperCase()) && [row.operation_id, row.request_id, row.idempotency_key].map(routerText).some((value) => operationKeys.includes(value)))) {
    const messages = routerMessages(gatewayResult, context);
    return { decision: { kind: 'DUPLICATE', write_plan: [] }, text: routerText(messages.get('ROUTER_DUPLICATE')) };
  }
  if (command === '/help') return { decision: { kind: 'HELP', write_plan: [] }, text: routerHelpText(config, context, normalized?.envelope?.actor_user_id, now, activeBranchIds) };
  if (command === '/retry') {
    const errorId = routerText(normalized?.args?.[0]);
    const retryCommand = (config.CONFIG_LENH ?? []).find((row) => routerActive(row) && routerText(row.command_text).toLowerCase() === '/retry');
    const topic = routerFindTopic(normalized, config, activeBranchIds, retryCommand);
    const retryResult = planRetry({ actorUserId: normalized?.envelope?.actor_user_id, errorId, topic, tables: { ...config, ...context }, now });
    const errorCode = retryResult.response?.error_code ?? 'ERROR_GENERIC';
    if (errorCode === 'USER_NOT_AUTHORIZED' || !retryCommand || !routerActive(topic)) {
      return { decision: { kind: 'DENY', write_plan: routerAuditPlan(normalized, context, 'USER_NOT_AUTHORIZED', topic, now) }, text: routerErrorText(gatewayResult, context, 'USER_NOT_AUTHORIZED', retryResult.response?.error_id || `err-${errorId || 'unknown'}-retry-denied`) };
    }
    if (!retryResult.retry) return { decision: base, text: routerErrorText(gatewayResult, context, errorCode, retryResult.response?.error_id || errorId) };
    return {
      decision: { kind: 'RETRY_UNAVAILABLE', retry: retryResult.retry, write_plan: [] },
      text: routerErrorText(gatewayResult, context, errorCode, retryResult.response?.error_id || `err-${errorId}-retry-payload-unavailable`),
    };
  }
  const commandRow = (config.CONFIG_LENH ?? []).find((row) => routerActive(row) && routerText(row.command_text).toLowerCase() === command);
  if (!commandRow) return { decision: base, text: routerErrorText(gatewayResult, context, 'COMMAND_NOT_AVAILABLE', `err-${routerText(normalized?.envelope?.operation_id)}`) };
  const topic = routerFindTopic(normalized, config, activeBranchIds, commandRow);
  if (!routerAuthorized({ actorUserId: normalized?.envelope?.actor_user_id, command, topic, config, context, now, activeBranchIds })) {
    return { decision: { kind: 'DENY', write_plan: routerAuditPlan(normalized, context, 'USER_NOT_AUTHORIZED', topic, now) }, text: routerErrorText(gatewayResult, context, 'USER_NOT_AUTHORIZED', `err-${routerText(normalized?.envelope?.operation_id)}-user_not_authorized`) };
  }
  if (!routerText(commandRow.worker_workflow)) {
    return { decision: { kind: 'DENY', write_plan: [] }, text: routerErrorText(gatewayResult, context, 'COMMAND_NOT_AVAILABLE', `err-${routerText(normalized?.envelope?.operation_id)}-worker-unavailable`) };
  }
  const messages = routerMessages(gatewayResult, context);
  const idempotencyKey = routerText(normalized?.envelope?.payload?.idempotency_key) || routerText(normalized?.envelope?.request_id);
  const workerEnvelope = {
    ...normalized.envelope,
    event_type: 'ROUTE_COMMAND',
    branch_id: routerText(topic?.branch_id),
    config_version: routerText(response.config_version) || normalized.envelope.config_version || null,
    config_snapshot_id: routerText(response.config_snapshot_id) || null,
    payload: {
      ...normalized.envelope.payload,
      command,
      command_code: routerText(commandRow.command_code),
      intent: 'ROUTE_COMMAND',
      topic_type: routerText(commandRow.topic_type),
      idempotency_key: idempotencyKey,
    },
  };
  return {
    decision: {
      kind: 'ROUTE',
      error_alert_target: routerErrorAlertTarget(context),
      worker_envelope: workerEnvelope,
      worker_error_message_template: routerMessages(gatewayResult, context).get('ERROR_GENERIC') || SAFE_ERROR_TEMPLATE,
      route: {
        command_code: routerText(commandRow.command_code),
        topic_type: routerText(commandRow.topic_type),
        worker_workflow: routerText(commandRow.worker_workflow),
        branch_id: routerText(topic?.branch_id),
        permission_code: routerText(commandRow.permission_code) || null,
        operation_id: routerText(normalized?.envelope?.operation_id),
        idempotency_key: idempotencyKey,
      },
      reservation: {
        sheet: 'OPERATION',
        action: 'APPEND',
        row: {
          operation_id: routerText(normalized?.envelope?.operation_id),
          request_id: routerText(normalized?.envelope?.request_id),
          operation_type: 'ROUTE_COMMAND',
          idempotency_key: routerText(normalized?.envelope?.payload?.idempotency_key) || routerText(normalized?.envelope?.request_id),
          expected_row_count: '1',
          actual_row_count: '',
          checksum: '',
          status: 'PREPARED',
          error_id: '',
          created_at: now,
          updated_at: now,
        },
      },
      write_plan: [],
    },
    text: routerText(messages.get('ROUTER_COMMAND_ACCEPTED')),
  };
}
