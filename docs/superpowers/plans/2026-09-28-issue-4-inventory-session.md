# Issue #4 Inventory Session and Bubble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WF05 opens one scheduled inventory session with a fixed beer catalog and one Telegram bubble, while `/kiemke` can only resume the committed session/bubble.

**Architecture:** A pure session planner decides `OPEN`, `RESUME`, `RECONCILE`, or safe rejection from a standard envelope and committed Sheet rows. The n8n graph stages `OPERATION`, session and audit before Telegram send; a `SEND_REQUESTED` marker prevents blind resend if the API outcome is unknown. After a known message ID is saved, WF05 commits the operation, edits that same message on resume, and treats pin failure as a warning.

**Tech Stack:** Node.js ESM, `node:test`, n8n workflow JSON builder, Google Sheets V2 nodes, n8n Telegram nodes.

**Spec:** [Approved WF05/WF06 Telegram design](https://github.com/devphucthinh/n8n-Modus/blob/9b985150ed4120cae4740446a96b746e8fbca368/docs/superpowers/specs/2026-09-25-wf05-wf06-inventory-telegram-design.md), [Issue #4](https://github.com/devphucthinh/n8n-Modus/issues/4), `docs/specs/kiem-ke-bia-v2.md`.

## Global Constraints

- The user's 2026-09-28 decision supersedes the older auto-create behavior: `CONFIG_TOPIC` must contain an active `KIEM_KE` mapping. If missing, stop and request configuration; never create a topic or mutate `CONFIG_TOPIC` at runtime.
- No Apps Script LockService. Treat unknown Telegram or Sheet outcomes as reconciliation-required, not as success or permission to resend.
- `CONFIG_BIA` and page size come from versioned Sheet configuration. Freeze ACTIVE beers and their `thu_tu_hien_thi` order at opening; do not recalculate an existing session's STT.
- All Google Sheets reads use `executeOnce: true` and `returnAll: true`; only committed operations/sessions are visible to resume.
- Do not import, activate, or smoke with the published Sheet until a reviewed migration and precise write scope are approved. PR #21 is the original Router change; do not create a duplicate PR. The remaining worker-agnostic WF03 replay/reconciliation work is a separate follow-up from `master`, not part of Issue #4.
- The Issue #4 WF05 candidate accepts one exact `RUNNING` Router reservation with an empty `expected_row_count`, while retaining compatibility with legacy `PREPARED` reservations whose count is 1 or 2. This is a worker-contract change only; WF03 remains a separate follow-up from `master`. Do not import WF03 into Issue #4 or treat this unit-level compatibility as an integration/smoke pass.
- Test behavior at pure worker-contract seams. Do not select workflow nodes by name or assert node positions, connections, or internal expressions in tests. Graph-only invariants belong in `scripts/validate-workflows.mjs` or the review handoff's manual checklist.
- Never commit, push, or create a PR as part of this plan until the user explicitly clears the branch boundary.

---

### Task 1: Enforce scheduled open and configured-topic-only resume

**Files:**
- Modify: `src/inventory-session/open-session.mjs`
- Modify: `workflow-src/WF05_V2_MO_PHIEN_KIEM_KE.mjs`
- Modify: `scripts/build-workflows.mjs` (`buildInventorySessionWorkflow` only)
- Modify: `test/inventory-session/open-session.test.mjs`
- Test: `test/inventory-session/open-session.test.mjs`
- Test: `test/workflows/dispatcher-worker-contract.test.mjs`

**Interfaces:**
- Consumes: `openOrReuseInventorySession({ envelope, configSnapshotId, topics, sessions, branch, now })`; `envelope.event_type` is `SCHEDULED_JOB` for open and `TELEGRAM_UPDATE` for `/kiemke` resume.
- Produces: `{ ok:false, error_code:'INVENTORY_SESSION_NOT_OPEN' }` for Telegram with no committed session; `{ ok:false, error_code:'INVENTORY_TOPIC_NOT_CONFIGURED' }` if opening without active mapping; no `CONFIG_TOPIC` write or Telegram create request.

- [ ] **Step 1: Add failing pure-planner tests.** A Telegram `/kiemke` request with zero sessions returns `INVENTORY_SESSION_NOT_OPEN` and an empty write plan. A scheduled request with no `CONFIG_TOPIC` returns `INVENTORY_TOPIC_NOT_CONFIGURED`. An existing active committed session with `master_message_id: '501'` resumes that same ID, business date, catalog snapshot and config snapshot. Keep graph-only topic-write restrictions in validator/manual review.
- [ ] **Step 2: Run the focused pure-planner tests and confirm the new behavior failures.**
- [ ] **Step 3: Preserve `event_type` in `Prepare Session Gateway Request`; use `START_OPERATION` only for scheduled opens and read-only validation for Telegram resume. Remove the topic-creation graph and code path; never synthesize an active topic row. Treat any non-committed existing session as reconciliation-required, not reusable.**
- [ ] **Step 4: Rebuild exports, run the focused tests and `npm run verify`; keep all changes local for separate Standards and Spec review.**

### Task 2: Freeze catalog and stage session without exposing it early

**Files:**
- Modify: `src/contracts/core-sheet-schema.mjs`
- Modify: `src/config-gateway/evaluate-config.mjs`
- Modify: `scripts/build-workflows.mjs`
- Modify: `workflow-src/WF05_V2_MO_PHIEN_KIEM_KE.mjs`
- Modify: `src/inventory-session/open-session.mjs`
- Modify: `test/inventory-session/open-session.test.mjs`
- Modify: `test/config-gateway/schema-validation.test.mjs`

**Interfaces:**
- Consumes: active `CONFIG_BIA` rows with `ma_bia`, `ten_bia`, `don_vi_dem`, `thu_tu_hien_thi`, `trang_thai`; active `CONFIG_GLOBAL.INVENTORY_PAGE_SIZE` as a positive integer.
- Produces: fixed `catalog_snapshot_json` on `PHIEN_KIEM_KE` ordered by numeric display order then beer code, with one-based `stt`; a new session remains `PREPARED` until bubble ID and `OPERATION` are committed.

- [ ] **Step 1: Add failing tests.** Feed three beers with `thu_tu_hien_thi` 20/10/30 and one `INACTIVE`; assert the snapshot contains only active beers in STT order 1/2. Change live config during resume and assert the stored snapshot/STT remain unchanged. Assert missing/duplicate beer code and nonpositive page size reject the open before a write plan is produced.
- [ ] **Step 2: Run `node --test --test-isolation=none test/inventory-session/open-session.test.mjs test/config-gateway/schema-validation.test.mjs`; confirm failure.**
- [ ] **Step 3: Add `CONFIG_BIA` to the Gateway's complete write fingerprint/validation scope, read it with the one-execution guard, and pass it to WF05. Store the canonical snapshot in the staged session row and reject a serialized value over Google Sheets' 50,000-character cell limit. Require the incoming dispatcher snapshot ID to match the current committed Gateway ID.**
- [ ] **Step 4: Rebuild exports, run focused tests and `npm run verify`; keep all changes local for separate Standards and Spec review.**

### Task 3: Reconcile, send, pin and resume exactly one bubble

**Files:**
- Create: `src/inventory-session/bubble-state.mjs`
- Create: `test/inventory-session/bubble-state.test.mjs`
- Modify: `src/inventory-session/open-session.mjs`
- Modify: `workflow-src/WF05_V2_MO_PHIEN_KIEM_KE.mjs`
- Modify: `scripts/build-workflows.mjs`
- Test: `test/inventory-session/bubble-state.test.mjs`
- Test: `test/workflows/dispatcher-worker-contract.test.mjs`

**Interfaces:**
- Consumes: staged session with `bubble_state` `NONE|SEND_REQUESTED|SENT|RECONCILIATION_REQUIRED`, `master_message_id`, Telegram send/edit response, active page size.
- Produces: `SEND` only from `NONE` after persisting `SEND_REQUESTED`; `RECONCILE` for `SEND_REQUESTED` without a known message ID; `EDIT` for any known message ID; sanitized pin warning on pin failure; `COMMITTED` session/operation only with a known message ID and matching dispatch key.

- [ ] **Step 1: Add failing state tests.** Verify a new session requests one send; repeated `SEND_REQUESTED` with no result requests reconciliation and zero send; known message ID 501 requests edit of 501; Telegram send success stores 501 before commit; pin failure keeps the same session and reports warning without claiming pin success.
- [ ] **Step 2: Run `node --test --test-isolation=none test/inventory-session/bubble-state.test.mjs`; confirm failure.**
- [ ] **Step 3: Implement the pure transitions and render one paginated Telegram message from the fixed catalog. Wire the n8n adapter to persist `SEND_REQUESTED` before send, save the known message ID before commit, edit the same stored message on resume, and never send on unknown outcome. Cover behavior through `bubble-state` contracts; keep send/edit topology checks in validator/manual review.**
- [ ] **Step 4: Rebuild exports, run focused tests and `npm run verify`; do not commit, push, or create a PR.**

## Migration and smoke gate

Before import, create a reviewed migration sheet showing exact headers/schema rules for `CONFIG_LICH`, `CONFIG_BIA`, `DISPATCH_HISTORY`, `HEARTBEAT`, and `PHIEN_KIEM_KE`, plus required `CONFIG_GLOBAL` keys. Preserve the user's existing workbook and config version policy. Confirm the n8n project/workflow bindings against the exact spreadsheet ID, then seek approval for the precise rows to write in the published Sheet. Smoke must capture sanitized execution IDs, Telegram bubble/message ID and the matching `OPERATION`, `PHIEN_KIEM_KE`, `EVENT_LOG`, `DISPATCH_HISTORY` and `HEARTBEAT` rows. PR #21 is the original Router change and must not be duplicated. Remaining WF03 reconciliation/replay belongs to a separate follow-up branch from `master`, not Issue #4. The worker-side `RUNNING`/unknown-count compatibility now has a local regression test; keep `/kiemke` integration and smoke deferred until both scopes pass review and an exact smoke target is explicitly confirmed.

The physical header row must be directly inspected for exact names and order on all five tabs, including empty tabs and trailing columns. This manual preflight is a hard import/smoke blocker; runtime prefix validation and local tests cannot prove physical header absence/order.
