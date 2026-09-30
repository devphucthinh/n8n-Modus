import { validateLedgerRows } from '../contracts/validate-ledger-schema.mjs';
import { hasValidPersistedHeartbeatSettings, latestHeartbeat, recordHeartbeat, reuseValidatedHeartbeatSettings, validateHeartbeatRows } from './decide-dispatch.mjs';

const safeErrorCode = (value) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(normalized) ? normalized : 'GATEWAY_UNAVAILABLE';
};

export function planGatewayFailureHeartbeat({
  rows,
  heartbeatId,
  now,
  gatewayErrorCode,
} = {}) {
  const rejected = (result) => ({
    kind: 'SCHEMA_REJECTED', status: 'ERROR', ok: false, ...result, write_plan: [],
  });
  const rowValidation = validateLedgerRows({ tables: { HEARTBEAT: rows }, requiredSheets: ['HEARTBEAT'] });
  if (!rowValidation.ok) return rejected(rowValidation);

  const valueValidation = validateHeartbeatRows(rows);
  if (!valueValidation.ok) return rejected(valueValidation);
  if (rows.length === 0) return rejected({
    error_code: 'HEARTBEAT_CONFIG_MISSING', sheet_name: 'HEARTBEAT', column_name: 'heartbeat_id',
  });

  const previous = latestHeartbeat(rows) ?? {};
  if (!hasValidPersistedHeartbeatSettings(previous)) return rejected({
    error_code: 'HEARTBEAT_CONFIG_INVALID', sheet_name: 'HEARTBEAT', column_name: null,
  });

  const heartbeat = recordHeartbeat({
    now,
    previous: reuseValidatedHeartbeatSettings(previous),
    failure: true,
    threshold: previous.threshold,
    notificationTarget: {
      chat_id: previous.alert_chat_id,
      message_thread_id: previous.alert_thread_id,
    },
  });
  if (!heartbeat || heartbeat.status !== 'FAILED') return rejected({
    error_code: 'HEARTBEAT_WRITE_PLAN_INVALID', sheet_name: 'HEARTBEAT', column_name: null,
  });

  return {
    kind: 'HEARTBEAT',
    heartbeat_id: String(heartbeatId ?? ''),
    ...heartbeat,
    critical_notified: String(previous.critical_notified ?? '').trim().toUpperCase() === 'YES' ? 'YES' : 'NO',
    notice: null,
    diagnostic_code: heartbeat.diagnostic_code || safeErrorCode(gatewayErrorCode),
  };
}
