# Handoff: Issue #3 / Config Snapshot Cell Limit

Date: 2026-09-22
Branch: `codex/issue-3-config-snapshot-handoff`
Starting point: `codex/issue-3-telegram-router` at `1211b18`
Target: `master`

## Outcome so far

The live failure was a Google Sheets append rejection in WF01 at `Prepare CONFIG_SNAPSHOT` because `normalized_config_json` exceeded the 50,000-character cell limit. The live n8n draft was edited in `WF01_V2_CONFIG_GATEWAY` (`5aanaOAGNoCUPQA1`), node `Evaluate Config Gateway`, and the user reported the smoke test as stable. Treat production publish/activation as still pending until an execution proves it.

The fix now represented in source and generated artifacts:

- Fingerprints continue to use the complete canonical normalized configuration.
- A snapshot that fits uses the normal JSON payload.
- An oversized snapshot is stored as a reversible `columnar-v1` envelope with `__scope`, `__fingerprint`, sheet columns, and row arrays.
- Storage uses a 49,000-character safety ceiling, leaving margin below the Sheets limit.
- If the packed payload still does not fit, the Gateway returns `CONFIG_SNAPSHOT_TOO_LARGE` before any write is planned.
- `expandSnapshotPayload` verifies that the packed representation can be restored exactly.

The earlier branch commit `1642361` already removed Google Sheets `row_number` metadata from the normalized snapshot. This handoff adds the second protection needed for the real live configuration size.

## Files changed on this branch

This list describes the original config-snapshot change only. Subsequent Issue #3 continuation work is also present in the current worktree and must be reviewed/staged separately:

- `src/config-gateway/evaluate-config.mjs`
- `workflows/WF01_V2_CONFIG_GATEWAY.json`
- `test/config-gateway/versioning.test.mjs`
- `test/workflows/generated-artifacts.test.mjs`
- `docs/handoffs/2026-09-22-issue-3-config-snapshot-handoff.md`

`workflow-src/WF01_V2_CONFIG_GATEWAY.mjs` already embeds `src/config-gateway/evaluate-config.mjs`; rebuilding regenerates all three artifacts, but only WF01 has a content diff for this change. Update source first, then rebuild; do not hand-edit generated JSON as the primary source.

## Verification already performed

Focused regression coverage is green:

```text
test/config-gateway/versioning.test.mjs          8 passed
test/workflows/generated-artifacts.test.mjs     15 passed
```

The oversized regression builds a configuration over 50,000 characters, asserts the stored cell is below the limit, checks `columnar-v1`, preserves the fingerprint, and verifies the generated WF01 artifact keeps the repeated data.

## Continuation state — 2026-09-23

- WF03 now has a local worker-dispatch path that resolves the supported worker targets, reserves a router-specific operation key, sends the standard envelope, and handles child-workflow failures. This is locally verified only; it is not evidence of a live n8n smoke pass.
- The generated Router Decision Code node now bundles every helper it calls; an artifact-level sandbox test executes `/help`, `/kiemke`, and the fail-closed `/retry` path. Existing `PREPARED` reservations resume through the worker using the same identity. Returned errors or malformed worker responses go through WF02; only `ok: true` commits the router reservation.
- `/retry` cannot safely replay the original operation with the present `ERROR_BIA` and `OPERATION` fields. The implementation now fails closed with `ERROR_RETRY_CONTEXT_MISSING` and hides `/retry` from `/help`. The user chose to prepare only `branch_id` and `idempotency_key`; a header template is at `docs/maintenance/issue-3-error-bia-optional-columns.csv`. Do not add a payload column or change the live Sheet. The two fields do not resolve the retry blocker.
- The original Issue #3 GitHub body could not be fetched from this environment because `gh` is blocked by the configured proxy. Current decisions and evidence are local.
- No live Sheet edits, publish/activation, or production smoke were performed. Keep testing on the n8n shadow/test workflow. `/baocaobia` is out of this issue's scope until WF10 exists.
- Issue #3 is not ready to merge/close while ADR 0005's successful retry requirement is unsatisfied or required shadow smoke evidence remains pending.

Before claiming completion, run the full commands below on this branch and record fresh output:

```powershell
npm run verify
git diff --check
```

## Next agent sequence

1. Inspect `git status` and `git diff`; stage only the files listed above plus this handoff. Leave unrelated files from the original dirty `master` checkout out of the commit.
2. Review the full current diff against `c75d8e7` and the local Issue #3 spec/ADR. Confirm no credentials, tokens, private Sheet rows, or temporary exports are included; note that GitHub Issue #3 was unavailable from this environment.
3. After review passes, commit only the intended Issue #3 changes, then update existing PR #21 on `codex/issue-3-config-snapshot-handoff`; do not create a duplicate PR or force-push.
4. Import/update the generated artifacts in the n8n shadow/test workflow only. Keep production inactive/unchanged. Confirm the selected workflow names and the WF01/WF02 links after import.
5. On shadow/test, collect sanitized evidence for `/help`, `/trangthai`, `/kiemke`, `/nhaphang`, `/nhapban`, wrong permission/topic, duplicate update, callback replay, and `/retry` failing closed without a worker call or reservation. Verify snapshot packing with a real-sized test configuration. Do not include `/baocaobia` until WF10 is delivered.
6. Keep `/retry` and Issue #3 open: ADR 0005 requires retrying the same operation, but neither the chosen two-column ERROR_BIA change nor OPERATION stores the original payload. A separate approved design for payload recovery/persistence is required before that feature can pass.
7. Do not publish/activate production or merge/close Issue #3 until the retry gap is resolved, all required shadow smoke cases are green, review passes, and the user explicitly approves the release step.
8. After Issue #3 is accepted, continue the shared-contract integration; WF07 reconciliation/close-book and WF10 reporting remain later work.

## Important constraints

- The live Google Sheet is authoritative; downloaded workbooks are fixtures only.
- A code-only fix does not require bumping the business `config_version`. Bump it only when business configuration changes.
- Do not commit `.cloud-*`, `brief2_render_tmp`, old import bundles, screenshots, or unrelated `WF*_DEV` exports.
- Do not activate additional Telegram ingress workflows. WF03 remains the single Telegram Trigger owner.
- Do not treat a successful editor/manual run as production proof while n8n still shows `Publish`.

## Known live identifiers

- WF01 Config Gateway: `5aanaOAGNoCUPQA1`
- WF02 Error Handler: `SDi4QrKIX8QKTJCo`
- WF03 Telegram Router: `O4q27IeFSlL0Rbnh`
- Last reported failing execution: WF01 execution `#130`, at `Prepare CONFIG_SNAPSHOT`.

No credentials or bot tokens are recorded here.
