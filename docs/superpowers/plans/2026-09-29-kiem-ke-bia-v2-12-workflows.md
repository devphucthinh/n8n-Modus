# Kiểm kê bia V2 — Kế hoạch triển khai 12 workflow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Implement all twelve Kiểm kê bia V2 workflows as importable, inactive n8n artifacts, validate them locally and as one integrated test-only system, then deliver a runnable-test ZIP with the workbook and operator documents.

**Architecture:** Reconcile schemaManifest to the approved ADR/spec before using it as the workbook contract; in particular, CONFIG_SNAPSHOT stores normalized_config_json. Put deterministic business decisions in small pure JavaScript functions; the workflow builder embeds the same function source into n8n Code nodes so unit tests and imported workflows do not diverge. WF01 is the only configuration gateway; WF02 handles safe failures; workers use an explicit envelope and staged PREPARED/COMMITTED writes; WF03 and WF04 remain the only interactive and scheduled entry points. Generated workflows remain inactive until bound and verified in the isolated test environment.

**Tech Stack:** Node.js built-in test runner, n8n workflow JSON and built-in Google Sheets/Drive/Telegram/Code/Execute Sub-workflow nodes, existing schemaManifest and @oai/artifact-tool workbook validator, PowerShell ZIP verification.

**Spec:** docs/superpowers/specs/2026-09-29-kiem-ke-bia-v2-deployment-design.md; detailed node behavior in docs/deployment/kiem-ke-bia-v2/WORKFLOW_DESIGN_BLUEPRINT.md; domain authority in CONTEXT.md and docs/adr/0001–0022.

## Global Constraints

- The live Google Sheet remains the authoritative business configuration; the XLSX is only a template or analysis snapshot.
- Implement and verify only in the isolated test environment. Do not import, activate, bind, or write to production.
- V2 is independent from V1 and the existing WF04; do not modify, rename, replace, or import over them.
- All mutable schedules, thresholds, mappings, permissions, topics, retention, and business policies come from Google Sheets through WF01.
- Never include credentials, tokens, API keys, private business data, or real test identifiers in source, documentation, logs, workflow exports, ZIPs, or issue comments.
- Keep all workflows inactive in the deliverable. Activation is a separate test-environment gate after binding, preflight, and approval.
- Every Google Sheets read executes once; configuration reads that require all active rows use returnAll; optional reads tolerate nodes not executed.
- Every durable multi-sheet operation has a stable operation_id/idempotency_key, stages records as PREPARED, commits only after all required writes succeed, and is safe to replay or recover.
- WF05 concurrency acceptance uses only the isolated self-hosted n8n test instance: production entry points WF03/WF04 must await WF05, and the test instance must set `N8N_CONCURRENCY_PRODUCTION_LIMIT=1` plus a finite `EXECUTIONS_TIMEOUT`. This is global single-flight serialization, not a per-branch lock; manual/direct WF05 executions are outside the concurrency guarantee. If the test host cannot enforce these conditions, keep the concurrency gate pending rather than treating Google Sheets read/write as an atomic lock.
- Readers ignore uncommitted records. Operational ledgers are append-only/versioned; corrections use superseding records or DIEU_CHINH_SO.
- A zero count is valid; a blank count is incomplete; negative count is invalid. Missing purchase/sales becomes zero only after the configured notice and pending-input checks.
- Invoice evidence is saved to test Drive before OCR; OCR starts only on explicit user action; only human-confirmed purchase lines enter LOG_NHAP.
- Archive purge is allowed only after read-back verification; restore creates and verifies a new workbook and never overwrites the source.
- Write tests before production logic and observe the intended failing result before implementing each behavior.
- Do not commit, push, create an issue, or create a pull request unless the user separately requests it.
- Final acceptance is one integrated E2E campaign covering all twelve workflows in the isolated test environment; local tests are readiness evidence, not formal acceptance.

## File Map

