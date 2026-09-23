import { sourceFile, codeNode } from './helpers.mjs';

export async function dispatcherCode() {
  return codeNode(`
${await sourceFile('src/dispatcher/decide-dispatch.mjs')}
${await sourceFile('src/dispatcher/claim-dispatch.mjs')}
const gateway = $('Call Config Gateway').first()?.json ?? {};
const tables = gateway.response?.data?.config_tables ?? {};
const readRows = (name) => {
  try { return $items('Read ' + name).map((item) => item.json).filter((row) => row && Object.keys(row).length > 0); } catch { return []; }
};
const now = new Date().toISOString();
const executionId = typeof $execution !== 'undefined' && $execution.id ? String($execution.id) : now.replace(/[^0-9]/g, '');
const requestEnvelope = $('Prepare Dispatcher Gateway Request').first()?.json?.envelope ?? {};
const claimToken = 'claim-' + executionId;
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
const actions = plan.actions.map((action) => {
  if (action.kind !== 'DISPATCH') return { ...action, heartbeat_id: heartbeatItem.heartbeat_id };
  return {
    ...prepareDispatchClaim({ action, claimToken, requestId: requestEnvelope.request_id }),
    heartbeat_id: heartbeatItem.heartbeat_id,
  };
});
return [heartbeatItem, ...actions].map((json) => ({ json }));
`);
}

export async function verifyClaimCode() {
  return codeNode(`
${await sourceFile('src/dispatcher/claim-dispatch.mjs')}
const action = $('Claim DISPATCH_HISTORY').first()?.json ?? {};
const rows = (() => {
  try { return $items('Read DISPATCH_HISTORY after claim').map((item) => item.json).filter((row) => row && Object.keys(row).length > 0); }
  catch { return []; }
})();
const persistedRow = rows.filter((row) => String(row.dispatch_key || '') === String(action.dispatch_key || '')).at(-1) || {};
if (!verifyDispatchClaim({ action, persistedRow })) return [];
return [{ json: { ...action, claim_verified: true } }];
`);
}

export async function workerFailureCode() {
  return codeNode(`
${await sourceFile('src/dispatcher/worker-failure.mjs')}
${await sourceFile('src/dispatcher/notifications.mjs')}
const worker = $input.first()?.json ?? {};
const action = $('Verify persisted dispatch claim').first()?.json ?? {};
const gateway = $('Call Config Gateway').first()?.json ?? {};
const envelope = buildWorkerFailureEnvelope({ action, worker, now: new Date().toISOString() });
if (!envelope) return [];
const configGlobal = gateway.response?.data?.config_tables?.CONFIG_GLOBAL || [];
return [{ json: { ...envelope, messages: gateway.response?.messages || {}, reply_target: dispatcherNotificationTarget({ configGlobal }) } }];
`);
}

export async function dispatcherNoticeCode() {
  return codeNode(`
${await sourceFile('src/dispatcher/notifications.mjs')}
const input = $input.first()?.json ?? {};
const gateway = $('Call Config Gateway').first()?.json ?? {};
const tables = gateway.response?.data?.config_tables ?? {};
const source = input.notice_code
  ? input
  : (() => {
      try { return $items('Decide Dispatcher Actions').map((item) => item.json).find((row) => row.notice); }
      catch { return input; }
    })();
const action = source.notice_code
  ? source
  : { ...source, notice_code: 'DISPATCHER_' + String(source.notice || '').toUpperCase(), operation_id: source.heartbeat_id, request_id: source.heartbeat_id };
const notice = buildDispatchNotice({
  action,
  configGlobal: tables.CONFIG_GLOBAL || [],
  messages: gateway.response?.messages || {},
  configVersion: gateway.response?.config_version || null,
});
return notice ? [{ json: notice }] : [];
`);
}
