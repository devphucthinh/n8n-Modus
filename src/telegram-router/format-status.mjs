const MAX_MESSAGE_LENGTH = 4096;

const asText = (value) => (value == null ? '' : String(value));

function messageMap(tables, locale = 'vi-VN', fallbackMessages = {}) {
  const map = new Map();
  for (const [key, value] of Object.entries(fallbackMessages ?? {})) map.set(asText(key), asText(value));
  for (const row of tables?.CONFIG_THONG_BAO ?? []) {
    if (asText(row.trang_thai).toUpperCase() === 'INACTIVE') continue;
    if (asText(row.locale) && asText(row.locale) !== locale) continue;
    map.set(asText(row.message_key), asText(row.message_text));
  }
  return map;
}

function render(template, values) {
  return asText(template).replace(/\{([a-z0-9_]+)\}/gi, (_match, key) => asText(values[key]));
}

function errorTemplateKey(errorCode) {
  if (errorCode === 'USER_NOT_ACTIVE') return 'USER_NOT_ACTIVE';
  if (errorCode === 'COMMAND_NOT_AVAILABLE') return 'COMMAND_NOT_AVAILABLE';
  return 'ERROR_GENERIC';
}

export function formatStatus({ gatewayResult, tables, locale = 'vi-VN' } = {}) {
  if (!gatewayResult?.ok) {
    const response = gatewayResult?.response ?? {};
    const messages = messageMap(tables, locale, response.messages);
    const template = messages.get(errorTemplateKey(response.error_code)) || messages.get('ERROR_GENERIC') || 'ERROR error_id={error_id}';
    return { text: render(template, { error_id: response.error_id || 'unknown' }).slice(0, MAX_MESSAGE_LENGTH) };
  }

  const response = gatewayResult.response;
  const messages = messageMap(tables, locale, response.messages);
  const lines = [
    render(messages.get('STATUS_HEADER'), response),
    render(messages.get('STATUS_GATEWAY_HEALTH_LINE'), response),
    render(messages.get('STATUS_CONFIG_LINE'), response),
    render(messages.get('STATUS_BRANCH_COUNT_LINE'), response),
  ];
  for (const branch of response.active_branches ?? []) {
    lines.push(render(messages.get('STATUS_BRANCH_LINE'), branch));
  }
  lines.push(render(messages.get('STATUS_MAINTENANCE_LINE'), response));
  return { text: lines.filter(Boolean).join('\n').slice(0, MAX_MESSAGE_LENGTH) };
}

export { messageMap, render };