- Modify src/WF01_Evaluate_Config_Gateway.js to match the approved schemaManifest field names and snapshot contract.
- Create src/kiem-ke-bia-v2/contracts.mjs for envelope, response, safe-error, canonicalization, and stable-key behavior.
- Create src/kiem-ke-bia-v2/operation-journal.mjs for PREPARED/COMMITTED replay and recovery decisions.
- Create src/kiem-ke-bia-v2/logic/wf01-config-gateway.mjs through wf12-backup-recovery.mjs, one deterministic domain module per workflow.
- Modify tools/kiem-ke-bia-v2/build-workflows.mjs to embed tested function source, build explicit node graphs, and produce test-ready inactive JSONs.
- Modify tools/kiem-ke-bia-v2/schema-manifest.mjs and build-workbook.mjs so the generated workbook conforms to the approved field names.
- Modify tools/kiem-ke-bia-v2/validate-package.mjs and outputs/kiem-ke-bia-v2-2026-09-29/WORKFLOW_MANIFEST.json generation for runnable-test structural checks.
- Regenerate outputs/kiem-ke-bia-v2-2026-09-29/KKB_V2_WORKBOOK_TEMPLATE.xlsx from the corrected schemaManifest.
- Create focused tests under tests/kiem-ke-bia-v2/ and replace scaffold-only assertions in tests/workflow-incomplete-guard.test.mjs with behavior and artifact checks.
- Modify docs/deployment/kiem-ke-bia-v2/SETUP_GUIDE.md, IMPORT_BINDING_CHECKLIST.md, SMOKE_TEST_MATRIX.md, and WORKFLOW_DESIGN_BLUEPRINT.md; add E2E_ACCEPTANCE_RUNBOOK.md.
- Create outputs/kiem-ke-bia-v2-2026-09-29/KKB_V2_RUNNABLE_TEST_PACKAGE.zip after local validation; label it a test candidate until the integrated test-environment E2E gate passes.

## Implementation Tasks

### Task 1: Establish executable contracts and honest test seams

**Files:**
- Create: src/kiem-ke-bia-v2/contracts.mjs
- Create: src/kiem-ke-bia-v2/n8n-code.mjs
- Create: tests/kiem-ke-bia-v2/contracts.test.mjs
- Create: tests/kiem-ke-bia-v2/fixtures/configuration.mjs

**Interfaces:**
- normalizeEnvelope(input, workflowCode) returns either {ok:true,envelope} or {ok:false,error}; required IDs are never fabricated from a constant placeholder.
- success(envelope, status, data, warnings) and failure(envelope, error) produce the approved common result envelope.
- stableKey(parts) returns the same deterministic key for the same business event and different keys for different events.
- buildCodeNodeSource(entryPoint, helpers) emits self-contained n8n Code-node JavaScript from the same pure functions imported by Node tests.
- Fixtures are synthetic and conform to schemaManifest; they contain no production identifiers or credentials.

- [x] Write a failing contract test for a valid envelope, a missing required identifier, deterministic replay key, and secret/raw-payload redaction.
- [x] Run the focused contract test and observe the missing-module failures before implementation; fix the VM test harness when emitted Code-node source initially failed on top-level `return`.
- [x] Implement the shared contract helpers and the Code-node emitter without n8n-only global dependencies in the pure functions.
- [x] Run focused tests and execute emitted code in a VM with a literal input, comparing its result with the imported function.
- [ ] Full auto-discovered suite green — deferred to Task 15: `workflow-incomplete-guard.test.mjs` remains 10/12 in a safe temporary-mirror run; two assertions expect stale WF01/WF02 `INCOMPLETE` status. Do not report the full suite as passing.

### Task 2: Align the schema and implement WF01 Config Gateway

**Files:**
- Modify: src/WF01_Evaluate_Config_Gateway.js
- Create: src/kiem-ke-bia-v2/logic/wf01-config-gateway.mjs
- Modify: tools/kiem-ke-bia-v2/schema-manifest.mjs
- Modify: tools/kiem-ke-bia-v2/build-workbook.mjs
- Regenerate: outputs/kiem-ke-bia-v2-2026-09-29/KKB_V2_WORKBOOK_TEMPLATE.xlsx
- Modify: tests/wf01-config-gateway.test.mjs
- Modify: tools/kiem-ke-bia-v2/build-workflows.mjs

**Interfaces:**
- evaluateConfigGateway({envelope,tables,now}) returns a validated configuration result, immutable snapshot payload, fingerprint, and ordered write plan, or a safe classified error.
- The approved ADR/spec takes precedence over the current scaffold: reconcile CONFIG_SNAPSHOT to config_fingerprint, branch_scope, and normalized_config_json, then regenerate the workbook and manifest from that corrected contract.

