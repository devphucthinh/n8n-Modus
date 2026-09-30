import { sha256 } from '../config-gateway/sha256.mjs';

const MAX_TEXT = 256;
const SECRET_KEY = /(token|secret|password|credential|authorization|api[_-]?key|spreadsheet[_-]?id|private[_-]?key|access[_-]?key)/i;
const TRANSIENT_CODE = /(429|408|5\d\d|TIMEOUT|ETIMEDOUT|ECONNRESET|ECONNREFUSED|NETWORK|RATE_LIMIT|TEMPORARY|UNAVAILABLE)/i;
const VALIDATION_CODE = /^(CONFIG_|VALIDATION_|INVALID_|DUPLICATE_|MISSING_|UNAUTHORIZED|FORBIDDEN)/i;

const cap = (value, length = MAX_TEXT) => String(value ?? '').slice(0, length);

function scrubString(value) {
  return cap(String(value)
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b\d{8,}:[A-Za-z0-9_-]{20,}\b/g, '[TELEGRAM_TOKEN_REDACTED]'));
}

function redactSecrets(value, key = '') {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactSecrets(childValue, childKey)]));
  }
  return scrubString(value);
}

function classifyCode(error) {
  const candidate = error?.error_code || error?.code || error?.name;
  const code = String(candidate || 'INTERNAL_ERROR').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  return cap(code);
}

function classifyRetryable(code, error) {
  return Boolean(error?.retryable) || TRANSIENT_CODE.test(code) || TRANSIENT_CODE.test(String(error?.message || ''));
}

function classifyErrorClass(code, retryable) {
  if (retryable) return 'TRANSIENT';
  if (VALIDATION_CODE.test(code)) return 'VALIDATION';
  return 'INTERNAL';
}

function renderMessage(template, errorId) {
  const source = cap(template || 'ERROR error_id={error_id}');
  return cap(source.replaceAll('{error_id}', errorId));
}

export function normalizeWorkflowError({ error = {}, context = {}, messages = {}, now = new Date().toISOString() } = {}) {
  const safeError = redactSecrets({
    code: error?.error_code || error?.code || error?.name,
    message: error?.message,
    context: error?.context,
  });
  const safeContext = redactSecrets({
    request_id: context.request_id,
    operation_id: context.operation_id,
    workflow: context.workflow,
    node: context.node,
    config_version: context.config_version,
  });
  const errorCode = classifyCode(error);
  const retryable = classifyRetryable(errorCode, error);
  const errorClass = classifyErrorClass(errorCode, retryable);
  const fingerprint = sha256(JSON.stringify({ error: safeError, context: safeContext }));
  const errorId = `err-${fingerprint.slice(0, 16)}`;
  const messageTemplate = messages[error?.message_key] || messages[errorCode] || messages.ERROR_GENERIC;
  const messageSafe = renderMessage(messageTemplate, errorId);
  const response = {
    ok: false,
    request_id: cap(context.request_id),
    operation_id: cap(context.operation_id),
    status: 'FAILED',
    error_id: errorId,
    error_code: errorCode,
    retryable,
    message_safe: messageSafe,
  };
  const errorRow = {
    error_id: errorId,
    error_code: errorCode,
    error_class: errorClass,
    retryable: retryable ? 'YES' : 'NO',
    message_safe: messageSafe,
    workflow: cap(context.workflow),
    node: cap(context.node),
    operation_id: cap(context.operation_id),
    request_id: cap(context.request_id),
    config_version: cap(context.config_version),
    fingerprint,
    status: 'OPEN',
    created_at: cap(now),
    resolved_at: '',
  };
  return { response, error_row: errorRow };
}

export { redactSecrets };
