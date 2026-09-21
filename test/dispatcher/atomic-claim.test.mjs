import test from 'node:test';
import assert from 'node:assert/strict';
import { atomicClaim, buildAtomicClaimRequest } from '../../src/dispatcher/atomic-claim.mjs';

const decision = {
  action: 'DISPATCH',
  dispatch_key: 'dispatch:SCHED-01:CN_HN:2026-09-21:23:45',
  operation_id: 'op-dispatch-abc123',
  history_row: {
    history_id: 'history-1',
    dispatch_key: 'dispatch:SCHED-01:CN_HN:2026-09-21:23:45',
    operation_id: 'op-dispatch-abc123',
    status: 'CLAIMED',
  },
};

test('builds a compare-and-set claim with a deterministic uniqueness key', () => {
  const request = buildAtomicClaimRequest({ decision, now: '2026-09-21T16:45:00.000Z' });
  assert.equal(request.unique_key, `DISPATCH:${decision.dispatch_key}`);
  assert.equal(request.claim_token, decision.operation_id);
  assert.equal(request.row.claimed_at, '2026-09-21T16:45:00.000Z');
});

test('two concurrent callers produce one effective claim when the adapter is atomic', async () => {
  const request = buildAtomicClaimRequest({ decision, now: '2026-09-21T16:45:00.000Z' });
  let stored = null;
  let insertCalls = 0;
  const readClaim = async () => stored;
  const tryClaim = async (candidate) => {
    insertCalls += 1;
    if (stored) return false;
    stored = { ...candidate.row, claim_token: candidate.claim_token };
    return true;
  };

  const results = await Promise.all([
    atomicClaim({ candidate: request, readClaim, tryClaim }),
    atomicClaim({ candidate: request, readClaim, tryClaim }),
  ]);

  assert.equal(insertCalls, 2);
  assert.equal(results.filter((result) => result.claimed).length, 1);
  assert.equal(results.filter((result) => result.reason === 'ALREADY_CLAIMED').length, 1);
  assert.equal(stored.dispatch_key, decision.dispatch_key);
});

test('does not claim a non-dispatch decision', () => {
  assert.equal(buildAtomicClaimRequest({ decision: { action: 'SKIP' } }), null);
});
