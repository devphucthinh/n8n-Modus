import { sha256 } from '../config-gateway/sha256.mjs';

const heartbeatText = (value) => (value == null ? '' : String(value).trim());
const FAILED_STATUSES = new Set(['FAILED', 'ERROR']);

function parseHeartbeatInstant(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('DISPATCH_TIME_INVALID:tickAt');
  return date;
}

function heartbeatIdentity(tickAt) {
  const date = parseHeartbeatInstant(tickAt);
  date.setUTCSeconds(0, 0);
  date.setUTCMinutes(Math.floor(date.getUTCMinutes() / 10) * 10);
  const tickKey = date.toISOString();
  const heartbeatKey = `heartbeat:${tickKey}`;
  return {
    tick_key: tickKey,
    dispatch_key: heartbeatKey,
    operation_id: `op-heartbeat-${sha256(heartbeatKey).slice(0, 32)}`,
  };
}

function orderedHeartbeatRows(rows) {
  return [...(Array.isArray(rows) ? rows : [])]
    .filter((row) => heartbeatText(row?.record_type).toUpperCase() === 'HEARTBEAT' || heartbeatText(row?.dispatch_key).startsWith('heartbeat:'))
    .sort((left, right) => heartbeatText(left.updated_at || left.created_at).localeCompare(heartbeatText(right.updated_at || right.created_at)));
}

function trailingFailures(rows) {
  let failures = 0;
  for (const row of [...rows].reverse()) {
    if (!FAILED_STATUSES.has(heartbeatText(row.status).toUpperCase())) break;
    failures += 1;
  }
  return failures;
}

function historyId(identity) {
  return `dispatch-history-${sha256(`${identity.dispatch_key}|heartbeat`).slice(0, 24)}`;
}

export function decideHeartbeat({ heartbeatRows = [], tickAt, success, failureThreshold } = {}) {
  const threshold = Number(failureThreshold);
  if (!Number.isSafeInteger(threshold) || threshold < 1) throw new Error('DISPATCH_HEARTBEAT_THRESHOLD_INVALID');
  if (typeof success !== 'boolean') throw new TypeError('DISPATCH_HEARTBEAT_RESULT_REQUIRED');

  const identity = heartbeatIdentity(tickAt);
  const rows = orderedHeartbeatRows(heartbeatRows);
  const duplicate = rows.find((row) => heartbeatText(row.dispatch_key) === identity.dispatch_key);
  if (duplicate) {
    return {
      action: 'SKIP',
      reason: 'HEARTBEAT_ALREADY_RECORDED',
      ...identity,
      status: heartbeatText(duplicate.status).toUpperCase(),
      consecutive_failures: Number(heartbeatText(duplicate.failure_count)) || 0,
      critical_alert: false,
      recovery_alert: false,
      alert_state: heartbeatText(duplicate.alert_state).toUpperCase() || 'HEALTHY',
      history_row: duplicate,
    };
  }

  const priorFailures = trailingFailures(rows);
  const previous = rows.at(-1);
  const previousWasCritical = heartbeatText(previous?.alert_state).toUpperCase() === 'CRITICAL' || priorFailures >= threshold;
  const consecutiveFailures = success ? 0 : priorFailures + 1;
  const criticalAlert = !success && consecutiveFailures >= threshold && priorFailures < threshold;
  const recoveryAlert = success && previousWasCritical;
  const alertState = success ? 'HEALTHY' : consecutiveFailures >= threshold ? 'CRITICAL' : 'DEGRADED';
  const status = success ? 'SUCCEEDED' : 'FAILED';
  const now = parseHeartbeatInstant(tickAt).toISOString();
  const historyRow = {
    history_id: historyId(identity),
    record_type: 'HEARTBEAT',
    dispatch_key: identity.dispatch_key,
    operation_id: identity.operation_id,
    schedule_id: '',
    job_code: 'DISPATCH_HEARTBEAT',
    worker_workflow: 'WF04_V2_DISPATCHER',
    branch_id: '*',
    occurrence_date: now.slice(0, 10),
    scheduled_at_local: '',
    status,
    attempt_number: '1',
    retryable: success ? '' : 'YES',
    failure_count: String(consecutiveFailures),
    error_code: success ? '' : 'DISPATCH_TICK_FAILED',
    error_id: '',
    heartbeat_failure_count: String(consecutiveFailures),
    alert_state: alertState,
    critical_alert: criticalAlert ? 'YES' : '',
    recovery_alert: recoveryAlert ? 'YES' : '',
    created_at: now,
    updated_at: now,
  };

  return {
    action: 'RECORD',
    reason: success ? (recoveryAlert ? 'RECOVERY' : 'HEALTHY') : criticalAlert ? 'CRITICAL_THRESHOLD_REACHED' : 'FAILURE',
    ...identity,
    status,
    consecutive_failures: consecutiveFailures,
    critical_alert: criticalAlert,
    recovery_alert: recoveryAlert,
    alert_state: alertState,
    history_row: historyRow,
  };
}
