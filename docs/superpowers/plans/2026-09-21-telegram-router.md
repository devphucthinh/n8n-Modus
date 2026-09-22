# Telegram Router, Permissions and Help Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the V2 Telegram Router so one bot ingress can authorize users by branch-scoped roles, render `/help` from Google Sheets, route all approved commands by topic, and safely retry only retryable errors without duplicating operations.

**Architecture:** Keep WF03 as the only Telegram Trigger. Normalize every message/callback into the existing workflow envelope, ask the Config Gateway for the requested role/permission/topic/command tables, then perform authorization and routing in pure modules before the n8n Code nodes send a response or invoke a worker. Business labels, permissions, topic mappings, templates, and workflow references remain Sheet data; the export keeps only credential references and technical placeholders.

**Tech Stack:** Node.js ESM, `node:test`, generated n8n JSON workflows, Google Sheets configuration tables, Telegram credential `TELEGRAM_KKB_V2`.

**Spec:** `docs/specs/kiem-ke-bia-v2.md`, issue #3 at `https://github.com/devphucthinh/n8n-Modus/issues/3`, ADR 0005 and ADR 0021.

**Implementation status:** The plan is implemented on `codex/issue-3-telegram-router` and tracked in PR #21. Local workflow build/validation and the complete test suite pass; live n8n/Telegram evidence remains a release gate and is recorded in `docs/testing/issue-3-evidence.md`.

## Global Constraints

- WF03 is the only Telegram Trigger for the bot; workers receive the standard envelope.
- Google Sheets is the authoritative source for users, roles, permissions, topics, commands, message text, and access audit; no changeable business rule is hard-coded in n8n.
- Machine codes use uppercase ASCII identifiers; Vietnamese labels are display-only.
- `/trangthai` is read-only for every active configured user; every other command needs its configured permission.
- `branch_id='*'` is the global role scope; inactive or unknown users are denied without revealing roles, branches, or configuration.
- Repeated `update_id`, callback ID, or retry operation has one effective business effect. Message updates use `tg-<update_id>`; callback updates add a stable `payload.idempotency_key=tg-callback-<callback_id>` and reuse it across Telegram re-deliveries.
- Workflow exports are inactive, contain no secrets, and use `GOOGLE_SHEETS_KKB_V2`/`TELEGRAM_KKB_V2` credential names.
- Accepted routes reserve `OPERATION.idempotency_key` with a `PREPARED` row before Telegram ACK; Google Sheets uses `appendOrUpdate` matching `idempotency_key`, while access audit uses `event_id`.
- Existing WF01/WF02/WF03 Issue #2 behavior and live `/trangthai` path must remain green.

---

### Task 1: Add the router configuration contract

**Files:**
- Modify: `src/contracts/core-sheet-schema.mjs`
- Modify: `src/config-gateway/evaluate-config.mjs`
- Modify: `config/google-sheets/core-config-template.mjs`
- Test: `test/contracts/router-sheet-schema.test.mjs`
- Test: `test/config-gateway/router-config.test.mjs`
- Modify: `test/fixtures/config/valid-config.mjs`

**Interfaces:**
- `ROUTER_SHEET_DEFINITIONS` exports exact columns for `CONFIG_ROLE`, `CONFIG_PERMISSION`, `CONFIG_USER_ROLE`, `CONFIG_ROLE_PERMISSION`, `CONFIG_TOPIC`, and `CONFIG_LENH`.
- `evaluateConfigGateway({ envelope, tables, now })` accepts `envelope.payload.required_sheet_names` and returns active requested rows under `response.data.config_tables`, runtime auth context and the immutable `config_snapshot`.

- [ ] **Step 1: Write failing contract tests**

