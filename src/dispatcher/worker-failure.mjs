const asText = (value) => (value == null ? '' : String(value).trim());

export function buildWorkerFailureEnvelope({ action = {}, worker = {}, now = new Date().toISOString() } = {}) {
  if (worker?.ok === true) return null;
  const nested = worker?.error && typeof worker.error === 'object' ? worker.error : {};
  const errorCode = asText(worker.error_code) || asText(nested.error_code) || 'WORKER_FAILED';
  const operationId = asText(action.operation_id);
  const requestId = asText(action.request_id);
  const workflow = 'WF04_V2_DISPATCHER';
  const node = 'Execute Configured Worker';
  return {
    error: {
      error_code: errorCode,
      error_class: asText(worker.error_class) || asText(nested.error_class) || 'OPERATIONAL',
      retryable: worker.retryable ?? nested.retryable ?? true,
      message_key: asText(worker.message_key) || asText(nested.message_key) || errorCode,
      message: asText(worker.message_safe) || asText(nested.message_safe) || errorCode,
      operation_id: operationId,
      request_id: requestId,
      workflow,
      node,
      config_version: asText(action.config_version) || null,
      failed_at: now,
    },
    context: {
      workflow,
      node,
      operation_id: operationId,
      request_id: requestId,
      dispatch_key: asText(action.dispatch_key),
      config_snapshot_id: asText(action.config_snapshot_id) || null,
    },
  };
}
