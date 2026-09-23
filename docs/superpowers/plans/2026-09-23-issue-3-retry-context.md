# Issue #3 Retry Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `/retry <error_id>` to safely replay the exact original worker envelope with its original operation and idempotency identity.

**Architecture:** Keep retry decisions pure in the Telegram Router modules, persist the replay envelope through WF02 into a protected `RETRY_CONTEXT` sheet, and dispatch it through WF03's existing allow-listed worker calls. WF01 reads `RETRY_CONTEXT` only for `/retry`; successful retries append error-resolution/audit rows and scrub the stored payload. Google Sheets is not treated as an atomic lock.

**Tech Stack:** Node.js ESM (Node >=20), `node:test`, generated n8n workflow JSON, n8n Google Sheets nodes v4.5, existing Telegram and Google Sheets credential references.

**Spec:** `docs/superpowers/specs/2026-09-23-issue-3-retry-context-design.md`.

## Global Constraints

- Set `config_version` to `v1.3` and `schema_version` to `1.1`; keep the current Config Gateway fingerprint algorithm.
- Add only `branch_id` and `idempotency_key` to `ERROR_BIA`; persist replay data only in `RETRY_CONTEXT`.
- `RETRY_CONTEXT` is optional operational context, not a core or fingerprint sheet, and WF01 reads it only for `/retry`.
- Re-dispatch the stored worker envelope unchanged; preserve its original `operation_id`, config snapshot and idempotency key.
- Fail closed for validation errors, unauthorized/wrong-branch actors, missing/mismatched context, unknown workers and uncertain outcomes. If the business operation is already `COMMITTED`, never call a worker; use `RETRY_FINALIZE` only to reconcile retry metadata.
- Set n8n workflow execution-data redaction to `all` for generated WF01/WF02/WF03; a worker is not retry-eligible in shadow/production until its own execution data is also redacted and its unchanged-operation/idempotency behavior is proven.
- Do not mutate the live Google Sheet or production n8n during implementation/testing; prepare import/setup instructions only.
- Keep WF10 and `/baocaobia` outside Issue #3. Do not publish/activate production, merge PR #21 or close Issue #3 until review and every in-scope shadow smoke is green.
- The branch already contains uncommitted Issue #3 changes. Preserve them; never use blanket staging. Task-scoped local checkpoint commits are permitted only in this isolated worktree after focused tests and self-review, staging only intentional task hunks. Do not push until the complete diff boundary, review, and smoke gates pass. Do not publish/activate production, merge PR #21, or close Issue #3 in this implementation run.

---

### Task 1: Add the optional retry-context Gateway contract

**Files:**
- Modify: `src/contracts/core-sheet-schema.mjs`
- Modify: `src/config-gateway/evaluate-config.mjs`
- Modify: `src/telegram-router/required-sheet-names.mjs`
- Modify: `test/fixtures/config/valid-config.mjs`
- Test: `test/config-gateway/router-config.test.mjs`
- Test: `test/telegram-router/required-sheet-names.test.mjs`
- Modify: `workflow-src/WF01_V2_CONFIG_GATEWAY.mjs`
- Modify: `scripts/build-workflows.mjs`
- Test: `test/workflows/generated-artifacts.test.mjs`
- Generated: `workflows/WF01_V2_CONFIG_GATEWAY.json`

**Interfaces:**
- `OPERATIONAL_SHEET_DEFINITIONS.RETRY_CONTEXT` has exactly `operation_id`, `envelope_version`, `worker_envelope_json`, `envelope_sha256`, `context_status`, `created_at`, `updated_at`; `ERROR_BIA` adds only `branch_id` and `idempotency_key` to its current definition. Add a retry-specific Gateway fixture with `config_version=v1.3` and `schema_version=1.1`; leave unrelated baseline fixture defaults unchanged.
- `requiredSheetNames('/retry')` returns the router tables needed for authorization/audit plus `RETRY_CONTEXT`; `/help` excludes it and `/trangthai` returns `[]`.
- `evaluateConfigGateway({ envelope, tables, now })` validates requested `RETRY_CONTEXT` columns from `CONFIG_SCHEMA` and returns at most the one row for the requested error's operation in `response.data.context_tables.RETRY_CONTEXT` when `/retry` requests it. Resolve the latest matching `ERROR_BIA` row by `error_id`, then filter the Sheet read by its `operation_id`; never return the whole retry-context tab, copy the payload into `config_tables`, expose it to another command, or include it in the fingerprint.

- [ ] **Step 1: Write failing contract and selective-read tests**

