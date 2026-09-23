import { authorizeCommand, hasPermission } from './authorize-command.mjs';
import { buildDispatchReservation } from './operation-reservation.mjs';
import { planRetry } from './retry-command.mjs';
import { resolveWorkerTarget } from './worker-targets.mjs';

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

function routerTopicAtReplyTarget(config, replyTarget, activeBranchIds) {
  const matches = (config.CONFIG_TOPIC ?? []).filter((topic) => routerActive(topic)
    && activeBranchIds.has(routerText(topic.branch_id))
    && routerText(topic.chat_id) === routerText(replyTarget?.chat_id)
    && routerText(topic.message_thread_id) === routerText(replyTarget?.message_thread_id));
  return matches.length === 1 ? matches[0] : null;
}

function routerCanViewCommand(row, config, context, actorUserId, now, activeBranchIds, currentTopic) {
  const command = routerText(row.command_text).toLowerCase();
  // The current ERROR_BIA/OPERATION schema cannot replay the source payload.
  // Do not advertise a command that is intentionally fail-closed.
  if (command === '/retry') return false;
  if (!['/help', '/trangthai', '/retry'].includes(command)
    && !resolveWorkerTarget(row.worker_workflow)) return false;
  const permission = routerText(row.permission_code);
  if (!permission) return ['/help', '/trangthai'].includes(routerText(row.command_text).toLowerCase());
  const topicType = routerText(row.topic_type);
  if (!currentTopic || !topicType || routerText(currentTopic.topic_type) !== topicType) return false;
  return routerHasPermission({ actorUserId, permission, branchId: currentTopic.branch_id, config, context, now, activeBranchIds });
}

