import { isPositiveSafeInteger, isValidHeartbeatAlertTarget } from './heartbeat-settings.mjs';

const ACTIVE = 'ACTIVE';
const asText = (value) => (value == null ? '' : String(value).trim());
const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const isNonNegativeSafeInteger = (value) => {
  const text = asText(value);
  return /^(0|[1-9]\d*)$/.test(text) && Number.isSafeInteger(Number(text));
};
const truthy = (value) => ['YES', 'TRUE', '1', 'ACTIVE'].includes(asText(value).toUpperCase());
const localDate = (date, timezone) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const localParts = (date, timezone) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
const shiftDate = (date, amount) => {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + amount);
  return shifted.toISOString().slice(0, 10);
};

function toUtc(date, time, timezone) {
  const [hour, minute] = asText(time).split(':').map(Number);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asText(date)) || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  let guess = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hour, minute, 0);
  const desired = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hour, minute, 0);
  for (let index = 0; index < 3; index += 1) {
    const parts = localParts(new Date(guess), timezone);
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess += desired - observed;
  }
  return new Date(guess);
}

function weekdayAllowed(date, timezone, configured) {
  const days = asText(configured).split(/[|,\s]+/).map((value) => value.toUpperCase()).filter(Boolean);
  if (days.length === 0 || days.includes('*')) return true;
  const weekday = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][date.getUTCDay()];
  const numeric = String(date.getUTCDay());
  return days.includes(weekday) || days.includes(numeric);
}

function activeSession(sessions, branchId) {
  return (sessions ?? []).find((row) => asText(row.branch_id) === asText(branchId) && ['ACTIVE', 'OPEN', 'IN_PROGRESS'].includes(asText(row.status).toUpperCase()));
}

export function buildDispatchKey(schedule, businessDate) {
  return [schedule?.schedule_id, schedule?.branch_id, businessDate].map(asText).join(':');
}

function occurrencesFor(schedule, now) {
  const timezone = asText(schedule.timezone);
  if (!timezone) return [];
  const instant = new Date(now);
  if (Number.isNaN(instant.getTime())) return [];
  const currentDate = localDate(instant, timezone);
  const graceMinutes = asNumber(schedule.grace_window_minutes);
  const dates = [];
  for (let offset = 0; offset <= Math.ceil(Math.max(0, graceMinutes) / 1440) + 1; offset += 1) {
    dates.push(shiftDate(currentDate, -offset));
  }
  dates.reverse();
  const candidates = dates.filter((date) => weekdayAllowed(new Date(`${date}T12:00:00.000Z`), timezone, schedule.days_of_week)).map((businessDate) => {
    const scheduledAt = toUtc(businessDate, schedule.local_time, timezone);
    const graceEnd = scheduledAt ? new Date(scheduledAt.getTime() + graceMinutes * 60_000) : null;
    return { businessDate, scheduledAt, graceEnd };
  }).filter(({ scheduledAt }) => scheduledAt);
  return candidates;
}

function candidatesFor(schedule, now, candidates = occurrencesFor(schedule, now)) {
  const instant = new Date(now);
  const due = candidates.filter(({ scheduledAt, graceEnd }) => instant >= scheduledAt && instant <= graceEnd);
  if (due.length) return due.map((candidate) => ({ ...candidate, state: 'DUE' }));
  const missed = candidates.findLast(({ scheduledAt, graceEnd }) => instant > graceEnd && scheduledAt <= instant);
  return missed ? [{ ...missed, state: 'OUTSIDE_GRACE_WINDOW' }] : [];
}

function timestampMillis(value) {
  const timestamp = asText(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)) return NaN;
  return Date.parse(timestamp);
}

