const FULL_ROUTER_SHEETS = Object.freeze([
  'CONFIG_ROLE',
  'CONFIG_PERMISSION',
  'CONFIG_USER_ROLE',
  'CONFIG_ROLE_PERMISSION',
  'CONFIG_TOPIC',
  'CONFIG_LENH',
  'EVENT_LOG',
]);
const HELP_ROUTER_SHEETS = Object.freeze([
  'CONFIG_ROLE',
  'CONFIG_PERMISSION',
  'CONFIG_USER_ROLE',
  'CONFIG_ROLE_PERMISSION',
  'CONFIG_TOPIC',
  'CONFIG_LENH',
]);

/**
 * Return only the configuration tabs needed by a Telegram command.
 * Core sheets are always read by WF01; this list controls the optional router
 * reads so read-only help does not wait on operational/audit tabs.
 */
export function requiredSheetNames(command) {
  const normalized = command == null ? '' : String(command).trim().toLowerCase();
  if (normalized === '/trangthai') return [];
  if (normalized === '/help') return [...HELP_ROUTER_SHEETS];
  if (normalized === '/retry') return [...FULL_ROUTER_SHEETS, 'RETRY_CONTEXT'];
  return [...FULL_ROUTER_SHEETS];
}
