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
| `/retry <error_id>` | Only configured admin can retry a retryable error and original keys are reused | `<WF03 execution ref>` | `PENDING` |

## Release gate

Do not merge PR #21 or close issue #3 while any required case is `PENDING`/`FAIL`. Attach the completed evidence to the PR or issue without adding secret values.