function historyDisposition(row, schedule, now, claimLeaseMinutes) {
  if (!row) return 'DISPATCH';
  const status = asText(row.status).toUpperCase();
  if (status === 'CLAIMED' || status === 'RUNNING') {
    const updatedAt = timestampMillis(row.updated_at);
    const lease = Number(claimLeaseMinutes);
    if (!Number.isFinite(updatedAt) || !Number.isFinite(lease) || lease <= 0) return 'RECONCILE';
    if (Date.parse(now) < updatedAt + lease * 60_000) return 'BLOCK';
    if (status === 'RUNNING') return 'RECONCILE';
    const attempts = Number(row.attempt_count);
    if (!Number.isInteger(attempts) || attempts < 1 || !asText(row.operation_id) || !asText(row.config_snapshot_id)) return 'RECONCILE';
    return attempts < asNumber(schedule.retry_limit, 0) ? 'DISPATCH' : 'BLOCK';
  }
  if (status !== 'FAILED') return 'BLOCK';
  if (!asText(row.operation_id) || !asText(row.config_snapshot_id)) return 'RECONCILE';
  const attempts = asNumber(row.attempt_count, 0);
  if (attempts >= asNumber(schedule.retry_limit, 0)) return 'BLOCK';
  const explicitRetryAt = timestampMillis(row.retry_at);
  const updatedAt = timestampMillis(row.updated_at);
  const retryAt = Number.isFinite(explicitRetryAt)
    ? explicitRetryAt
    : Number.isFinite(updatedAt) ? updatedAt + asNumber(schedule.retry_delay_minutes) * 60_000 : null;
  if (!Number.isFinite(retryAt)) return 'RECONCILE';
  return Date.parse(now) < retryAt ? 'BLOCK' : 'DISPATCH';
}

export function planDispatch({ now = new Date().toISOString(), schedules = [], branches = [], history = [], activeSessions = [], operations = [], configSnapshotId = null, claimLeaseMinutes } = {}) {
  const activeSchedules = schedules.filter((schedule) =>
    truthy(schedule.enabled) && asText(schedule.trang_thai).toUpperCase() !== 'INACTIVE');
  for (const schedule of activeSchedules) {
    try {
      const timezone = asText(schedule.timezone);
      if (!timezone) throw new RangeError('timezone is empty');
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(now));
    } catch {
      return { actions: [], error_code: 'CONFIG_TIMEZONE_INVALID', sheet_name: 'CONFIG_LICH', column_name: 'timezone' };
    }
  }
  const scheduleCandidates = activeSchedules.map((schedule) => {
    const occurrences = occurrencesFor(schedule, now);
    return { schedule, candidates: candidatesFor(schedule, now, occurrences), occurrences };
  });
  const effectiveKeys = new Set();
  for (const { schedule, occurrences } of scheduleCandidates) {
    for (const candidate of occurrences) {
      const effectiveKey = JSON.stringify([
        asText(schedule.job_code).toUpperCase(),
        asText(schedule.branch_id),
        candidate.businessDate,
      ]);
      if (effectiveKeys.has(effectiveKey)) {
        return { actions: [], error_code: 'CONFIG_DUPLICATE_EFFECTIVE_SCHEDULE', sheet_name: 'CONFIG_LICH', column_name: 'job_code' };
      }
      effectiveKeys.add(effectiveKey);
    }
  }
  const actions = [];
  for (const { schedule, candidates } of scheduleCandidates) {
    for (const candidate of candidates) {
      const dispatchKey = buildDispatchKey(schedule, candidate.businessDate);
      const existing = asText(schedule.job_code).toUpperCase() === 'OPEN_INVENTORY'
        ? activeSession(activeSessions, schedule.branch_id) : null;
      if (existing && !(operations ?? []).some((row) => asText(row.idempotency_key) === asText(existing.dispatch_key)
        && asText(existing.dispatch_key)
        && asText(row.operation_type) === 'OPEN_INVENTORY_SESSION'
        && asText(row.status).toUpperCase() === 'COMMITTED')) {
        actions.push({ kind: 'WARNING', reason: 'RECONCILIATION_REQUIRED', notice_code: 'DISPATCH_RECONCILIATION_REQUIRED', dispatch_key: dispatchKey, schedule_id: asText(schedule.schedule_id), job_code: asText(schedule.job_code), branch_id: asText(schedule.branch_id), business_date: candidate.businessDate, session_id: asText(existing.session_id), config_snapshot_id: configSnapshotId });
        break;
      }
      const previous = (history ?? []).find((row) => asText(row.dispatch_key) === dispatchKey);
      const disposition = historyDisposition(previous, schedule, now, claimLeaseMinutes);
      if (disposition === 'BLOCK') continue;
      if (disposition === 'RECONCILE') {
        actions.push({ kind: 'WARNING', reason: 'RECONCILIATION_REQUIRED', notice_code: 'DISPATCH_RECONCILIATION_REQUIRED', dispatch_key: dispatchKey, schedule_id: asText(schedule.schedule_id), job_code: asText(schedule.job_code), branch_id: asText(schedule.branch_id), business_date: candidate.businessDate, operation_id: asText(previous.operation_id), attempt_count: asText(previous.attempt_count), config_snapshot_id: asText(previous.config_snapshot_id) || configSnapshotId });
        break;
      }
      if (candidate.state === 'OUTSIDE_GRACE_WINDOW') {
        actions.push({ kind: 'WARNING', reason: 'OUTSIDE_GRACE_WINDOW', notice_code: 'DISPATCH_OUTSIDE_GRACE_WINDOW', dispatch_key: dispatchKey, schedule_id: asText(schedule.schedule_id), job_code: asText(schedule.job_code), branch_id: asText(schedule.branch_id), business_date: candidate.businessDate, scheduled_at: candidate.scheduledAt.toISOString(), config_snapshot_id: configSnapshotId });
        break;
      }
      const branch = (branches ?? []).find((row) => asText(row.branch_id) === asText(schedule.branch_id));
      if (!branch || asText(branch.trang_thai).toUpperCase() !== ACTIVE) {
        actions.push({ kind: 'SKIP', reason: 'BRANCH_INACTIVE', notice_code: 'DISPATCH_BRANCH_INACTIVE', dispatch_key: dispatchKey, schedule_id: asText(schedule.schedule_id), job_code: asText(schedule.job_code), branch_id: asText(schedule.branch_id), business_date: candidate.businessDate, config_snapshot_id: configSnapshotId });
        break;
      }
      if (existing) {
        actions.push({ kind: 'SKIP', reason: 'ACTIVE_SESSION_EXISTS', notice_code: 'DISPATCH_ACTIVE_SESSION_EXISTS', dispatch_key: dispatchKey, schedule_id: asText(schedule.schedule_id), job_code: asText(schedule.job_code), branch_id: asText(schedule.branch_id), business_date: candidate.businessDate, session_id: asText(existing.session_id), config_snapshot_id: configSnapshotId });
        break;
      }
      const attemptCount = asNumber(previous?.attempt_count, 0) + 1;
      actions.push({
        kind: 'DISPATCH',
        status: 'CLAIMED',
        dispatch_key: dispatchKey,
        schedule_id: asText(schedule.schedule_id),
        job_code: asText(schedule.job_code),
        branch_id: asText(schedule.branch_id),
        business_date: candidate.businessDate,
        scheduled_at: candidate.scheduledAt.toISOString(),
        worker_workflow: asText(schedule.worker_workflow),
        attempt_count: String(attemptCount),
        retry_delay_minutes: asText(schedule.retry_delay_minutes),
        retry_limit: asText(schedule.retry_limit),
        ...(asText(previous?.operation_id) ? { operation_id: asText(previous.operation_id) } : {}),
        config_snapshot_id: asText(previous?.config_snapshot_id) || configSnapshotId,
      });
      break;
    }
  }
  return { actions };
}

