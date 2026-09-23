# Issue #3: Safe Telegram `/retry` Context Design

- Status: approved design; implementation and live Sheet migration have not started.
- Date: 2026-09-23.
- Repository: `devphucthinh/n8n-Modus`.
- Fixed point for the Issue #3 review: `c75d8e7`.

## Goal

Make `/retry <error_id>` replay the exact original standard worker envelope for an allow-listed worker, while preserving the original `operation_id` and idempotency key. Do not reconstruct a command from partial error metadata, retry validation failures, overwrite error history, or alter the production Sheet as part of this implementation.

This work remains in Issue #3. WF10 and `/baocaobia` remain deferred.

## Approved configuration and Sheet contract

- `config_version` becomes `v1.3`.
- `schema_version` becomes `1.1` for the new tab/schema registration.
- Keep the current Config Gateway fingerprint algorithm; no fingerprint redesign is in scope.
- `ERROR_BIA` retains only the two approved added columns: `branch_id` and `idempotency_key`.
- Register `RETRY_CONTEXT` in `CONFIG_SCHEMA` and expose it as an optional operational table through WF01 only for `/retry`; `/help` and `/trangthai` must not read it. It is not a fingerprint input.
- Add a `RETRY_CONTEXT` tab with these columns:

| Column | Meaning |
| --- | --- |
| `operation_id` | Stable business-operation key; one replay context per operation. |
| `envelope_version` | Version of the standard worker envelope contract. |
| `worker_envelope_json` | Exact serialized standard envelope originally sent to the worker. |
| `envelope_sha256` | SHA-256 of the exact serialized envelope. |
| `context_status` | `READY`, `CONSUMED`, or `MANUAL_REVIEW`. |
| `created_at` | Initial context creation time. |
| `updated_at` | Latest context-state update time. |

The normal initial status is `READY`. A repeat write for the same `operation_id` is accepted only if its hash and envelope agree with the existing row; a mismatch must not overwrite the original payload and must fail closed.

## Workflow behavior

### Capturing a retryable worker failure

1. WF03 preserves the exact standard envelope used for the original worker call and passes it, separately from safe error metadata, to WF02.
2. WF02 validates the envelope version, required identifiers, allow-listed worker identity, JSON serialization and the implementation's safe Sheet-cell size limit.
3. For a retryable error only, WF02 stores the envelope in `RETRY_CONTEXT` before appending an `ERROR_BIA` row marked retryable. Non-retryable errors do not create replay payloads.
4. If context validation or persistence fails, do not publish a retryable error record. Record/report a safe context-store failure when the relevant Sheet write is available; otherwise fail closed and require operational investigation.
5. A context row without a matching retryable error row never authorizes dispatch.

The persisted value is the standard worker envelope, not the raw Telegram update, binary media, stack trace, credentials or arbitrary runtime object. The worker identity is taken from the error's `workflow` field and must resolve through the existing worker allow-list. For `/retry`, WF01 supplies the required core/router tables plus `RETRY_CONTEXT`; other commands do not fetch this operational payload.

### Executing `/retry`

1. Authorize the actor against the active command permission and the current topic/branch rules.
2. Resolve the requested error's latest state; require it to be open and retryable. Resolve its operation in `RETRY_CONTEXT`; require `READY` and a matching hash, `operation_id`, `branch_id`, idempotency key and allow-listed worker.
3. If the business `OPERATION` is already `COMMITTED`, do not call the worker again; finalize the stale retry metadata safely instead. Missing or contradictory identifiers, mismatched hashes, unknown workers, non-retryable errors, or `MANUAL_REVIEW` state fail closed.
4. Call the worker with the stored envelope unchanged. The new Telegram request ID and retrying actor are audit metadata outside that envelope; they must not replace its original `request_id`, `operation_id`, config snapshot or idempotency key.
5. Append retry-attempt audit events to `EVENT_LOG`. A failed retry retains the payload and returns the context to `READY` only when the worker outcome is a clear retryable failure. An uncertain or contradictory outcome moves it to `MANUAL_REVIEW` and blocks another dispatch.
6. On confirmed success, append resolution state rows to `ERROR_BIA` (do not edit/delete the prior error rows), append the success audit event, and clear `worker_envelope_json` while retaining its hash and `CONSUMED` state. Readers use the latest row for an `error_id` when determining whether that error is resolved.
7. A retry failure is appended as a new error-history row, correlated by the original `operation_id` and the new retry request ID. The retry request ID is used as the error-attempt `request_id`/fingerprint context; the original business request ID remains in the stored envelope. No existing error-history row is overwritten.

