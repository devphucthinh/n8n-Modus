# Config Gateway and Safe Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver GitHub issue #2 as the first runnable Kiểm kê bia V2 slice: a configured active user sends `/trangthai`, the shared Config Gateway validates and snapshots live Google Sheets configuration, and Telegram receives a safe status or normalized error.

**Architecture:** Keep the workflow exports self-contained for n8n, while keeping their behavior testable outside n8n. Pure ESM modules own schema validation, canonicalization, fingerprint/version decisions, staged-write planning, error sanitization, and status formatting. A deterministic generator embeds those modules into three inactive n8n workflow JSON exports; thin Google Sheets and Telegram nodes remain adapters at the external seams. A Google Sheets-ready workbook is a template/fixture only—the live Google Sheet remains authoritative.

**Tech Stack:** n8n workflow JSON, JavaScript ESM, Node.js built-in test runner and `assert`, Google Sheets and Telegram n8n nodes, `@oai/artifact-tool` for the `.xlsx` template.

**Spec:** `docs/specs/kiem-ke-bia-v2.md`; GitHub issue `#2`; ADRs `0003`, `0004`, `0005`, `0017`, `0018`, `0019`, and `0021`.

## Global Constraints

- The live Google Sheet is the authoritative business configuration. The generated workbook is only a Google Sheets-ready template and deterministic test fixture.
- V2 is independent from WF04 and must not call, rename, overwrite, or reuse WF04 state/schema.
- No schedules, TTLs, thresholds, mappings, roles, permissions, topics, notification text, or retention values may be hard-coded into workflow logic.
- n8n may contain only credential references, workflow-ID placeholders, the bootstrap spreadsheet-ID placeholder, stable protocol constants, and stable sheet/column contract names.
- Workflow exports must contain no credential IDs, tokens, API keys, private Telegram IDs, or production spreadsheet IDs.
- Record IDs are immutable. Multi-sheet writes use `PREPARED -> COMMITTED`; readers ignore any row whose operation is not `COMMITTED`.
- Technical timestamps are ISO 8601 UTC. Branch timezone is separate business configuration.
- Public tests exercise the Telegram Router and Config Gateway interfaces, not node positions or internal expressions.
- The repository currently has no initial commit. Before feature commits, create one curated documentation baseline commit containing only `AGENTS.md`, `CONTEXT.md`, `docs/agents`, `docs/adr`, `docs/maintenance`, `docs/specs`, and this plan. Do not stage legacy workflow JSON, rendered scratch folders, or unrelated `outputs` artifacts.

---

### Task 1: Establish the executable contract and deterministic fixtures

**Files:**
- Create: `package.json`
- Create: `src/contracts/workflow-envelope.mjs`
- Create: `src/contracts/core-sheet-schema.mjs`
- Create: `test/fixtures/config/valid-config.mjs`
- Create: `test/contracts/workflow-envelope.test.mjs`
- Create: `test/contracts/core-sheet-schema.test.mjs`

**Interfaces:**
- Consumes: the envelope defined in `docs/maintenance/04-v2-target-design.md`.
- Produces: `normalizeEnvelope(input)` and `CORE_SHEET_DEFINITIONS`, used by every later task.

- [ ] **Step 1: Write the failing envelope tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEnvelope } from '../../src/contracts/workflow-envelope.mjs';

test('normalizes a status request without inventing business configuration', () => {
  const result = normalizeEnvelope({
    request_id: 'req-001',
    operation_id: 'op-001',
    event_type: 'TELEGRAM_UPDATE',
    actor_user_id: '10001',
    payload: { command: '/trangthai', intent: 'READ_STATUS' },
  });

  assert.equal(result.request_id, 'req-001');
  assert.equal(result.payload.intent, 'READ_STATUS');
  assert.equal(result.business_date, null);
});

