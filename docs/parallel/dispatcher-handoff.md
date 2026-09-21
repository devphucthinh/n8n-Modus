# Dispatcher lane handoff

## Scope delivered

This lane adds the pure V2 dispatcher decision slice and an inactive workflow export. It does not change the Issue #2 contracts, V1 JSON, WF04 legacy artifacts, or any existing V2 workflow export.

Pure modules:

- `src/dispatcher/parse-schedule.mjs` normalizes schedule rows, resolves branch timezone/status, and validates the schedule protocol.
- `src/dispatcher/decide-dispatch.mjs` classifies local-time windows, creates deterministic dispatch identities, applies `DISPATCH_HISTORY` idempotency/retry decisions, builds standard scheduled-job envelopes, and assembles a tick plan.
- `src/dispatcher/heartbeat.mjs` records ten-minute tick health and emits one critical threshold alert plus one recovery alert per failure episode.

Workflow artifacts:

- `workflow-src/WF04_V2_DISPATCHER.mjs`
- `scripts/build-wf04-dispatcher.mjs`
- `workflows/WF04_V2_DISPATCHER.json`

The workflow is inactive, has one ten-minute `Schedule Trigger`, has no Telegram Trigger, calls the existing Config Gateway through `PASTE_WF01_WORKFLOW_ID`, reads the operational history, and returns a dispatch plan/envelope. It intentionally does not contain worker business logic or activate any workflow.

## Configuration rows expected

The canonical machine column names below are the names the pure parser expects. A few documented aliases are accepted for fixture compatibility, but new Sheet schema should use the canonical names.

### `CONFIG_LICH`

| Column | Required | Meaning |
|---|---:|---|
| `schedule_id` | yes | Immutable ASCII identity of a configured schedule row; unique within the table. |
| `job_code` | yes | Stable worker/job code placed in the scheduled-job envelope. |
| `worker_workflow` | yes | Stable worker workflow code/name; the dispatcher does not execute worker logic. |
| `branch_id` | yes | Branch identity, referencing `CONFIG_BRANCH.branch_id`; this slice expects a concrete branch row. |
| `timezone` | conditional | IANA timezone for this schedule. It may be blank only when `CONFIG_BRANCH.timezone` or the configured default timezone supplies the value. |
| `days_of_week` | yes | `MON` … `SUN`, comma/space/pipe separated, or `*` for every day. Numeric `1` … `7` use Monday … Sunday. |
| `local_time` | yes | Local wall-clock time in `HH:mm`. |
| `grace_minutes` | yes | Non-negative catch-up window after the scheduled local time. |
| `max_attempts` | yes | Positive maximum number of attempts for the same dispatch key. |
| `trang_thai` | yes | `ACTIVE`/`INACTIVE`; disabled rows never emit a job. |

`CONFIG_BRANCH` columns used by this lane are the existing `branch_id`, `timezone`, and `trang_thai` columns. An inactive branch suppresses new dispatches even when the schedule row is active.

`CONFIG_GLOBAL` uses the existing `config_key` and `config_value` columns for:

- `DEFAULT_TIMEZONE` — fallback only when a schedule and its branch do not provide a timezone.
- `DISPATCH_HEARTBEAT_FAILURE_THRESHOLD` — positive integer; the workflow must not silently invent this threshold.

The technical ten-minute poll interval is fixed in the Schedule Trigger. Business times, weekdays, grace windows, enablement, retries, and thresholds remain Sheet data.

### `DISPATCH_HISTORY`

The dispatcher emits these append-only columns for both job and heartbeat records:

```text
history_id
record_type
dispatch_key
operation_id
schedule_id
job_code
worker_workflow
branch_id
occurrence_date
scheduled_at_local
status
attempt_number
retryable
failure_count
error_code
error_id
heartbeat_failure_count
alert_state
critical_alert
recovery_alert
created_at
updated_at
```

`record_type` is `JOB` or `HEARTBEAT`. Job statuses consumed by the decision layer are `CLAIMED`/`RUNNING`/`DISPATCHED`, `FAILED`, `WARNING`, and a successful status such as `SUCCEEDED` or `COMMITTED`. Heartbeat rows use `SUCCEEDED` or `FAILED`.

The deterministic identities are:

- Job: `dispatch:<schedule_id>:<branch_id>:<YYYY-MM-DD>:<HH:mm>`.
- Job operation: `op-dispatch-` plus the first 32 hexadecimal characters of SHA-256 of the job `dispatch_key`.
- Heartbeat: `heartbeat:<UTC ISO instant rounded down to the ten-minute tick>`.
- Heartbeat operation: `op-heartbeat-` plus the first 32 hexadecimal characters of SHA-256 of the heartbeat key.

The same job key and operation ID are reused for retryable failures. A completed or in-flight key is skipped. An outside-window warning is recorded once for the occurrence and then skipped on later ticks.

## Shared-contract status at the integration fixed point

At the lane fixed point, the following items were intentionally left for
integration. They are now defined in the shared contract on
`codex/issue-2-v2-integration` and documented in
`docs/parallel/shared-contract.md` and ADR 0023:

1. `core-sheet-schema.mjs` includes `CONFIG_LICH`, `DISPATCH_HISTORY`, the
   catalog/mapping tables, and the canonical operational ledgers.
2. The Gateway fingerprints requested extended configuration, validates its
   schema coverage, and returns the requested dispatcher tables/catalog with
   immutable snapshot metadata.
3. WF04 emits a compare-and-set `ATOMIC_CLAIM` request keyed by
   `DISPATCH:<dispatch_key>`. A real Apps Script `LockService` or equivalent
   atomic endpoint is still required before production activation.
4. The integration branch remains an inactive planning boundary: worker
   invocation, external adapters and production writes are not enabled here.

## Integration tests still required

- Gateway-to-dispatcher test: a validated snapshot contains `CONFIG_LICH`, `CONFIG_BRANCH`, `CONFIG_GLOBAL`, and `config_version`, and the workflow produces a plan without direct business-config reads.
- Timezone/DST matrix using the test Sheet: local due, not-due, previous-day grace catch-up, and outside-window warning across at least `Asia/Ho_Chi_Minh` and one DST timezone.
- Concurrent claim test: two dispatcher executions for the same occurrence cannot append two effective `CLAIMED` rows for one `dispatch_key`.
- Worker success/failure test: successful completion records the same operation identity; retryable worker failure retries below `max_attempts`, and non-retryable or exhausted failures stop.
- Worker integration test: each emitted envelope reaches the configured worker with `event_type=SCHEDULED_JOB`, branch, business date, config version, job code, and dispatch key intact; no worker business logic is placed in WF04.
- Heartbeat/error integration test: three failed ticks route one critical alert through `WF02_V2_ERROR_HANDLER`, a healthy tick routes one recovery notice, and repeated healthy ticks stay quiet.
- Branch/session integration test: an active `PHIEN_KIEM_KE` is handled by the worker as the existing-session case; the dispatcher only emits the scheduled envelope.
- Live-like negative/idempotency tests use a test Google Sheet and credentials only; no production Sheet, live n8n activation, Telegram Trigger, or real secret is part of this lane.