- [x] Add a failing manifest/workbook assertion requiring CONFIG_SNAPSHOT.normalized_config_json, and run the focused gateway test to observe failure against the current snapshot_json scaffold.
- [x] Change the manifest header to normalized_config_json, regenerate the workbook, and rerun the focused header test to verify the approved contract.
- [x] Add a failing WF01 test for missing schema headers and invalid references; run it and confirm the error identifies the specific sheet/field.
- [x] Implement WF01 column-name validation and scoped table selection; rerun the focused test and confirm invalid config yields no write plan.
- [x] Add failing WF01 tests for inactive rows, version/fingerprint mismatch, stable snapshot reuse, and oversized-but-reversible snapshot encoding; run and record the expected failures.
- [x] Implement canonical full-content fingerprinting and reversible columnar encoding; run the focused suite and confirm snapshots stay below the single-cell limit.
- [x] Add a failing test for maintenance mode and cutover state; implement the start/continue decision so new operations are blocked without reinterpreting already snapshotted sessions.
- [x] Generate WF01 from the tested logic; assert all Sheets reads execute once and no CONFIG_VERSION/CONFIG_SNAPSHOT row is marked committed before persistence succeeds.

### Task 3: Implement WF02 Error Handler

**Files:**
- Create: src/kiem-ke-bia-v2/logic/wf02-error-handler.mjs
- Modify: tests/wf02-error-handler-contract.test.mjs
- Create: tests/kiem-ke-bia-v2/wf02-error-handler.test.mjs
- Modify: tools/kiem-ke-bia-v2/build-workflows.mjs

**Interfaces:**
- handleWorkflowError({error,context,policy,now}) returns a redacted error record, retryability, safe user message, and notification decision without recursively invoking itself.

- [x] Add one table-driven failing test for the eight approved error classes and the expected retryable flag for each class.
- [x] Run the focused WF02 test and confirm the current placeholder classifier fails the literal class/retryability expectations.
- [x] Implement explicit class mapping and safe message generation; rerun the table-driven test.
- [x] Add a failing test that supplies nested authorization/token/raw payload fields and asserts none appear in the persisted error record or user response.
- [x] Implement redaction at the error boundary and add the non-recursive fallback for WF02 audit/notification failures; rerun both security tests.
- [x] Generate WF02 with a typed input contract, WF01-backed notification policy, sanitized ERROR_BIA/EVENT_LOG writes, and no call back to WF02 on its own failure.

### Task 4: Implement the replay-safe operation journal

**Files:**
- Create: src/kiem-ke-bia-v2/operation-journal.mjs
- Create: tests/kiem-ke-bia-v2/operation-journal.test.mjs

**Interfaces:**
- prepareOperation(envelope, workflowCode, now, existingOperations = []) creates a schema-shaped stable PREPARED operation row or returns the existing operation for a replay; the optional rows are the caller's already-read OPERATION snapshot (the helper performs no I/O).
- decideCommit(operation, requiredWrites, observedWrites) returns COMMITTED only when all required write identifiers are present; partial writes remain PREPARED and invisible through visibleCommittedRows(rows, operations).

- [x] Add a failing test where the same idempotency key is submitted twice and assert both attempts resolve to one operation identity.
- [x] Run the journal test and confirm the missing journal API creates no replay decision.
- [x] Implement stable prepare/replay decisions and rerun the focused test.
- [x] Add a failing partial-write test proving PREPARED is not visible to readers and cannot commit while one required sheet write is missing.
- [x] Implement observed-write recovery and rerun the focused journal suite.

### Task 5: Implement WF05 Open Session

**Files:**
- Create: src/kiem-ke-bia-v2/logic/wf05-open-session.mjs
- Create: tests/kiem-ke-bia-v2/wf05-open-session.test.mjs
- Modify: tests/kiem-ke-bia-v2/contracts.test.mjs
- Modify: tools/kiem-ke-bia-v2/schema-manifest.mjs
- Modify: tools/kiem-ke-bia-v2/build-workflows.mjs
- Modify: docs/deployment/kiem-ke-bia-v2/WORKFLOW_DESIGN_BLUEPRINT.md

