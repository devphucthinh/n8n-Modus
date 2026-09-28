import { isWithinEffectiveWindow } from './permission-window.mjs';

const authorizationText = (value) => (value == null ? '' : String(value).trim());
const active = (row) => authorizationText(row?.trang_thai).toUpperCase() === 'ACTIVE';

const denied = () => ({ allowed: false, denial_code: 'USER_NOT_AUTHORIZED', permission_code: null, branch_id: null, role_codes: [] });

function eligibleAssignments({ actorUserId, permissionCode, tables, now, topic = null }) {
  const userId = authorizationText(actorUserId);
  const topicBranch = authorizationText(topic?.branch_id);
  const permissions = new Set((tables?.CONFIG_PERMISSION ?? []).filter(active).map((row) => authorizationText(row.permission_code)));
  if (!permissions.has(authorizationText(permissionCode))) return [];
  const roles = new Set((tables?.CONFIG_ROLE ?? []).filter(active).map((row) => authorizationText(row.role_code)));
  const mappings = (tables?.CONFIG_ROLE_PERMISSION ?? []).filter((row) => active(row) && authorizationText(row.permission_code) === authorizationText(permissionCode));
  return (tables?.CONFIG_USER_ROLE ?? [])
    .filter((row) => active(row) && authorizationText(row.user_id) === userId && isWithinEffectiveWindow(row, now))
    .filter((row) => (authorizationText(row.branch_id) === '*' || !topic || authorizationText(row.branch_id) === topicBranch) && roles.has(authorizationText(row.role_code)))
    .filter((row) => mappings.some((mapping) => authorizationText(mapping.role_code) === authorizationText(row.role_code)));
}

export function authorizeCommand({ actorUserId, command, topic = null, tables, now = new Date().toISOString() } = {}) {
  const userId = authorizationText(actorUserId);
  const user = (tables?.CONFIG_USER ?? []).find((row) => authorizationText(row.user_id) === userId);
  if (!user || !active(user)) return denied();
  const commandText = authorizationText(command).toLowerCase();
  if (commandText === '/trangthai') {
    return { allowed: true, denial_code: null, permission_code: null, branch_id: authorizationText(user.branch_id) || null, role_codes: [] };
  }
  const commandRow = (tables?.CONFIG_LENH ?? []).find((row) => active(row) && authorizationText(row.command_text).toLowerCase() === commandText);
  if (!commandRow) return denied();
  const permissionCode = authorizationText(commandRow.permission_code);
  if (!permissionCode) {
    if (!['/help', '/trangthai'].includes(commandText)) return denied();
    return { allowed: true, denial_code: null, permission_code: null, branch_id: authorizationText(topic?.branch_id) || authorizationText(user.branch_id) || null, role_codes: [] };
  }
  if (!topic || !active(topic)) return denied();
  const topicBranch = authorizationText(topic.branch_id);
  const eligible = eligibleAssignments({ actorUserId: userId, permissionCode, tables, now, topic });
  if (eligible.length === 0) return denied();
  return {
    allowed: true,
    denial_code: null,
    permission_code: permissionCode,
    branch_id: topicBranch,
    role_codes: [...new Set(eligible.map((row) => authorizationText(row.role_code)))],
  };
}

export function hasPermission({ actorUserId, permissionCode, tables, now, topic = null } = {}) {
  const userId = authorizationText(actorUserId);
  const user = (tables?.CONFIG_USER ?? []).find((row) => authorizationText(row.user_id) === userId);
  if (!user || !active(user)) return false;
  return eligibleAssignments({ actorUserId: userId, permissionCode, tables, now, topic }).length > 0;
}