export function recordHeartbeat({ now = new Date().toISOString(), previous = {}, failure = false, threshold = null, notificationTarget = null } = {}) {
  const limit = isPositiveSafeInteger(threshold) ? Number(threshold) : isPositiveSafeInteger(previous.threshold) ? Number(previous.threshold) : 0;
  const currentChat = asText(notificationTarget?.chat_id);
  const currentThread = asText(notificationTarget?.message_thread_id);
  const alertChatId = currentChat && currentThread ? currentChat : asText(previous.alert_chat_id);
  const alertThreadId = currentChat && currentThread ? currentThread : asText(previous.alert_thread_id);
  const canNotify = limit > 0 && !!alertChatId && !!alertThreadId;
  const common = {
    heartbeat_at: now,
    threshold: limit,
    alert_chat_id: alertChatId,
    alert_thread_id: alertThreadId,
    diagnostic_code: canNotify ? '' : 'HEARTBEAT_CONFIG_MISSING',
  };
  const oldFailures = asNumber(previous.failure_count, 0);
  if (failure) {
    const failureCount = oldFailures + 1;
    const critical = canNotify && failureCount >= limit && asText(previous.critical_notified).toUpperCase() !== 'YES';
    return { ...common, status: 'FAILED', failure_count: failureCount, critical_notified: critical || asText(previous.critical_notified).toUpperCase() === 'YES' ? 'YES' : 'NO', notice: critical ? 'CRITICAL' : null };
  }
  const recovered = canNotify && asText(previous.status).toUpperCase() === 'FAILED' && (asText(previous.critical_notified).toUpperCase() === 'YES' || oldFailures >= limit);
  return { ...common, status: 'HEALTHY', failure_count: 0, critical_notified: 'NO', notice: recovered ? 'RECOVERY' : null };
}