**Interfaces:**
- openInventorySession({envelope,activeSessions,catalog,snapshot,now}) rejects a second unexpired active session for the branch, stores the immutable catalog/config reference, and requires the validated `CONFIG_GLOBAL.inventory_session_ttl_minutes` value from the WF01 snapshot; it does not invent a default.

- [x] Add failing tests for a second active session on one branch and for opening a different branch while the first remains active.
- [x] Run WF05 tests and verify the missing logic/builder behavior fails before implementation.
- [x] Implement branch-scoped active-session checks and immutable snapshot/catalog capture; focused tests pass locally.
- [x] Add failing schema tests proving `STATE_CHO.invoice_id` and `OPERATION.error_id` may be null while their reference metadata remains; add WF05 tests for missing/non-positive/non-integer TTL rejection, exact UTC expiry calculation, expiry allowing a later open without deleting prior rows, and equality of session/state expiry.
- [x] Run only `node --test --test-isolation=none tests/kiem-ke-bia-v2/contracts.test.mjs tests/kiem-ke-bia-v2/wf05-open-session.test.mjs` and confirm the new assertions fail before the fix.
- [x] Mark only those two schema fields optional in `schema-manifest.mjs`; keep all headers unchanged. Read the TTL from WF01's existing configuration snapshot, compute one `expires_at` in UTC, write it to `PHIEN_KIEM_KE` and `STATE_CHO`, and treat expired sessions as non-active without deleting their records.
- [x] Update the WF05/WF06 blueprint: state that concurrency depends on test-only n8n global single-flight serialization through WF03/WF04 production triggers (both wait for the worker), document the global-throughput tradeoff and the manual/direct-call limitation, define `inventory_session_ttl_minutes` from the validated snapshot, and require WF06 to reject expired-session actions.
- [x] Rerun the focused contracts/WF05 tests; build only WF05 in memory and assert inactive status, explicit inputs, one guarded read per sheet. Verify separately that WF03/WF04 worker-call nodes await their sub-workflows. Do not export artifacts or run the all-workflow builder in Task 5; the package export remains Task 15.

### Task 6: Implement WF06 Count Intake

**Files:**
- Create: src/kiem-ke-bia-v2/logic/wf06-count-intake.mjs
- Create: tests/kiem-ke-bia-v2/wf06-count-intake.test.mjs
- Modify: tools/kiem-ke-bia-v2/build-workflows.mjs
- Modify: tools/kiem-ke-bia-v2/schema-manifest.mjs to add the per-item count rules already required by ADR-0015/0020.
- Modify: src/kiem-ke-bia-v2/logic/wf05-open-session.mjs and its test/fixture so WF05 freezes those rules into the session snapshot consumed by WF06.
- Modify: tests/kiem-ke-bia-v2/contracts.test.mjs and tests/kiem-ke-bia-v2/fixtures/configuration.mjs for the expanded CONFIG_BIA contract.

**Interfaces:**
- acceptInventoryCount({envelope,session,currentCounts,payload,now}) distinguishes zero, blank, negative, duplicate, stale revision, preview, and explicit finalize.

- [x] Add failing tests for count 0, blank, negative, configured precision bounds, and stale revision.
- [x] Run WF06 tests and confirm the zero/blank/negative and revision assertions fail against the scaffold.
- [x] Implement count validation and optimistic revision conflict decisions; rerun the focused tests.
- [x] Add a failing test proving an action using an expired session is rejected without writing BIA_LOG or changing state; implement the `expires_at <= now` check and rerun the focused suite while retaining historical rows.
- [x] Add a failing test proving preview does not commit and only an explicit finalize action closes count intake.
- [x] Implement explicit preview/finalize transitions with append/versioned BIA_LOG rows; rerun the suite.
- [x] Generate WF06 with one-execution reads, explicit config/session snapshot inputs, and a call to WF07 only after a valid finalize.
- [x] Cover replay after a PREPARED BIA_LOG row exists: resume the same count by `entry_id`, key-idempotently upsert BIA_LOG/EVENT_LOG, and reject changed payload or mismatched operation identity under that count key.

### Task 7: Implement WF07 Reconcile and Close

**Files:**
- Create: src/kiem-ke-bia-v2/logic/wf07-reconcile-close.mjs
- Create: tests/kiem-ke-bia-v2/wf07-reconcile-close.test.mjs
- Modify: tools/kiem-ke-bia-v2/build-workflows.mjs

