const reservationText = (value) => (value == null ? '' : String(value).trim());

export function buildDispatchReservation(envelope, now = new Date().toISOString()) {
  const requestId = reservationText(envelope?.request_id);
  const operationId = reservationText(envelope?.operation_id);
  const sourceKey = reservationText(envelope?.payload?.idempotency_key) || requestId || operationId;
  return {
    sheet: 'OPERATION',
    action: 'APPEND',
    row: {
      operation_id: `router-${operationId}`,
      request_id: requestId,
      operation_type: 'ROUTER_DISPATCH',
      idempotency_key: `router-${sourceKey}`,
      expected_row_count: '1',
      actual_row_count: '',
      checksum: '',
      status: 'PREPARED',
      error_id: '',
      created_at: now,
      updated_at: now,
    },
  };
}
