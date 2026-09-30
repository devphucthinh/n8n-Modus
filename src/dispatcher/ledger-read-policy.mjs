const BUSINESS_LEDGER_NAMES = Object.freeze([
  'DISPATCH_HISTORY',
  'PHIEN_KIEM_KE',
  'OPERATION',
]);

export function readDispatcherLedgers({ gatewayReady, heartbeatSettingsValid, heartbeatRowsValid, readLedger } = {}) {
  if (typeof readLedger !== 'function') throw new TypeError('DISPATCHER_LEDGER_READER_REQUIRED');

  const ledgers = { HEARTBEAT: readLedger('HEARTBEAT') };
  if (gatewayReady !== true || heartbeatSettingsValid !== true) return ledgers;
  if (heartbeatRowsValid?.(ledgers.HEARTBEAT) !== true) return ledgers;

  for (const sheetName of BUSINESS_LEDGER_NAMES) ledgers[sheetName] = readLedger(sheetName);
  return ledgers;
}
