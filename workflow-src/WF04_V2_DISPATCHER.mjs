import { sourceFile, codeNode } from './helpers.mjs';

export async function dispatcherCode() {
  return codeNode(`
${await sourceFile('src/config-gateway/sha256.mjs')}
${await sourceFile('src/dispatcher/parse-schedule.mjs')}
${await sourceFile('src/dispatcher/heartbeat.mjs')}
${await sourceFile('src/dispatcher/decide-dispatch.mjs')}

const gateway = $('Call Config Gateway').first()?.json ?? {};
const trigger = $('Create Dispatcher Envelope').first()?.json?.envelope ?? {};
const historyRows = $items('Read DISPATCH_HISTORY')
  .map((item) => item.json)
  .filter((row) => row && Object.keys(row).length > 0);
const tables = gateway.response?.data?.dispatcher_tables
  ?? gateway.data?.dispatcher_tables
  ?? trigger.payload?.dispatcher_tables
  ?? {};
const scheduleRows = tables.CONFIG_LICH ?? [];
const branchRows = tables.CONFIG_BRANCH ?? [];
const globalRows = tables.CONFIG_GLOBAL ?? [];
const thresholdRow = globalRows.find((row) => String(row.config_key ?? '').trim() === 'DISPATCH_HEARTBEAT_FAILURE_THRESHOLD');
const failureThreshold = Number(thresholdRow?.config_value);
const defaultTimezone = globalRows.find((row) => String(row.config_key ?? '').trim() === 'DEFAULT_TIMEZONE')?.config_value ?? '';
const configVersion = gateway.response?.config_version ?? gateway.config_version ?? trigger.config_version ?? '';
const tickAt = trigger.payload?.tick_at ?? new Date().toISOString();

if (gateway.ok === false) {
  return [{ json: {
    ok: false,
    status: 'ERROR',
    error_code: gateway.response?.error_code ?? 'CONFIG_GATEWAY_UNAVAILABLE',
    request_id: trigger.request_id ?? '',
    operation_id: trigger.operation_id ?? '',
    dispatches: [],
    warnings: [],
  } }];
}
if (!Array.isArray(scheduleRows) || !Array.isArray(branchRows) || !Number.isSafeInteger(failureThreshold) || failureThreshold < 1) {
  return [{ json: {
    ok: false,
    status: 'ERROR',
    error_code: 'DISPATCHER_CONFIG_SNAPSHOT_INCOMPLETE',
    message_safe: 'Dispatcher configuration snapshot does not expose CONFIG_LICH, CONFIG_BRANCH and heartbeat threshold',
    request_id: trigger.request_id ?? '',
    operation_id: trigger.operation_id ?? '',
    dispatches: [],
    warnings: [],
  } }];
}

const plan = buildDispatchPlan({
  scheduleRows,
  branchRows,
  historyRows,
  defaultTimezone,
  now: tickAt,
  requestId: trigger.request_id,
  configVersion,
  heartbeatSuccess: gateway.ok !== false,
  heartbeatFailureThreshold: failureThreshold,
});
return [{ json: plan }];
`);
}
