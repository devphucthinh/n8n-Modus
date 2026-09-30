# Issue #4 Dispatcher Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make WF04 obtain a committed, current configuration snapshot, claim due jobs once, recover stale claims safely, and record heartbeat after worker outcomes.

**Architecture:** Keep scheduling and claim decisions in pure `src/dispatcher` functions; n8n nodes only adapt Google Sheets and worker outputs. Use the existing `dispatch_key` and stable worker operation ID on retries. A stale claim may be replayed only through the same idempotency key after a Sheet-configured lease, and the workflow must inspect the worker result before recording success/heartbeat.

**Tech Stack:** Node.js ESM, `node:test`, n8n workflow JSON builder, Google Sheets V2 nodes.

**Spec:** `docs/specs/kiem-ke-bia-v2.md`, [approved WF05/WF06 addendum at 9b98515](https://github.com/devphucthinh/n8n-Modus/blob/9b985150ed4120cae4740446a96b746e8fbca368/docs/superpowers/specs/2026-09-25-wf05-wf06-inventory-telegram-design.md), [Issue #4](https://github.com/devphucthinh/n8n-Modus/issues/4).

## Global Constraints

- The tick is a fixed technical 10 minutes; business time, timezone, grace, retry delay/limit, claim lease and heartbeat threshold come from Sheet.
- No Apps Script LockService. Google Sheets does not guarantee physical transaction isolation; use stable keys, read-back checks, idempotent worker and reconciliation for uncertain outcomes.
- Never mutate V1/WF04 legacy artifacts; WF04_V2 and WF05_V2 exports remain inactive until smoke passes.
- Do not write live production configuration during tests; only the explicitly confirmed test Sheet may receive smoke rows after confirming its n8n bindings.
- All Google Sheets read nodes use `executeOnce: true` and `returnAll: true` per `docs/agents/google-sheets-read-performance.md`.
- Test behavior at pure dispatcher/worker contract seams. Do not select workflow nodes by name or assert node positions, connections, or internal expressions in tests. Graph-only invariants belong in `scripts/validate-workflows.mjs` or the review handoff's manual checklist.
- Never commit, push, or create a PR as part of this plan until the user explicitly clears the branch boundary.

---

### Task 1: Obtain a committed Gateway snapshot for WF04

**Files:**
- Modify: `scripts/build-workflows.mjs` (`buildDispatcherWorkflow` request/edges)
- Test: `test/dispatcher/ledger-read-policy.test.mjs`
- Test: `test/workflows/dispatcher-worker-contract.test.mjs`
- Test: `test/config-gateway/versioning.test.mjs`

**Interfaces:**
- Consumes: WF01 `evaluateConfigGateway({ envelope, tables, now })` with `payload.intent = 'START_OPERATION'`.
- Produces: WF04 `Call Config Gateway` output with `response.config_snapshot_id` and `response.data.config_tables.CONFIG_LICH`; no dispatch when `ok !== true` or snapshot ID is absent.

- [ ] **Step 1: Write failing behavior tests at pure contract seams.** Verify dispatch identity/snapshot survives claim verification into a prepared inventory operation; verify the ledger-read policy emits only HEARTBEAT on a failed Gateway. Do not inspect an exported node or connection.
- [ ] **Step 2: Run the focused pure-contract tests and confirm the expected red cases.**
- [ ] **Step 3: Change the request body to `payload: { intent: 'START_OPERATION', required_sheet_names: ['CONFIG_LICH', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_THONG_BAO'] }`. In `dispatcherCode()`, gate `planDispatch` on `gateway.ok === true && gateway.response?.config_snapshot_id`; on failure emit only a failed heartbeat/diagnostic, never an action.**
- [ ] **Step 4: Rebuild with `npm run build:workflows`, run the focused test, and check that maintenance mode or invalid Gateway result cannot open a session.**
- [ ] **Step 5: Put Gateway caller binding, failure routing, and native workflow allowlist invariants in `scripts/validate-workflows.mjs`; list physical Sheet checks as manual blockers.**

### Task 2: Recover dispatch claims and honor long grace windows

**Files:**
- Modify: `src/dispatcher/decide-dispatch.mjs`
- Modify: `workflow-src/WF04_V2_DISPATCHER.mjs`
- Modify: `test/dispatcher/dispatcher.test.mjs`

**Interfaces:**
- Consumes: `planDispatch({ now, schedules, branches, history, activeSessions, configSnapshotId, claimLeaseMinutes })`; `claimLeaseMinutes` is the active `DISPATCH_CLAIM_LEASE_MINUTES` value from `CONFIG_GLOBAL`.
- Produces: actions with a stable `dispatch_key`, `business_date`, `attempt_count`, and existing `config_snapshot_id`; an uncertain stale worker state must become a reconciliation warning rather than an unguarded second worker call.

- [ ] **Step 1: Add table-driven failing tests:** a 3-day grace window finds the original business date; a stale `CLAIMED` row does not remain blocked forever; a fresh `CLAIMED` row stays blocked; a stale `RUNNING` row becomes `RECONCILIATION_REQUIRED`; a committed active session prevents another open.
- [ ] **Step 2: Run `node --test test/dispatcher/dispatcher.test.mjs`; verify the new cases fail for the intended reasons.**
- [ ] **Step 3: Replace the fixed `[today, yesterday]` candidate list with `for (let offset = 0; offset <= Math.ceil(graceMinutes / 1440) + 1; offset += 1)`, preserving the earliest valid due business date. Pass the configured claim lease to `historyBlocks`; if a `CLAIMED` row has expired, retry only with the same dispatch/operation key and within `retry_limit`; if the row is `RUNNING` or has an unknown/invalid timestamp, emit a reconciliation notice without worker invocation.**
- [ ] **Step 4: Pass the active `DISPATCH_CLAIM_LEASE_MINUTES` value from the Gateway's `CONFIG_GLOBAL` rows. Reject missing/nonpositive lease for recovery rather than silently inventing a business TTL. Run the focused tests.**
- [ ] **Step 5: Keep the changes local; perform Standards and Spec review against the declared fixed point before proposing any integration boundary.**

### Task 3: Record post-worker heartbeat and accurate worker outcome

**Files:**
- Modify: `scripts/build-workflows.mjs` (`buildDispatcherWorkflow`)
- Modify: `workflow-src/WF04_V2_DISPATCHER.mjs`
- Test: `test/dispatcher/ledger-read-policy.test.mjs`
- Test: `test/dispatcher/gateway-failure-heartbeat.test.mjs`
- Modify: `test/dispatcher/dispatcher.test.mjs`

**Interfaces:**
- Consumes: worker outcome `{ ok: boolean, error_code?: string }`, latest HEARTBEAT row, `DISPATCHER_HEARTBEAT_THRESHOLD` from `CONFIG_GLOBAL`.
- Produces: one HEARTBEAT row per completed dispatcher attempt; `FAILED` after worker failure and `HEALTHY` only after a verified successful worker; critical and recovery notices on normal Gateway-success paths are based on the persisted prior row. Keep the last validated Sheet-derived threshold and alert destination in HEARTBEAT for continuity and validation, but on any Gateway rejection/outage write only a guarded `FAILED` HEARTBEAT from that persisted configuration: do not emit threshold/recovery notices, call WF02, dispatch, or write `ERROR_BIA`.

- [ ] **Step 1: Add failing behavior regressions for post-worker outcome, Gateway failure reads only HEARTBEAT, persisted settings reuse, and fail-closed empty/unreadable/invalid rows. Test read policy and heartbeat projection through pure seams.**
- [ ] **Step 2: Run focused pure tests and confirm any new regression fails before changing decision logic.**
- [ ] **Step 3: Move normal heartbeat projection to a post-worker code node that calls `recordHeartbeat({ now, previous, failure: worker.ok !== true, threshold })`. Before reading business ledgers or planning a dispatch, require exactly one ACTIVE current `CONFIG_GLOBAL` value for the positive-safe-integer threshold and each valid numeric notification destination ID; reject incomplete/duplicate/invalid settings without a write and never fall back to persisted settings or zero. Use those current values for normal worker outcomes; preserve critical/recovery notices through WF02 on those paths. On Gateway rejection/failure, read and validate only HEARTBEAT first; append one `FAILED` row from the latest compatible, semantically valid persisted heartbeat, preserve `critical_notified`, and emit no notice or `ERROR_BIA` and make no WF02 call, including repeated failures. If HEARTBEAT is missing, unreadable, empty, malformed or semantically invalid, fail closed without a write.**
- [ ] **Step 4: Rebuild exports and run focused tests plus `npm run verify`. Workflow topology checks run through the validator; no behavioral test should assert node names or connection lists.**
- [ ] **Step 5: Review Standards and Spec separately and update the handoff; do not commit, push, or create a PR.**

## Integration Gate

**Deferred P3:** strict UTC-only validation of persisted HEARTBEAT timestamps remains deferred. This slice keeps the existing parseability check and does not tighten timestamp acceptance.

The prior review used `72469e5`; review the current isolated Issue #4 continuation against `65f3ad348878dd8e3c6ee3d658680be80ac365b6`. Do not call #4 complete until the separate WF05 session/bubble plan and the explicitly approved Issue #4 n8n test smoke are green. `/kiemke` replay/reconciliation belongs to the separate WF03 follow-up from `master`; do not fold it into Issue #4 or duplicate PR #21. Record test execution IDs and redacted Telegram/Sheet evidence; do not publish production or merge based only on unit tests.

**Smoke blocker:** physical header names/order (including empty tabs and trailing columns) require direct operator inspection; local/runtime validation cannot prove them. Native WF04 and dedicated heartbeat-Gateway IDs remain placeholders until bound and verified. Strict UTC-only HEARTBEAT timestamp validation remains deferred (P3).
