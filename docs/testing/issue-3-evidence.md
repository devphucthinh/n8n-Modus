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
not count as `/help` smoke evidence. The regression fix reads `CONFIG_LENH`
plus the minimal role, permission, and topic tables needed to apply per-topic
visibility; it skips reading `EVENT_LOG` and operational ledgers for `/help`.
Denied access still creates a deterministic `event_id`; WF03 writes it via
`appendOrUpdate` keyed by that ID, so idempotent audit does not need a pre-read.
Re-run the live matrix after WF01 is published and the Cloud workspace reconnects.

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
| `/retry <error_id>` | Must fail closed unless the original business payload can be recovered; current two-column migration does not persist that payload | `<WF03 execution ref>` | `PENDING` |

## Sanitized observations — 2026-09-23

These observations are not a complete release gate. The inspected n8n workflow is published; isolation from production was not established. No new Telegram command was sent during this review. Personal identifiers, chat/thread IDs, message IDs, sheet IDs, and configuration payloads are intentionally omitted.

| Case | Evidence observed | Result |
|---|---|---|
| `/help` | WF03 execution `#141` succeeded; input normalized `/HELP` to `/help`. User-provided Telegram capture in this task shows the configured command catalog. | `PARTIAL` — exact active/inactive catalog reconciliation was not captured from the same execution. |
| Valid `/kiemke` | WF03 execution `#152` succeeded; route-reservation and Telegram-reply nodes ran. | `FAIL` — generated WF03 has no worker Execute Workflow node: it reserves the operation and replies, but does not invoke `worker_workflow`; the business command is not fully routed. |
| `/trangthai` active user; unknown/inactive user; wrong topic/permission; duplicate update; callback replay; `/retry` | No qualifying execution evidence was verified in this review. | `PENDING` |

Local verification at commit `9fa4f1a`: `npm run verify` passed (3 workflows validated; 113 tests passed), and `git diff --check` passed. Code review blockers:

- `P1` Spec: WF03 never calls the configured worker with the standard envelope; `/retry` also only returns an accepted decision and does not execute the retry.
- `P2` Spec/Standards: retry requires a global `ADMIN` assignment (`branch_id='*'`), rejecting branch-scoped admins allowed by ADR 0021; the hard-coded role check also conflicts with the ADR's config-driven permission mapping.
- `P2` Spec: `/help` prints an empty `Quyền:` value when a command has no permission code instead of an explicit “Không yêu cầu”.
- `P3` Standards: effective-date-window validation is duplicated across authorization paths.

## Local remediation status — 2026-09-23

The local Issue #3 worktree now has these code-level remediations:

| Finding | Local result | Regression evidence | Live status |
|---|---|---|---|
| P2 retry rejects branch-scoped roles / hard-codes `ADMIN` | Authorization now follows active Sheet permission mappings and the branch of the exact active forum topic; however, a successful retry is not available without the original payload. | `router-flow.test.mjs` and `retry-command.test.mjs`: branch-scoped authorization is checked, then retry fails closed with `ERROR_RETRY_CONTEXT_MISSING`. | `PENDING` |
| P2 `/help` shows an empty permission | Blank permission displays `Không yêu cầu`. | `router-flow.test.mjs`, `command-catalog.test.mjs`, and generated WF03 Code-node sandbox test. | `PENDING` |
| P3 duplicated effective-date logic | Consolidated into `isWithinEffectiveWindow`, shared by authorization helpers and the self-contained WF03 artifact. | `effective-window.test.mjs` covers inclusive endpoints, unbounded values, malformed bounds, and invalid current time. | `LOCAL FIXED` |

The branch-specific retry permission is evaluated against the topic where `/retry` is issued. A prepared local Sheet migration adds only the optional `branch_id` and `idempotency_key` columns to `ERROR_BIA`; it does not modify the live Sheet. Those keys support authorization and deduplication, but they are not enough to replay the original command.

The worker-invocation path is now present in the local WF03 artifact and covered by regression tests. However, `/retry` is deliberately fail-closed with `ERROR_RETRY_CONTEXT_MISSING`: `ERROR_BIA` and `OPERATION` do not persist the original request payload, and the user chose not to add a payload column. It would be unsafe to reconstruct it from an error ID, command catalog row, and idempotency key. This remains a P1 against ADR 0005 and blocks claiming retry is complete. The required live smoke matrix is also still `PENDING`; local tests do not count as n8n evidence.

Additional review fixes in the local artifact: a matching `PREPARED` operation now continues through dispatch with the same reservation identity (while terminal/unknown status remains deduplicated), and only a worker response with explicit `ok: true` commits that reservation. Returned worker failures or malformed responses are routed to WF02 and leave the router reservation `FAILED`. Regression tests exercise prepared-operation recovery, generated WF03 `/help`, `/kiemke`, `/retry`, and the worker result/error topology. These remain local-code evidence only.

`WF10` and `/baocaobia` remain deferred by scope. Other live workflow readiness prerequisites, including the `business_date`/`CONFIG_LICH` contract needed by WF05, have not been verified as satisfied. No live Google Sheet edits, production publish/activation, or production smoke tests were performed in this remediation.

Do not merge or close issue #3 until P1 is resolved, all required live smoke cases are green, and the PR review passes. Local checks do not substitute for the remaining live smoke cases.

## Release gate

Do not merge PR #21 or close issue #3 while any required case is `PENDING`/`FAIL`, `/retry` cannot replay the original payload, or a required worker is not ready. Attach the completed evidence to the PR or issue without adding secret values.
