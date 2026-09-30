import test from 'node:test';
import assert from 'node:assert/strict';
import { readDispatcherLedgers } from '../../src/dispatcher/ledger-read-policy.mjs';

test('Gateway failure reads HEARTBEAT only', () => {
  const reads = [];
  const ledgers = readDispatcherLedgers({
    gatewayReady: false,
    heartbeatSettingsValid: false,
    heartbeatRowsValid: () => true,
    readLedger: (sheetName) => { reads.push(sheetName); return []; },
  });

  assert.deepEqual(reads, ['HEARTBEAT']);
  assert.deepEqual(Object.keys(ledgers), ['HEARTBEAT']);
});

test('invalid current heartbeat configuration reads HEARTBEAT only', () => {
  const reads = [];
  const ledgers = readDispatcherLedgers({
    gatewayReady: true,
    heartbeatSettingsValid: false,
    heartbeatRowsValid: () => true,
    readLedger: (sheetName) => { reads.push(sheetName); return []; },
  });

  assert.deepEqual(reads, ['HEARTBEAT']);
  assert.deepEqual(Object.keys(ledgers), ['HEARTBEAT']);
});

test('invalid HEARTBEAT rows block business-ledger reads', () => {
  const reads = [];
  const ledgers = readDispatcherLedgers({
    gatewayReady: true,
    heartbeatSettingsValid: true,
    heartbeatRowsValid: () => false,
    readLedger: (sheetName) => { reads.push(sheetName); return []; },
  });

  assert.deepEqual(reads, ['HEARTBEAT']);
  assert.deepEqual(Object.keys(ledgers), ['HEARTBEAT']);
});

test('valid Gateway and heartbeat configuration may read business ledgers after HEARTBEAT', () => {
  const reads = [];
  const ledgers = readDispatcherLedgers({
    gatewayReady: true,
    heartbeatSettingsValid: true,
    heartbeatRowsValid: () => true,
    readLedger: (sheetName) => { reads.push(sheetName); return [sheetName]; },
  });

  assert.deepEqual(reads, ['HEARTBEAT', 'DISPATCH_HISTORY', 'PHIEN_KIEM_KE', 'OPERATION']);
  assert.deepEqual(ledgers, {
    HEARTBEAT: ['HEARTBEAT'],
    DISPATCH_HISTORY: ['DISPATCH_HISTORY'],
    PHIEN_KIEM_KE: ['PHIEN_KIEM_KE'],
    OPERATION: ['OPERATION'],
  });
});
