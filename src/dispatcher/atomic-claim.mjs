const CLAIMABLE_ACTIONS = new Set(['DISPATCH', 'RETRY']);

const asText = (value) => (value == null ? '' : String(value).trim());

/**
 * Build the request sent to the claim adapter. The adapter must implement a
 * conditional insert keyed by unique_key while holding its datastore lock;
 * an ordinary Google Sheets append is not sufficient for this contract.
 */
export function buildAtomicClaimRequest({ decision, now } = {}) {
  if (!decision || !CLAIMABLE_ACTIONS.has(asText(decision.action).toUpperCase()) || !decision.dispatch_key || !decision.operation_id || !decision.history_row) {
    return null;
  }
  const claimToken = asText(decision.operation_id);
  return {
    unique_key: `DISPATCH:${asText(decision.dispatch_key)}`,
    dispatch_key: asText(decision.dispatch_key),
    claim_token: claimToken,
    row: {
      ...structuredClone(decision.history_row),
      claim_token: claimToken,
      claimed_at: asText(now),
      updated_at: asText(now),
    },
  };
}

/**
 * Execute the compare-and-set protocol at the adapter boundary.
 *
 * `tryClaim` is intentionally injected: the Google Sheet shadow adapter must
 * implement it with Apps Script LockService (or an equivalent atomic store),
 * then return false when another owner already holds unique_key. The
 * read-after-write confirms that this caller owns the claim before a worker is
 * invoked.
 */
export async function atomicClaim({ candidate, readClaim, tryClaim } = {}) {
  if (!candidate?.dispatch_key || !candidate?.claim_token || !candidate?.unique_key) {
    throw new TypeError('DISPATCH_CLAIM_CANDIDATE_INVALID');
  }
  if (typeof readClaim !== 'function' || typeof tryClaim !== 'function') {
    throw new TypeError('DISPATCH_CLAIM_ADAPTER_REQUIRED');
  }

  const existing = await readClaim(candidate.dispatch_key);
  if (existing) return { ok: true, claimed: false, reason: 'ALREADY_CLAIMED', existing };

  const inserted = await tryClaim(candidate);
  if (inserted === false) {
    const winner = await readClaim(candidate.dispatch_key);
    return { ok: true, claimed: false, reason: 'ALREADY_CLAIMED', existing: winner ?? null };
  }

  const winner = await readClaim(candidate.dispatch_key);
  if (winner && asText(winner.claim_token) === candidate.claim_token) {
    return { ok: true, claimed: true, row: winner };
  }
  return { ok: true, claimed: false, reason: 'CLAIM_LOST', existing: winner ?? null };
}