```js
test('declares router configuration sheets with stable ASCII columns', () => {
  assert.deepEqual(ROUTER_SHEET_DEFINITIONS.CONFIG_ROLE, [
    'role_code', 'role_name', 'description_vi', 'trang_thai',
  ]);
  assert.deepEqual(ROUTER_SHEET_DEFINITIONS.CONFIG_LENH, [
    'command_code', 'command_text', 'syntax', 'description_vi',
    'permission_code', 'topic_type', 'worker_workflow', 'example', 'ordinal', 'trang_thai',
  ]);
});

test('gateway exposes requested router tables but does not require them for status-only calls', () => {
  const result = evaluateConfigGateway({
    envelope: { ...envelope, payload: { command: '/help', intent: 'READ_HELP', required_sheet_names: Object.keys(routerTables) } },
    tables: { ...validConfig(), ...routerTables },
    now: FIXED_NOW,
  });
  assert.equal(result.ok, true);
  assert.equal(result.response.data.config_tables.CONFIG_LENH.length, 6);
});
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `node --test test/contracts/router-sheet-schema.test.mjs test/config-gateway/router-config.test.mjs`

Expected: FAIL because the router definitions and requested-table response do not exist.

- [ ] **Step 3: Implement the minimal contract extension**

Add the six router tables plus optional `EVENT_LOG` audit sheet as requested tables (not part of the nine required Issue #2 core sheets). Validate their columns and CONFIG_SCHEMA coverage only when requested, include only business config in the gateway fingerprint/snapshot, and expose active rows through `response.data.config_tables` plus runtime auth context. Extend the fixture/template with deterministic rows for commands, roles, permissions, a branch-scoped assignment, a topic mapping, and denied-access audit.

- [ ] **Step 4: Run focused and regression tests**

Run: `node --test test/contracts/router-sheet-schema.test.mjs test/config-gateway/router-config.test.mjs test/config-gateway/*.test.mjs test/contracts/*.test.mjs`

Expected: PASS with the original Issue #2 tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/contracts/core-sheet-schema.mjs src/config-gateway/evaluate-config.mjs config/google-sheets/core-config-template.mjs test/contracts/router-sheet-schema.test.mjs test/config-gateway/router-config.test.mjs test/fixtures/config/valid-config.mjs
git commit -m "feat: expose sheet-driven telegram router config"
```

### Task 2: Normalize commands and build the Sheet-driven help catalog

**Files:**
- Create: `src/telegram-router/command-catalog.mjs`
- Modify: `src/telegram-router/normalize-status-update.mjs` (rename exported normalizer only if backward-compatible; preserve `normalizeStatusUpdate`)
- Create: `test/telegram-router/command-catalog.test.mjs`
- Modify: `test/telegram-router/status-command.test.mjs`

**Interfaces:**
- `normalizeTelegramUpdate(update)` returns `{ envelope, reply_target, command, args, callback }`; `normalizeStatusUpdate` remains a compatibility wrapper.
- `getActiveCommands(tables, locale)` returns ordered active `CONFIG_LENH` rows.
- `formatHelp({ tables, locale='vi-VN', actor })` returns `{ text }` containing command, syntax, description, required permission, and example without exposing inactive rows.

- [ ] **Step 1: Write failing tests**

```js
test('parses bot suffix, arguments and forum topic without losing the stable key', () => {
  const result = normalizeTelegramUpdate(telegramStatusUpdate({ text: '/retry@kkb_bot err-42 arg' }));
  assert.equal(result.command, '/retry');
  assert.deepEqual(result.args, ['err-42', 'arg']);
  assert.equal(result.envelope.operation_id, 'tg-9001');
  assert.equal(result.reply_target.message_thread_id, '77');
});

test('help renders all active configured commands and omits inactive commands', () => {
  const result = formatHelp({ tables: validConfigWithRouterTables() });
  assert.match(result.text, /\/kiemke/);
  assert.match(result.text, /Cú pháp/);
  assert.match(result.text, /Quyền/);
  assert.doesNotMatch(result.text, /INACTIVE_COMMAND/);
});
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test test/telegram-router/command-catalog.test.mjs test/telegram-router/status-command.test.mjs`

Expected: FAIL because argument parsing and Sheet-driven help are not implemented.

- [ ] **Step 3: Implement normalization and catalog formatting**

Parse `/command@bot` case-insensitively, preserve the original text in `payload`, split bounded arguments, normalize callback query IDs and callback data, and keep `tg-<update_id>` as both request and operation identity. Format help from active rows ordered by `ordinal`; include `command_text`, `syntax`, `description_vi`, `permission_code`, and `example`.

- [ ] **Step 4: Run focused tests and regression tests**

Run: `node --test test/telegram-router/*.test.mjs test/e2e/status-flow.test.mjs`

Expected: PASS, including the existing `/trangthai` tests.

- [ ] **Step 5: Commit**

```bash
git add src/telegram-router/command-catalog.mjs src/telegram-router/normalize-status-update.mjs test/telegram-router/command-catalog.test.mjs test/telegram-router/status-command.test.mjs
git commit -m "feat: add sheet-driven telegram command catalog"
```

### Task 3: Implement branch-scoped authorization and safe retry

**Files:**
- Create: `src/telegram-router/authorize-command.mjs`
- Create: `src/telegram-router/retry-command.mjs`
- Create: `test/telegram-router/authorization.test.mjs`
- Create: `test/telegram-router/retry-command.test.mjs`

**Interfaces:**
- `authorizeCommand({ actorUserId, command, topic, tables, now })` returns `{ allowed, denial_code, permission_code, branch_id, role_codes }`.
- `planRetry({ actorUserId, errorId, tables, now })` returns either `{ ok:false, response }` or `{ ok:true, retry: { error_id, operation_id, idempotency_key, envelope } }`.

- [ ] **Step 1: Write failing authorization/retry tests**

```js
test('active user receives permission through a branch-scoped role', () => {
  const result = authorizeCommand({ actorUserId: '10001', command: '/kiemke', topic: topicFor('KIEM_KE'), tables: validConfigWithRouterTables(), now: FIXED_NOW });
  assert.equal(result.allowed, true);
  assert.equal(result.branch_id, 'CN_HN');
});

test('unknown and inactive users receive the same opaque denial', () => {
  const unknown = authorizeCommand({ actorUserId: '99999', command: '/kiemke', topic: topicFor('KIEM_KE'), tables: validConfigWithRouterTables(), now: FIXED_NOW });
  const inactive = authorizeCommand({ actorUserId: '10002', command: '/kiemke', topic: topicFor('KIEM_KE'), tables: validConfigWithRouterTables(), now: FIXED_NOW });
  assert.deepEqual(unknown, inactive);
  assert.equal(unknown.allowed, false);
});

test('retry keeps the original operation key and rejects non-retryable errors', () => {
  const result = planRetry({ actorUserId: 'admin-1', errorId: 'err-42', tables: validConfigWithRouterTables(), now: FIXED_NOW });
  assert.equal(result.ok, true);
  assert.equal(result.retry.operation_id, 'op-original-42');
  assert.equal(result.retry.idempotency_key, 'tg-original-42');
});
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test test/telegram-router/authorization.test.mjs test/telegram-router/retry-command.test.mjs`

Expected: FAIL because the authorization and retry modules do not exist.

- [ ] **Step 3: Implement policy evaluation**

Reject users absent or inactive in `CONFIG_USER`; for `/trangthai`, allow any active user. For other commands, resolve active `CONFIG_USER_ROLE` rows valid at `now`, accept branch `*` or the topic branch, join active `CONFIG_ROLE_PERMISSION` and `CONFIG_PERMISSION`, and require the command row's `permission_code`. Return one generic `USER_NOT_AUTHORIZED` denial shape without roles/branches/config details. For retry, require `ADMIN_RETRY`, locate an active retryable `ERROR_BIA` row, and reuse its `operation_id` plus `idempotency_key`; never synthesize a new business operation.

- [ ] **Step 4: Run focused tests, full unit tests and static checks**

Run: `node --test test/telegram-router/*.test.mjs test/e2e/status-flow.test.mjs`; then `npm test`.

Expected: PASS with no secret or internal configuration text in denial/retry responses.

- [ ] **Step 5: Commit**

```bash
git add src/telegram-router/authorize-command.mjs src/telegram-router/retry-command.mjs test/telegram-router/authorization.test.mjs test/telegram-router/retry-command.test.mjs
git commit -m "feat: enforce branch-scoped router permissions and retry"
```

### Task 4: Compose the router decision seam

**Files:**
- Create: `src/telegram-router/run-router-flow.mjs`
- Create: `test/e2e/router-flow.test.mjs`
- Modify: `test/e2e/status-flow.test.mjs`

**Interfaces:**
- `runRouterFlow({ update, tables, now })` returns `{ envelope, reply_target, decision, reply }` where `decision.kind` is one of `HELP`, `STATUS`, `ROUTE`, `RETRY`, or `DENY`.
- `decision.route` contains `{ command_code, topic_type, worker_workflow, branch_id, permission_code }` and the original operation/idempotency keys.

- [ ] **Step 1: Write failing seam tests**

```js
test('routes each configured command by topic and returns the standard envelope', () => {
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/kiemke' }), tables: validConfigWithRouterTables(), now: FIXED_NOW });
  assert.equal(result.decision.kind, 'ROUTE');
  assert.equal(result.decision.route.topic_type, 'KIEM_KE');
  assert.equal(result.decision.route.worker_workflow, 'WF05_V2_MO_PHIEN_KIEM_KE');
});

test('unknown command is denied without a worker call or write plan', () => {
  const result = runRouterFlow({ update: telegramStatusUpdate({ text: '/unknown' }), tables: validConfigWithRouterTables(), now: FIXED_NOW });
  assert.equal(result.decision.kind, 'DENY');
  assert.equal(result.decision.write_plan.length, 0);
});
```

- [ ] **Step 2: Run seam tests and confirm failure**

Run: `node --test test/e2e/router-flow.test.mjs`

Expected: FAIL because the router decision seam does not exist.

- [ ] **Step 3: Implement the composition**

Normalize the update, resolve the incoming `CONFIG_TOPIC` row by `chat_id` and `message_thread_id`, handle `/help`, `/trangthai`, `/retry`, and catalog commands, then call authorization before returning a route. Preserve a reply target for all user-facing responses. Return a read-only decision for unsupported or unauthorized commands; do not call workers or create write plans in this seam.

- [ ] **Step 4: Run the full local suite**

Run: `npm test`.

Expected: PASS with at least the original 39 tests plus the new router tests.

- [ ] **Step 5: Commit**

```bash
git add src/telegram-router/run-router-flow.mjs test/e2e/router-flow.test.mjs test/e2e/status-flow.test.mjs
git commit -m "feat: compose sheet-driven telegram router decisions"
```

### Task 5: Generate the n8n WF03 export and configuration template

**Files:**
- Modify: `workflow-src/WF03_V2_TELEGRAM_ROUTER.mjs`
- Modify: `scripts/build-workflows.mjs`
- Modify: `scripts/validate-workflows.mjs`
- Modify: `config/google-sheets/core-config-template.mjs`
- Test: `test/workflows/generated-artifacts.test.mjs`

**Interfaces:**
- `WF03_V2_TELEGRAM_ROUTER.json` contains exactly one Telegram Trigger, a self-contained normalization/router Code node, Config Gateway call, configured reply node, and no worker Telegram Trigger.
- The Execute Workflow input carries `payload.required_sheet_names` for the six router tables plus `EVENT_LOG`; router/audit reads are conditional so `/trangthai` remains core-only. The generated artifact uses only `PASTE_WF01_WORKFLOW_ID`, `GOOGLE_SHEETS_KKB_V2`, and `TELEGRAM_KKB_V2` technical placeholders.

- [ ] **Step 1: Add artifact assertions before changing the builder**

```js
test('WF03 export has one trigger and no hard-coded command or permission list', () => {
  const router = loadWorkflow('WF03_V2_TELEGRAM_ROUTER');
  assert.equal(router.nodes.filter((node) => node.type === 'n8n-nodes-base.telegramTrigger').length, 1);
  assert.doesNotMatch(JSON.stringify(router), /KIEM_KE|NHAP_HANG|CONFIG_LENH.*\/help/);
});
```

- [ ] **Step 2: Run the artifact test and confirm the new assertion fails**

Run: `node --test test/workflows/generated-artifacts.test.mjs`

Expected: FAIL because the current export only understands `/trangthai` and does not carry the router table request.

- [ ] **Step 3: Update the builder and validator**

Bundle the new pure modules into Code nodes through `sourceFile`, pass requested router table names to WF01, route the returned decision to the existing safe Telegram reply node, and keep worker workflow IDs/data in Sheet-returned fields. Extend validation to check exactly one Telegram Trigger, no credential/token/command-list secrets, and a valid self-contained Code node.

- [ ] **Step 4: Build and validate exports**

Run: `npm run build:workflows`; then `npm run validate:workflows`; then `npm test`.

Expected: all workflow JSON files regenerate, validate successfully, and the full test suite passes.

- [ ] **Step 5: Commit**

```bash
git add workflow-src/WF03_V2_TELEGRAM_ROUTER.mjs scripts/build-workflows.mjs scripts/validate-workflows.mjs config/google-sheets/core-config-template.mjs workflows/WF03_V2_TELEGRAM_ROUTER.json test/workflows/generated-artifacts.test.mjs
git commit -m "feat: generate configurable V2 telegram router workflow"
```

### Task 6: Documentation and handoff checklist

**Files:**
- Create: `docs/maintenance/08-issue-3-router-handoff.md`
- Modify: `docs/maintenance/05-operations-runbook.md`
- Modify: `docs/maintenance/06-next-steps.md`

**Interfaces:**
- The handoff names all Sheet tabs/columns, the n8n credential references, import order, WF01 dependency ID replacement, activation rules, and live smoke-test evidence fields without including secrets.

- [ ] **Step 1: Document the exact Google Sheet setup**

List the six tabs, required headers, sample machine codes, branch wildcard rules, active/inactive behavior, and the required `CONFIG_SCHEMA`/`CONFIG_VERSION` update. State that the current `.xlsx` files are snapshots, not configuration authority.

- [ ] **Step 2: Document n8n import and smoke test steps**

Record import order (`WF01`, `WF02`, `WF03`), credential names, workflow ID linking, publish/activate sequence, and test cases for `/help`, unauthorized user, each topic route, duplicate update, and `/retry`.

- [ ] **Step 3: Run documentation checks and commit**

Run: `rg -n "token|secret|api_key|password|TBD|TODO" docs/maintenance/08-issue-3-router-handoff.md`; expected no credential values or placeholders; then commit:

```bash
git add docs/maintenance/08-issue-3-router-handoff.md docs/maintenance/05-operations-runbook.md docs/maintenance/06-next-steps.md
git commit -m "docs: add issue 3 router handoff"
```

### Task 7: Review, PR, and live smoke test gate

**Files:**
- Review only: `git diff master...HEAD`
- Evidence: `docs/testing/issue-3-evidence.md`

- [ ] **Step 1: Run verification before any PR claim**

Run: `npm run validate:workflows`; `npm test`; `git diff --check master...HEAD`; and inspect `git status --short`. A build failure caused by an unwritable worktree must be resolved by running the build in a writable isolated checkout, not ignored.

- [ ] **Step 2: Run two-axis code review**

Review the branch against issue #3 and repository standards. Resolve every load-bearing finding before push; record any accepted non-blocking finding in the handoff.

- [ ] **Step 3: Push and create a PR targeting `master`**

Use branch `codex/issue-3-telegram-router`, reference issue #3 with `Closes #3`, and attach the PR to the Codex task. Do not include the integration branch or unrelated lane files.

- [ ] **Step 4: Import into a test copy of n8n Cloud**

Create/configure the six Sheet tabs first, import WF01 → WF02 → WF03, select `GOOGLE_SHEETS_KKB_V2` and `TELEGRAM_KKB_V2`, replace only the WF01 workflow ID, publish WF01/WF03, and keep worker calls inactive until their target workflows exist.

- [ ] **Step 5: Capture live smoke evidence**

Verify `/help` renders all active `CONFIG_LENH` rows, an unknown/inactive user receives opaque denial, `/trangthai` remains visible, a configured command returns the expected route envelope, duplicate update creates one event, and `/retry` rejects non-retryable/non-admin cases. Record execution IDs and Telegram message IDs without recording tokens.

- [ ] **Step 6: Close issue #3 only after evidence**

Add the evidence comment to the PR/issue, confirm CI/review status, then merge only the focused PR. Issue #4 Dispatcher is the next separate implementation after #3 is merged and live smoke-tested.
