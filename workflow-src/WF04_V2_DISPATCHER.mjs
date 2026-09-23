import { sourceFile, codeNode } from './helpers.mjs';

export async function dispatcherCode() {
  return codeNode(`
${await sourceFile('src/dispatcher/decide-dispatch.mjs')}
const gateway = $('Call Config Gateway').first()?.json ?? {};
const tables = gateway.response?.data?.config_tables ?? {};
const readRows = (name) => {
  try { return $items('Read ' + name).map((item) => item.json).filter((row) => row && Object.keys(row).length > 0); } catch { return []; }
};
const now = new Date().toISOString();
const heartbeatRows = readRows('HEARTBEAT').sort((left, right) => String(left.heartbeat_at || '').localeCompare(String(right.heartbeat_at || '')));
const threshold = (tables.CONFIG_GLOBAL || []).find((row) => String(row.config_key || '').trim() === 'DISPATCHER_HEARTBEAT_THRESHOLD')?.config_value || null;
const heartbeat = recordHeartbeat({ now, previous: heartbeatRows.at(-1) || {}, failure: gateway.ok !== true, threshold });
const plan = planDispatch({
  now,
  schedules: tables.CONFIG_LICH || [],
  branches: tables.CONFIG_BRANCH || [],
  history: readRows('DISPATCH_HISTORY'),
  activeSessions: readRows('PHIEN_KIEM_KE'),
  configSnapshotId: gateway.response?.config_snapshot_id || null,
});
const heartbeatItem = { kind: 'HEARTBEAT', heartbeat_id: 'dispatcher-' + now, ...heartbeat };
return [heartbeatItem, ...plan.actions.map((action) => ({ ...action, heartbeat_id: heartbeatItem.heartbeat_id }))].map((json) => ({ json }));
`);
}