### Duplicate and concurrent retries

Redelivery of the same Telegram `update_id` must be suppressed by the Router's existing request/idempotency reservation. Google Sheets `appendOrUpdate` is not treated as an atomic per-error lock. Separate concurrent `/retry` messages therefore rely on each worker safely resuming the same operation using the unchanged `operation_id` and idempotency key. Production readiness requires evidence that every worker enabled for retry enforces that contract; otherwise retry stays disabled for that worker and the Issue #3 production gate remains red.

## Privacy, retention and partial failures

- Restrict the `RETRY_CONTEXT` tab to the n8n service identity and authorized operators; do not emit its payload to execution logs, Telegram replies, exports, repository fixtures or evidence artifacts.
- The exact envelope may contain business text, so access to the tab is operationally sensitive even though credentials and binary media are excluded.
- If serialization or safe-cell-size validation fails, the error is not retryable.
- Clear the payload only after a confirmed committed operation. If the worker result is uncertain, or finalization cannot be confirmed, preserve the context as `MANUAL_REVIEW`; the committed operation state is the fence against replaying completed business effects.
- Do not introduce a new hard-coded TTL. Unresolved retry contexts are not eligible for rotation/purge. Resolved audit rows follow ADR 0012's weekly archive verification and purge rules; this Issue does not implement a separate retention job.

## Required verification

### Automated tests

- Retryable failure stores exactly the worker envelope and matching SHA-256 before the retryable `ERROR_BIA` record is exposed.
- Non-retryable, malformed, oversized, unpersistable or conflicting envelopes cannot be retried.
- Authorization, permission, topic/branch scope, worker allow-list, error latest-state and operation-state checks fail closed.
- Retry dispatch is byte-for-byte equivalent at the JSON string level to the stored envelope and preserves the original `operation_id` and idempotency key.
- Clear retryable failure retains context and appends history; success appends resolution/audit records, clears the payload and retains its hash.
- A repeated Telegram update produces no second business dispatch. Test the worker replay contract for each worker eligible for retry; do not claim an atomic lock.
- Partial-finalization and unknown-worker outcomes enter `MANUAL_REVIEW` and cannot be dispatched again.

### Repository, shadow and release gates

1. Build WF01/WF02/WF03 artifacts and run workflow validation plus `npm run verify`.
2. Review the complete branch against fixed point `c75d8e7`; update existing PR #21 only, never create a duplicate PR.
3. Prepare a Sheet migration guide/artifact for the approved schema and version values. Do not edit the live Sheet directly or change production configuration during testing.
4. Run shadow/test n8n smoke for `/help`, `/trangthai`, `/kiemke`, `/nhaphang`, `/nhapban`, permission denial and retry success/failure/idempotency. `/baocaobia` is excluded until WF10 exists.
5. Do not publish/activate production, merge PR #21 or close Issue #3 until review and all in-scope smoke cases are green. The user must confirm before any production cutover.

## Explicit non-goals

- WF10 and `/baocaobia`.
- Editing the live Google Sheet or production n8n workflows during implementation/testing.
- Reconstructing a request from `ERROR_BIA`, changing the original envelope, changing an idempotency key, or retrying a validation error blindly.
- Claiming Google Sheets provides an atomic distributed lock.
- Implementing retention/archive behavior beyond following the existing ADR 0012 contract.