**Interfaces:**
- reconcileBusinessDay({envelope,opening,purchases,sales,adjustments,counts,pending,policy,now}) returns canonical values and a versioned close decision.

- [ ] Add failing arithmetic tests with hand-calculated literal expected values for opening + confirmed purchases - published sales + approved adjustments.
- [ ] Run the focused test and confirm missing-data defaults or arithmetic fail as expected.
- [ ] Implement canonical arithmetic and require committed/approved source rows; rerun the arithmetic suite.
- [ ] Add failing tests for missing-input notice, pending invoice/file blocks, red-variance explanation, and report supersession after reopening.
- [ ] Implement close eligibility, explanation, and append-only report version decisions; rerun the focused suite.
- [ ] Generate WF07 with reads of business ledgers only after WF01 configuration, and readers that exclude PREPARED rows.

### Task 8: Implement invoice ingestion WF08

**Files:**
- Create: src/kiem-ke-bia-v2/logic/wf08-invoice-ingestion.mjs
- Create: tests/kiem-ke-bia-v2/wf08-invoice-ingestion.test.mjs
- Modify: tools/kiem-ke-bia-v2/build-workflows.mjs
- Modify: docs/deployment/kiem-ke-bia-v2/SMOKE_TEST_MATRIX.md

**Interfaces:**
- processInvoiceEvent({envelope,invoice,images,action,ocrResult,mappings,conversions,now}) returns an invoice state transition and staged ledger rows.
- Drive/OCR node results enter the pure decision function as explicit inputs; no OCR request is possible until action is READ_INVOICE.

- [ ] Add a failing test for duplicate Telegram image delivery, image grouping/order, and configured maximum-image policy; run it and observe the current failure.
- [ ] Implement invoice draft/image grouping and rerun the focused test with duplicate and ordered image fixtures.
- [ ] Add a failing test proving Drive failure blocks OCR and that image receipt alone cannot start OCR.
- [ ] Implement evidence-first handling and explicit READ_INVOICE action; rerun both tests with an OCR-call spy at the external boundary.
- [ ] Add failing tests for manual fallback, line mapping/conversion, separate approver, price-warning acknowledgement, and confirmed-only LOG_NHAP publication.
- [ ] Implement the review/publish transitions and rerun all WF08 behavior tests with literal ledger rows.
- [ ] Generate WF08 so it saves original evidence to test Drive before OCR, waits for explicit OCR intent, preserves OCR raw output, and commits only after reviewer-confirmed lines.
- [ ] Run WF08 tests with synthetic invoice images/records and verify a failed Drive response yields no OCR or LOG_NHAP write.

### Task 9: Implement versioned sales ingestion WF09

**Files:**
- Create: src/kiem-ke-bia-v2/logic/wf09-sales-ingestion.mjs
- Create: tests/kiem-ke-bia-v2/wf09-sales-ingestion.test.mjs
- Modify: tools/kiem-ke-bia-v2/build-workflows.mjs
- Modify: docs/deployment/kiem-ke-bia-v2/SMOKE_TEST_MATRIX.md

**Interfaces:**
- processSalesFile({envelope,fileHash,sourceConfig,sourceRows,mappings,conversions,activeSales,pending,now}) returns per-day drafts, validation errors, dedupe/no-op decisions, or a publish plan.
- Each published sales record is versioned by branch and business_date; source rows remain traceable to the original test Drive file.

- [ ] Add failing tests for two-day splitting, source ambiguity, file-hash replay, and normalized-content no-op; run and observe the failure.
- [ ] Implement configured source selection and sales-file dedupe; rerun the focused test.
- [ ] Add failing tests for missing mapping/unit conflicts, ZERO versus BLOCK absence policy, negative quantity adjustment, and CHO_SUA_FILE blocking SYSTEM_ZERO.
- [ ] Implement row validation and missing-item policy strictly from supplied configuration; rerun the focused suite.
- [ ] Add a failing test proving a real published report versions over SYSTEM_ZERO without adding quantities to it.
- [ ] Implement preview/publish and superseding version records; rerun all WF09 tests.
- [ ] Generate WF09 to save the original report to test Drive before parse, preserve source rows, require preview/publish, and stage versioned LOG_BAN writes.
- [ ] Run focused tests and confirm a malformed received file blocks close instead of being treated as missing sales.

