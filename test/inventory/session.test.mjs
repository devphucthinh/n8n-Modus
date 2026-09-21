import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expireInventorySession,
  openOrReuseInventorySession,
  reopenInventorySession,
} from '../../src/inventory/inventory-session.mjs';

const snapshot = () => ({
  config_snapshot_id: 'cfg-v1',
  config_version: 'v1',
  captured_at: '2026-09-21T16:45:00.000Z',
  config: { inventory_ttl_minutes: 30 },
  catalog: [
    {
      ma_bia: 'BIA-333',
      ten_bia: 'Bia 333',
      don_vi_dem: 'chai',
      thu_tu_hien_thi: '1',
      trang_thai: 'ACTIVE',
    },
  ],
});

test('reuses the active session and keeps its original config snapshot', () => {
  const opened = openOrReuseInventorySession({
    branch_id: 'CN_HN',
    business_date: '2026-09-21',
    config_snapshot: snapshot(),
    existing_sessions: [],
    actor_user_id: 'user-1',
    now: '2026-09-21T16:45:00.000Z',
    expires_at: '2026-09-21T17:15:00.000Z',
  });

  assert.equal(opened.ok, true);
  assert.equal(opened.action, 'OPENED');
  assert.equal(opened.session.config_snapshot.config_version, 'v1');
  assert.equal(opened.session.catalog[0].display_label, 'BIA-333 — Bia 333 — chai');

  const changedSnapshot = snapshot();
  changedSnapshot.config_version = 'v2';
  changedSnapshot.catalog[0].ten_bia = 'Bia khác';

  const reused = openOrReuseInventorySession({
    branch_id: 'CN_HN',
    business_date: '2026-09-21',
    config_snapshot: changedSnapshot,
    existing_sessions: [opened.session],
    actor_user_id: 'user-2',
    now: '2026-09-21T16:50:00.000Z',
    expires_at: '2026-09-21T17:20:00.000Z',
  });

  assert.equal(reused.ok, true);
  assert.equal(reused.action, 'REUSED');
  assert.equal(reused.session.session_id, opened.session.session_id);
  assert.equal(reused.session.config_snapshot.config_version, 'v1');
  assert.equal(reused.session.catalog[0].display_label, 'BIA-333 — Bia 333 — chai');
  assert.deepEqual(reused.write_plan, []);
});

test('stages a new session row before committing the open operation', () => {
  const result = openOrReuseInventorySession({
    branch_id: 'CN_DN',
    business_date: '2026-09-21',
    config_snapshot: snapshot(),
    existing_sessions: [],
    actor_user_id: 'user-1',
    now: '2026-09-21T16:45:00.000Z',
    expires_at: '2026-09-21T17:15:00.000Z',
    operation_id: 'op-open-1',
    request_id: 'req-open-1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.write_plan[0].sheet, 'OPERATION');
  assert.equal(result.write_plan[0].row.status, 'PREPARED');
  const append = result.write_plan.find((step) => step.sheet === 'PHIEN_KIEM_KE' && step.action === 'APPEND');
  assert.equal(append.row.session_id, result.session.session_id);
  assert.equal(append.row.status, 'PREPARED');
  assert.equal(append.row.config_snapshot_id, 'cfg-v1');
  assert.equal(result.write_plan.some((step) => step.sheet === 'PHIEN_KIEM_KE' && step.action === 'UPDATE' && step.patch.status === 'COMMITTED'), true);
  assert.equal(result.write_plan.at(-1).patch.status, 'COMMITTED');
});

test('rejects a second active session for the same branch', () => {
  const opened = openOrReuseInventorySession({
    branch_id: 'CN_HN',
    business_date: '2026-09-21',
    config_snapshot: snapshot(),
    existing_sessions: [],
    actor_user_id: 'user-1',
    now: '2026-09-21T16:45:00.000Z',
    expires_at: '2026-09-21T17:15:00.000Z',
  });

  const result = openOrReuseInventorySession({
    branch_id: 'CN_HN',
    business_date: '2026-09-22',
    config_snapshot: snapshot(),
    existing_sessions: [opened.session],
    actor_user_id: 'user-2',
    now: '2026-09-21T16:50:00.000Z',
    expires_at: '2026-09-21T17:20:00.000Z',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'ACTIVE_SESSION_EXISTS');
  assert.equal(result.active_session_id, opened.session.session_id);
  assert.equal(result.active_business_date, '2026-09-21');
  assert.deepEqual(result.write_plan, []);
});

test('expires an active session without deleting its recorded state', () => {
  const session = {
    session_id: 'phien-CN_HN-2026-09-21-cfg-v1',
    branch_id: 'CN_HN',
    business_date: '2026-09-21',
    config_snapshot_id: 'cfg-v1',
    status: 'ACTIVE',
    expires_at: '2026-09-21T17:15:00.000Z',
    session_revision: 2,
  };
  const result = expireInventorySession({
    session,
    now: '2026-09-21T17:16:00.000Z',
    actor_user_id: 'system',
    operation_id: 'op-expire-1',
    request_id: 'req-expire-1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'EXPIRED');
  assert.equal(result.session.status, 'EXPIRED');
  assert.equal(result.session.session_id, session.session_id);
  const audit = result.write_plan.find((step) => step.sheet === 'EVENT_LOG' && step.action === 'APPEND');
  assert.equal(audit.row.event_type, 'INVENTORY_SESSION_EXPIRED');
  assert.equal(result.write_plan.some((step) => step.action === 'DELETE'), false);
});

test('reopens an expired session with a required reason and audit event', () => {
  const session = {
    session_id: 'phien-CN_HN-2026-09-21-cfg-v1',
    branch_id: 'CN_HN',
    business_date: '2026-09-21',
    config_snapshot_id: 'cfg-v1',
    config_version: 'v1',
    status: 'EXPIRED',
    expires_at: '2026-09-21T17:15:00.000Z',
    session_revision: 3,
  };
  const result = reopenInventorySession({
    session,
    existing_sessions: [session],
    can_reopen: true,
    actor_user_id: 'admin-1',
    reason: 'Bổ sung thời gian vì nhân viên mất kết nối',
    expires_at: '2026-09-21T18:15:00.000Z',
    operation_id: 'op-reopen-1',
    request_id: 'req-reopen-1',
    now: '2026-09-21T17:20:00.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'REOPENED');
  assert.equal(result.session.status, 'ACTIVE');
  assert.equal(result.session.config_snapshot_id, 'cfg-v1');
  assert.equal(result.session.reopen_reason, 'Bổ sung thời gian vì nhân viên mất kết nối');
  assert.equal(result.session.expires_at, '2026-09-21T18:15:00.000Z');
  const audit = result.write_plan.find((step) => step.sheet === 'EVENT_LOG' && step.action === 'APPEND');
  assert.equal(audit.row.event_type, 'INVENTORY_SESSION_REOPENED');
  assert.equal(audit.row.reason, 'Bổ sung thời gian vì nhân viên mất kết nối');
});
