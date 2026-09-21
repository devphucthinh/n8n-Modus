import { evaluateConfigGateway } from '../config-gateway/evaluate-config.mjs';
import { AUDIT_SHEET_NAMES, ROUTER_SHEET_NAMES } from '../contracts/core-sheet-schema.mjs';
import { formatStatus } from './format-status.mjs';
import { formatHelp } from './command-catalog.mjs';
import { normalizeTelegramUpdate } from './normalize-status-update.mjs';
import { authorizeCommand } from './authorize-command.mjs';
import { planRetry } from './retry-command.mjs';

const asText = (value) => (value == null ? '' : String(value).trim());
const active = (row) => asText(row?.trang_thai).toUpperCase() === 'ACTIVE';
const routerTables = Object.freeze([...ROUTER_SHEET_NAMES, ...AUDIT_SHEET_NAMES]);
const configuredMessage = (tables, key, fallback) => (tables?.CONFIG_THONG_BAO ?? []).filter((row) => active(row) && asText(row.message_key) === key).at(-1)?.message_text || fallback;
const existingOperation = (tables, envelope) => (tables?.OPERATION ?? []).find((row) => asText(row.status).toUpperCase() === 'COMMITTED' && [row.operation_id, row.request_id, row.idempotency_key].map(asText).includes(asText(envelope.operation_id)));
const accessAuditPlan = ({ normalized, errorCode, topic, now, tables }) => (Array.isArray(tables?.EVENT_LOG) ? [{
  sheet: 'EVENT_LOG',
  action: 'APPEND',
  row: {
    event_id: `evt-${normalized.envelope.operation_id}-${errorCode.toLowerCase()}`,
    event_type: 'TELEGRAM_ACCESS',
    request_id: normalized.envelope.request_id,
    operation_id: normalized.envelope.operation_id,
    actor_user_id: normalized.envelope.actor_user_id,
    branch_id: asText(topic?.branch_id),
    topic_type: asText(topic?.topic_type),
    command: normalized.command,
    outcome: 'DENIED',
    error_code: errorCode,
    created_at: now,
    trang_thai: 'COMMITTED',
  },
}] : []);

function topicFor({ tables, replyTarget, command }) {
  const commandRow = (tables?.CONFIG_LENH ?? []).find((row) => active(row) && asText(row.command_text).toLowerCase() === asText(command).toLowerCase());
  const topicType = asText(commandRow?.topic_type);
  return (tables?.CONFIG_TOPIC ?? []).find((row) => active(row)
    && asText(row.chat_id) === asText(replyTarget.chat_id)
    && (asText(row.message_thread_id) === asText(replyTarget.message_thread_id) || !asText(row.message_thread_id))
    && (!topicType || asText(row.topic_type) === topicType)) ?? null;
}

function errorResult(normalized, gateway, errorCode) {
  return {
    ok: false,
    response: {
      status: 'ERROR',
      error_code: errorCode,
      error_id: `err-${normalized.envelope.operation_id}-${errorCode.toLowerCase()}`,
      messages: gateway?.response?.messages,
    },
    write_plan: [],
  };
}

function reply(normalized, text) {
  return { chat_id: normalized.reply_target.chat_id, message_thread_id: normalized.reply_target.message_thread_id, text: text.slice(0, 4096) };
}