test('rejects a request without immutable IDs', () => {
  assert.throws(
    () => normalizeEnvelope({ event_type: 'TELEGRAM_UPDATE', payload: {} }),
    /request_id.*operation_id/,
  );
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npm test -- test/contracts/workflow-envelope.test.mjs`

Expected: FAIL because `workflow-envelope.mjs` does not exist.

- [ ] **Step 3: Implement the minimal envelope interface**

```js
export function normalizeEnvelope(input) {
  const requestId = String(input?.request_id ?? '').trim();
  const operationId = String(input?.operation_id ?? '').trim();
  if (!requestId || !operationId) {
    throw new Error('request_id and operation_id are required');
  }
  return {
    request_id: requestId,
    operation_id: operationId,
    event_type: String(input.event_type ?? 'UNKNOWN'),
    branch_id: input.branch_id == null ? null : String(input.branch_id),
    actor_user_id: input.actor_user_id == null ? null : String(input.actor_user_id),
    business_date: input.business_date ?? null,
    config_version: input.config_version ?? null,
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
  };
}
```

- [ ] **Step 4: Define the core Sheet contract and fixture**

`CORE_SHEET_DEFINITIONS` must describe these nine tabs and their stable columns:

```js
export const CORE_SHEET_DEFINITIONS = Object.freeze({
  CONFIG_SCHEMA: ['schema_rule_id', 'schema_version', 'sheet_name', 'column_name', 'data_type', 'required', 'unique_group', 'reference_sheet', 'reference_column', 'allowed_values', 'ordinal', 'description_vi', 'trang_thai'],
  CONFIG_VERSION: ['config_version', 'schema_version', 'maintenance_mode', 'changed_by', 'changed_at', 'change_note', 'trang_thai'],
  CONFIG_GLOBAL: ['config_key', 'config_value', 'value_type', 'description_vi', 'trang_thai'],
  CONFIG_BRANCH: ['branch_id', 'branch_name', 'forum_chat_id', 'owner_chat_id', 'timezone', 'trang_thai'],
  CONFIG_USER: ['user_id', 'display_name', 'branch_id', 'trang_thai'],
  CONFIG_THONG_BAO: ['message_key', 'message_text', 'locale', 'trang_thai'],
  CONFIG_SNAPSHOT: ['config_snapshot_id', 'config_version', 'schema_version', 'fingerprint', 'normalized_config_json', 'operation_id', 'status', 'created_at'],
  OPERATION: ['operation_id', 'request_id', 'operation_type', 'idempotency_key', 'expected_row_count', 'actual_row_count', 'checksum', 'status', 'error_id', 'created_at', 'updated_at'],
  ERROR_BIA: ['error_id', 'error_code', 'error_class', 'retryable', 'message_safe', 'workflow', 'node', 'operation_id', 'request_id', 'config_version', 'fingerprint', 'status', 'created_at', 'resolved_at'],
});
```

The valid fixture contains only fake branch/user/chat identifiers and template text—never copied production values.

- [ ] **Step 5: Run the contract tests and verify GREEN**

Run: `npm test -- test/contracts/workflow-envelope.test.mjs test/contracts/core-sheet-schema.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the contract slice**

```bash
git add package.json src/contracts test/contracts test/fixtures/config
git commit -m "feat: define V2 gateway contracts"
```

---

### Task 2: Validate, normalize, fingerprint, and snapshot configuration

**Files:**
- Create: `src/config-gateway/evaluate-config.mjs`
- Create: `src/config-gateway/sha256.mjs`
- Create: `test/config-gateway/schema-validation.test.mjs`
- Create: `test/config-gateway/versioning.test.mjs`
- Create: `test/config-gateway/maintenance.test.mjs`
- Create: `test/fixtures/config/missing-column.mjs`
- Create: `test/fixtures/config/duplicate-key.mjs`

**Interfaces:**
- Consumes: `{ envelope, tables, now }`, where `tables` is an object keyed by stable sheet name.
- Produces: `evaluateConfigGateway(input) -> { ok, response, write_plan, diagnostics }`.

- [ ] **Step 1: Write the failing schema-validation tests**

```js
test('accepts valid config and returns an immutable snapshot ID', () => {
  const result = evaluateConfigGateway({ envelope, tables: validConfig(), now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.match(result.response.config_snapshot_id, /^cfg-v1-[a-f0-9]{16}$/);
});

test('rejects a required missing column before any write is planned', () => {
  const result = evaluateConfigGateway({ envelope, tables: missingColumn(), now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_COLUMN_MISSING');
  assert.deepEqual(result.write_plan, []);
});

test('rejects a duplicate configured unique key', () => {
  const result = evaluateConfigGateway({ envelope, tables: duplicateKey(), now: FIXED_NOW });
  assert.equal(result.ok, false);
  assert.equal(result.response.error_code, 'CONFIG_DUPLICATE_KEY');
});
```

- [ ] **Step 2: Run the schema tests and verify RED**

Run: `npm test -- test/config-gateway/schema-validation.test.mjs`

Expected: FAIL because `evaluateConfigGateway` is not implemented.

- [ ] **Step 3: Implement validation behind one deep interface**

The implementation must:

```js
export function evaluateConfigGateway({ envelope, tables, now }) {
  // 1. Validate CONFIG_SCHEMA bootstrap columns.
  // 2. Validate declared sheets, columns, types, required values, unique groups,
  //    allowed values, and references.
  // 3. Normalize only configuration tables; exclude CONFIG_VERSION and runtime
  //    ledgers from the business-content fingerprint.
  // 4. Sort keys and rows deterministically, then SHA-256 the canonical JSON.
  // 5. Compare only COMMITTED snapshots when deciding version changes.
  // 6. Return a write plan; do not perform I/O inside this module.
}
```

Use a dependency-free SHA-256 implementation that runs both in Node tests and an n8n Code node. The hash result is lowercase hexadecimal.

- [ ] **Step 4: Write version/fingerprint tests and verify RED**

```js
test('blocks changed content when config_version did not increase', () => {
  const result = evaluateConfigGateway({
    envelope,
    tables: changedConfigWithCommittedSnapshot('v1'),
    now: FIXED_NOW,
  });
  assert.equal(result.response.error_code, 'CONFIG_VERSION_NOT_INCREMENTED');
});

test('blocks an increased version when normalized content is unchanged', () => {
  const result = evaluateConfigGateway({
    envelope,
    tables: sameConfigWithCommittedSnapshot('v0'),
    now: FIXED_NOW,
  });
  assert.equal(result.response.error_code, 'CONFIG_VERSION_EMPTY_CHANGE');
});

test('ignores PREPARED snapshots when finding the accepted predecessor', () => {
  const result = evaluateConfigGateway({
    envelope,
    tables: configWithPreparedOnlySnapshot(),
    now: FIXED_NOW,
  });
  assert.equal(result.ok, true);
});
```

- [ ] **Step 5: Implement version, maintenance, and idempotent snapshot decisions**

Rules:

```text
READ_STATUS + maintenance_mode=YES -> allowed, state reports MAINTENANCE
START_OPERATION + maintenance_mode=YES -> CONFIG_MAINTENANCE
same version + different fingerprint -> CONFIG_VERSION_NOT_INCREMENTED
different version + same fingerprint -> CONFIG_VERSION_EMPTY_CHANGE
same version + same fingerprint + COMMITTED snapshot -> reuse snapshot, no writes
new accepted version/content -> deterministic snapshot ID and staged write plan
```

The new-snapshot write plan must be exactly:

```js
[
  { sheet: 'OPERATION', action: 'APPEND', row: { status: 'PREPARED', /* ... */ } },
  { sheet: 'CONFIG_SNAPSHOT', action: 'APPEND', row: { status: 'PREPARED', /* ... */ } },
  { sheet: 'CONFIG_SNAPSHOT', action: 'UPDATE', match: { config_snapshot_id }, patch: { status: 'COMMITTED' } },
  { sheet: 'OPERATION', action: 'UPDATE', match: { operation_id }, patch: { status: 'COMMITTED' } },
]
```

- [ ] **Step 6: Run all Config Gateway tests and verify GREEN**

Run: `npm test -- test/config-gateway`

Expected: valid, missing-column, duplicate-key, version mismatch, empty version, maintenance, idempotency, and PREPARED-ignore cases all PASS.

- [ ] **Step 7: Commit the Gateway slice**

```bash
git add src/config-gateway test/config-gateway test/fixtures/config
git commit -m "feat: validate and snapshot V2 configuration"
```

---

### Task 3: Normalize errors without leaking secrets

**Files:**
- Create: `src/error-handler/normalize-error.mjs`
- Create: `test/error-handler/normalize-error.test.mjs`

**Interfaces:**
- Consumes: `{ error, context, now }` from a worker or n8n Error Trigger.
- Produces: `{ response, error_row }`, where `response` is safe for Telegram and `error_row` matches `ERROR_BIA`.

- [ ] **Step 1: Write the failing sanitization tests**

```js
test('redacts nested secret-like keys and returns a safe error reference', () => {
  const result = normalizeWorkflowError({
    error: {
      code: 'CONFIG_COLUMN_MISSING',
      message: 'Missing CONFIG_BRANCH.timezone',
      credential: 'do-not-copy',
      context: { authorization: 'Bearer hidden', sheet: 'CONFIG_BRANCH' },
    },
    context: { request_id: 'req-001', operation_id: 'op-001', workflow: 'WF01_V2_CONFIG_GATEWAY' },
    now: FIXED_NOW,
  });

  assert.equal(result.response.ok, false);
  assert.match(result.response.message_safe, /error_id/);
  assert.doesNotMatch(JSON.stringify(result), /do-not-copy|Bearer hidden/);
});
```

- [ ] **Step 2: Run the error-handler test and verify RED**

Run: `npm test -- test/error-handler/normalize-error.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement deterministic classification and recursive redaction**

```js
const SECRET_KEY = /(token|secret|password|credential|authorization|api[_-]?key)/i;

export function normalizeWorkflowError({ error, context, messages, now }) {
  const errorId = deterministicErrorId(context, error);
  const safeContext = redactSecrets(context);
  return {
    response: {
      ok: false,
      request_id: context.request_id,
      operation_id: context.operation_id,
      status: 'FAILED',
      error_id: errorId,
      error_code: classifyCode(error),
      retryable: classifyRetryable(error),
      message_safe: renderMessage(messages?.ERROR_GENERIC ?? 'ERROR {error_id}', {
        error_id: errorId,
      }),
    },
    error_row: buildErrorRow(errorId, error, safeContext, now),
  };
}
```

`messages.ERROR_GENERIC` comes from `CONFIG_THONG_BAO`; the terse `ERROR {error_id}` fallback is a stable technical safety message for failures where configuration itself cannot be trusted. Do not store raw error payloads, stack traces, credentials, Telegram tokens, or spreadsheet IDs in `ERROR_BIA`.

- [ ] **Step 4: Add retryability, truncation, and stable-fingerprint cases**

Tests must distinguish validation errors from transient Google/Telegram errors, cap every persisted text field, and return the same fingerprint for the same sanitized failure context.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `npm test -- test/error-handler`

Expected: PASS with no secret-like values in serialized results.

- [ ] **Step 6: Commit the error slice**

```bash
git add src/error-handler test/error-handler
git commit -m "feat: normalize V2 workflow errors"
```

---

### Task 4: Route `/trangthai` and format a safe Telegram response

**Files:**
- Create: `src/telegram-router/normalize-status-update.mjs`
- Create: `src/telegram-router/format-status.mjs`
- Create: `test/telegram-router/status-command.test.mjs`
- Create: `test/e2e/status-flow.test.mjs`

**Interfaces:**
- Consumes: a Telegram update plus the Gateway result.
- Produces: `{ envelope, reply_target }` before the Gateway call and `{ chat_id, message_thread_id, text }` after it.

- [ ] **Step 1: Write the failing Router seam test**

```js
test('active configured user receives safe global status', () => {
  const result = runStatusFlow({
    update: telegramStatusUpdate({ userId: '10001', chatId: '-100100', threadId: '77' }),
    tables: validConfig(),
    now: FIXED_NOW,
  });

  assert.equal(result.reply.chat_id, '-100100');
  assert.equal(result.reply.message_thread_id, '77');
  assert.match(result.reply.text, /Cấu hình: v1/);
  assert.match(result.reply.text, /Chi nhánh hoạt động: 1/);
  assert.doesNotMatch(result.reply.text, /forum_chat_id|owner_chat_id|token|credential|normalized_config_json/);
});
```

- [ ] **Step 2: Run the Router test and verify RED**

Run: `npm test -- test/telegram-router/status-command.test.mjs test/e2e/status-flow.test.mjs`

Expected: FAIL because the Router modules do not exist.

- [ ] **Step 3: Implement update normalization and active-user validation**

`normalizeStatusUpdate(update)` must accept `/trangthai` with an optional bot suffix, preserve `chat_id` and `message_thread_id` as strings, generate stable request/operation IDs from `update_id`, and set `payload.intent='READ_STATUS'`.

The Gateway must reject an actor absent from active `CONFIG_USER` with `USER_NOT_ACTIVE`, without revealing whether other users, roles, branches, or configuration exist.

- [ ] **Step 4: Format messages from `CONFIG_THONG_BAO` keys**

Required configurable keys:

```text
STATUS_HEADER
STATUS_CONFIG_LINE
STATUS_BRANCH_COUNT_LINE
STATUS_BRANCH_LINE
STATUS_MAINTENANCE_LINE
ERROR_GENERIC
USER_NOT_ACTIVE
COMMAND_NOT_AVAILABLE
```

The formatter may supply protocol substitutions such as `{config_version}` and `{active_branch_count}` but must not hard-code the Vietnamese template text in Router logic.

- [ ] **Step 5: Run Router and end-to-end tests and verify GREEN**

Run: `npm test -- test/telegram-router test/e2e/status-flow.test.mjs`

Expected: PASS for active user, inactive user, maintenance status, repeated update ID, and sanitized Gateway error.

- [ ] **Step 6: Commit the Telegram status slice**

```bash
git add src/telegram-router test/telegram-router test/e2e
git commit -m "feat: add safe Telegram status route"
```

---

### Task 5: Generate three self-contained n8n workflow exports

**Files:**
- Create: `scripts/build-workflows.mjs`
- Create: `scripts/validate-workflows.mjs`
- Create: `workflow-src/WF01_V2_CONFIG_GATEWAY.mjs`
- Create: `workflow-src/WF02_V2_ERROR_HANDLER.mjs`
- Create: `workflow-src/WF03_V2_TELEGRAM_ROUTER.mjs`
- Create: `workflows/WF01_V2_CONFIG_GATEWAY.json`
- Create: `workflows/WF02_V2_ERROR_HANDLER.json`
- Create: `workflows/WF03_V2_TELEGRAM_ROUTER.json`
- Create: `test/workflows/generated-artifacts.test.mjs`

**Interfaces:**
- Consumes: the pure modules from Tasks 1–4 and technical bootstrap placeholders.
- Produces: deterministic, inactive, importable workflow JSON files whose Code nodes contain the same tested logic.

The generator imports the tested exported functions in Node, serializes each function with `Function.prototype.toString()`, and explicitly prepends every named helper that function calls. Emitted Code-node source must contain no ESM `import`/`export` statement and no runtime filesystem dependency; the generated JSON is therefore self-contained after import into n8n.

- [ ] **Step 1: Write the failing artifact tests**

```js
test('exports exactly one Telegram Trigger across the V2 workflows', async () => {
  const workflows = await loadGeneratedWorkflows();
  const triggers = workflows.flatMap((workflow) =>
    workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.telegramTrigger'),
  );
  assert.equal(triggers.length, 1);
  assert.equal(workflows.find((workflow) => workflow.name === 'WF03_V2_TELEGRAM_ROUTER').active, false);
});

test('exports contain placeholders and credential names but no secrets', async () => {
  const text = await readAllWorkflowText();
  assert.match(text, /PASTE_GOOGLE_SHEET_ID/);
  assert.match(text, /GOOGLE_SHEETS_KKB_V2/);
  assert.doesNotMatch(text, /\b\d{8,}:[A-Za-z0-9_-]{20,}\b|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._-]+/);
});
```

- [ ] **Step 2: Run the workflow tests and verify RED**

Run: `npm test -- test/workflows/generated-artifacts.test.mjs`

Expected: FAIL because no generator or workflow exports exist.

- [ ] **Step 3: Build `WF01_V2_CONFIG_GATEWAY`**

The workflow must include:

```text
Execute Workflow Trigger
  -> read CONFIG_SCHEMA / CONFIG_VERSION / CONFIG_GLOBAL / CONFIG_BRANCH /
          CONFIG_USER / CONFIG_THONG_BAO / CONFIG_SNAPSHOT / OPERATION
  -> assemble tables
  -> tested Gateway decision Code node
  -> valid? branch
       new snapshot: OPERATION PREPARED -> SNAPSHOT PREPARED -> SNAPSHOT COMMITTED -> OPERATION COMMITTED
       existing snapshot: return without writes
       invalid: execute WF02 using PASTE_WF02_WORKFLOW_ID
```

Any adapter failure after `OPERATION=PREPARED` must call WF02 with the same `operation_id`; WF02 updates that operation to `FAILED`. No status/read path may consume the associated `CONFIG_SNAPSHOT` until both snapshot and operation are `COMMITTED`.

Every Google Sheets node uses credential name `GOOGLE_SHEETS_KKB_V2` and document placeholder `PASTE_GOOGLE_SHEET_ID`.

- [ ] **Step 4: Build `WF02_V2_ERROR_HANDLER`**

Include both Execute Workflow Trigger and Error Trigger, the tested sanitizer, mandatory append to `ERROR_BIA`, optional safe Telegram reply when a reply target exists, and a normalized return envelope. Telegram credential name is `TELEGRAM_KKB_V2`; no credential ID is exported.

- [ ] **Step 5: Build the minimal `WF03_V2_TELEGRAM_ROUTER`**

The Router owns the only Telegram Trigger, recognizes only `/trangthai` in this ticket, calls `PASTE_WF01_WORKFLOW_ID`, and sends the formatted result back to the original chat/thread. Other commands return `CONFIG_THONG_BAO.COMMAND_NOT_AVAILABLE` without invoking business workers; ticket #3 expands the command catalog and permissions.

- [ ] **Step 6: Generate and validate deterministic artifacts**

Run:

```bash
npm run build:workflows
npm run build:workflows
git diff --exit-code -- workflows
npm run validate:workflows
npm test -- test/workflows/generated-artifacts.test.mjs
```

Expected: second generation produces no diff; all three JSON files parse, have unique node IDs/names, valid connections, `active=false`, placeholder bootstrap values, and no secret patterns.

- [ ] **Step 7: Commit the workflow exports**

```bash
git add scripts workflow-src workflows test/workflows package.json
git commit -m "feat: export V2 config status workflows"
```

---

### Task 6: Create the Google Sheets-ready baseline workbook and setup guide

**Files:**
- Create: `config/google-sheets/core-config-template.mjs`
- Create: `scripts/build-config-workbook.mjs`
- Create: `outputs/issue-2/KKB_V2_CONFIG_BASELINE.xlsx`
- Create: `docs/configuration/config-gateway-v2.md`
- Create: `test/google-sheets/core-config-template.test.mjs`

**Interfaces:**
- Consumes: `CORE_SHEET_DEFINITIONS` and fake fixture values.
- Produces: a styled `.xlsx` that users copy/import as tabs into the existing live Google Sheet, plus an exact n8n/bootstrap checklist.

- [ ] **Step 1: Read and follow the spreadsheet authoring resources**

Read the full spreadsheet skill resources before authoring: `routing/google_sheets.md`, `workflows/create_workflows.md`, `artifact_tool_docs/API_QUICK_START.md`, and `style_guidelines.md`. Run `mark_artifact_operation_started.mjs` exactly once immediately before the first workbook-authoring command.

- [ ] **Step 2: Write the failing template-contract test**

```js
test('template exposes every core sheet and required column exactly once', () => {
  for (const [sheetName, columns] of Object.entries(CORE_SHEET_DEFINITIONS)) {
    assert.deepEqual(template[sheetName].columns, columns);
    assert.equal(new Set(columns).size, columns.length);
  }
});

test('template contains no real credential or production identifier', () => {
  assert.doesNotMatch(JSON.stringify(template), /AIza|Bearer|bot_token|credential_id/i);
});
```

- [ ] **Step 3: Run the template test and verify RED**

Run: `npm test -- test/google-sheets/core-config-template.test.mjs`

Expected: FAIL because the template manifest does not exist.

- [ ] **Step 4: Implement the template manifest and workbook**

Use fake values only. Preserve existing snapshot vocabulary where useful (`branch_id`, `branch_name`, `forum_chat_id`, `owner_chat_id`, `ttl_minutes`, `trang_thai`) while adding the V2 schema/version fields. Apply dropdown validation for enum/config fields, freeze headers, use readable widths, and visually distinguish editable config tabs from protected runtime/audit tabs.

The workbook must contain exactly the nine core tabs from Task 1. `CONFIG_SCHEMA` declares every required column, type, uniqueness group, allowed values, and reference. `CONFIG_VERSION` starts at `v1`, and template messages live in `CONFIG_THONG_BAO`; workflow code contains no duplicate business message text.

- [ ] **Step 5: Recalculate, inspect, render, and export**

Use Artifact Tool to:

```text
recalculate once
inspect representative header/data ranges on all nine tabs
scan for formula errors
render every tab at normal zoom
export outputs/issue-2/KKB_V2_CONFIG_BASELINE.xlsx
```

Expected: no clipped headers, no formula errors, no blank default sheet, and no sensitive values.

- [ ] **Step 6: Document the live Google Sheet and n8n setup**

`docs/configuration/config-gateway-v2.md` must explain:

```text
1. Make a recovery copy of the live Google Sheet.
2. Add/copy the nine tabs; do not replace V1 tabs.
3. Fill fake template rows with real branch/user/message config.
4. Protect CONFIG_SNAPSHOT, OPERATION, and ERROR_BIA from direct editing.
5. Import WF01, then WF02, then WF03; link workflow-ID placeholders.
6. Select existing Google Sheets and Telegram credentials.
7. Keep all workflows inactive until smoke tests pass.
8. Run valid, missing-column, duplicate-key, version, and maintenance smoke cases.
```

- [ ] **Step 7: Run tests and commit the workbook slice**

Run: `npm test -- test/google-sheets test/contracts/core-sheet-schema.test.mjs`

Then:

```bash
git add config/google-sheets scripts/build-config-workbook.mjs outputs/issue-2/KKB_V2_CONFIG_BASELINE.xlsx docs/configuration test/google-sheets
git commit -m "docs: add V2 core Sheet template"
```

---

### Task 7: Verify the complete tracer bullet against issue #2

**Files:**
- Modify: `package.json`
- Create: `docs/testing/issue-2-evidence.md`
- Modify: `docs/maintenance/04-v2-target-design.md`

**Interfaces:**
- Consumes: all source modules, generated workflows, fixtures, and workbook from Tasks 1–6.
- Produces: one reproducible verification command and an evidence record mapped to every acceptance criterion.

- [ ] **Step 1: Add one full verification command**

```json
{
  "scripts": {
    "build:workflows": "node scripts/build-workflows.mjs",
    "validate:workflows": "node scripts/validate-workflows.mjs",
    "test": "node --test",
    "verify": "npm run build:workflows && npm run validate:workflows && node --test"
  }
}
```

- [ ] **Step 2: Run focused seam tests**

Run:

```bash
npm test -- test/e2e/status-flow.test.mjs
npm test -- test/config-gateway
npm test -- test/error-handler
npm test -- test/workflows
```

Expected: all focused tests PASS with no skipped acceptance case.

- [ ] **Step 3: Run the full verification suite**

Run: `npm run verify`

Expected: exit code 0, all tests pass, workflow generation is deterministic, and secret/hard-code checks pass.

- [ ] **Step 4: Perform artifact and repository checks**

Run:

```bash
git diff --check
git status --short
rg -n "AIza|Bearer [A-Za-z0-9._-]+|bot_token|api[_-]?key\s*[:=]" workflows src config docs test
```

Expected: no whitespace errors; only intended issue files changed; the secret scan has no real credential match. Review generated workflow parameters to confirm all business values come from Sheet rows.

- [ ] **Step 5: Record acceptance evidence**

`docs/testing/issue-2-evidence.md` maps all six issue criteria to test names, fixture IDs, generated workflow files, workbook tabs, command output, and any n8n smoke step that still requires the user's live credentials.

- [ ] **Step 6: Run `/code-review` and address findings**

Review from the curated documentation-baseline commit along two axes: repository standards and GitHub issue #2. Any accepted fix must rerun the affected focused test and `npm run verify`.

- [ ] **Step 7: Final verification and commit**

Run: `npm run verify` and `git diff --check` again immediately before commit.

Then:

```bash
git add package.json docs/testing/issue-2-evidence.md docs/maintenance/04-v2-target-design.md
git commit -m "test: verify V2 config status slice"
```

Do not close issue #2 until the user has imported the workflows into the real n8n instance, selected credentials, copied/configured the live Sheet tabs, and supplied smoke-test evidence. Local completion may move the issue to `ready-for-human` rather than claim live production acceptance.