### Task 10: Implement reporting WF10

**Files:**
- Create: src/kiem-ke-bia-v2/logic/wf10-reporting.mjs
- Create: tests/kiem-ke-bia-v2/wf10-reporting.test.mjs
- Modify: tools/kiem-ke-bia-v2/build-workflows.mjs

**Interfaces:**
- buildPeriodReport({envelope,closedDailyReports,policy,now}) emits an immutable versioned weekly report and reports data-quality/zero-source counts.

- [ ] Add failing report tests for closed-day eligibility, branch/item totals, superseding versions, and SYSTEM_ZERO source counts.
- [ ] Run WF10 tests and record the missing report behavior.
- [ ] Implement report aggregation from committed daily reports and run the focused suite.
- [ ] Generate WF10 with config from WF01, versioned BAO_CAO_TUAN writes, and an explicit no-data/error result.

### Task 11: Implement weekly archive WF11

**Files:**
- Create: src/kiem-ke-bia-v2/logic/wf11-weekly-archive.mjs
- Create: tests/kiem-ke-bia-v2/wf11-weekly-archive.test.mjs
- Modify: tools/kiem-ke-bia-v2/build-workflows.mjs

**Interfaces:**
- planWeeklyArchive({envelope,eligibleRows,existingArchives,readBackManifest,now}) authorizes purge only after archive write, read-back, and verification.

- [ ] Add failing tests for populated week, empty week with EMPTY_VERIFIED, and a PREPARED operation that blocks archive.
- [ ] Add failing tests for manifest row/key/hash mismatch and failed read-back; assert no purge is authorized.
- [ ] Run WF11 tests and confirm the scaffold cannot produce the expected verify-before-purge decisions.
- [ ] Implement manifest verification, retention eligibility, and purge authorization; rerun the focused suite.
- [ ] Generate WF11 so the Drive archive is read back and verified before any source deletion node can execute.

### Task 12: Implement backup/recovery WF12

**Files:**
- Create: src/kiem-ke-bia-v2/logic/wf12-backup-recovery.mjs
- Create: tests/kiem-ke-bia-v2/wf12-backup-recovery.test.mjs
- Modify: tools/kiem-ke-bia-v2/build-workflows.mjs

**Interfaces:**
- planBackupRecovery({envelope,operations,backupRows,restoreTarget,ownerApproval,now}) skips unsafe backup windows and permits restore only to a new verified workbook.

- [ ] Add a failing test that PREPARED operations defer backup without deleting prior backups.
- [ ] Add a failing test that retention cannot delete old backups until a new full-workbook backup passes read-back verification.
- [ ] Add a failing restore test proving the source ID is never the destination and source switching requires owner approval.
- [ ] Implement the backup/restore decision function; run WF12 tests and confirm every failed verification path preserves source and prior backups.
- [ ] Generate WF12 with Drive copy/read-back steps and a separate owner-approved source-switch gate; never write to V1.

### Task 13: Implement Telegram Router WF03

**Files:**
- Create: src/kiem-ke-bia-v2/logic/wf03-telegram-router.mjs
- Create: tests/kiem-ke-bia-v2/wf03-telegram-router.test.mjs
- Modify: tools/kiem-ke-bia-v2/build-workflows.mjs

**Interfaces:**
- routeTelegramUpdate({update,config,user,permissions,topic,state,priorOperation,now}) returns a denial, replay result, read-only response, or one configured worker call.

- [ ] Add a failing test for duplicate Telegram update/callback replay and assert one stable idempotency key.
- [ ] Add failing authorization tests for inactive user, wrong branch/topic, missing permission, the complete permitted /help command list, and active-user /trangthai behavior.
- [ ] Run WF03 tests and confirm unauthorized input cannot select or call a worker.
- [ ] Implement normalization, WF01 authorization, replay lookup, configured worker dispatch, and safe Telegram response; rerun the focused suite.
- [ ] Generate WF03 as the only Telegram Trigger, with explicit callback/message event handling and test-only credential placeholder.

### Task 14: Implement Dispatcher WF04

**Files:**
- Create: src/kiem-ke-bia-v2/logic/wf04-dispatcher.mjs
- Create: tests/kiem-ke-bia-v2/wf04-dispatcher.test.mjs
- Modify: tools/kiem-ke-bia-v2/build-workflows.mjs

