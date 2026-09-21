import { sha256 } from '../config-gateway/sha256.mjs';
import { buildAtomicClaimRequest } from './atomic-claim.mjs';
import { decideHeartbeat } from './heartbeat.mjs';
import { parseScheduleRows } from './parse-schedule.mjs';

const WEEKDAY_NUMBERS = new Map([
  ['Mon', 1],
  ['Tue', 2],
  ['Wed', 3],
  ['Thu', 4],
  ['Fri', 5],
  ['Sat', 6],
  ['Sun', 7],
]);

const COMPLETED_STATUSES = new Set(['SUCCESS', 'SUCCEEDED', 'COMMITTED', 'COMPLETED', 'DONE']);
const IN_FLIGHT_STATUSES = new Set(['CLAIMED', 'RUNNING', 'DISPATCHED', 'PREPARED']);
const FAILURE_STATUSES = new Set(['FAILED', 'RETRYING']);
const WARNING_STATUSES = new Set(['WARNING', 'WARNED']);

const dispatchText = (value) => (value == null ? '' : String(value).trim());

function parseDispatchInstant(value, label) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`DISPATCH_TIME_INVALID:${label}`);
  return date;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function localParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  const weekday = WEEKDAY_NUMBERS.get(parts.weekday);
  if (!weekday) throw new Error(`DISPATCH_TIMEZONE_WEEKDAY_INVALID:${timezone}`);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday,
    local_date: `${parts.year}-${parts.month}-${parts.day}`,
    local_time: `${parts.hour}:${parts.minute}`,
  };
}

function datePartsFromWallDate(wallDate) {
  const date = new Date(wallDate);
  const dayOfWeek = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: dayOfWeek,
  };
}

function wallDateFor(local, dayOffset = 0) {
  return Date.UTC(local.year, local.month - 1, local.day) - dayOffset * 24 * 60 * 60 * 1000;
}

function wallMinutes(year, month, day, hour, minute) {
  return Date.UTC(year, month - 1, day, hour, minute) / 60000;
}

function occurrenceFor(local, schedule, dateParts, differenceMinutes) {
  const localDate = `${dateParts.year}-${pad(dateParts.month)}-${pad(dateParts.day)}`;
  const localTime = schedule.local_time;
  return {
    local_date: localDate,
    local_time: localTime,
    scheduled_at_local: `${localDate}T${localTime}:00`,
    timezone: schedule.timezone,
    weekday: dateParts.weekday,
    lateness_minutes: Math.max(0, differenceMinutes),
  };
}

function findOccurrence(local, schedule) {
  const currentWallDate = wallDateFor(local);
  const currentDayScheduled = schedule.days_of_week.includes(local.weekday);
  if (currentDayScheduled) {
    const difference = wallMinutes(local.year, local.month, local.day, local.hour, local.minute)
      - wallMinutes(local.year, local.month, local.day, schedule.hour, schedule.minute);
    if (difference < 0) {
      return occurrenceFor(local, schedule, {
        year: local.year,
        month: local.month,
        day: local.day,
        weekday: local.weekday,
      }, difference);
    }
  }

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidateDate = currentWallDate - offset * 24 * 60 * 60 * 1000;
    const dateParts = datePartsFromWallDate(candidateDate);
    if (!schedule.days_of_week.includes(dateParts.weekday)) continue;
    const scheduledWall = wallMinutes(dateParts.year, dateParts.month, dateParts.day, schedule.hour, schedule.minute);
    const nowWall = wallMinutes(local.year, local.month, local.day, local.hour, local.minute);
    const difference = nowWall - scheduledWall;
    if (difference >= 0) return occurrenceFor(local, schedule, dateParts, difference);
  }

  for (let offset = 1; offset <= 7; offset += 1) {
    const candidateDate = currentWallDate + offset * 24 * 60 * 60 * 1000;
    const dateParts = datePartsFromWallDate(candidateDate);
    if (schedule.days_of_week.includes(dateParts.weekday)) return occurrenceFor(local, schedule, dateParts, -1);
  }

  throw new Error(`DISPATCH_OCCURRENCE_NOT_FOUND:${schedule.schedule_id}`);
}

export function evaluateSchedule({ schedule, now } = {}) {
  if (!schedule || typeof schedule !== 'object') throw new TypeError('DISPATCH_SCHEDULE_REQUIRED');
  if (!schedule.enabled) return { phase: 'DISABLED', occurrence: null, lateness_minutes: null };
  const instant = parseDispatchInstant(now, 'now');
  const local = localParts(instant, schedule.timezone);
  const occurrence = findOccurrence(local, schedule);
  const nowWall = wallMinutes(local.year, local.month, local.day, local.hour, local.minute);
  const scheduledParts = occurrence.scheduled_at_local.slice(0, 16).split(/[T:-]/).map(Number);
  const scheduledWall = wallMinutes(scheduledParts[0], scheduledParts[1], scheduledParts[2], scheduledParts[3], scheduledParts[4]);
  const difference = nowWall - scheduledWall;
  const phase = difference < 0
    ? 'NOT_DUE'
    : difference === 0
      ? 'DUE'
      : difference <= schedule.grace_minutes
        ? 'CATCH_UP'
        : 'OUTSIDE_WINDOW';
  return {
    phase,
    occurrence: { ...occurrence, lateness_minutes: Math.max(0, difference) },
    lateness_minutes: Math.max(0, difference),
  };
}

