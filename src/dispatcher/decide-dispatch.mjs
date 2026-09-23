const ACTIVE = 'ACTIVE';
const asText = (value) => (value == null ? '' : String(value).trim());
const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function candidateFor(schedule, now) {
  const timezone = asText(schedule.timezone);
  if (!timezone) return null;
  const instant = new Date(now);
  if (Number.isNaN(instant.getTime())) return null;
  const currentDate = localDate(instant, timezone);
  const dates = [currentDate, shiftDate(currentDate, -1)];
  const candidates = dates.filter((date) => weekdayAllowed(new Date(`${date}T12:00:00.000Z`), timezone, schedule.days_of_week)).map((businessDate) => {
    const scheduledAt = toUtc(businessDate, schedule.local_time, timezone);
    const graceEnd = scheduledAt ? new Date(scheduledAt.getTime() + asNumber(schedule.grace_window_minutes) * 60_000) : null;
    return { businessDate, scheduledAt, graceEnd };
  }).filter(({ scheduledAt }) => scheduledAt);
  const due = candidates.find(({ scheduledAt, graceEnd }) => instant >= scheduledAt && instant <= graceEnd);
  if (due) return { ...due, state: 'DUE' };
  const missed = candidates.find(({ scheduledAt, graceEnd }) => instant > graceEnd && scheduledAt <= instant);
  if (missed) return { ...missed, state: 'OUTSIDE_GRACE_WINDOW' };
  return null;
}

function historyBlocks(row, schedule, now) {
  if (!row) return false;
  const status = asText(row.status).toUpperCase();
  if (['CLAIMED', 'RUNNING', 'SUCCESS', 'SKIPPED', 'WARNING'].includes(status)) return true;
  if (status !== 'FAILED') return true;
  const attempts = asNumber(row.attempt_count, 0);
  if (attempts >= asNumber(schedule.retry_limit, 0)) return true;
  const explicitRetryAt = Date.parse(asText(row.retry_at));
  const updatedAt = Date.parse(asText(row.updated_at));
  const retryAt = Number.isFinite(explicitRetryAt)
    ? explicitRetryAt
    : Number.isFinite(updatedAt) ? updatedAt + asNumber(schedule.retry_delay_minutes) * 60_000 : null;
  return Number.isFinite(retryAt) && Date.parse(now) < retryAt;
}

export function planDispatch({ now = new Date().toISOString(), schedules = [], branches = [], history = [], activeSessions = [], configSnapshotId = null } = {}) {
  const actions = [];
  for (const schedule of schedules) {
    if (!truthy(schedule.enabled) || asText(schedule.trang_thai).toUpperCase() === 'INACTIVE') continue;
    const candidate = candidateFor(schedule, now);
    if (!candidate) continue;
    const dispatchKey = buildDispatchKey(schedule, candidate.businessDate);
    const previous = (history ?? []).find((row) => asText(row.dispatch_key) === dispatchKey);
    if (historyBlocks(previous, schedule, now)) continue;
    if (candidate.state === 'OUTSIDE_GRACE_WINDOW') {
      actions.push({ kind: 'WARNING', reason: 'OUTSIDE_GRACE_WINDOW', dispatch_key: dispatchKey, schedule_id: asText(schedule.schedule_id), job_code: asText(schedule.job_code), branch_id: asText(schedule.branch_id), business_date: candidate.businessDate, scheduled_at: candidate.scheduledAt.toISOString(), config_snapshot_id: configSnapshotId });
      continue;
    }
    const branch = (branches ?? []).find((row) => asText(row.branch_id) === asText(schedule.branch_id));
    if (!branch || asText(branch.trang_thai).toUpperCase() !== ACTIVE) {
      actions.push({ kind: 'SKIP', reason: 'BRANCH_INACTIVE', dispatch_key: dispatchKey, schedule_id: asText(schedule.schedule_id), job_code: asText(schedule.job_code), branch_id: asText(schedule.branch_id), business_date: candidate.businessDate, config_snapshot_id: configSnapshotId });
      continue;
    }
    const existing = activeSession(activeSessions, schedule.branch_id);
    if (existing) {
      actions.push({ kind: 'SKIP', reason: 'ACTIVE_SESSION_EXISTS', dispatch_key: dispatchKey, schedule_id: asText(schedule.schedule_id), job_code: asText(schedule.job_code), branch_id: asText(schedule.branch_id), business_date: candidate.businessDate, session_id: asText(existing.session_id), config_snapshot_id: configSnapshotId });
      continue;
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
      config_snapshot_id: configSnapshotId,
    });
  }
  return { actions };
}

export function recordHeartbeat({ now = new Date().toISOString(), previous = {}, failure = false, threshold = null } = {}) {
  const limit = asNumber(threshold, 0);
  const oldFailures = asNumber(previous.failure_count, 0);
  if (failure) {
    const failureCount = oldFailures + 1;
    const critical = limit > 0 && failureCount >= limit && asText(previous.critical_notified).toUpperCase() !== 'YES';
    return { heartbeat_at: now, status: 'FAILED', failure_count: failureCount, threshold: limit, critical_notified: critical || asText(previous.critical_notified).toUpperCase() === 'YES' ? 'YES' : 'NO', notice: critical ? 'CRITICAL' : null };
  }
  const recovered = limit > 0 && asText(previous.status).toUpperCase() === 'FAILED' && (asText(previous.critical_notified).toUpperCase() === 'YES' || oldFailures >= limit);
  return { heartbeat_at: now, status: 'HEALTHY', failure_count: 0, threshold: limit, critical_notified: 'NO', notice: recovered ? 'RECOVERY' : null };
}