export function runRouterFlow({ update, tables, now = new Date().toISOString() } = {}) {
  const normalized = normalizeTelegramUpdate(update);
  const callbackToken = asText(normalized.callback?.data);
  const callbackCommand = callbackToken && !normalized.command
    ? (tables?.CONFIG_LENH ?? []).find((row) => active(row) && [row.command_code, row.command_text].map((value) => asText(value).toLowerCase()).includes(callbackToken.toLowerCase()))?.command_text
    : null;
  const command = asText(callbackCommand) || normalized.command;
  const required = command === '/trangthai' ? [] : routerTables;
  const envelope = {
    ...normalized.envelope,
    payload: { ...normalized.envelope.payload, command, required_sheet_names: required },
  };
  const gateway = evaluateConfigGateway({ envelope, tables, now });
  const configTables = gateway.response?.data?.config_tables ?? {};

  if (command === '/trangthai') {
    const formatted = formatStatus({ gatewayResult: gateway, tables });
    return { envelope, reply_target: normalized.reply_target, gateway, decision: { kind: 'STATUS', write_plan: gateway.write_plan ?? [] }, reply: reply(normalized, formatted.text) };
  }

  if (!gateway.ok) {
    const formatted = formatStatus({ gatewayResult: gateway, tables });
    return { envelope, reply_target: normalized.reply_target, gateway, decision: { kind: 'DENY', write_plan: gateway.response?.error_code === 'USER_NOT_ACTIVE' ? accessAuditPlan({ normalized, errorCode: 'USER_NOT_AUTHORIZED', topic: null, now, tables }) : [] }, reply: reply(normalized, formatted.text) };
  }

  if (existingOperation(tables, envelope)) {
    return { envelope, reply_target: normalized.reply_target, gateway, decision: { kind: 'DUPLICATE', write_plan: [] }, reply: reply(normalized, configuredMessage(tables, 'ROUTER_DUPLICATE', 'Yêu cầu đã được xử lý.')) };
  }

  if (command === '/help') {
    const formatted = formatHelp({ tables: configTables });
    return { envelope, reply_target: normalized.reply_target, gateway, decision: { kind: 'HELP', write_plan: [] }, reply: reply(normalized, formatted.text) };
  }

  if (command === '/retry') {
    const retryCommand = (configTables.CONFIG_LENH ?? []).find((row) => active(row) && asText(row.command_text).toLowerCase() === '/retry');
    const retry = planRetry({ actorUserId: normalized.envelope.actor_user_id, errorId: normalized.args[0], permissionCode: retryCommand?.permission_code, tables, now });
    if (!retry.ok) {
      const formatted = formatStatus({ gatewayResult: retry, tables });
      return { envelope, reply_target: normalized.reply_target, gateway, decision: { kind: 'DENY', write_plan: retry.response?.error_code === 'USER_NOT_AUTHORIZED' ? accessAuditPlan({ normalized, errorCode: 'USER_NOT_AUTHORIZED', topic: null, now, tables }) : [] }, reply: reply(normalized, formatted.text) };
    }
    return {
      envelope,
      reply_target: normalized.reply_target,
      gateway,
      decision: { kind: 'RETRY', retry: retry.retry, write_plan: [] },
      reply: reply(normalized, configuredMessage(tables, 'ROUTER_RETRY_ACCEPTED', 'Đã tiếp nhận yêu cầu retry.')),
    };
  }

  const commandRow = (configTables.CONFIG_LENH ?? []).find((row) => asText(row.command_text).toLowerCase() === asText(command).toLowerCase());
  if (!commandRow) {
    const unsupported = errorResult(normalized, gateway, 'COMMAND_NOT_AVAILABLE');
    const formatted = formatStatus({ gatewayResult: unsupported, tables });
    return { envelope, reply_target: normalized.reply_target, gateway, decision: { kind: 'DENY', write_plan: [] }, reply: reply(normalized, formatted.text) };
  }
  const topic = topicFor({ tables: configTables, replyTarget: normalized.reply_target, command });
  const authorization = authorizeCommand({ actorUserId: normalized.envelope.actor_user_id, command, topic, tables: { ...tables, ...configTables }, now });
  if (!authorization.allowed) {
    const denied = errorResult(normalized, gateway, 'USER_NOT_AUTHORIZED');
    const formatted = formatStatus({ gatewayResult: denied, tables });
    return { envelope, reply_target: normalized.reply_target, gateway, decision: { kind: 'DENY', write_plan: accessAuditPlan({ normalized, errorCode: 'USER_NOT_AUTHORIZED', topic, now, tables }) }, reply: reply(normalized, formatted.text) };
  }
  const route = {
    command_code: asText(commandRow.command_code),
    topic_type: asText(commandRow.topic_type),
    worker_workflow: asText(commandRow.worker_workflow),
    branch_id: authorization.branch_id,
    permission_code: authorization.permission_code,
    operation_id: envelope.operation_id,
    idempotency_key: envelope.request_id,
  };
  return {
    envelope,
    reply_target: normalized.reply_target,
    gateway,
    decision: { kind: 'ROUTE', route, write_plan: [] },
    reply: reply(normalized, configuredMessage(tables, 'ROUTER_COMMAND_ACCEPTED', 'Đã tiếp nhận lệnh.')),
  };
}
