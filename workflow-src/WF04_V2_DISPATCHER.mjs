import { sourceFile, codeNode } from './helpers.mjs';

export async function dispatcherCode() {
  return codeNode(`
${await sourceFile('src/contracts/core-sheet-schema.mjs')}
${await sourceFile('src/contracts/validate-ledger-schema.mjs')}
${await sourceFile('src/dispatcher/heartbeat-settings.mjs')}
${await sourceFile('src/dispatcher/decide-dispatch.mjs')}
${await sourceFile('src/dispatcher/claim-dispatch.mjs')}
${await sourceFile('src/dispatcher/notifications.mjs')}
${await sourceFile('src/dispatcher/ledger-read-policy.mjs')}
${await sourceFile('src/dispatcher/gateway-failure-heartbeat.mjs')}
const gateway = $('Call Config Gateway').first()?.json ?? {};
const tables = gateway.response?.data?.config_tables ?? {};
const readRows = (name) => {
  try { return $items('Read ' + name).map((item) => item.json).filter((row) => row && Object.keys(row).length > 0); } catch { return null; }
};
const now = new Date().toISOString();
const attempt = $('Prepare Dispatcher Gateway Request').first()?.json ?? {};
const claimToken = String(attempt.claim_token || '');
const heartbeatId = String(attempt.heartbeat_id || '');
if (!String(attempt.dispatcher_attempt_id || '') || !claimToken || !heartbeatId) throw new Error('DISPATCHER_ATTEMPT_ID_MISSING');
const claimLeaseMinutes = (tables.CONFIG_GLOBAL || []).find((row) => String(row.config_key || '').trim() === 'DISPATCH_CLAIM_LEASE_MINUTES' && String(row.trang_thai || '').trim().toUpperCase() === 'ACTIVE')?.config_value;
const gatewayReady = gateway.ok === true && Boolean(String(gateway.response?.config_snapshot_id || '').trim());
const currentHeartbeatSettings = gatewayReady ? validateDispatcherHeartbeatSettings(tables.CONFIG_GLOBAL || []) : null;
const threshold = currentHeartbeatSettings?.ok ? currentHeartbeatSettings.threshold : null;
const workflowReadNode = {
  HEARTBEAT: 'HEARTBEAT',
  DISPATCH_HISTORY: 'DISPATCH_HISTORY',
  PHIEN_KIEM_KE: 'PHIEN_KIEM_KE',
  OPERATION: 'OPERATION for dispatcher',
};
const ledgers = readDispatcherLedgers({
  gatewayReady,
  heartbeatSettingsValid: currentHeartbeatSettings?.ok === true,
  heartbeatRowsValid: (rows) => validateLedgerRows({ tables: { HEARTBEAT: rows }, requiredSheets: ['HEARTBEAT'] }).ok
    && validateHeartbeatRows(rows).ok,
  readLedger: (sheetName) => readRows(workflowReadNode[sheetName]),
});
const heartbeatLedger = ledgers.HEARTBEAT;
const gatewayErrorCode = String(gateway.response?.error_code || gateway.error_code || gateway.diagnostics?.error_code || '');
if (!gatewayReady) {
  return [{ json: planGatewayFailureHeartbeat({
    rows: heartbeatLedger,
    heartbeatId,
    now,
    gatewayErrorCode,
  }) }];
}
const heartbeatValidation = validateLedgerRows({ tables: { HEARTBEAT: heartbeatLedger }, requiredSheets: ['HEARTBEAT'] });
if (!heartbeatValidation.ok) return [{ json: { kind: 'SCHEMA_REJECTED', status: 'ERROR', ...heartbeatValidation, write_plan: [] } }];
const heartbeatValuesValidation = validateHeartbeatRows(heartbeatLedger);
if (!heartbeatValuesValidation.ok) return [{ json: { kind: 'SCHEMA_REJECTED', status: 'ERROR', ...heartbeatValuesValidation, write_plan: [] } }];
if (gatewayReady && !currentHeartbeatSettings?.ok) return [{ json: {
  kind: 'SCHEMA_REJECTED', status: 'ERROR', ok: false, ...currentHeartbeatSettings, write_plan: [],
} }];
const previousHeartbeat = latestHeartbeat(heartbeatLedger) || {};
const history = ledgers.DISPATCH_HISTORY ?? null;
const sessions = ledgers.PHIEN_KIEM_KE ?? null;
const operations = ledgers.OPERATION ?? null;
if (gatewayReady) {
  const validation = validateLedgerSchema({
    schemaRows: tables.CONFIG_SCHEMA,
    tables: { DISPATCH_HISTORY: history, PHIEN_KIEM_KE: sessions, OPERATION: operations, HEARTBEAT: heartbeatLedger, EVENT_LOG: tables.EVENT_LOG },
    requiredSheets: ['DISPATCH_HISTORY', 'PHIEN_KIEM_KE', 'OPERATION', 'HEARTBEAT', 'EVENT_LOG'],
  });
  if (!validation.ok) return [{ json: { kind: 'SCHEMA_REJECTED', status: 'ERROR', ...validation, write_plan: [] } }];
}
const notificationTarget = gatewayReady ? currentHeartbeatSettings.notificationTarget : null;
const plan = planDispatch({
  now,
  schedules: tables.CONFIG_LICH || [],
  branches: tables.CONFIG_BRANCH || [],
  history,
  activeSessions: sessions,
  operations,
  configSnapshotId: gateway.response?.config_snapshot_id || null,
  claimLeaseMinutes,
});
if (plan.error_code) return [{ json: { kind: 'SCHEMA_REJECTED', status: 'ERROR', ok: false, error_code: plan.error_code, sheet_name: plan.sheet_name, column_name: plan.column_name, write_plan: [] } }];
const heartbeat = recordHeartbeat({
  now,
  previous: previousHeartbeat,
  failure: false,
  threshold,
  notificationTarget,
});
const heartbeatItem = {
  kind: 'HEARTBEAT',
  heartbeat_id: heartbeatId,
  ...heartbeat,
  diagnostic_code: heartbeat.diagnostic_code,
};
const actions = plan.actions.map((action) => {
  if (action.kind !== 'DISPATCH') return { ...action, heartbeat_id: heartbeatItem.heartbeat_id };
  return {
    ...prepareDispatchClaim({ action, claimToken }),
    heartbeat_id: heartbeatItem.heartbeat_id,
  };
});
return (actions.some((action) => action.kind === 'DISPATCH') ? actions : [heartbeatItem, ...actions]).map((json) => ({ json }));
`);
}