```js
import { requiredSheetNames } from '../../src/telegram-router/required-sheet-names.mjs';
import { evaluateConfigGateway } from '../../src/config-gateway/evaluate-config.mjs';
import { envelope, FIXED_NOW, validConfigWithRetryContext } from '../fixtures/config/valid-config.mjs';

test('/retry requests RETRY_CONTEXT without making it a core or help read', () => {
  assert.ok(requiredSheetNames('/retry').includes('RETRY_CONTEXT'));
  assert.equal(requiredSheetNames('/help').includes('RETRY_CONTEXT'), false);
  assert.deepEqual(requiredSheetNames('/trangthai'), []);
});

test('Gateway returns requested retry context but rejects a missing tab', () => {
  const tables = validConfigWithRetryContext();
  tables.RETRY_CONTEXT = [{
    operation_id: 'op-original-42', envelope_version: '1.0', worker_envelope_json: '{}',
    envelope_sha256: 'hash', context_status: 'READY', created_at: FIXED_NOW, updated_at: FIXED_NOW,
  }, {
    operation_id: 'op-unrelated-99', envelope_version: '1.0', worker_envelope_json: 'must-not-leak',
    envelope_sha256: 'other-hash', context_status: 'READY', created_at: FIXED_NOW, updated_at: FIXED_NOW,
  }];
  const request = { ...envelope, payload: { command: '/retry', args: ['err-42'], intent: 'MANUAL_RETRY', required_sheet_names: requiredSheetNames('/retry') } };
  const result = evaluateConfigGateway({ envelope: request, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.equal(result.response.data.context_tables.RETRY_CONTEXT.length, 1);
  assert.equal(result.response.data.context_tables.RETRY_CONTEXT[0].operation_id, 'op-original-42');
  assert.equal(result.response.data.config_tables.RETRY_CONTEXT, undefined);
  const fingerprint = result.response.fingerprint;
  tables.RETRY_CONTEXT[0].worker_envelope_json = '{"different":"payload"}';
  assert.equal(evaluateConfigGateway({ envelope: request, tables, now: FIXED_NOW }).response.fingerprint, fingerprint);
  delete tables.RETRY_CONTEXT;
  assert.equal(evaluateConfigGateway({ envelope: request, tables, now: FIXED_NOW }).response.error_code, 'CONFIG_SHEET_MISSING');
});

test('/help never receives an unrequested retry payload even when tests provide the full table object', () => {
  const tables = validConfigWithRetryContext();
  tables.RETRY_CONTEXT = [{ operation_id: 'op-original-42', envelope_version: '1.0', worker_envelope_json: 'sensitive',
    envelope_sha256: 'hash', context_status: 'READY', created_at: FIXED_NOW, updated_at: FIXED_NOW }];
  const request = { ...envelope, payload: { command: '/help', intent: 'READ_HELP', required_sheet_names: requiredSheetNames('/help') } };
  const result = evaluateConfigGateway({ envelope: request, tables, now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.equal(result.response.data.context_tables.RETRY_CONTEXT, undefined);
  assert.equal(result.response.data.config_tables.RETRY_CONTEXT, undefined);
});
```

In `test/workflows/generated-artifacts.test.mjs`, add an artifact assertion that `WF01_V2_CONFIG_GATEWAY.settings.redactionPolicy === 'all'`.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test test/config-gateway/router-config.test.mjs test/telegram-router/required-sheet-names.test.mjs`

Expected: FAIL because `RETRY_CONTEXT` is not an allowed requested table and `/retry` does not request it.

- [ ] **Step 3: Implement the optional operational-table contract**

Add `RETRY_CONTEXT` under a separate operational-sheet definition, include it in `ALL_SHEET_DEFINITIONS` but not `CORE_SHEET_NAMES`, `ROUTER_SHEET_NAMES` or `FINGERPRINT_SHEETS`. Add the two approved columns to the `ERROR_BIA` definition and fixture; add the retry-context columns to `CONTEXT_COLUMNS`; allow them in `validateRequestedTables`. Exclude retry context from `requestedConfigTables`, and include only the row for the target operation in `contextConfigTables` when explicitly requested. Add `validConfigWithRetryContext()` for tests: it starts from the router fixture, declares the expanded error and retry-context columns at schema version `1.1`, sets its active config to `v1.3`/schema `1.1`, and leaves unrelated baseline fixtures unchanged. In WF01, resolve the requested `/retry` error from the actual normalized `payload.args[0]` (accept `payload.error_id` only as an equivalent explicit API field), look up its latest `ERROR_BIA` row, derive `operation_id`, and filter the retry-only Google Sheets read by that key; return an empty array when no matching row exists or the table was not requested. Keep `executeOnce` and `alwaysOutputData` on the Google Sheets read node. Set `redactionPolicy: 'all'` in generated workflow settings and assert it in artifact tests; imported WF01 must be manually verified to preserve that setting.

- [ ] **Step 4: Build WF01 and run focused contract/artifact tests**

Run: `node scripts/build-workflows.mjs`; then `node --test test/config-gateway/router-config.test.mjs test/telegram-router/required-sheet-names.test.mjs test/workflows/generated-artifacts.test.mjs`.

Expected: PASS; generated WF01 contains a conditional `Read RETRY_CONTEXT` path and `/help`/`/trangthai` do not read it.

### Task 2: Persist replay context before exposing a retryable error

**Files:**
- Create: `src/error-handler/retry-context.mjs`
- Create: `test/fixtures/config/retry-context.mjs`
- Test: `test/error-handler/retry-context.test.mjs`
- Modify: `src/error-handler/normalize-error.mjs`
- Modify: `workflow-src/WF02_V2_ERROR_HANDLER.mjs`
- Modify: `workflow-src/WF03_V2_TELEGRAM_ROUTER.mjs`
- Modify: `scripts/build-workflows.mjs`
- Test: `test/error-handler/normalize-error.test.mjs`
- Test: `test/e2e/router-flow.test.mjs`
- Test: `test/workflows/generated-artifacts.test.mjs`
- Generated: `workflows/WF02_V2_ERROR_HANDLER.json`
- Generated: `workflows/WF03_V2_TELEGRAM_ROUTER.json`

**Interfaces:**
- `buildRetryContextRecord({ envelope, retryable, workerWorkflow, existingRows = [], retryAttempt = false, uncertain = false, now, maxCellChars = 49000 })` returns `SKIP` for a non-retryable initial failure; `CREATE`/`REUSE` for a valid retryable envelope; `MANUAL_REVIEW` with a context patch that retains the payload for a non-retryable retry-attempt failure or uncertain outcome; or `{ ok: false, error_code }` for invalid/unserializable/oversized/unallow-listed/conflicting input.
- A valid row uses `envelope_version: '1.0'`, SHA-256 over the exact `worker_envelope_json`, and `context_status: 'READY'`.
- WF02 receives `worker_envelope` separately from error metadata, reads the existing context filtered by `operation_id`, refuses a hash conflict, writes/updates context first, and appends a retryable `ERROR_BIA` row only after context persistence succeeds. A retry-attempt failure also appends a `RETRY_FAILED` `EVENT_LOG` row keyed by the new retry request ID.

- [ ] **Step 1: Write failing context-builder tests**

```js
import { sha256 } from '../../src/config-gateway/sha256.mjs';
import { originalWorkerEnvelope } from '../fixtures/config/retry-context.mjs';
import { buildRetryContextRecord } from '../../src/error-handler/retry-context.mjs';
import { FIXED_NOW } from '../fixtures/config/valid-config.mjs';

