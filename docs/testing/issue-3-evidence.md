# Issue #3 live evidence

This is a fill-in record for the live n8n Cloud smoke test. It deliberately contains no credentials, tokens, spreadsheet IDs, chat IDs, or private user data. Replace the placeholders with execution/message references only after the test is run.

## Test context

- Environment: `<n8n Cloud workspace/environment>`
- Date/time (Asia/Bangkok): `<YYYY-MM-DD HH:mm>`
- Config version: `<CONFIG_VERSION.config_version>`
- WF01 execution: `<execution reference>`
- WF03 execution: `<execution reference>`

## Hanging execution diagnostic (pre-fix)

On the live Cloud workspace, three WF03 executions were observed active at
the same time and were stopped manually to release the execution slots:

- `#42` — canceled after approximately 5m52s.
- `#44` — canceled after approximately 2m55s.
- `#46` — canceled after approximately 2m26s.

The exact Telegram command for those historical executions was not verified
from the execution payload, so these references are diagnostic only and do
not count as `/help` smoke evidence. The regression fix narrows `/help` to
`CONFIG_LENH` instead of reading every optional router/audit sheet. Re-run the
live matrix after WF01 is published and the Cloud workspace reconnects.

## Google Sheets read fan-out fix

The same pre-fix executions also showed the core read chain growing from
roughly 119 to 238 items. The cause was a linear chain of `returnAll` reads:
each downstream node was executed once per upstream row. The generated V2
artifacts now set the n8n node property `executeOnce=true` on all 16 WF01
read nodes, while preserving `returnAll=true` and the live Sheet ID. The
source builder and validator enforce this contract, and `npm run verify`
passes 74 tests. This is a build-time regression guard; it does not replace
the required live `/help` and `/trangthai` smoke cases below.

The first post-import live run exposed a second edge case: `/trangthai` does
not request router tables, so `Read CONFIG_ROLE` is intentionally skipped.
The generated WF01 now guards optional `$items('Read ...')` access and passes
the assembled `tables` object into evaluation. The regression suite covers
this path (`does not dereference optional router reads that were skipped`).

## Required configuration gate

- [ ] `CONFIG_ROLE` exists with the intended active roles.
- [ ] `CONFIG_PERMISSION` exists with the intended active permissions.
- [ ] `CONFIG_USER_ROLE` exists with branch/global assignments and effective dates.
- [ ] `CONFIG_ROLE_PERMISSION` exists with active mappings.
- [ ] `CONFIG_TOPIC` exists with exact `chat_id` + `message_thread_id` + `topic_type` rows.
- [ ] `CONFIG_LENH` exists with active commands and help metadata.
- [ ] `EVENT_LOG` exists with the documented header.
- [ ] `CONFIG_SCHEMA` includes every new router/audit column.
- [ ] `CONFIG_VERSION.config_version` was incremented after the tabs were added.

## Smoke cases

| Case | Expected | Evidence reference | Result |
|---|---|---|---|
| `/help` valid topic | Every active command is shown; long help may arrive as multiple Telegram messages | `<WF03 execution + Telegram message refs>` | `PENDING` |
| `/trangthai` active user | Status reply in the exact chat/thread; no Telegram audit append | `<WF03 execution + Telegram message ref>` | `PENDING` |
| `/trangthai` inactive/unknown user | Safe denial and one `EVENT_LOG` row | `<WF03 execution + EVENT_LOG row ref>` | `PENDING` |
| Valid `/kiemke` | Exact topic/permission route; `OPERATION` reservation is created before ACK | `<WF03 execution + OPERATION row ref>` | `PENDING` |
| Wrong topic/permission | Safe denial; one idempotent `EVENT_LOG` row; no worker call | `<WF03 execution + EVENT_LOG row ref>` | `PENDING` |
| Same message `update_id` replay | No second route reservation or audit row | `<two execution refs>` | `PENDING` |
| Same callback ID with a new `update_id` | No second route reservation; Telegram callback is answered | `<two execution refs + callback answer ref>` | `PENDING` |
| `/retry <error_id>` | If source payload is recoverable: reuse original keys and require worker success. With current Sheet schema the expected safe result is fail-closed `retry-payload-unavailable`, no worker call and no success acknowledgement. | `<WF03 execution ref>` | `PENDING` |