export async function validateCurrentHeartbeatSettingsCode() {
  return codeNode(`
${await sourceFile('src/dispatcher/heartbeat-settings.mjs')}
const gateway = $('Call Config Gateway').first()?.json ?? {};
const gatewayReady = gateway.ok === true && Boolean(String(gateway.response?.config_snapshot_id || '').trim());
if (!gatewayReady) return [{ json: {
  kind: 'SCHEMA_REJECTED', status: 'ERROR', ok: false,
  error_code: 'CONFIG_GATEWAY_UNAVAILABLE', sheet_name: 'CONFIG_GLOBAL', column_name: null, write_plan: [],
} }];
const tables = gateway.response?.data?.config_tables ?? {};
const settings = validateDispatcherHeartbeatSettings(tables.CONFIG_GLOBAL || []);
return [{ json: settings.ok
  ? { kind: 'HEARTBEAT_CONFIG_VALID' }
  : { kind: 'SCHEMA_REJECTED', status: 'ERROR', ...settings, write_plan: [] } }];
`);
}

export async function postWorkerHeartbeatCode() {
  return codeNode(`
${await sourceFile('src/dispatcher/heartbeat-settings.mjs')}
${await sourceFile('src/dispatcher/decide-dispatch.mjs')}
${await sourceFile('src/dispatcher/notifications.mjs')}
const outcomes = $input.all().map((item) => item.json);
const failed = outcomes.find((outcome) => outcome.status !== 'SUCCESS');
const gateway = $('Call Config Gateway').first()?.json ?? {};
const tables = gateway.response?.data?.config_tables ?? {};
const globals = tables.CONFIG_GLOBAL || [];
const threshold = globals.find((row) => String(row.config_key || '').trim() === 'DISPATCHER_HEARTBEAT_THRESHOLD' && String(row.trang_thai || '').trim().toUpperCase() === 'ACTIVE')?.config_value || null;
const previousRows = (() => { try { return $items('Read HEARTBEAT').map((item) => item.json).filter((row) => row && Object.keys(row).length > 0); } catch { return []; } })();
const previous = latestHeartbeat(previousRows) || {};
const notificationTarget = dispatcherNotificationTarget({ configGlobal: globals });
const now = new Date().toISOString();
const heartbeat = recordHeartbeat({ now, previous, failure: outcomes.length === 0 || !!failed, threshold, notificationTarget });
const heartbeatId = String($('Prepare Dispatcher Gateway Request').first()?.json?.heartbeat_id || '');
if (!heartbeatId) throw new Error('DISPATCHER_ATTEMPT_ID_MISSING');
return [{json: {kind: 'HEARTBEAT', heartbeat_id: heartbeatId, dispatch_key: failed?.dispatch_key || '', ...heartbeat}}];
`);
}

