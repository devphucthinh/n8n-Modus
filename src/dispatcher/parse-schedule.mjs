const ACTIVE_VALUES = new Set(['ACTIVE', 'ENABLED', 'YES', 'TRUE', '1']);
const INACTIVE_VALUES = new Set(['INACTIVE', 'DISABLED', 'NO', 'FALSE', '0']);
const DAY_NAMES = new Map([
  ['MON', 1],
  ['MONDAY', 1],
  ['TUE', 2],
  ['TUESDAY', 2],
  ['WED', 3],
  ['WEDNESDAY', 3],
  ['THU', 4],
  ['THURSDAY', 4],
  ['FRI', 5],
  ['FRIDAY', 5],
  ['SAT', 6],
  ['SATURDAY', 6],
  ['SUN', 7],
  ['SUNDAY', 7],
]);

const scheduleText = (value) => (value == null ? '' : String(value).trim());

function field(row, names) {
  for (const name of names) {
    if (row?.[name] !== undefined && row?.[name] !== null && scheduleText(row[name]) !== '') return row[name];
  }
  return '';
}

function required(row, names, label) {
  const value = scheduleText(field(row, names));
  if (!value) throw new Error(`DISPATCH_CONFIG_REQUIRED:${label}`);
  return value;
}

function parseStatus(value, label) {
  const normalized = scheduleText(value).toUpperCase();
  if (!normalized) throw new Error(`DISPATCH_CONFIG_REQUIRED:${label}`);
  if (ACTIVE_VALUES.has(normalized)) return true;
  if (INACTIVE_VALUES.has(normalized)) return false;
  throw new Error(`DISPATCH_CONFIG_STATUS_INVALID:${label}`);
}

function parseInteger(value, label, { minimum = 0 } = {}) {
  const normalized = scheduleText(value);
  if (!/^-?\d+$/.test(normalized)) throw new Error(`DISPATCH_CONFIG_INTEGER_INVALID:${label}`);
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`DISPATCH_CONFIG_INTEGER_INVALID:${label}`);
  return parsed;
}

function parseTime(value) {
  const normalized = scheduleText(value);
  const match = /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)$/.exec(normalized);
  if (!match) throw new Error('DISPATCH_CONFIG_TIME_INVALID:local_time');
  return {
    local_time: normalized,
    hour: Number(match.groups.hour),
    minute: Number(match.groups.minute),
  };
}

function parseDays(value) {
  const normalized = scheduleText(value).toUpperCase();
  if (!normalized || normalized === '*') return [1, 2, 3, 4, 5, 6, 7];
  const values = normalized.split(/[\s,|]+/).filter(Boolean).flatMap((token) => {
    if (/^[1-7]$/.test(token)) return [Number(token)];
    const day = DAY_NAMES.get(token);
    if (day) return [day];
    const vietnameseDay = /^T([2-7])$/.exec(token);
    return vietnameseDay ? [Number(vietnameseDay[1]) - 1] : [];
  });
  const unique = [...new Set(values)].sort((left, right) => left - right);
  if (unique.length === 0 || unique.length !== normalized.split(/[\s,|]+/).filter(Boolean).length) {
    throw new Error('DISPATCH_CONFIG_DAYS_INVALID:days_of_week');
  }
  return unique;
}

function validateTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new Error(`DISPATCH_CONFIG_TIMEZONE_INVALID:${timezone}`);
  }
  return timezone;
}

function activeBranch(branchRows, branchId) {
  if (!Array.isArray(branchRows) || branchRows.length === 0) return null;
  const row = branchRows.find((candidate) => scheduleText(candidate?.branch_id) === branchId);
  if (!row) throw new Error(`DISPATCH_BRANCH_NOT_FOUND:${branchId}`);
  return row;
}

export function parseScheduleRow(row, { branchRows = [], defaultTimezone = '' } = {}) {
  if (!row || typeof row !== 'object') throw new TypeError('DISPATCH_CONFIG_ROW_INVALID');

  const scheduleId = required(row, ['schedule_id', 'lich_id', 'schedule_code'], 'schedule_id');
  const jobCode = required(row, ['job_code', 'job_id', 'task_code'], 'job_code');
  const workerWorkflow = required(row, ['worker_workflow', 'workflow_name', 'target_workflow'], 'worker_workflow');
  const branchId = required(row, ['branch_id', 'branch_code'], 'branch_id');
  const branch = activeBranch(branchRows, branchId);
  const statusValue = field(row, ['trang_thai', 'status', 'enabled']);
  const scheduleEnabled = parseStatus(statusValue, 'trang_thai');
  const branchEnabled = branch ? parseStatus(field(branch, ['trang_thai', 'status']), 'CONFIG_BRANCH.trang_thai') : true;
  const timezone = validateTimezone(required({ timezone: field(row, ['timezone', 'time_zone']) || field(branch, ['timezone']) || defaultTimezone }, ['timezone'], 'timezone'));
  const parsedTime = parseTime(required(row, ['local_time', 'run_time', 'gio_chay'], 'local_time'));
  const days = parseDays(field(row, ['days_of_week', 'weekday', 'thu_trong_tuan']));
  const graceMinutes = parseInteger(field(row, ['grace_minutes', 'grace_window_minutes', 'phut_catchup']), 'grace_minutes');
  const maxAttempts = parseInteger(field(row, ['max_attempts', 'retry_limit', 'max_retries']), 'max_attempts', { minimum: 1 });

  return Object.freeze({
    schedule_id: scheduleId,
    job_code: jobCode,
    worker_workflow: workerWorkflow,
    branch_id: branchId,
    timezone,
    days_of_week: Object.freeze(days),
    local_time: parsedTime.local_time,
    hour: parsedTime.hour,
    minute: parsedTime.minute,
    grace_minutes: graceMinutes,
    max_attempts: maxAttempts,
    schedule_enabled: scheduleEnabled,
    branch_enabled: branchEnabled,
    enabled: scheduleEnabled && branchEnabled,
    trang_thai: scheduleEnabled ? 'ACTIVE' : 'INACTIVE',
  });
}

export function parseScheduleRows({ rows = [], branchRows = [], defaultTimezone = '' } = {}) {
  if (!Array.isArray(rows)) throw new TypeError('DISPATCH_CONFIG_ROWS_INVALID');
  return rows.map((row) => parseScheduleRow(row, { branchRows, defaultTimezone }));
}