**Interfaces:**
- dispatchDueJobs({now,schedules,claims,heartbeats,config}) returns stable due keys and claim/skip/recovery actions without calling the same occurrence twice.

- [ ] Add failing schedule tests for timezone/effective dates, due windows, and one stable dispatch key per schedule/branch/local occurrence.
- [ ] Add failing concurrency/recovery tests for duplicate claim, stale heartbeat, retry limit, and one recovery notification after health returns.
- [ ] Implement due/claim/recovery decisions and rerun focused WF04 tests with fixed time and literal schedule rows.
- [ ] Generate WF04 with only the fixed ten-minute technical tick; all business schedule, grace, retry, and timezone values come through WF01.
- [ ] Verify its test-only worker binding and heartbeat paths cannot target production IDs.

### Task 15: Replace scaffold guards and strengthen package validation

**Files:**
- Modify: tools/kiem-ke-bia-v2/build-workflows.mjs
- Modify: tools/kiem-ke-bia-v2/validate-package.mjs
- Modify: tests/workflow-incomplete-guard.test.mjs
- Create: tests/kiem-ke-bia-v2/generated-workflows.test.mjs
- Modify: outputs/kiem-ke-bia-v2-2026-09-29/WORKFLOW_MANIFEST.json through the builder
- Modify: outputs/kiem-ke-bia-v2-2026-09-29/README.md

