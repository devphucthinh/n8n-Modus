import { isWithinEffectiveWindow } from './permission-window.mjs';

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
  return routerRender(map.get(key) || map.get('ERROR_GENERIC') || 'ERROR error_id={error_id}', { error_id: safeErrorId }).slice(0, 4096);
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
  if (!permission) return ['/help', '/trangthai'].includes(routerText(row.command_text).toLowerCase());
  const user = (context.CONFIG_USER ?? []).find((candidate) => routerText(candidate.user_id) === routerText(actorUserId));
  if (!user || !routerActive(user)) return false;
  const permissions = new Set((config.CONFIG_PERMISSION ?? []).filter(routerActive).map((candidate) => routerText(candidate.permission_code)));
  if (!permissions.has(permission)) return false;
  const roles = new Set((config.CONFIG_ROLE ?? []).filter(routerActive).map((candidate) => routerText(candidate.role_code)));
  const mappings = (config.CONFIG_ROLE_PERMISSION ?? []).filter((candidate) => routerActive(candidate) && routerText(candidate.permission_code) === permission);
  const topicType = routerText(row.topic_type);
  const topics = (config.CONFIG_TOPIC ?? []).filter((candidate) => routerActive(candidate)
    && activeBranchIds.has(routerText(candidate.branch_id))
    && (!topicType || routerText(candidate.topic_type) === topicType));
  return (config.CONFIG_USER_ROLE ?? []).some((assignment) => routerActive(assignment)
    && routerText(assignment.user_id) === routerText(actorUserId)
    && isWithinEffectiveWindow(assignment, now)
    && roles.has(routerText(assignment.role_code))
    && mappings.some((mapping) => routerText(mapping.role_code) === routerText(assignment.role_code))
    && topics.some((topic) => routerText(assignment.branch_id) === '*' || routerText(topic.branch_id) === routerText(assignment.branch_id)));
}

function routerFindTopic(normalized, config, activeBranchIds, commandRow) {
  const topicType = routerText(commandRow?.topic_type);
  return (config.CONFIG_TOPIC ?? []).find((row) => routerActive(row)
    && activeBranchIds.has(routerText(row.branch_id))
    && routerText(row.chat_id) === routerText(normalized?.reply_target?.chat_id)
    && routerText(row.message_thread_id) === routerText(normalized?.reply_target?.message_thread_id)
    && (!topicType || routerText(row.topic_type) === topicType));
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
  const user = (context.CONFIG_USER ?? []).find((row) => routerText(row.user_id) === routerText(actorUserId));
  if (!user || !routerActive(user)) return false;
  if (command === '/trangthai') return true;
  const commandRow = (config.CONFIG_LENH ?? []).find((row) => routerActive(row) && routerText(row.command_text).toLowerCase() === routerText(command).toLowerCase());
  const permission = routerText(commandRow?.permission_code);
  if (!permission) return ['/help', '/trangthai'].includes(routerText(command).toLowerCase());
  if (!topic || !routerActive(topic)) return false;
  if (!activeBranchIds.has(routerText(topic.branch_id))) return false;
  const permissions = new Set((config.CONFIG_PERMISSION ?? []).filter(routerActive).map((row) => routerText(row.permission_code)));
  if (!permissions.has(permission)) return false;
  const roles = new Set((config.CONFIG_ROLE ?? []).filter(routerActive).map((row) => routerText(row.role_code)));
  const mappings = (config.CONFIG_ROLE_PERMISSION ?? []).filter((row) => routerActive(row) && routerText(row.permission_code) === permission);
  return (config.CONFIG_USER_ROLE ?? []).some((row) => routerActive(row)
    && routerText(row.user_id) === routerText(actorUserId)
    && isWithinEffectiveWindow(row, now)
    && (routerText(row.branch_id) === '*' || routerText(row.branch_id) === routerText(topic.branch_id))
    && roles.has(routerText(row.role_code))
    && mappings.some((mapping) => routerText(mapping.role_code) === routerText(row.role_code)));
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
    const error = (context.ERROR_BIA ?? []).find((row) => routerText(row.error_id) === errorId && routerText(row.status).toUpperCase() !== 'RESOLVED');
    if (!retryCommand || !routerAuthorized({ actorUserId: normalized?.envelope?.actor_user_id, command: '/retry', topic, config, context, now, activeBranchIds })) {
      return { decision: { kind: 'DENY', write_plan: routerAuditPlan(normalized, context, 'USER_NOT_AUTHORIZED', topic, now) }, text: routerErrorText(gatewayResult, context, 'USER_NOT_AUTHORIZED', `err-${errorId || 'unknown'}-retry-denied`) };
    }
    if (!error) return { decision: base, text: routerErrorText(gatewayResult, context, 'ERROR_NOT_FOUND', `err-${errorId || 'unknown'}-not-found`) };
    if (!['YES', 'TRUE', '1'].includes(routerText(error.retryable).toUpperCase())) return { decision: base, text: routerErrorText(gatewayResult, context, 'ERROR_NOT_RETRYABLE', errorId) };
    const operationId = routerText(error.operation_id);
    const operation = (context.OPERATION ?? []).find((row) => routerText(row.operation_id) === operationId);
    const idempotencyKey = routerText(operation?.idempotency_key) || routerText(error.request_id) || operationId;
    const retry = { error_id: errorId, operation_id: operationId, idempotency_key: idempotencyKey };
    return {
      decision: { kind: 'RETRY_UNAVAILABLE', retry, write_plan: [] },
      text: routerErrorText(gatewayResult, context, 'ERROR_GENERIC', `err-${errorId}-retry-payload-unavailable`),
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
    payload: {
      ...normalized.envelope.payload,
      command,
      command_code: routerText(commandRow.command_code),
      intent: 'ROUTE_COMMAND',
      topic_type: routerText(commandRow.topic_type),
      idempotency_key: idempotencyKey,
    },
  };
  const workerFailureId = `err-${routerText(normalized?.envelope?.operation_id)}-worker-failed`;
  return {
    decision: {
      kind: 'ROUTE',
      worker_envelope: workerEnvelope,
      worker_failure_error_id: workerFailureId,
      worker_failure_text: routerErrorText(gatewayResult, context, 'ERROR_GENERIC', workerFailureId),
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
