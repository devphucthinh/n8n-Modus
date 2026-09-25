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

Before claiming completion, run the full commands below on this branch and record fresh output:

```powershell
npm run verify
git diff --check
```

## Next agent sequence

1. Inspect `git status` and `git diff`; stage only the files listed above plus this handoff. Leave unrelated files from the original dirty `master` checkout out of the commit.
2. Review the diff against `c75d8e7` and the Issue #3 acceptance criteria. Confirm no credentials, tokens, private Sheet rows, or temporary exports are included.
3. Commit with a focused message such as `fix(issue-3): pack oversized config snapshots`.
4. Push this branch and create/update a PR into `master`. Preserve the existing Issue #3 branch history; do not force-push.
5. In n8n, keep the draft inactive while importing or updating the generated WF01 artifact. Confirm the live Code node is equivalent to source and that the WF02 reference remains intact.
6. Publish/activate only after the test workflow is green. Run this production smoke matrix:
   - `/help`
   - `/trangthai`
   - `/kiemke`
   - `/nhaphang`
   - `/nhapban`
   - `/baocaobia`
   - one unauthorized-user/topic denial
7. Check executions and the live Sheet: no 50,000-character error, no `CONFIG_SNAPSHOT_TOO_LARGE` for the normal configuration, and successful `OPERATION`/`CONFIG_SNAPSHOT` commit rows. Record only sanitized execution IDs and timestamps.
8. After release evidence is captured, continue with the shared-contract integration branch. `WF07` reconciliation/close-book and `WF10` reporting remain later work; do not broaden this fix into those workflows.

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