- [ ] Add failing artifact tests that reject Block Incomplete Workflow, INCOMPLETE status, duplicate/missing workflow codes, real IDs/secrets, incorrect import order, direct CONFIG_* reads by workers, missing executeOnce on reads, unguarded optional read outputs, or mismatched node contracts.
- [ ] Replace the guard with runnable behavior and set manifest status to READY_FOR_TEST while every exported workflow remains active=false.
- [ ] Validate exactly twelve workflows, workbook headers against the corrected schemaManifest/ADR contract, one Telegram trigger in WF03, the WF04 technical interval, explicit Execute Sub-workflow inputs/wait behavior, credential placeholders, and workflow binding instructions.
- [ ] Regenerate artifacts and run node --test --test-isolation=none tests/*.test.mjs, the workflow builder, workbook rebuild, and package validator with the configured bundled artifact-tool runtime.
- [ ] Parse every exported JSON; confirm no secrets/private values and all test-only binding points are documented.

### Task 16: Run one local integrated functional campaign

**Files:**
- Create: tests/kiem-ke-bia-v2/integrated-campaign.test.mjs
- Create: tests/kiem-ke-bia-v2/fixtures/campaign.mjs
- Create: tests/kiem-ke-bia-v2/support/in-memory-test-adapters.mjs
- Modify: docs/deployment/kiem-ke-bia-v2/SMOKE_TEST_MATRIX.md

- [ ] Add a failing end-to-end campaign test with synthetic branch/config/items and one call through each of WF01–WF12 decision functions.
- [ ] Assert the full business path: configure and snapshot; Telegram authorization; open session; accept explicit zero; save and review invoice; publish mapped sales; reconcile and close; produce weekly report; verify archive; backup and restore to a new test workbook.
- [ ] Inject a transient failure and replay the same idempotency key; assert exactly one committed business effect and a redacted WF02 error record.
- [ ] Implement only the smallest test adapters needed to preserve real domain logic while replacing external Sheets/Drive/Telegram/Gemini boundaries.
- [ ] Run the campaign repeatedly with literal expected rows/hashes; label it local simulated integration, not external E2E acceptance.

### Task 17: Prepare and execute the test-only E2E acceptance campaign and ZIP

**Files:**
- Create: docs/deployment/kiem-ke-bia-v2/E2E_ACCEPTANCE_RUNBOOK.md
- Modify: docs/deployment/kiem-ke-bia-v2/SETUP_GUIDE.md
- Modify: docs/deployment/kiem-ke-bia-v2/IMPORT_BINDING_CHECKLIST.md
- Modify: docs/deployment/kiem-ke-bia-v2/WORKFLOW_DESIGN_BLUEPRINT.md
- Create: outputs/kiem-ke-bia-v2-2026-09-29/KKB_V2_RUNNABLE_TEST_PACKAGE.zip
- Create after the campaign: outputs/kiem-ke-bia-v2-2026-09-29/E2E_ACCEPTANCE_REPORT.md

- [ ] Document exact test-only prerequisites: self-hosted n8n URL/version with `N8N_CONCURRENCY_PRODUCTION_LIMIT=1` and finite `EXECUTIONS_TIMEOUT`, workflow import permission, isolated Google test workbook/Drive folder, test Telegram bot/chat/topics, synthetic files, and test Gemini credential. Bind secrets inside n8n; never send tokens or write them to repository files.
- [ ] Build a READY_FOR_TEST candidate ZIP from locally validated JSONs, workbook, manifest, diagram, and operator docs; inspect its central directory and re-parse all twelve workflow members.
- [ ] If a required test environment or credential is unavailable, keep the candidate inactive, state which prerequisite is missing, and leave formal E2E acceptance pending; never substitute production.
- [ ] Before activation, verify the isolated workbook has exactly one active `CONFIG_GLOBAL` row for `inventory_session_ttl_minutes`, with `value_type=NUMBER`, global scope, and a positive integer value.
- [ ] With all prerequisites present, import inactive workflows in this exact dependency order: WF02, WF01, WF05, WF06, WF08, WF09, WF07, WF10, WF11, WF12, WF03, WF04; bind IDs/credentials in the test instance and pass readiness preflight before activating only test entry points.
- [ ] Send two session-open requests concurrently through the WF03 production trigger; assert n8n queues them, the first opens one session, and the second returns `SESSION_ALREADY_ACTIVE`. Confirm the parent waits for WF05, and do not substitute manual/direct WF05 execution. If the self-hosted concurrency or timeout settings cannot be verified, leave this acceptance gate pending.
- [ ] Run one integrated campaign in this order: WF01 validates/snapshots test config; WF02 records a deliberately induced sanitized test error; WF03 routes an authorized test command and denies an unauthorized user; WF04 claims one due test schedule; WF05 opens a session; WF06 records explicit zero and finalizes; WF08 saves a multi-image synthetic invoice to Drive before explicit OCR and human confirmation; WF09 previews/publishes a synthetic multi-day sales file; WF07 reconciles/closes the business day; WF10 builds the weekly report; WF11 verifies and archives test rows; WF12 verifies backup and restores to a new test workbook without switching the source.
- [ ] In the same campaign, replay one Telegram callback and one worker operation with the original idempotency keys; assert no duplicate ledger rows, no PREPARED row is read as committed, and no failed archive/backup validation deletes source data.
- [ ] Record sanitized pass/fail evidence per workflow, data invariants, and cleanup/rollback result in an E2E acceptance report; formal acceptance passes only if every workflow and cross-workflow assertion passes.
- [ ] After the E2E result, update the package status and rebuild the final ZIP with the sanitized report; if E2E could not run, retain the READY_FOR_TEST candidate and explicitly label acceptance pending.
- [ ] Run final unit, artifact, local integrated, workbook, ZIP, and E2E-result checks. Do not claim external E2E success until the isolated campaign actually completes.

## Acceptance Checklist

- Twelve importable workflow JSONs exist, have no execution-blocking scaffold guard, match the approved 50-tab schema, and remain inactive in the package.
- Every worker gets configuration through WF01 and every Google Sheets read obeys the one-execution guard.
- PREPARED data is ignored by readers; retry uses the same operation/idempotency identity; no duplicate ledger effects occur.
- Inventory, purchase, sales, reconciliation, report, archive, and backup invariants from the spec/ADRs have behavior tests.
- Local test suite, generated-artifact validator, workbook validation, and local integrated campaign pass.
- The isolated test-only E2E campaign executes and verifies all twelve workflows together; absent test credentials mean acceptance remains pending, not passed.
- Final ZIP contains the twelve verified workflows, workbook template, manifest, diagram, and operator/acceptance documents without secrets or private data.

## References and Test Gates

- Execute Sub-workflow input mapping, all-items/per-item behavior, and wait-for-completion options: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/
- Google Sheets supported read/append/update operations: https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googlesheets/
- Telegram Trigger event and file-download options: https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.telegramtrigger/
- Google Drive upload/download/copy capabilities: https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googledrive/
- GitHub issue lookup was attempted for devphucthinh/n8n-Modus but the configured network proxy refused the connection; no issue-derived requirement is assumed until access is available.