## Sanitized observations — 2026-09-23

These observations are not a complete release gate. The inspected n8n workflow is published; isolation from production was not established. No new Telegram command was sent during this review. Personal identifiers, chat/thread IDs, message IDs, sheet IDs, and configuration payloads are intentionally omitted.

| Case | Evidence observed | Result |
|---|---|---|
| `/help` | WF03 execution `#141` succeeded; input normalized `/HELP` to `/help`. User-provided Telegram capture in this task shows the configured command catalog. | `PARTIAL` — exact active/inactive catalog reconciliation was not captured from the same execution. |
| Valid `/kiemke` | WF03 execution `#152` succeeded; route-reservation and Telegram-reply nodes ran. | `FAIL` — generated WF03 has no worker Execute Workflow node: it reserves the operation and replies, but does not invoke `worker_workflow`; the business command is not fully routed. |
| `/trangthai` active user; unknown/inactive user; wrong topic/permission; duplicate update; callback replay; `/retry` | No qualifying execution evidence was verified in this review. | `PENDING` |

Local verification at commit `9fa4f1a`: `npm run verify` passed (3 workflows validated; 113 tests passed), and `git diff --check` passed. Findings from that review were:

- `P1` Spec: WF03 never called the configured worker with the standard envelope; `/retry` only returned an accepted decision and did not execute the retry.
- `P2` Spec/Standards: retry requires a global `ADMIN` assignment (`branch_id='*'`), rejecting branch-scoped admins allowed by ADR 0021; the hard-coded role check also conflicts with the ADR's config-driven permission mapping.
- `P2` Spec: `/help` prints an empty `Quyền:` value when a command has no permission code instead of an explicit “Không yêu cầu”.
- `P3` Standards: effective-date-window validation is duplicated across authorization paths.

## Local implementation status — 2026-09-25

This section records local PR-branch work only; it is not live n8n smoke evidence. No Google Sheet was edited, no workflow was published/activated, and no Telegram smoke command was sent for this revision.

- WF03 now builds a standard worker envelope from the normalized Telegram update, exact topic/branch, active config version and immutable `config_snapshot_id`, plus the original `operation_id`/`idempotency_key`. The shared envelope normalizer preserves `config_snapshot_id`. It reads the target workflow ID from `CONFIG_LENH.worker_workflow`, reserves `OPERATION`, waits for the sub-workflow, and only sends the accepted reply after explicit `{ ok: true }`.
- For `ROUTE_COMMAND` and `MANUAL_RETRY`, WF01 validates the current fingerprint against the committed predecessor before returning router tables. First use or a valid version+content change writes a stable `CONFIG_SNAPSHOT` operation before WF03 may route; a changed fingerprint without a version bump, a version-only bump, a non-increasing version, or maintenance mode fails closed.
- Missing workflow ID, a false/missing worker result, and a worker execution error do not send the accepted reply. WF03 sends sanitized worker error context through WF02, which records `ERROR_BIA`; WF03 then sets `OPERATION=FAILED` with that error ID and sends the safe message. If WF02 itself errors, WF03 writes a sanitized, non-retryable `ERROR_HANDLER_UNAVAILABLE` row to the existing `ERROR_BIA` schema. If this fallback write also fails, it leaves `OPERATION.error_id` empty and replies without inventing a reference; it does not claim the failure was logged. After a successful fallback write, WF03 sends one allowlisted diagnostic to the configured admin topic; a missing/invalid destination or Telegram alert failure does not suppress the user-facing failure reply.
- If configured user-error templates are missing, WF03 fails closed and uses a Vietnamese safe fallback containing the error reference and directs the user to pass it to an administrator; this does not substitute missing business configuration or dispatch a worker.
- The fallback admin destination uses the existing `CONFIG_GLOBAL` key/value tab; no new tab or columns are required. Copy these two rows into that tab, replace both placeholders with numeric IDs, and only then bump `CONFIG_VERSION.config_version` once after the configuration edit is complete. Placeholders are intentionally rejected by Router validation. The live Sheet has not been edited:

