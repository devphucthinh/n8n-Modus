import test from 'node:test';
import assert from 'node:assert/strict';
import { planBubbleAction, markSendRequested, observeTelegramSend, recordPinOutcome, renderInventoryBubble } from '../../src/inventory-session/bubble-state.mjs';

const session = {
  session_id: 'session-1', dispatch_key: 'dispatch-1', branch_id: 'CN01', business_date: '2026-09-23',
  chat_id: '-100123', message_thread_id: '77', status: 'PREPARED', bubble_state: 'NONE',
  catalog_snapshot_json: JSON.stringify([
    { stt: 1, ma_bia: 'B1', ten_bia: 'Bia Một', don_vi_dem: 'thùng' },
    { stt: 2, ma_bia: 'B2', ten_bia: 'Bia Hai', don_vi_dem: 'két' },
  ]), page_size: '1',
};

test('a prepared new session requests one send only after a durable send marker', () => {
  assert.equal(planBubbleAction(session).action, 'MARK_SEND_REQUESTED');
  const marked = markSendRequested(session, '2026-09-23T16:45:00Z');
  assert.equal(marked.status, 'SEND_REQUESTED');
  assert.equal(marked.bubble_state, 'SEND_REQUESTED');
  assert.equal(planBubbleAction(marked).action, 'RECONCILE');
  assert.equal(planBubbleAction({ ...marked, master_message_id: '' }).action, 'RECONCILE');
});

test('only a known Telegram message ID can authorize session commit', () => {
  const marked = markSendRequested(session, '2026-09-23T16:45:00Z');
  const known = observeTelegramSend(marked, { message_id: 501, chat: { id: -100123 }, message_thread_id: 77 });
  assert.equal(known.ok, true);
  assert.equal(known.patch.master_message_id, '501');
  assert.equal(known.patch.bubble_state, 'SENT');
  assert.equal(known.patch.status, 'PREPARED');
  assert.equal(known.can_commit, true);
  const unknown = observeTelegramSend(marked, { error: { message: 'timeout' } });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.can_commit, false);
  assert.equal(unknown.patch.status, 'RECONCILIATION_REQUIRED');
  assert.equal(unknown.patch.master_message_id, '');
});

test('a successful Telegram API wrapper preserves the confirmed send identity', () => {
  const marked = markSendRequested(session, '2026-09-23T16:45:00Z');
  const outcome = observeTelegramSend(marked, {
    ok: true, result: { message_id: 501, chat: { id: -100123 }, message_thread_id: 77 },
  });
  assert.equal(outcome.can_commit, true);
  assert.equal(outcome.patch.master_message_id, '501');
});

test('a known bubble is always edited, never sent again', () => {
  assert.deepEqual(planBubbleAction({ ...session, status: 'ACTIVE', bubble_state: 'SENT', master_message_id: '501' }), {
    action: 'EDIT', message_id: '501',
  });
  assert.equal(planBubbleAction({ ...session, status: 'PREPARED', bubble_state: 'SENT', master_message_id: '501' }).action, 'RECONCILE');
});

test('pin failure is a warning and does not change bubble identity', () => {
  const failed = recordPinOutcome({ ...session, status: 'ACTIVE', bubble_state: 'SENT', master_message_id: '501' }, { error: { message: 'forbidden' } });
  assert.equal(failed.warning_code, 'INVENTORY_PIN_FAILED');
  assert.equal(failed.session.master_message_id, '501');
  assert.equal(failed.pinned, false);
});

test('only an explicit successful pin result confirms the bubble was pinned', () => {
  assert.equal(recordPinOutcome(session, { ok: true, result: true }).pinned, true);
  assert.equal(recordPinOutcome(session, { ok: true, result: false }).pinned, false);
});

test('the frozen catalog renders one bounded page without recalculating STT', () => {
  const first = renderInventoryBubble(session, { page: 1 });
  const second = renderInventoryBubble(session, { page: 2 });
  assert.match(first.text, /1\. B1 — Bia Một/);
  assert.doesNotMatch(first.text, /2\. B2/);
  assert.match(second.text, /2\. B2 — Bia Hai/);
  assert.match(second.text, /Trang 2\/2/);
});

test('opening renders zero progress only for a newly prepared bubble', () => {
  const rendered = renderInventoryBubble(session);
  assert.deepEqual(rendered.progress, { known: true, counted: 0, total: 2 });
  assert.match(rendered.text, /0\/2/);
});

test('resume without committed counts never overwrites progress with uncounted claims', () => {
  const rendered = renderInventoryBubble({ ...session, status: 'ACTIVE', bubble_state: 'SENT', master_message_id: '501' });
  assert.deepEqual(rendered.progress, { known: false, counted: null, total: 2 });
  assert.doesNotMatch(rendered.text, /0\/2|chưa đếm|Chọn mặt hàng/);
});