export function dispatchIdentity({ schedule, occurrence } = {}) {
  if (!schedule?.schedule_id || !schedule?.branch_id || !occurrence?.local_date || !occurrence?.local_time) {
    throw new Error('DISPATCH_IDENTITY_INPUT_INVALID');
  }
  const dispatch_key = `dispatch:${schedule.schedule_id}:${schedule.branch_id}:${occurrence.local_date}:${occurrence.local_time}`;
  return {
    dispatch_key,
    operation_id: `op-dispatch-${sha256(dispatch_key).slice(0, 32)}`,
  };
}

function parseAttempt(row) {
  const parsed = Number(dispatchText(row?.attempt_number));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function isYes(value) {
  return ['YES', 'TRUE', '1', 'Y'].includes(dispatchText(value).toUpperCase());
}

function sortHistory(rows) {
  return [...rows].sort((left, right) => {
    const leftTime = dispatchText(left.updated_at || left.created_at);
    const rightTime = dispatchText(right.updated_at || right.created_at);
    return leftTime.localeCompare(rightTime) || parseAttempt(left) - parseAttempt(right);
  });
}

function historyForKey(historyRows, dispatchKey) {
  return sortHistory((Array.isArray(historyRows) ? historyRows : [])
    .filter((row) => dispatchText(row?.dispatch_key) === dispatchKey && dispatchText(row?.record_type).toUpperCase() !== 'HEARTBEAT'));
}

function rowId(identity, status, attempt) {
  return `dispatch-history-${sha256(`${identity.dispatch_key}|${status}|${attempt}`).slice(0, 24)}`;
}

function historyRow({ identity, schedule, occurrence, status, attempt, now, retryable = '', errorCode = '' }) {
  return {
    history_id: rowId(identity, status, attempt),
    record_type: 'JOB',
    dispatch_key: identity.dispatch_key,
    operation_id: identity.operation_id,
    schedule_id: schedule.schedule_id,
    job_code: schedule.job_code,
    worker_workflow: schedule.worker_workflow,
    branch_id: schedule.branch_id,
    occurrence_date: occurrence.local_date,
    scheduled_at_local: occurrence.scheduled_at_local,
    status,
    attempt_number: String(attempt),
    retryable,
    failure_count: '',
    error_code: errorCode,
    error_id: '',
    heartbeat_failure_count: '',
    alert_state: '',
    critical_alert: '',
    recovery_alert: '',
    created_at: now,
    updated_at: now,
  };
}

function workerEnvelope({ identity, schedule, occurrence, requestId, configVersion, configSnapshotId, attempt }) {
  const request = dispatchText(requestId);
  const version = dispatchText(configVersion);
  if (!request) throw new Error('DISPATCH_REQUEST_ID_REQUIRED');
  if (!version) throw new Error('DISPATCH_CONFIG_VERSION_REQUIRED');
  return {
    request_id: request,
    operation_id: identity.operation_id,
    event_type: 'SCHEDULED_JOB',
    branch_id: schedule.branch_id,
    actor_user_id: 'SYSTEM',
    business_date: occurrence.local_date,
    config_version: version,
    config_snapshot_id: dispatchText(configSnapshotId) || null,
    payload: {
      dispatch_key: identity.dispatch_key,
      schedule_id: schedule.schedule_id,
      job_code: schedule.job_code,
      worker_workflow: schedule.worker_workflow,
      timezone: schedule.timezone,
      scheduled_at_local: occurrence.scheduled_at_local,
      attempt_number: attempt,
    },
  };
}

function skipResult({ phase, reason, occurrence, identity }) {
  return {
    action: 'SKIP',
    reason,
    phase,
    occurrence,
    ...(identity ? identity : {}),
  };
}

export function decideDispatch({
  schedule,
  now,
  historyRows = [],
  requestId,
  configVersion,
  configSnapshotId,
} = {}) {
  if (!schedule || typeof schedule !== 'object') throw new TypeError('DISPATCH_SCHEDULE_REQUIRED');
  const nowInstant = parseDispatchInstant(now, 'now').toISOString();
  if (!schedule.enabled) return { action: 'SKIP', reason: schedule.schedule_enabled ? 'BRANCH_INACTIVE' : 'DISABLED', phase: 'DISABLED' };

  const evaluated = evaluateSchedule({ schedule, now: nowInstant });
  const identity = dispatchIdentity({ schedule, occurrence: evaluated.occurrence });
  if (evaluated.phase === 'NOT_DUE') return skipResult({ ...evaluated, identity, reason: 'NOT_DUE' });

  const matchingHistory = historyForKey(historyRows, identity.dispatch_key);
  if (matchingHistory.some((row) => COMPLETED_STATUSES.has(dispatchText(row.status).toUpperCase()))) {
    return skipResult({ ...evaluated, identity, reason: 'ALREADY_COMPLETED' });
  }
  if (matchingHistory.some((row) => IN_FLIGHT_STATUSES.has(dispatchText(row.status).toUpperCase()))) {
    return skipResult({ ...evaluated, identity, reason: 'ALREADY_IN_FLIGHT' });
  }
  if (evaluated.phase === 'OUTSIDE_WINDOW') {
    if (matchingHistory.some((row) => WARNING_STATUSES.has(dispatchText(row.status).toUpperCase()))) {
      return skipResult({ ...evaluated, identity, reason: 'WARNING_ALREADY_RECORDED' });
    }
    return {
      action: 'WARN',
      reason: 'OUTSIDE_WINDOW',
      phase: evaluated.phase,
      occurrence: evaluated.occurrence,
      ...identity,
      warning: {
        code: 'DISPATCH_OUTSIDE_WINDOW',
        message_safe: `Scheduled job ${schedule.job_code} is outside its grace window`,
        lateness_minutes: evaluated.lateness_minutes,
      },
      history_row: historyRow({
        identity,
        schedule,
        occurrence: evaluated.occurrence,
        status: 'WARNING',
        attempt: 0,
        now: nowInstant,
        errorCode: 'DISPATCH_OUTSIDE_WINDOW',
      }),
    };
  }

  const latestFailure = [...matchingHistory].reverse().find((row) => FAILURE_STATUSES.has(dispatchText(row.status).toUpperCase()));
  const attempt = latestFailure ? parseAttempt(latestFailure) + 1 : 1;
  if (latestFailure && !isYes(latestFailure.retryable)) {
    return skipResult({ ...evaluated, identity, reason: 'FAILURE_NOT_RETRYABLE' });
  }
  if (latestFailure && attempt > schedule.max_attempts) {
    return skipResult({ ...evaluated, identity, reason: 'RETRY_LIMIT_REACHED' });
  }

  const action = latestFailure ? 'RETRY' : 'DISPATCH';
  const reason = latestFailure ? 'RETRY_FAILED' : evaluated.phase === 'CATCH_UP' ? 'GRACE_CATCH_UP' : 'DUE';
  return {
    action,
    reason,
    phase: evaluated.phase,
    occurrence: evaluated.occurrence,
    ...identity,
    attempt_number: attempt,
    envelope: workerEnvelope({ identity, schedule, occurrence: evaluated.occurrence, requestId, configVersion, configSnapshotId, attempt }),
    history_row: historyRow({
      identity,
      schedule,
      occurrence: evaluated.occurrence,
      status: 'CLAIMED',
      attempt,
      now: nowInstant,
      retryable: latestFailure ? 'YES' : '',
    }),
  };
}

export function buildDispatchPlan({
  scheduleRows = [],
  branchRows = [],
  historyRows = [],
  heartbeatRows = [],
  defaultTimezone = '',
  now,
  requestId,
  configVersion,
  configSnapshotId,
  heartbeatSuccess,
  heartbeatFailureThreshold,
} = {}) {
  const schedules = parseScheduleRows({ rows: scheduleRows, branchRows, defaultTimezone });
  const decisions = schedules.map((schedule) => decideDispatch({
    schedule,
    now,
    historyRows,
    requestId,
    configVersion,
    configSnapshotId,
  }));
  const heartbeat = decideHeartbeat({
    heartbeatRows,
    tickAt: now,
    success: heartbeatSuccess,
    failureThreshold: heartbeatFailureThreshold,
  });
  const dispatches = decisions.filter((decision) => ['DISPATCH', 'RETRY'].includes(decision.action));
  const atomicClaims = dispatches.map((decision) => buildAtomicClaimRequest({ decision, now })).filter(Boolean);
  const warnings = decisions.filter((decision) => decision.action === 'WARN').map((decision) => decision.warning);
  if (heartbeat.critical_alert) warnings.push({ code: 'DISPATCH_HEARTBEAT_CRITICAL', consecutive_failures: heartbeat.consecutive_failures });
  if (heartbeat.recovery_alert) warnings.push({ code: 'DISPATCH_HEARTBEAT_RECOVERY' });
  return {
    ok: true,
    request_id: dispatchText(requestId),
    operation_id: `op-dispatch-tick-${sha256(dispatchText(requestId)).slice(0, 32)}`,
    status: 'PLANNED',
    data: {
      dispatch_count: dispatches.length,
      warning_count: warnings.length,
      atomic_claim_count: atomicClaims.length,
    },
    decisions,
    dispatches,
    atomic_claims: atomicClaims,
    warnings,
    heartbeat,
    write_plan: [
      heartbeat.history_row,
      ...decisions.filter((decision) => decision.history_row).map((decision) => decision.history_row),
    ].map((row) => ({
      sheet: 'DISPATCH_HISTORY',
      action: row.status === 'CLAIMED' ? 'ATOMIC_CLAIM' : 'APPEND',
      unique_key: row.status === 'CLAIMED' ? `DISPATCH:${row.dispatch_key}` : undefined,
      row,
    })),
  };
}
