const asText = (value) => (value == null ? '' : String(value).trim());
const active = (row) => asText(row?.trang_thai).toUpperCase() === 'ACTIVE';

function withinEffectiveWindow(row, now) {
  const current = Date.parse(now);
  const from = asText(row.effective_from);
  const to = asText(row.effective_to);
  if (from && Number.isNaN(Date.parse(from))) return false;
  if (to && Number.isNaN(Date.parse(to))) return false;
  if ((from || to) && Number.isNaN(current)) return false;
  return (!from || current >= Date.parse(from))
    && (!to || current <= Date.parse(to));
}

const denied = () => ({ allowed: false, denial_code: 'USER_NOT_AUTHORIZED', permission_code: null, branch_id: null, role_codes: [] });

export function authorizeCommand({ actorUserId, command, topic = null, tables, now = new Date().toISOString() } = {}) {
  const userId = asText(actorUserId);
  const user = (tables?.CONFIG_USER ?? []).find((row) => asText(row.user_id) === userId);
  if (!user || !active(user)) return denied();
  const commandText = asText(command).toLowerCase();
  if (commandText === '/trangthai') {
    return { allowed: true, denial_code: null, permission_code: null, branch_id: asText(user.branch_id) || null, role_codes: [] };
  }
  const commandRow = (tables?.CONFIG_LENH ?? []).find((row) => active(row) && asText(row.command_text).toLowerCase() === commandText);
  if (!commandRow) return denied();
  const permissionCode = asText(commandRow.permission_code);
  if (!permissionCode) {
    if (!['/help', '/trangthai'].includes(commandText)) return denied();
    return { allowed: true, denial_code: null, permission_code: null, branch_id: asText(topic?.branch_id) || asText(user.branch_id) || null, role_codes: [] };
  }
  if (!topic || !active(topic)) return denied();
  const topicBranch = asText(topic.branch_id);
  const permissions = new Set((tables?.CONFIG_PERMISSION ?? []).filter(active).map((row) => asText(row.permission_code)));
  if (!permissions.has(permissionCode)) return denied();
  const roles = new Set((tables?.CONFIG_ROLE ?? []).filter(active).map((row) => asText(row.role_code)));
  const rolePermissions = (tables?.CONFIG_ROLE_PERMISSION ?? []).filter((row) => active(row) && asText(row.permission_code) === permissionCode);
  const eligible = (tables?.CONFIG_USER_ROLE ?? [])
    .filter((row) => active(row) && asText(row.user_id) === userId && withinEffectiveWindow(row, now))
    .filter((row) => (asText(row.branch_id) === '*' || asText(row.branch_id) === topicBranch) && roles.has(asText(row.role_code)))
    .filter((row) => rolePermissions.some((mapping) => asText(mapping.role_code) === asText(row.role_code)));
  if (eligible.length === 0) return denied();
  return {
    allowed: true,
    denial_code: null,
    permission_code: permissionCode,
    branch_id: topicBranch,
    role_codes: [...new Set(eligible.map((row) => asText(row.role_code)))],
  };
}

export function hasPermission({ actorUserId, permissionCode, tables, now, topic = null } = {}) {
  const userId = asText(actorUserId);
  const user = (tables?.CONFIG_USER ?? []).find((row) => asText(row.user_id) === userId);
  if (!user || !active(user)) return false;
  const permissions = new Set((tables?.CONFIG_PERMISSION ?? []).filter(active).map((row) => asText(row.permission_code)));
  if (!permissions.has(asText(permissionCode))) return false;
  const roles = new Set((tables?.CONFIG_ROLE ?? []).filter(active).map((row) => asText(row.role_code)));
  const mapping = (tables?.CONFIG_ROLE_PERMISSION ?? []).filter((row) => active(row) && asText(row.permission_code) === asText(permissionCode));
  return (tables?.CONFIG_USER_ROLE ?? [])
    .filter((row) => active(row) && asText(row.user_id) === userId && withinEffectiveWindow(row, now))
    .filter((row) => asText(row.branch_id) === '*' || !topic || asText(row.branch_id) === asText(topic.branch_id))
    .some((row) => roles.has(asText(row.role_code)) && mapping.some((entry) => asText(entry.role_code) === asText(row.role_code)));
}

export function hasRole({ actorUserId, roleCode, tables, now, branchId = '*' } = {}) {
  const userId = asText(actorUserId);
  const requestedRole = asText(roleCode);
  const user = (tables?.CONFIG_USER ?? []).find((row) => asText(row.user_id) === userId);
  if (!user || !active(user) || !requestedRole) return false;
  const roles = new Set((tables?.CONFIG_ROLE ?? []).filter(active).map((row) => asText(row.role_code)));
  return roles.has(requestedRole) && (tables?.CONFIG_USER_ROLE ?? []).some((row) => active(row)
    && asText(row.user_id) === userId
    && asText(row.role_code) === requestedRole
    && asText(row.branch_id) === asText(branchId)
    && withinEffectiveWindow(row, now));
}