export async function verifyClaimCode() {
  return codeNode(`
${await sourceFile('src/dispatcher/claim-dispatch.mjs')}
const actions = $('Dispatch action?').all(0).map((item) => item.json);
const rows = (() => {
  try { return $items('Read DISPATCH_HISTORY after claim').map((item) => item.json).filter((row) => row && Object.keys(row).length > 0); }
  catch { return []; }
})();
return actions.map((action) => {
  const matches = rows.filter((row) => String(row.dispatch_key || '') === String(action.dispatch_key || ''));
  if (matches.length !== 1 || !verifyDispatchClaim({ action, persistedRow: matches[0] })
    || !action.operation_id || !action.request_id || !action.branch_id || !action.business_date || !action.config_snapshot_id) {
    return { json: { ...action, claim_verified: false, ok: false, error_code: 'DISPATCH_CLAIM_LOST' } };
  }
  const envelope = {
    request_id: String(action.request_id), operation_id: String(action.operation_id),
    event_type: 'SCHEDULED_JOB', actor_user_id: 'SYSTEM',
    branch_id: String(action.branch_id), business_date: String(action.business_date),
    config_version: null,
    payload: { dispatch_key: String(action.dispatch_key), idempotency_key: String(action.dispatch_key), config_snapshot_id: String(action.config_snapshot_id) },
  };
  return { json: { ...action, envelope, claim_verified: true } };
});
`);
}

export async function verifyRunningClaimCode() {
  return codeNode(`
${await sourceFile('src/dispatcher/claim-dispatch.mjs')}
const action = $('Loop Due Dispatches').itemMatching(0)?.json ?? {};
const rows = $input.all().map((item) => item.json).filter((row) => row && Object.keys(row).length > 0);
const matches = rows.filter((row) => String(row.dispatch_key || '') === String(action.dispatch_key || ''));
const verified = matches.length === 1 && verifyDispatchClaim({ action, persistedRow: matches[0] })
  && String(matches[0].status || '').toUpperCase() === 'RUNNING';
return [{ json: verified
  ? { ...action, running_verified: true }
  : { ...action, running_verified: false, ok: false, error_code: 'DISPATCH_RUNNING_CLAIM_LOST' } }];
`);
}

export async function rejectedClaimOutcomeCode() {
  return codeNode(`
const action = $input.first()?.json ?? {};
return [{ json: { ...action, ok: false, status: 'RECONCILIATION_REQUIRED', last_error_code: action.error_code || 'DISPATCH_CLAIM_LOST' } }];
`);
}

export async function workerFailureCode() {
  return codeNode(`
${await sourceFile('src/dispatcher/worker-failure.mjs')}
${await sourceFile('src/dispatcher/notifications.mjs')}
const worker = $input.first()?.json ?? {};
const action = $('Verify RUNNING claim').itemMatching(0)?.json ?? {};
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
const source = input;
if (!source.notice_code && !source.notice) return [];
const action = source.notice_code
  ? source
  : { ...source, notice_code: 'DISPATCHER_' + String(source.notice || '').toUpperCase(), operation_id: source.heartbeat_id, request_id: source.heartbeat_id };
const persistedTarget = source.alert_chat_id && source.alert_thread_id ? [
  { config_key: 'DISPATCHER_NOTIFICATION_CHAT_ID', config_value: source.alert_chat_id, trang_thai: 'ACTIVE' },
  { config_key: 'DISPATCHER_NOTIFICATION_THREAD_ID', config_value: source.alert_thread_id, trang_thai: 'ACTIVE' },
] : [];
const notice = buildDispatchNotice({
  action,
  configGlobal: persistedTarget.length ? persistedTarget : (tables.CONFIG_GLOBAL || []),
  messages: gateway.response?.messages || {},
  configVersion: gateway.response?.config_version || null,
});
return notice ? [{ json: notice }] : [];
`);
}
