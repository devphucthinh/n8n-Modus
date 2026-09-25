# WF05/WF06 inventory handoff

Branch for the approved interaction design: `codex/wf05-wf06-telegram-design`. It builds on `codex/issue-2-inventory-session-counts` (`06367bd`). The [approved design](../superpowers/specs/2026-09-25-wf05-wf06-inventory-telegram-design.md) is the source of truth for behavior; this handoff records the implementation checkpoint.

## Current checkpoint

- Pure planners exist in [session logic](../../src/inventory/inventory-session.mjs), [count logic](../../src/inventory/count-entry.mjs), and [review/finalize logic](../../src/inventory/review-finalize.mjs). They assume an immutable Config Gateway snapshot and produce write plans; they are not connected to live Google Sheets or Telegram.
- [WF05 source](../../workflow-src/WF05_V2_MO_PHIEN_KIEM_KE.mjs) and [WF06 source](../../workflow-src/WF06_V2_NHAN_SO_DEM.mjs) generate [WF05 export](../../workflows/WF05_V2_MO_PHIEN_KIEM_KE.json) and [WF06 export](../../workflows/WF06_V2_NHAN_SO_DEM.json). Exports remain inactive and contain no production credentials or IDs.
- [Inventory tests](../../test/inventory/) cover the pure planners and export shape. They do not prove Telegram Reply routing, Google Sheets writes, or end-to-end behavior.
- No Sheet live, n8n workflow, Telegram bot, or production configuration was changed while approving this design. The earlier local UI prototype used a ForceReply label; that draft predates the final decision to use a **manual Reply to the same session bubble**. Follow the approved design, not that label.

## Next execution path

1. Read [CONTEXT.md](../../CONTEXT.md), the approved design, relevant ADRs, and current `CONFIG_SCHEMA`. Map each required logical field to the authoritative live workbook before proposing a migration. Keep migrations versioned and seek approval before changing live Sheet data. Done when every required session, pending, count, and audit field has a verified source or an explicit migration proposal.
2. Extend WF03 to accept Telegram Reply text and callbacks as standard envelopes for WF05/WF06. Validate actor, branch permission, topic, `reply_to_message_id`, session, pending owner, expiry, and idempotency; plain number text must not route without a valid pending state. Done when automated tests cover accepted and rejected Reply/callback paths.
3. Connect WF05 to the Dispatcher schedule and Config Gateway, persist one session/bubble per branch/business date, and edit/pin that bubble as specified. Done when duplicate open/resume requests do not create a second session or bot bubble.
4. Connect WF06 to versioned Sheet writes and the one-bubble UI state machine: single count, batch `STT số_lượng`, correction preview, review, explicit finalization, reopen and cancel with reason. Block reopen after daily close: current pure session logic permits `LOCKED`/`CLOSED` and is **not** safe to publish unchanged. Done when invalid batches write nothing, duplicate updates are idempotent, and all committed rows pass conflict checks.
5. Build exports, run `npm run verify`, review against this design and ADRs, then import inactive into n8n test. Capture sanitized execution IDs, Telegram result, and `OPERATION`/`BIA_LOG`/`EVENT_LOG` evidence for each acceptance case in the design. Only request production publication after the smoke gate is green.

## Integration boundaries and risks

- Reconcile `CONFIG_BIA` item identity/order and `CONFIG_QUY_DOI` precision/step with the Config Gateway snapshot; verify `PHIEN_KIEM_KE`, `BIA_LOG`, `DIEU_CHINH_SO`, `EVENT_LOG`, and pending-state schemas. Do not infer live Sheet columns from exported `.xlsx` snapshots.
- `WF07` daily close is not part of this lane. WF05/WF06 must honor an authoritative daily-lock state; full after-close smoke needs WF07 or a controlled test fixture.
- The owner chose not to use Apps Script LockService. Preserve the documented residual concurrent-write risk; use staged `PREPARED`/`COMMITTED` visibility, revision checks, idempotency, and reconciliation without claiming a physical Sheets transaction.
- The main `master` checkout contains unrelated uncommitted user files. Continue in an isolated worktree and stage exact paths only. Push feature branches; do not merge or activate from this handoff alone.