export function latestHeartbeat(rows = []) {
  let latest = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    const timestamp = Date.parse(asText(row?.heartbeat_at));
    if (!Number.isFinite(timestamp) || (latest && timestamp < latest.timestamp)) continue;
    latest = { row, timestamp };
  }
  return latest?.row ?? null;
}

export function hasValidPersistedHeartbeatSettings(previous = {}) {
  return isPositiveSafeInteger(previous.threshold)
    && isValidHeartbeatAlertTarget(previous.alert_chat_id, previous.alert_thread_id);
}

export function reuseValidatedHeartbeatSettings(previous = {}) {
  const threshold = asText(previous.threshold);
  const validThreshold = isPositiveSafeInteger(threshold);
  const chatId = asText(previous.alert_chat_id);
  const threadId = asText(previous.alert_thread_id);
  const validTarget = isValidHeartbeatAlertTarget(chatId, threadId);
  return {
    ...previous,
    threshold: validThreshold ? threshold : '',
    alert_chat_id: validTarget ? chatId : '',
    alert_thread_id: validTarget ? threadId : '',
  };
}

export function validateHeartbeatRows(rows = []) {
  if (!Array.isArray(rows)) return { ok: false, error_code: 'HEARTBEAT_ROW_INVALID', sheet_name: 'HEARTBEAT', column_name: null };
  const heartbeatIds = new Set();
  for (const row of rows) {
    const invalidColumn = (() => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
      if (!asText(row.heartbeat_id)) return 'heartbeat_id';
      if (!asText(row.heartbeat_at) || Number.isNaN(Date.parse(asText(row.heartbeat_at)))) return 'heartbeat_at';
      if (!['HEALTHY', 'FAILED'].includes(asText(row.status).toUpperCase())) return 'status';
      if (!isNonNegativeSafeInteger(row.failure_count)) return 'failure_count';
      if (!['YES', 'NO'].includes(asText(row.critical_notified).toUpperCase())) return 'critical_notified';
      if (asText(row.notice) && !['CRITICAL', 'RECOVERY'].includes(asText(row.notice).toUpperCase())) return 'notice';

      const threshold = asText(row.threshold);
      if (threshold && threshold !== '0' && !isPositiveSafeInteger(threshold)) return 'threshold';
      const chatId = asText(row.alert_chat_id);
      const threadId = asText(row.alert_thread_id);
      if (Boolean(chatId) !== Boolean(threadId)) return chatId ? 'alert_thread_id' : 'alert_chat_id';
      if (chatId || threadId) {
        if (!isValidHeartbeatAlertTarget(chatId, threadId)) return 'alert_chat_id';
        if (!isPositiveSafeInteger(threshold)) return 'threshold';
      }

      const status = asText(row.status).toUpperCase();
      const failureCount = Number(row.failure_count);
      const criticalNotified = asText(row.critical_notified).toUpperCase();
      const notice = asText(row.notice).toUpperCase();
      const hasNotificationConfig = isPositiveSafeInteger(threshold)
        && isValidHeartbeatAlertTarget(chatId, threadId);
      if (status === 'HEALTHY' && failureCount !== 0) return 'failure_count';
      if (status === 'HEALTHY' && criticalNotified !== 'NO') return 'critical_notified';
      if (status === 'FAILED' && failureCount < 1) return 'failure_count';
      if (criticalNotified === 'YES'
        && (status !== 'FAILED' || !hasNotificationConfig || failureCount < Number(threshold))) return 'critical_notified';
      if (status === 'HEALTHY' && notice === 'CRITICAL') return 'notice';
      if (status === 'FAILED' && notice === 'RECOVERY') return 'notice';
      if (notice === 'CRITICAL'
        && (criticalNotified !== 'YES' || failureCount < Number(threshold) || !hasNotificationConfig)) return 'notice';
      if (notice === 'RECOVERY'
        && (criticalNotified !== 'NO' || !hasNotificationConfig)) return 'notice';
      return null;
    })();
    if (invalidColumn) return { ok: false, error_code: 'HEARTBEAT_ROW_INVALID', sheet_name: 'HEARTBEAT', column_name: invalidColumn };
    const heartbeatId = asText(row.heartbeat_id);
    if (heartbeatIds.has(heartbeatId)) return { ok: false, error_code: 'HEARTBEAT_ROW_INVALID', sheet_name: 'HEARTBEAT', column_name: 'heartbeat_id' };
    heartbeatIds.add(heartbeatId);
  }
  return { ok: true };
}