```tsv
ERROR_ALERT_CHAT_ID	REPLACE_WITH_ADMIN_CHAT_ID	STRING	Chat ID của group admin nhận cảnh báo lỗi WF03	ACTIVE
ERROR_ALERT_THREAD_ID	REPLACE_WITH_ERROR_THREAD_ID	STRING	Thread ID của topic admin nhận cảnh báo lỗi WF03	ACTIVE
```
- Active `CONFIG_TOPIC` mappings are resolved by exact `chat_id` + `message_thread_id`; zero or multiple matches are denied. `topic_type` is checked after resolving the pair, so duplicate active pairs cannot be disambiguated by command to silently select the first row.
- `/retry` now checks the configured command permission against the exact active Telegram topic and preserves the stored `OPERATION.idempotency_key` when available. It does **not** dispatch: `ERROR_BIA` and `OPERATION` currently contain no original payload or durable source reference. It fails closed with an error ID ending `retry-payload-unavailable`. The retry execution acceptance criterion therefore remains **not met**; no column was added to the live Sheet.
- P2 branch-scoped authorization and `/help`'s explicit `Không yêu cầu` label are implemented locally. Effective-date validation was extracted to one shared helper for the former P3.
- Router permission checks now share one config-driven authorization implementation across command dispatch, help visibility, and retry policy; the unused role-only helper was removed.
- Regression tests cover missing worker ID, standard envelope identity/configuration/snapshot handoff and normalization, duplicate PREPARED/FAILED operations, branch-scoped retry authorization, missing retry payload, ambiguous topic pairs, config fingerprint/version gating, maintenance-mode denial, fallback `ERROR_BIA` projection, and the n8n dispatch/Error Handler/wait/success-gate graph.
- Fresh `npm run verify` result on the local PR worktree after these review fixes: 3 workflows validated; 135 tests passed; 0 failed. Regression tests verify that `/help` rejects changed config content without a version bump, multi-part versions compare numerically (`v1.10` > `v1.9`), the shared normalizer preserves `config_snapshot_id`, a WF02 failure cannot create an unpersisted error reference, the fallback alert uses only persisted/allowlisted values, and missing user-error templates fail closed with localized guidance. WF01/WF03 artifacts were rebuilt from source. `git diff --check` is clean. This does not verify actual n8n Cloud node execution.
- Google Sheets `appendOrUpdate` is only a sequential duplicate guard, not an atomic claim across simultaneous executions. Workers must still deduplicate by `operation_id`/`idempotency_key`; concurrent execution safety has not been proven live.

The earlier authorization/help/date-window findings and additional config-gateway, worker-error logging, ambiguous-topic, snapshot handoff/normalization, `/help` version-validation, multi-part version-ordering and fallback admin-alert findings are addressed locally. The design and code for `ERROR_ALERT_CHAT_ID`/`ERROR_ALERT_THREAD_ID` are approved, but no destination IDs have been entered and the live Sheet remains unchanged. Remaining P1 gates are `/retry` replay (the approved Sheet columns contain no recoverable payload) and atomic duplicate claims under concurrent execution. All live smoke rows above remain pending until an isolated n8n test worker and test Sheet are configured. Do not merge PR #21 or close Issue #3 yet.

## Release gate

Do not merge PR #21 or close issue #3 while any required case is `PENDING`/`FAIL`. Attach the completed evidence to the PR or issue without adding secret values.
