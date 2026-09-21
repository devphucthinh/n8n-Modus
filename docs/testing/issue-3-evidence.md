# Issue #3 live evidence

This is a fill-in record for the live n8n Cloud smoke test. It deliberately contains no credentials, tokens, spreadsheet IDs, chat IDs, or private user data. Replace the placeholders with execution/message references only after the test is run.

## Test context

- Environment: `<n8n Cloud workspace/environment>`
- Date/time (Asia/Bangkok): `<YYYY-MM-DD HH:mm>`
- Config version: `<CONFIG_VERSION.config_version>`
- WF01 execution: `<execution reference>`
- WF03 execution: `<execution reference>`

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
