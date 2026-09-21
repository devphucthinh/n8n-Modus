import test from 'node:test';
import assert from 'node:assert/strict';

import { assertPurchasePorts } from '../../src/purchase-ingestion/ports.mjs';

test('purchase workflow accepts only explicit Drive, Gemini, and ledger ports', () => {
  const ports = {
    sourceEvidenceStore: { save: async () => undefined },
    ocrProvider: { recognize: async () => undefined },
    ledgerStore: { stage: async () => undefined, commit: async () => undefined },
  };

  assert.equal(assertPurchasePorts(ports), ports);
  assert.throws(() => assertPurchasePorts({ ...ports, ocrProvider: {} }), /ocrProvider\.recognize/);
});
