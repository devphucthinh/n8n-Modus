const clone = (value) => {
  if (value === undefined) return undefined;
  return structuredClone(value);
};

/**
 * Normalize the small envelope shared by all KKB-V2 workflows.
 * Business configuration is deliberately not inferred here; it is read only
 * by the Config Gateway from the live Google Sheets tables.
 */
export function normalizeEnvelope(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('workflow envelope must be an object');
  }

  const requestId = input.request_id;
  const operationId = input.operation_id;
  if (!requestId || !operationId) {
    throw new Error('workflow envelope requires request_id and operation_id');
  }

  return {
    request_id: String(requestId),
    operation_id: String(operationId),
    event_type: input.event_type ? String(input.event_type) : 'UNKNOWN',
    actor_user_id: input.actor_user_id == null ? null : String(input.actor_user_id),
    branch_id: input.branch_id == null || input.branch_id === '' ? null : String(input.branch_id),
    business_date: input.business_date == null || input.business_date === '' ? null : String(input.business_date),
    config_version: input.config_version == null || input.config_version === '' ? null : String(input.config_version),
    config_snapshot_id: input.config_snapshot_id == null || input.config_snapshot_id === '' ? null : String(input.config_snapshot_id),
    payload: input.payload && typeof input.payload === 'object' ? clone(input.payload) : {},
  };
}
