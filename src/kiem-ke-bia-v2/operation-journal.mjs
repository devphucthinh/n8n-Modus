const asText = (value) => (value == null ? '' : String(value).trim());
const asNullableText = (value) => asText(value) || null;

function isUtcTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function normalizeConfigVersion(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('config_version must be a finite number');
  return number;
}

function normalizeIntent(envelope, workflowCode, idempotencyKey) {
  return {
    request_id: asText(envelope.request_id),
    event_type: asText(envelope.event_type),
    idempotency_key: idempotencyKey,
    branch_id: asText(envelope.branch_id),
    actor_user_id: asNullableText(envelope.actor_user_id),
    business_date: asNullableText(envelope.business_date),
    config_version: normalizeConfigVersion(envelope.config_version),
    config_snapshot_id: asText(envelope.config_snapshot_id),
    workflow_code: workflowCode,
    parent_operation_id: asNullableText(envelope.parent_operation_id),
  };
}

function sameIntent(operation, intent) {
  return ['request_id', 'event_type', 'branch_id', 'actor_user_id', 'business_date', 'config_version', 'config_snapshot_id', 'workflow_code', 'parent_operation_id']
    .every((field) => {
      const value = field === 'actor_user_id' || field === 'business_date' || field === 'parent_operation_id'
        ? asNullableText(operation?.[field])
        : field === 'config_version'
          ? normalizeConfigVersion(operation?.[field])
          : asText(operation?.[field]);
      return value === intent[field];
    });
}

function conflict(existingOperation = null) {
  return {
    ok: false,
    replay: false,
    appendPrepared: false,
    error_code: 'OPERATION_IDEMPOTENCY_CONFLICT',
    operation: existingOperation,
  };
}

function isOperationCommitted(operation) {
  return asText(operation?.status).toUpperCase() === 'COMMITTED'
    && asText(operation?.commit_state).toUpperCase() === 'COMMITTED';
}

/**
 * Create the first PREPARED row or resolve a replay against rows already read
 * from OPERATION. existingOperations is a read snapshot supplied by the caller;
 * this pure module never performs I/O.
 */
export function prepareOperation(envelope, workflowCode, now, existingOperations = []) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new TypeError('envelope must be an object');
  }
  if (!/^WF\d{2}$/.test(asText(workflowCode))) throw new TypeError('workflowCode must look like WF00');
  if (!isUtcTimestamp(now)) throw new TypeError('now must be an ISO-8601 UTC timestamp');
  if (!Array.isArray(existingOperations) || existingOperations.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new TypeError('existingOperations must be an array of operation rows');
  }

  const required = ['request_id', 'operation_id', 'event_type', 'branch_id', 'config_snapshot_id'];
  for (const field of required) {
    if (!asText(envelope[field])) throw new TypeError(`envelope.${field} is required`);
  }
  const idempotencyKey = [envelope.idempotency_key, envelope.payload?.idempotency_key, envelope.request_id, envelope.operation_id]
    .map(asText)
    .find(Boolean);
  if (!idempotencyKey) throw new TypeError('idempotency_key must resolve to a nonempty stable value');

  const intent = normalizeIntent(envelope, workflowCode, idempotencyKey);
  const matches = existingOperations.filter((row) => asText(row.idempotency_key) === idempotencyKey);
  if (matches.length > 0) {
    const operationIds = new Set(matches.map((row) => asText(row.operation_id)));
    if (operationIds.size !== 1 || matches.some((row) => !sameIntent(row, intent))) return conflict(matches[0]);
    const existing = matches.find(isOperationCommitted) ?? matches.at(-1);
    return { ok: true, replay: true, appendPrepared: false, operation: existing };
  }

  const operationIdMatch = existingOperations.find((row) => asText(row.operation_id) === asText(envelope.operation_id));
  if (operationIdMatch) return conflict(operationIdMatch);

  const operation = {
    operation_id: asText(envelope.operation_id),
    ...intent,
    status: 'PREPARED',
    commit_state: 'PREPARED',
    attempt_number: 1,
    retryable: false,
    error_code: null,
    error_id: null,
    started_at: now,
    committed_at: null,
    created_at: now,
    updated_at: now,
  };
  return { ok: true, replay: false, appendPrepared: true, operation };
}

/**
 * Return a new commit decision row. The caller persists committed_at/updated_at
 * when it appends the COMMITTED operation record.
 */
export function decideCommit(operation, requiredWrites, observedWrites) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw new TypeError('operation must be a row object');
  }
  const validWrites = (value, name) => {
    if (!Array.isArray(value) || value.some((write) => typeof write !== 'string' || !write.trim())) {
      throw new TypeError(`${name} must be an array of nonempty write identifiers`);
    }
    return [...new Set(value.map((write) => write.trim()))];
  };
  const required = validWrites(requiredWrites, 'requiredWrites');
  const observed = new Set(validWrites(observedWrites, 'observedWrites'));
  if (required.length === 0) throw new TypeError('requiredWrites must not be empty');

  if (isOperationCommitted(operation)) {
    return { ok: true, committed: true, replay: true, missingWrites: [], operation };
  }
  if (asText(operation.status).toUpperCase() !== 'PREPARED'
    || asText(operation.commit_state).toUpperCase() !== 'PREPARED') {
    return { ok: false, committed: false, replay: false, error_code: 'OPERATION_NOT_PREPARED', missingWrites: required, operation };
  }

  const missingWrites = required.filter((write) => !observed.has(write));
  const committed = missingWrites.length === 0;
  const nextOperation = {
    ...operation,
    status: committed ? 'COMMITTED' : 'PREPARED',
    commit_state: committed ? 'COMMITTED' : 'PREPARED',
  };
  return { ok: true, committed, replay: false, missingWrites, operation: nextOperation };
}

export function visibleCommittedRows(rows, operations) {
  if (!Array.isArray(rows) || !Array.isArray(operations)) {
    throw new TypeError('rows and operations must be arrays');
  }
  const committedIds = new Set(operations
    .filter(isOperationCommitted)
    .map((operation) => asText(operation.operation_id))
    .filter(Boolean));
  return rows.filter((row) => row && typeof row === 'object' && !Array.isArray(row)
    && committedIds.has(asText(row.operation_id)));
}

export { isOperationCommitted };