function routerHelpText(config, context, actorUserId, now, activeBranchIds, replyTarget) {
  const currentTopic = routerTopicAtReplyTarget(config, replyTarget, activeBranchIds);
  const rows = (config.CONFIG_LENH ?? []).filter(routerActive)
    .filter((row) => routerCanViewCommand(row, config, context, actorUserId, now, activeBranchIds, currentTopic))
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

function routerHasPermission({ actorUserId, permission, branchId, config, context, now, activeBranchIds }) {
  if (branchId !== '*' && !activeBranchIds.has(routerText(branchId))) return false;
  return hasPermission({
    actorUserId,
    permissionCode: permission,
    tables: { ...config, ...context },
    now,
    topic: { branch_id: branchId },
  });
}

function routerAuthorized({ actorUserId, command, topic, config, context, now }) {
  const authorizationTopic = topic ?? (command === '/retry' ? { branch_id: '*', trang_thai: 'ACTIVE' } : null);
  return authorizeCommand({
    actorUserId,
    command,
    topic: authorizationTopic,
    tables: { ...config, ...context },
    now,
  }).allowed;
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
  const rawOperationKeys = [normalized?.envelope?.operation_id, normalized?.envelope?.request_id, normalized?.envelope?.payload?.idempotency_key].map(routerText).filter(Boolean);
  const operationKeys = [...rawOperationKeys, ...rawOperationKeys.map((key) => `router-${key}`)];
  const dispatchReservation = buildDispatchReservation(normalized?.envelope, now);
  const routerReservation = (context.OPERATION ?? []).find((row) => routerText(row.operation_id) === routerText(dispatchReservation.row.operation_id)
    && routerText(row.operation_type) === 'ROUTER_DISPATCH');
  const existingOperation = (context.OPERATION ?? []).find((row) => [row.operation_id, row.request_id, row.idempotency_key].map(routerText).some((value) => operationKeys.includes(value)));
  const duplicateGuardOperation = routerReservation ?? existingOperation;
  if (duplicateGuardOperation && routerText(duplicateGuardOperation.status).toUpperCase() !== 'PREPARED') {
    const messages = routerMessages(gatewayResult, context);
    return { decision: { kind: 'DUPLICATE', write_plan: [] }, text: routerText(messages.get('ROUTER_DUPLICATE')) };
  }
  if (command === '/help') return { decision: { kind: 'HELP', write_plan: [] }, text: routerHelpText(config, context, normalized?.envelope?.actor_user_id, now, activeBranchIds, normalized?.reply_target) };
  if (command === '/retry') {
    const errorId = routerText(normalized?.args?.[0]);
    const retryTopic = (config.CONFIG_TOPIC ?? []).find((row) => routerActive(row)
      && activeBranchIds.has(routerText(row.branch_id))
      && routerText(row.chat_id) === routerText(normalized?.reply_target?.chat_id)
      && routerText(row.message_thread_id) === routerText(normalized?.reply_target?.message_thread_id));
    const retryCommand = (config.CONFIG_LENH ?? []).find((row) => routerActive(row) && routerText(row.command_text).toLowerCase() === command);
    const retry = planRetry({
      actorUserId: normalized?.envelope?.actor_user_id,
      errorId,
      permissionCode: retryCommand?.permission_code,
      topic: retryTopic,
      tables: { ...config, ...context },
      now,
    });
    const denied = retry.response.error_code === 'USER_NOT_AUTHORIZED';
    return {
      decision: { ...base, write_plan: denied ? routerAuditPlan(normalized, context, retry.response.error_code, retryTopic, now) : [] },
      text: routerErrorText(gatewayResult, context, retry.response.error_code, retry.response.error_id),
    };
  }
  const commandRow = (config.CONFIG_LENH ?? []).find((row) => routerActive(row) && routerText(row.command_text).toLowerCase() === command);
  if (!commandRow) return { decision: base, text: routerErrorText(gatewayResult, context, 'COMMAND_NOT_AVAILABLE', `err-${routerText(normalized?.envelope?.operation_id)}`) };
  const workerTarget = resolveWorkerTarget(commandRow.worker_workflow);
  if (!workerTarget) return { decision: base, text: routerErrorText(gatewayResult, context, 'COMMAND_NOT_AVAILABLE', `err-${routerText(normalized?.envelope?.operation_id)}-worker-unavailable`) };
  const topic = (config.CONFIG_TOPIC ?? []).find((row) => routerActive(row)
     && activeBranchIds.has(routerText(row.branch_id))
    && routerText(row.chat_id) === routerText(normalized?.reply_target?.chat_id)
    && routerText(row.message_thread_id) === routerText(normalized?.reply_target?.message_thread_id)
    && (!routerText(commandRow.topic_type) || routerText(row.topic_type) === routerText(commandRow.topic_type)));
  if (!routerAuthorized({ actorUserId: normalized?.envelope?.actor_user_id, command, topic, config, context, now, activeBranchIds })) {
    return { decision: { kind: 'DENY', write_plan: routerAuditPlan(normalized, context, 'USER_NOT_AUTHORIZED', topic, now) }, text: routerErrorText(gatewayResult, context, 'USER_NOT_AUTHORIZED', `err-${routerText(normalized?.envelope?.operation_id)}-user_not_authorized`) };
  }
  const messages = routerMessages(gatewayResult, context);
  const idempotencyKey = routerText(normalized?.envelope?.payload?.idempotency_key) || routerText(normalized?.envelope?.request_id);
  const workerEnvelope = {
    ...normalized.envelope,
    event_type: 'TELEGRAM_COMMAND',
    branch_id: routerText(topic?.branch_id),
    config_version: routerText(response.config_version) || normalized.envelope.config_version || null,
    config_snapshot_id: routerText(response.config_snapshot_id) || null,
    payload: {
      ...normalized.envelope.payload,
      command,
      command_code: routerText(commandRow.command_code),
      topic_type: routerText(commandRow.topic_type),
      idempotency_key: idempotencyKey,
      worker_workflow: routerText(commandRow.worker_workflow),
    },
  };
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
        idempotency_key: idempotencyKey,
        worker_target: workerTarget.workflow_name,
        envelope: workerEnvelope,
      },
      reservation: dispatchReservation,
      write_plan: [],
    },
    text: routerText(messages.get('ROUTER_COMMAND_ACCEPTED')),
  };
}