test('stores the exact standard envelope and its hash only for an allow-listed retryable worker failure', () => {
  const result = buildRetryContextRecord({ envelope: originalWorkerEnvelope, retryable: true, workerWorkflow: 'WF05_V2_MO_PHIEN_KIEM_KE', now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.equal(result.row.worker_envelope_json, JSON.stringify(originalWorkerEnvelope));
  assert.equal(result.row.envelope_sha256, sha256(result.row.worker_envelope_json));
  assert.equal(result.row.context_status, 'READY');
});

test('does not persist a non-retryable initial failure or invalid, unknown-worker, malformed or oversized envelope', () => {
  assert.equal(buildRetryContextRecord({ envelope: originalWorkerEnvelope, retryable: false, workerWorkflow: 'WF05_V2_MO_PHIEN_KIEM_KE', now: FIXED_NOW }).row, null);
  const initial = buildRetryContextRecord({ envelope: originalWorkerEnvelope, retryable: true, workerWorkflow: 'WF05_V2_MO_PHIEN_KIEM_KE', now: FIXED_NOW });
  const manualReview = buildRetryContextRecord({ envelope: originalWorkerEnvelope, retryable: false, retryAttempt: true, workerWorkflow: 'WF05_V2_MO_PHIEN_KIEM_KE', existingRows: [initial.row], now: FIXED_NOW });
  assert.equal(manualReview.action, 'MANUAL_REVIEW');
  assert.equal(manualReview.row.worker_envelope_json, initial.row.worker_envelope_json);
  assert.equal(buildRetryContextRecord({ envelope: originalWorkerEnvelope, retryable: true, workerWorkflow: 'WF_NOT_ALLOWED', now: FIXED_NOW }).ok, false);
  assert.equal(buildRetryContextRecord({ envelope: { payload: {} }, retryable: true, workerWorkflow: 'WF05_V2_MO_PHIEN_KIEM_KE', now: FIXED_NOW }).ok, false);
  const oversized = { ...originalWorkerEnvelope, payload: { ...originalWorkerEnvelope.payload, raw_text: 'x'.repeat(80) } };
  assert.equal(buildRetryContextRecord({ envelope: oversized, retryable: true, workerWorkflow: 'WF05_V2_MO_PHIEN_KIEM_KE', now: FIXED_NOW, maxCellChars: 64 }).ok, false);
});

test('reuses an identical operation context and refuses to overwrite a conflicting one', () => {
  const created = buildRetryContextRecord({ envelope: originalWorkerEnvelope, retryable: true, workerWorkflow: 'WF05_V2_MO_PHIEN_KIEM_KE', now: FIXED_NOW });
  const reused = buildRetryContextRecord({ envelope: originalWorkerEnvelope, retryable: true, workerWorkflow: 'WF05_V2_MO_PHIEN_KIEM_KE', existingRows: [created.row], now: FIXED_NOW });
  assert.equal(reused.action, 'REUSE');
  const conflict = buildRetryContextRecord({ envelope: { ...originalWorkerEnvelope, branch_id: 'CN_OTHER' }, retryable: true, workerWorkflow: 'WF05_V2_MO_PHIEN_KIEM_KE', existingRows: [created.row], now: FIXED_NOW });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error_code, 'ERROR_RETRY_CONTEXT_CONFLICT');
});
```

In `test/fixtures/config/retry-context.mjs`, export the shared fixture exactly as follows; the same fixture is consumed by router unit and flow tests:

```js
import { sha256 } from '../../../src/config-gateway/sha256.mjs';
import { FIXED_NOW, validConfigWithRouterTables, topicFor } from './valid-config.mjs';

export const originalWorkerEnvelope = {
  request_id: 'tg-original-42', operation_id: 'op-original-42', event_type: 'TELEGRAM_COMMAND',
  // This represents an operation created before the current config was raised
  // to v1.3; retry must preserve its original config snapshot unchanged.
  actor_user_id: '10001', branch_id: 'CN_HN', business_date: null, config_version: 'v1.2',
  config_snapshot_id: 'cfg-v12-42',
  payload: { command: '/kiemke', command_code: 'CMD_KIEM_KE', topic_type: 'KIEM_KE',
    worker_workflow: 'WF05_V2_MO_PHIEN_KIEM_KE', idempotency_key: 'tg-original-42' },
};

export function retryTables() {
  const tables = validConfigWithRouterTables();
  const workerEnvelopeJson = JSON.stringify(originalWorkerEnvelope);
  tables.RETRY_CONTEXT = [{ operation_id: originalWorkerEnvelope.operation_id, envelope_version: '1.0',
    worker_envelope_json: workerEnvelopeJson, envelope_sha256: sha256(workerEnvelopeJson),
    context_status: 'READY', created_at: FIXED_NOW, updated_at: FIXED_NOW }];
  tables.OPERATION = [{ operation_id: originalWorkerEnvelope.operation_id, request_id: originalWorkerEnvelope.request_id,
    operation_type: 'KIEM_KE', idempotency_key: originalWorkerEnvelope.payload.idempotency_key,
    expected_row_count: '1', actual_row_count: '0', checksum: '', status: 'FAILED', error_id: 'err-42',
    created_at: FIXED_NOW, updated_at: FIXED_NOW }];
  return tables;
}

export function retryInput(tables, overrides = {}) {
  const command = tables.CONFIG_LENH.find((row) => row.command_text === '/retry');
  return { actorUserId: 'admin-1', errorId: 'err-42', permissionCode: command.permission_code,
    topic: topicFor('KIEM_KE'), tables, retryRequestId: 'tg-retry-99', now: FIXED_NOW, ...overrides };
}
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `node --test test/error-handler/retry-context.test.mjs test/error-handler/normalize-error.test.mjs`

Expected: FAIL because `buildRetryContextRecord` and worker-envelope capture are not implemented.

- [ ] **Step 3: Implement bounded context serialization and WF02 write ordering**

Implement the helper with the repository SHA-256 utility and `resolveWorkerTarget`. In WF03's error input, pass the original dispatch envelope separately. In WF02, read rows filtered by `operation_id`; `buildRetryContextRecord` returns `CREATE` if none exists, `REUSE` only for the exact same envelope/hash in `READY`, and a conflict error otherwise. Write `RETRY_CONTEXT` before a retryable `ERROR_BIA` row. If an initial failure is non-retryable or context validation/storage fails, never mark it retryable; append only safe error metadata if `ERROR_BIA` is writable. For a retry attempt, keep context `READY` only for a clear retryable failure; update it to `MANUAL_REVIEW` (retaining payload and hash) for non-retryable/uncertain outcomes. Use the new retry request ID for the failure row fingerprint/request ID and append a deduplicable `RETRY_FAILED` event for a clear retryable failure. Do not include the envelope in `ERROR_BIA`, logs, or Telegram replies. Set WF02 `redactionPolicy: 'all'` and test the generated setting.

- [ ] **Step 4: Assert generated WF02 ordering and failure branches**

Add artifact assertions that the WF02 path is `Normalize Workflow Error` → retryable/context validation → `Read RETRY_CONTEXT by operation_id` → conflict check → `Write RETRY_CONTEXT` → `Append ERROR_BIA`, and that non-retryable errors bypass the payload write. Assert that worker failure input includes the original envelope as a separate field and no error reply contains it. Assert that only a retry-attempt input writes the `RETRY_FAILED` audit event.
Also assert in `test/workflows/generated-artifacts.test.mjs` that `WF02_V2_ERROR_HANDLER.settings.redactionPolicy === 'all'`.

- [ ] **Step 5: Build WF02 and run focused tests**

Run: `node scripts/build-workflows.mjs`; then `node --test test/error-handler/*.test.mjs test/workflows/generated-artifacts.test.mjs`.

Expected: PASS; the error row is never marked retryable when its replay context was not stored.

### Task 3: Implement pure `/retry` validation and dispatch planning

**Files:**
- Modify: `src/telegram-router/retry-command.mjs`
- Modify: `test/telegram-router/retry-command.test.mjs`
- Modify: `test/telegram-router/command-catalog.test.mjs`
- Modify: `src/telegram-router/decide-router-response.mjs`
- Modify: `test/e2e/router-flow.test.mjs`

**Interfaces:**
- `planRetry({ actorUserId, errorId, permissionCode, topic = null, tables, retryRequestId, now })` retains the existing fail response shape. For resumable `FAILED`/`PREPARED` operations it returns `{ ok: true, retry: { error_id, operation_id, worker_workflow, worker_target, envelope, retry_request_id, branch_id }, response, write_plan }`; the write plan includes the new-update reservation and deterministic `RETRY_STARTED` EVENT_LOG row. For a `COMMITTED` operation it returns `{ ok: true, reconciliation: { error_id, operation_id, retry_request_id }, response, write_plan }` and no worker dispatch.
- `ERROR_BIA` lookup selects the last appended row for the requested `error_id`; `RETRY_CONTEXT` is indexed by `operation_id`. The function parses the envelope, recomputes the hash, matches operation/branch/idempotency fields, resolves an allow-listed target, and distinguishes `FAILED`/`PREPARED` from `COMMITTED` and unknown operation states.
- `decideRouterResponse` returns `RETRY` only for a fully authorized resumable retry, `RETRY_FINALIZE` for an already committed operation requiring metadata reconciliation, or `DENY` with a safe configured response.

- [ ] **Step 1: Write failing pure retry tests**

```js
import { originalWorkerEnvelope, retryInput, retryTables } from '../fixtures/config/retry-context.mjs';

test('authorized retry returns the original envelope and stable operation identity', () => {
  const tables = retryTables();
  const retry = planRetry(retryInput(tables));
  assert.equal(retry.ok, true);
  assert.deepEqual(retry.retry.envelope, originalWorkerEnvelope);
  assert.equal(retry.retry.envelope.operation_id, originalWorkerEnvelope.operation_id);
  assert.equal(retry.retry.envelope.payload.idempotency_key, originalWorkerEnvelope.payload.idempotency_key);
  assert.equal(retry.retry.retry_request_id, 'tg-retry-99');
});

test('retry rejects a changed hash and reconciles a committed business operation without dispatch', () => {
  const tables = retryTables();
  tables.RETRY_CONTEXT[0].worker_envelope_json = '{"tampered":true}';
  assert.equal(planRetry(retryInput(tables)).response.error_code, 'ERROR_RETRY_CONTEXT_MISMATCH');
  const committed = retryTables();
  committed.OPERATION[0].status = 'COMMITTED';
  const result = planRetry(retryInput(committed));
  assert.equal(result.ok, true);
  assert.equal(result.reconciliation.operation_id, 'op-original-42');
  assert.equal(result.retry, undefined);
});
```

- [ ] **Step 2: Run retry and router-flow tests to confirm failure**

Run: `node --test test/telegram-router/retry-command.test.mjs test/e2e/router-flow.test.mjs`.

Expected: FAIL because retries currently always return `ERROR_RETRY_CONTEXT_MISSING`.

- [ ] **Step 3: Implement validation in fail-closed order**

Keep permission and branch checks before returning any error details. Select the last row for an `error_id`; require `OPEN` and `retryable=YES`. Require exactly one matching `RETRY_CONTEXT` row with `READY`, valid JSON, correct hash, matching identifiers, and an allow-listed worker matching `ERROR_BIA.workflow` and the stored envelope's `payload.worker_workflow`. Require a matching `OPERATION` in `FAILED`, `PREPARED` or `COMMITTED`; missing or unknown state fails closed. Return the unchanged envelope plus new retry request metadata for `FAILED`/`PREPARED`; for `COMMITTED`, return reconciliation metadata that has no worker route. Remove the unconditional `/retry` hide from the help catalog; include it only for active commands where the actor has the configured permission in the current topic. Update the existing `runRouterFlow` tests and fixtures, not the live Sheet.

- [ ] **Step 4: Run focused router tests**

Run: `node --test test/telegram-router/retry-command.test.mjs test/e2e/router-flow.test.mjs test/telegram-router/command-catalog.test.mjs`.

Expected: PASS; `/retry` is advertised only when configured/authorized, and invalid attempts never produce a worker route.

### Task 4: Wire retry dispatch and append-only finalization in WF03

**Files:**
- Modify: `src/telegram-router/retry-command.mjs`
- Modify: `src/telegram-router/decide-router-response.mjs`
- Modify: `workflow-src/WF03_V2_TELEGRAM_ROUTER.mjs`
- Modify: `scripts/build-workflows.mjs`
- Test: `test/e2e/router-flow.test.mjs`
- Test: `test/workflows/generated-artifacts.test.mjs`
- Generated: `workflows/WF03_V2_TELEGRAM_ROUTER.json`

**Interfaces:**
- `ROUTE`, `RETRY` and `RETRY_FINALIZE` decisions use the existing router reservation keyed from the current Telegram update. `RETRY_FINALIZE` bypasses worker-call nodes; only `RETRY` passes the stored original envelope to a worker.
- A `RETRY` decision carries `retry` metadata separately from `retry.envelope`; the called child worker receives only `retry.envelope`.
- Append a deterministic `RETRY_STARTED` audit row after reservation but before worker dispatch; failure/uncertainty to confirm this write blocks the worker call. WF02 appends `RETRY_FAILED` for a clear retryable failure. Uncertain outcomes use `RETRY_MANUAL_REVIEW` and block dispatch.
- `buildRetryFinalizationWrites({ retry, retryFinalization, errorRows, retryContext, eventType, now })` accepts only `RETRY_SUCCEEDED` or `RETRY_RECONCILED`; it returns append-only `ERROR_BIA` resolution rows, a `RETRY_CONTEXT` update clearing `worker_envelope_json` with `CONSUMED`, and a deterministic `EVENT_LOG` row keyed by event type and retry request ID.
- `buildRetryManualReviewWrites({ retry, retryFinalization, retryContext, now })` keeps the exact payload/hash, sets `context_status: 'MANUAL_REVIEW'`, and emits a deterministic `RETRY_MANUAL_REVIEW` event row.

- [ ] **Step 1: Write failing workflow-seam and artifact tests**

```js
import { retryTables } from '../fixtures/config/retry-context.mjs';
import { buildRetryFinalizationWrites, buildRetryManualReviewWrites } from '../../src/telegram-router/retry-command.mjs';

test('retry decision dispatches only the saved business envelope and reserves the new Telegram update', () => {
  const tables = retryTables();
  const update = telegramStatusUpdate({ userId: 'admin-1', text: '/retry err-42' });
  update.update_id = 9100;
  const result = runRouterFlow({ update, tables, now: FIXED_NOW });
  assert.equal(result.decision.kind, 'RETRY');
  assert.equal(result.decision.reservation.row.idempotency_key, 'router-tg-9100');
  assert.deepEqual(result.decision.retry.envelope, JSON.parse(tables.RETRY_CONTEXT[0].worker_envelope_json));
});

test('committed retry reconciles error/context without a child worker dispatch', () => {
  const tables = retryTables();
  tables.OPERATION[0].status = 'COMMITTED';
  const update = telegramStatusUpdate({ userId: 'admin-1', text: '/retry err-42' });
  update.update_id = 9101;
  const result = runRouterFlow({ update, tables, now: FIXED_NOW });
  assert.equal(result.decision.kind, 'RETRY_FINALIZE');
  assert.equal(result.decision.retry, undefined);
  assert.equal(result.decision.retry_finalization.operation_id, 'op-original-42');
});

test('successful retry appends resolution and consumes payload without editing error history', () => {
  const tables = retryTables();
  const errorRowsBefore = JSON.stringify(tables.ERROR_BIA);
  const update = telegramStatusUpdate({ userId: 'admin-1', text: '/retry err-42' });
  update.update_id = 9100;
  const retry = runRouterFlow({ update, tables, now: FIXED_NOW }).decision.retry;
  const writes = buildRetryFinalizationWrites({ retry, errorRows: tables.ERROR_BIA, retryContext: tables.RETRY_CONTEXT[0], eventType: 'RETRY_SUCCEEDED', now: FIXED_NOW });
  assert.ok(writes.error_rows.every((row) => row.status === 'RESOLVED' && row.resolved_at === FIXED_NOW));
  assert.equal(writes.context_update.patch.worker_envelope_json, '');
  assert.equal(writes.context_update.patch.envelope_sha256, tables.RETRY_CONTEXT[0].envelope_sha256);
  assert.equal(writes.context_update.patch.context_status, 'CONSUMED');
  assert.equal(writes.event_row.event_type, 'RETRY_SUCCEEDED');
  assert.equal(JSON.stringify(tables.ERROR_BIA), errorRowsBefore);
  const repeated = buildRetryFinalizationWrites({ retry, errorRows: [...tables.ERROR_BIA, ...writes.error_rows],
    retryContext: { ...tables.RETRY_CONTEXT[0], worker_envelope_json: '', context_status: 'CONSUMED' }, eventType: 'RETRY_SUCCEEDED', now: FIXED_NOW });
  assert.equal(repeated.error_rows.length, 0);
});

test('committed reconciliation emits a distinct audit event and does not dispatch a worker', () => {
  const tables = retryTables();
  tables.OPERATION[0].status = 'COMMITTED';
  const update = telegramStatusUpdate({ userId: 'admin-1', text: '/retry err-42' });
  update.update_id = 9101;
  const result = runRouterFlow({ update, tables, now: FIXED_NOW });
  assert.equal(result.decision.kind, 'RETRY_FINALIZE');
  assert.equal(result.decision.retry, undefined);
  const writes = buildRetryFinalizationWrites({ retryFinalization: result.decision.retry_finalization,
    errorRows: tables.ERROR_BIA, retryContext: tables.RETRY_CONTEXT[0], eventType: 'RETRY_RECONCILED', now: FIXED_NOW });
  assert.equal(writes.event_row.event_type, 'RETRY_RECONCILED');
});

test('partial finalization moves context to manual review without scrubbing replay data', () => {
  const tables = retryTables();
  const writes = buildRetryManualReviewWrites({ retryFinalization: { operation_id: 'op-original-42', retry_request_id: 'tg-retry-99' },
    retryContext: tables.RETRY_CONTEXT[0], now: FIXED_NOW });
  assert.equal(writes.context_update.patch.context_status, 'MANUAL_REVIEW');
  assert.equal(writes.context_update.patch.worker_envelope_json, tables.RETRY_CONTEXT[0].worker_envelope_json);
  assert.equal(writes.context_update.patch.envelope_sha256, tables.RETRY_CONTEXT[0].envelope_sha256);
  assert.equal(writes.event_row.event_type, 'RETRY_MANUAL_REVIEW');
});

```

- [ ] **Step 2: Run focused seam/artifact tests and confirm failure**

Run: `node --test test/e2e/router-flow.test.mjs test/workflows/generated-artifacts.test.mjs`.

Expected: FAIL because WF03 currently routes only `ROUTE` and has no retry finalization path.

- [ ] **Step 3: Implement retry dispatch on the existing allow-listed worker path**

Allow the reservation gate for `ROUTE`, `RETRY` or `RETRY_FINALIZE`, but allow only `ROUTE` and `RETRY` into `Prepare Worker Dispatch`. Send `RETRY_FINALIZE` directly to the finalization nodes. In `Prepare Worker Dispatch`, select `decision.retry.envelope` for retry and `decision.route.envelope` for normal routing; derive the worker node only from the allow-list. Continue passing the exact chosen envelope to the child. Keep current `/retry` Telegram IDs and audit metadata in the parent item, never in the child envelope. Append `RETRY_STARTED` after reservation and before the worker call; a failed or uncertain write must stop dispatch. Artifact tests verify graph order `Reserve Router Operation` → `Append RETRY_STARTED` → worker call and ensure no edge from `RETRY_FINALIZE` reaches any worker call.

- [ ] **Step 4: Implement safe outcome handling**

Treat retry as successful only when the child result is `ok === true` and `status === 'COMMITTED'`. Use the same finalizer for that result and for `RETRY_FINALIZE`, but emit `RETRY_SUCCEEDED` and `RETRY_RECONCILED` respectively. Append resolution rows only for the latest unresolved `ERROR_BIA` rows matching the operation, so repeated finalization does not duplicate resolutions. Append the deterministic audit row and clear the context payload only after confirmed commit and successful resolution writes. If finalization is partial or uncertain, preserve the payload, move the context to `MANUAL_REVIEW`, append a `RETRY_MANUAL_REVIEW` event when possible, and block further dispatch. For an explicit clear retryable failure, call WF02 with the original envelope plus the new retry request ID and leave context `READY`; any non-retryable or uncertain failure moves it to `MANUAL_REVIEW`. Update tests to verify existing error rows are not mutated, finalization is idempotent, and `RETRY_FINALIZE` has no path to worker calls.

- [ ] **Step 5: Build WF03 and run focused tests**

First add an artifact assertion in `test/workflows/generated-artifacts.test.mjs` that `WF03_V2_TELEGRAM_ROUTER.settings.redactionPolicy === 'all'`. Then run: `node scripts/build-workflows.mjs`; `node --test test/e2e/router-flow.test.mjs test/telegram-router/retry-command.test.mjs test/workflows/generated-artifacts.test.mjs test/workflows/router-policy-artifacts.test.mjs`.

Expected: PASS; retry child inputs contain only the original standard envelope, while outcome writes retain an auditable history.

### Task 5: Prepare operator Sheet instructions and update Issue #3 handoff

**Files:**
- Create: `docs/maintenance/issue-3-retry-context-sheet-setup.md`
- Create: `docs/maintenance/issue-3-retry-context-header.csv`
- Modify: `test/workflows/generated-artifacts.test.mjs`
- Modify: `docs/maintenance/08-issue-3-router-handoff.md`
- Modify: `docs/handoffs/2026-09-22-issue-3-config-snapshot-handoff.md`
- Modify: `docs/testing/issue-3-evidence.md`

**Interfaces:**
- The setup guide describes, without editing the Sheet, how the operator adds `RETRY_CONTEXT`, registers seven columns in `CONFIG_SCHEMA`, sets `schema_version=1.1` and `config_version=v1.3`, keeps only the two approved `ERROR_BIA` additions, and protects payload access.
- The guide explicitly explains snapshot timing: `/help`, `/trangthai` and `/retry` are read-only and do not create a new config snapshot. In the isolated shadow Sheet only, the first valid non-read-only business command creates a `CONFIG_SNAPSHOT`/`OPERATION` pair; verify both are `COMMITTED` and the snapshot stores `v1.3`, schema `1.1`, and the expected fingerprint. Never trigger that write on the production Sheet for this test.
- The guide instructs operators to set n8n execution-data redaction to `all` for WF01/WF02/WF03 and every worker enabled for retry; this implementation does not change production settings. Shadow smoke verifies the imported setting on each workflow before exercising retry; unsupported/missing redaction keeps retry disabled and the release gate red.
- Register these exact `CONFIG_SCHEMA` rows at `schema_version=1.1`; column order is `schema_rule_id,schema_version,sheet_name,column_name,data_type,required,unique_group,reference_sheet,reference_column,allowed_values,ordinal,description_vi,trang_thai`:

```csv
rule-RETRY_CONTEXT-operation_id,1.1,RETRY_CONTEXT,operation_id,STRING,YES,RETRY_CONTEXT_OPERATION,,,,1,Stable operation key,ACTIVE
rule-RETRY_CONTEXT-envelope_version,1.1,RETRY_CONTEXT,envelope_version,STRING,YES,,,,,2,Worker envelope contract version,ACTIVE
rule-RETRY_CONTEXT-worker_envelope_json,1.1,RETRY_CONTEXT,worker_envelope_json,STRING,NO,,,,,3,Exact replay envelope; blank after consumption,ACTIVE
rule-RETRY_CONTEXT-envelope_sha256,1.1,RETRY_CONTEXT,envelope_sha256,STRING,YES,,,,,4,Hash of exact replay envelope,ACTIVE
rule-RETRY_CONTEXT-context_status,1.1,RETRY_CONTEXT,context_status,STRING,YES,,,,READY|CONSUMED|MANUAL_REVIEW,5,Replay context lifecycle,ACTIVE
rule-RETRY_CONTEXT-created_at,1.1,RETRY_CONTEXT,created_at,DATETIME,YES,,,,,6,Context creation time,ACTIVE
rule-RETRY_CONTEXT-updated_at,1.1,RETRY_CONTEXT,updated_at,DATETIME,YES,,,,,7,Context last update time,ACTIVE
```

All unspecified `unique_group`, reference and `allowed_values` cells are empty. `worker_envelope_json` is optional because successful consumption scrubs the payload while retaining the audit hash.
- Evidence docs distinguish automated local checks from pending n8n shadow smoke; they contain no payload samples, credentials or fabricated execution IDs.

- [ ] **Step 1: Add a Sheet-header artifact test**

```js
test('retry-context CSV header matches the approved ordered schema', async () => {
  const text = await readFile(path.join(root, 'docs/maintenance/issue-3-retry-context-header.csv'), 'utf8');
  assert.equal(text.trim(), 'operation_id,envelope_version,worker_envelope_json,envelope_sha256,context_status,created_at,updated_at');
});
```

- [ ] **Step 2: Run the artifact test and confirm it fails**

Run: `node --test test/workflows/generated-artifacts.test.mjs`.

Expected: FAIL because the retry-context setup artifacts do not exist.

- [ ] **Step 3: Add the import/setup guide and truthful handoff**

Document the exact header and schema-registration rows, the version change, the restricted read/write lifecycle, and the manual test sequence. Explain why read-only commands do not create a snapshot and how to verify the first v1.3 snapshot on an isolated test Sheet. Document the required execution-data redaction setting for every retry participant. Clearly state that these are instructions/artifacts only and the live Sheet has not been changed. Record `/baocaobia` as deferred until WF10 and keep all shadow execution IDs blank until supplied by actual tests.

- [ ] **Step 4: Run documentation and artifact checks**

Run: `node --test test/workflows/generated-artifacts.test.mjs`; then `rg -n -i "telegram_token|api_key|password|worker_envelope_json.*\{" docs/maintenance/issue-3-retry-context-sheet-setup.md docs/maintenance/issue-3-retry-context-header.csv docs/testing/issue-3-evidence.md`.

Expected: tests PASS; no secrets or example replay payloads appear in operator artifacts.

### Task 6: Full verification, review, shadow smoke and PR #21 gate

**Files:**
- Review: all branch changes against `c75d8e7`.
- Update only after passing gates: existing PR #21 and `docs/testing/issue-3-evidence.md`.

- [ ] **Step 1: Run the complete local verification**

Run: `npm run verify`; then `git diff --check c75d8e7`; inspect `git status --short` and every changed/untracked path. Do not stage or discard unrelated worktree changes.

Expected: workflow build, workflow validation and all tests pass; no whitespace errors; only intended Issue #3 files remain.

- [ ] **Step 2: Perform the two-axis code review**

Use `code-review` against fixed point `c75d8e7`. Resolve every blocking finding and re-run `npm run verify`. Verify in particular the latest-row semantics, retry payload redaction, child envelope identity, worker status gate and concurrent-retry limitation.

- [ ] **Step 3: Run shadow/test n8n smoke without production edits**

Import the generated WF01/WF02/WF03 into the designated test/shadow environment and verify `redactionPolicy=all` for each plus every retry-eligible worker before running retry cases. Manually verify `/help`, `/trangthai`, `/kiemke`, `/nhaphang`, `/nhapban`, unauthorized retry, retry failure, retry success, duplicate update, and committed-operation rejection. Confirm the read-only commands do not create a new snapshot; use only the isolated shadow Sheet for the first v1.3 business snapshot, and verify its linked `OPERATION` and `CONFIG_SNAPSHOT` are `COMMITTED`. Prove the unchanged operation/idempotency contract for every worker enabled for retry; otherwise disable retry for that worker and keep the gate red. If the test requires the new tab/version, use an isolated test copy of the approved Sheet; do not add tabs or change the authoritative/live Sheet. Record real execution/message IDs and outcomes in the evidence file; leave unknown evidence pending.

- [ ] **Step 4: Update existing PR #21 only after all in-scope smoke cases pass**

Commit only the reviewed Issue #3 work, push the existing branch `codex/issue-3-config-snapshot-handoff`, and update PR #21. Do not create a duplicate PR. This implementation run must not merge PR #21, close Issue #3, or activate/publish production; report the passing gates and request a separate explicit cutover confirmation.

## Handoff rule

Stop after the plan is saved and ask whether to execute inline or task-by-task with subagents. During execution, stop before production publication, merge or issue closure if any review/smoke evidence is missing. `/baocaobia` remains outside this plan until WF10 is implemented.
