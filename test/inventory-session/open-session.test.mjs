import test from 'node:test';
import assert from 'node:assert/strict';
import { openOrReuseInventorySession } from '../../src/inventory-session/open-session.mjs';

const input = {
  envelope: {
    event_type: 'SCHEDULED_JOB',
    request_id: 'req-dispatch-1',
    operation_id: 'op-dispatch-1',
    branch_id: 'CN_HN',
    business_date: '2026-09-23',
    payload: { dispatch_key: 'lich-kiem-ke:CN_HN:2026-09-23' },
  },
  configSnapshotId: 'cfg-v2-fp',
  expectedConfigSnapshotId: 'cfg-v2-fp',
  beers: [
    { ma_bia: 'B20', ten_bia: 'Bia 20', don_vi_dem: 'thùng', thu_tu_hien_thi: '20', trang_thai: 'ACTIVE' },
    { ma_bia: 'B10', ten_bia: 'Bia 10', don_vi_dem: 'thùng', thu_tu_hien_thi: '10', trang_thai: 'ACTIVE' },
    { ma_bia: 'B30', ten_bia: 'Bia 30', don_vi_dem: 'thùng', thu_tu_hien_thi: '30', trang_thai: 'INACTIVE' },
  ],
  configGlobal: [{ config_key: 'INVENTORY_PAGE_SIZE', config_value: '8', trang_thai: 'ACTIVE' }],
  topics: [{ topic_id: 'topic-kiem-ke', branch_id: 'CN_HN', topic_type: 'KIEM_KE', chat_id: '-100100', message_thread_id: '77', trang_thai: 'ACTIVE' }],
  operations: [{ operation_id: 'op-existing', operation_type: 'OPEN_INVENTORY_SESSION', idempotency_key: 'dispatch-existing', status: 'COMMITTED' }],
};

function telegramReservation(overrides = {}) {
  return {
    operation_id: 'tg-update-9001', request_id: 'tg-update-9001', operation_type: 'ROUTE_COMMAND',
    idempotency_key: 'tg-callback-9001', expected_row_count: '1', actual_row_count: '', checksum: '',
    status: 'PREPARED', error_id: '', created_at: '2026-09-23T16:50:00.000Z', updated_at: '2026-09-23T16:50:00.000Z',
    ...overrides,
  };
}

function telegramEnvelope(reservation, overrides = {}) {
  return {
    ...input.envelope,
    event_type: 'TELEGRAM_UPDATE',
    operation_id: reservation.operation_id,
    request_id: reservation.request_id,
    payload: { command: '/kiemke', idempotency_key: reservation.idempotency_key },
    ...overrides,
  };
}

test('reuses the existing active session and never creates a second one', () => {
  const result = openOrReuseInventorySession({
    ...input,
    sessions: [{ session_id: 'session-existing', branch_id: 'CN_HN', business_date: '2026-09-22', config_snapshot_id: 'cfg-old', dispatch_key: 'dispatch-existing', master_message_id: '501', bubble_state: 'SENT', catalog_snapshot_json: '[{"stt":1}]', status: 'ACTIVE' }],
  });

  assert.equal(result.status, 'REUSED');
  assert.equal(result.session.session_id, 'session-existing');
  assert.equal(result.write_plan.length, 2);
  assert.equal(result.write_plan[0].sheet, 'OPERATION');
  assert.equal(result.write_plan[1].sheet, 'EVENT_LOG');
  assert.equal(result.commit_plan.length, 2);
});

for (const scenario of [
  { name: 'scheduled open', eventType: 'SCHEDULED_JOB' },
  { name: 'Telegram /kiemke', eventType: 'TELEGRAM_UPDATE' },
]) {
  test(`${scenario.name} fails closed when multiple active-like sessions exist for the branch`, () => {
    const sessions = ['ACTIVE', 'OPEN', 'IN_PROGRESS'].map((status, index) => ({
      session_id: `session-active-${index}`,
      branch_id: 'CN_HN',
      business_date: '2026-09-22',
      config_snapshot_id: `cfg-session-${index}`,
      dispatch_key: `dispatch-active-${index}`,
      catalog_snapshot_json: '[{"stt":1,"ma_bia":"B1"}]',
      master_message_id: String(501 + index),
      bubble_state: 'SENT',
      status,
    }));
    const openingOperations = sessions.map((session, index) => ({
      operation_id: `opening-${index}`,
      request_id: `opening-request-${index}`,
      operation_type: 'OPEN_INVENTORY_SESSION',
      idempotency_key: session.dispatch_key,
      config_snapshot_id: session.config_snapshot_id,
      expected_row_count: '3',
      actual_row_count: '3',
      status: 'COMMITTED',
    }));
    const reservation = scenario.eventType === 'TELEGRAM_UPDATE'
      ? telegramReservation({ status: 'RUNNING', expected_row_count: '' })
      : null;
    const envelope = reservation
      ? telegramEnvelope(reservation)
      : input.envelope;
    const result = openOrReuseInventorySession({
      ...input,
      envelope,
      sessions,
      operations: reservation ? [...openingOperations, reservation] : openingOperations,
    });

    assert.equal(result.ok, false);
    assert.equal(result.error_code, 'INVENTORY_SESSION_RECONCILIATION_REQUIRED');
    assert.deepEqual(result.write_plan, []);
    assert.deepEqual(result.commit_plan ?? [], []);
    assert.notEqual(result.reply_handled, true);
  });
}

test('opens a session with the dispatch business date and config snapshot and audits it', () => {
  const result = openOrReuseInventorySession({ ...input, sessions: [] });

  assert.equal(result.status, 'OPENED');
  assert.equal(result.session.business_date, '2026-09-23');
  assert.equal(result.session.config_snapshot_id, 'cfg-v2-fp');
  assert.equal(result.session.topic_id, 'topic-kiem-ke');
  assert.equal(result.write_plan[0].sheet, 'OPERATION');
  assert.equal(result.write_plan[1].sheet, 'PHIEN_KIEM_KE');
  assert.equal(result.write_plan[2].sheet, 'EVENT_LOG');
  assert.equal(result.write_plan[1].row.dispatch_key, input.envelope.payload.dispatch_key);
  assert.equal(result.write_plan[1].row.bubble_state, 'NONE');
  assert.equal(result.write_plan[1].row.master_message_id, '');
});

test('distinct separator-bearing dispatch keys cannot overwrite each other session or audit row', () => {
  const open = (dispatchKey, branchId, operationId) => openOrReuseInventorySession({
    ...input, sessions: [], operations: [],
    envelope: { ...input.envelope, branch_id: branchId, operation_id: operationId, payload: { dispatch_key: dispatchKey } },
    topics: [{ ...input.topics[0], branch_id: branchId }],
  });
  const first = open('a_b:c:2026-09-23', 'c', 'op-a');
  const second = open('a:b_c:2026-09-23', 'b_c', 'op-b');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.session.session_id, second.session.session_id);
  assert.notEqual(first.write_plan[2].row.event_id, second.write_plan[2].row.event_id);
  const repeated = open('a_b:c:2026-09-23', 'c', 'op-a');
  assert.equal(repeated.session.session_id, first.session.session_id);
  assert.equal(repeated.write_plan[2].row.event_id, first.write_plan[2].row.event_id);
});

test('returns an immutable operation with prepared rows and an explicit commit phase', () => {
  const result = openOrReuseInventorySession({ ...input, sessions: [] });

  assert.equal(result.operation.operation_id, 'op-dispatch-1');
  assert.equal(result.operation.status, 'PREPARED');
  assert.equal(result.operation.operation_type, 'OPEN_INVENTORY_SESSION');
  assert.equal(result.operation.idempotency_key, input.envelope.payload.dispatch_key);

  assert.deepEqual(
    result.write_plan.map(({ sheet, phase, row }) => ({ sheet, phase, status: row.status ?? row.trang_thai })),
    [
      { sheet: 'OPERATION', phase: 'PREPARE', status: 'PREPARED' },
      { sheet: 'PHIEN_KIEM_KE', phase: 'PREPARE', status: 'PREPARED' },
      { sheet: 'EVENT_LOG', phase: 'PREPARE', status: 'PREPARED' },
    ],
  );
  assert.deepEqual(
    result.commit_plan.map(({ sheet, phase, patch }) => ({ sheet, phase, status: patch.status ?? patch.trang_thai })),
    [
      { sheet: 'PHIEN_KIEM_KE', phase: 'COMMIT', status: 'ACTIVE' },
      { sheet: 'EVENT_LOG', phase: 'COMMIT', status: 'COMMITTED' },
      { sheet: 'OPERATION', phase: 'COMMIT', status: 'COMMITTED' },
    ],
  );
});

test('rejects a scheduled open when no active KIEM_KE topic is configured', () => {
  const result = openOrReuseInventorySession({
    ...input,
    topics: [],
    sessions: [],
    branch: { branch_id: 'CN_HN', forum_chat_id: '-100200', trang_thai: 'ACTIVE' },
    configGlobal: [{ config_key: 'INVENTORY_TOPIC_NAME', config_value: 'Kiểm kê bia - CN_HN', trang_thai: 'ACTIVE' }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'INVENTORY_TOPIC_NOT_CONFIGURED');
  assert.deepEqual(result.write_plan, []);
  assert.equal(result.topic_request, undefined);
});

test('does not trust a Telegram-created topic as configuration', () => {
  const result = openOrReuseInventorySession({
    ...input,
    topics: [],
    sessions: [],
    branch: { branch_id: 'CN_HN', forum_chat_id: '-100200', trang_thai: 'ACTIVE' },
    configGlobal: [{ config_key: 'INVENTORY_TOPIC_NAME', config_value: 'Kiểm kê bia - CN_HN', trang_thai: 'ACTIVE' }],
    createdTopic: { message_thread_id: '99' },
  });

  assert.equal(result.error_code, 'INVENTORY_TOPIC_NOT_CONFIGURED');
  assert.deepEqual(result.write_plan, []);
});

test('Telegram /kiemke cannot open a session when no committed session exists', () => {
  const reservation = telegramReservation();
  const result = openOrReuseInventorySession({
    ...input,
    envelope: telegramEnvelope(reservation),
    sessions: [],
    operations: [input.operations[0], reservation],
  });
  assert.equal(result.error_code, 'INVENTORY_SESSION_NOT_OPEN');
  assert.deepEqual(result.write_plan, []);
});

test('Telegram /kiemke refuses to resume without the exact Router reservation', () => {
  const existing = {
    session_id: 'session-existing', branch_id: 'CN_HN', business_date: '2026-09-22',
    config_snapshot_id: 'cfg-old', catalog_snapshot_json: '[{"stt":1,"ma_bia":"B1"}]',
    dispatch_key: 'dispatch-existing', master_message_id: '501', bubble_state: 'SENT', status: 'ACTIVE',
  };
  const result = openOrReuseInventorySession({
    ...input,
    envelope: { ...input.envelope, event_type: 'TELEGRAM_UPDATE', payload: { command: '/kiemke' } },
    sessions: [existing],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'INVENTORY_SESSION_RECONCILIATION_REQUIRED');
  assert.deepEqual(result.write_plan, []);
});

test('Telegram /kiemke takes over the matching Router reservation without changing its identity', () => {
  const existing = {
    session_id: 'session-existing', branch_id: 'CN_HN', business_date: '2026-09-22',
    config_snapshot_id: 'cfg-old', catalog_snapshot_json: '[{"stt":1,"ma_bia":"B1"}]',
    dispatch_key: 'dispatch-existing', master_message_id: '501', bubble_state: 'SENT', status: 'ACTIVE',
  };
  const reservation = telegramReservation();
  const result = openOrReuseInventorySession({
    ...input,
    envelope: telegramEnvelope(reservation),
    sessions: [existing],
    operations: [input.operations[0], reservation],
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'REUSED');
  assert.equal(result.operation.operation_id, reservation.operation_id);
  assert.equal(result.operation.idempotency_key, reservation.idempotency_key);
  assert.equal(result.operation.operation_type, 'ROUTE_COMMAND');
  assert.equal(result.operation.expected_row_count, '2');
  assert.equal(result.write_plan[0].row.operation_id, reservation.operation_id);
  assert.equal(result.write_plan[0].row.expected_row_count, '2');
  assert.equal(result.commit_plan.at(-1).match.operation_id, reservation.operation_id);
  assert.equal(result.commit_plan.at(-1).patch.actual_row_count, '2');
});

test('Telegram /kiemke accepts the Router RUNNING reservation without a Router-owned row-count assumption', () => {
  const existing = {
    session_id: 'session-existing', branch_id: 'CN_HN', business_date: '2026-09-22',
    config_snapshot_id: 'cfg-old', catalog_snapshot_json: '[{"stt":1,"ma_bia":"B1"}]',
    dispatch_key: 'dispatch-existing', master_message_id: '501', bubble_state: 'SENT', status: 'ACTIVE',
  };
  const reservation = telegramReservation({ status: 'RUNNING', expected_row_count: '' });
  const result = openOrReuseInventorySession({
    ...input,
    envelope: telegramEnvelope(reservation),
    sessions: [existing],
    operations: [input.operations[0], reservation],
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'REUSED');
  assert.equal(result.operation.operation_id, reservation.operation_id);
  assert.equal(result.operation.request_id, reservation.request_id);
  assert.equal(result.operation.idempotency_key, reservation.idempotency_key);
  assert.equal(result.operation.expected_row_count, '2');
  assert.equal(result.commit_plan.at(-1).match.operation_id, reservation.operation_id);
  assert.equal(result.commit_plan.at(-1).patch.actual_row_count, '2');
});

test('Telegram /kiemke can replay the worker-owned PREPARED reservation after a partial run', () => {
  const existing = {
    session_id: 'session-existing', branch_id: 'CN_HN', business_date: '2026-09-22',
    config_snapshot_id: 'cfg-old', catalog_snapshot_json: '[{"stt":1,"ma_bia":"B1"}]',
    dispatch_key: 'dispatch-existing', master_message_id: '501', bubble_state: 'SENT', status: 'ACTIVE',
  };
  const reservation = telegramReservation({ expected_row_count: '2' });
  const result = openOrReuseInventorySession({
    ...input,
    envelope: telegramEnvelope(reservation),
    sessions: [existing],
    operations: [input.operations[0], reservation],
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'REUSED');
  assert.equal(result.operation.operation_id, reservation.operation_id);
  assert.equal(result.operation.expected_row_count, '2');
  assert.equal(result.commit_plan.at(-1).patch.actual_row_count, '2');
});

test('Telegram /kiemke rejects duplicate matching Router reservations', () => {
  const existing = {
    session_id: 'session-existing', branch_id: 'CN_HN', business_date: '2026-09-22',
    config_snapshot_id: 'cfg-old', catalog_snapshot_json: '[{"stt":1,"ma_bia":"B1"}]',
    dispatch_key: 'dispatch-existing', master_message_id: '501', bubble_state: 'SENT', status: 'ACTIVE',
  };
  const reservation = telegramReservation();
  const result = openOrReuseInventorySession({
    ...input,
    envelope: telegramEnvelope(reservation),
    sessions: [existing],
    operations: [input.operations[0], reservation, { ...reservation }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'INVENTORY_SESSION_RECONCILIATION_REQUIRED');
  assert.deepEqual(result.write_plan, []);
});

test('Telegram /kiemke rejects malformed Router reservations', () => {
  const existing = {
    session_id: 'session-existing', branch_id: 'CN_HN', business_date: '2026-09-22',
    config_snapshot_id: 'cfg-old', catalog_snapshot_json: '[{"stt":1,"ma_bia":"B1"}]',
    dispatch_key: 'dispatch-existing', master_message_id: '501', bubble_state: 'SENT', status: 'ACTIVE',
  };
  const reservation = telegramReservation();
  for (const malformed of [
    { operation_type: 'REUSE_INVENTORY_SESSION' },
    { status: 'COMMITTED' },
    { status: 'RUNNING', expected_row_count: '2' },
    { status: 'RUNNING', actual_row_count: '2' },
    { status: 'MANUAL_REVIEW', expected_row_count: '' },
    { request_id: 'wrong-request' },
    { idempotency_key: 'wrong-idempotency-key' },
    { expected_row_count: '3' },
    { actual_row_count: '1' },
    { checksum: 'unexpected-checksum' },
    { error_id: 'unexpected-error' },
    { created_at: '' },
    { created_at: 'not-iso' },
    { updated_at: '' },
    { updated_at: 'still-not-iso' },
  ]) {
    const result = openOrReuseInventorySession({
      ...input,
      envelope: telegramEnvelope(reservation),
      sessions: [existing],
      operations: [input.operations[0], { ...reservation, ...malformed }],
    });
    assert.equal(result.ok, false, JSON.stringify(malformed));
    assert.equal(result.error_code, 'INVENTORY_SESSION_RECONCILIATION_REQUIRED', JSON.stringify(malformed));
    assert.deepEqual(result.write_plan, [], JSON.stringify(malformed));
  }
});

test('Telegram /kiemke can resume its frozen session when the read-only Gateway has no current snapshot', () => {
  const existing = {
    session_id: 'session-existing', branch_id: 'CN_HN', business_date: '2026-09-22',
    config_snapshot_id: 'cfg-frozen', catalog_snapshot_json: '[{"stt":1,"ma_bia":"B1"}]',
    dispatch_key: 'dispatch-existing', master_message_id: '501', bubble_state: 'SENT', status: 'ACTIVE',
  };
  const reservation = telegramReservation();
  const result = openOrReuseInventorySession({
    ...input,
    configSnapshotId: null,
    envelope: telegramEnvelope(reservation),
    sessions: [existing],
    operations: [input.operations[0], reservation],
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'REUSED');
  assert.equal(result.session.config_snapshot_id, 'cfg-frozen');
});

test('Telegram /kiemke refuses an ACTIVE session without its immutable config snapshot', () => {
  const reservation = telegramReservation();
  const result = openOrReuseInventorySession({
    ...input,
    configSnapshotId: null,
    envelope: telegramEnvelope(reservation),
    sessions: [{
      session_id: 'session-existing', branch_id: 'CN_HN', business_date: '2026-09-22',
      config_snapshot_id: '', catalog_snapshot_json: '[{"stt":1,"ma_bia":"B1"}]',
      dispatch_key: 'dispatch-existing', master_message_id: '501', bubble_state: 'SENT', status: 'ACTIVE',
    }],
    operations: [input.operations[0], reservation],
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'INVENTORY_SESSION_RECONCILIATION_REQUIRED');
  assert.deepEqual(result.write_plan, []);
});

test('Telegram /kiemke resumes the frozen business date when Router supplies no date', () => {
  const existing = {
    session_id: 'session-existing', branch_id: 'CN_HN', business_date: '2026-09-22',
    config_snapshot_id: 'cfg-old', dispatch_key: 'dispatch-existing',
    master_message_id: '501', bubble_state: 'SENT', status: 'ACTIVE', catalog_snapshot_json: '[]',
  };
  const reservation = telegramReservation();
  const result = openOrReuseInventorySession({
    ...input,
    envelope: telegramEnvelope(reservation, { business_date: null }),
    sessions: [existing],
    operations: [input.operations[0], reservation],
  });
  assert.equal(result.status, 'REUSED');
  assert.equal(result.session.business_date, '2026-09-22');
  assert.equal(result.session.master_message_id, '501');
});

test('Telegram /kiemke without a date still refuses to open a new session', () => {
  const reservation = telegramReservation();
  const result = openOrReuseInventorySession({
    ...input,
    envelope: telegramEnvelope(reservation, { business_date: null }),
    sessions: [],
    operations: [input.operations[0], reservation],
  });
  assert.equal(result.error_code, 'INVENTORY_SESSION_NOT_OPEN');
  assert.deepEqual(result.write_plan, []);
});

test('replaying the scheduled open does not replace its committed opening operation', () => {
  const dispatchKey = input.envelope.payload.dispatch_key;
  const opening = {
    operation_id: input.envelope.operation_id, operation_type: 'OPEN_INVENTORY_SESSION',
    idempotency_key: dispatchKey, status: 'COMMITTED', created_at: '2026-09-23T16:45:00.000Z',
  };
  const result = openOrReuseInventorySession({
    ...input,
    sessions: [{
      session_id: 'session-existing', branch_id: 'CN_HN', business_date: '2026-09-23',
      config_snapshot_id: 'cfg-v2-fp', dispatch_key: dispatchKey, master_message_id: '501',
      bubble_state: 'SENT', status: 'ACTIVE', catalog_snapshot_json: '[]',
    }],
    operations: [opening],
  });
  assert.equal(result.status, 'REUSED');
  assert.deepEqual(result.write_plan, []);
  assert.deepEqual(result.commit_plan, []);
  assert.deepEqual(result.operation, opening);
});

test('reuse refuses an operation ID already owned by another operation', () => {
  const result = openOrReuseInventorySession({
    ...input,
    sessions: [{
      session_id: 'session-existing', branch_id: 'CN_HN', business_date: '2026-09-22',
      config_snapshot_id: 'cfg-old', dispatch_key: 'dispatch-existing',
      master_message_id: '501', bubble_state: 'SENT', status: 'ACTIVE', catalog_snapshot_json: '[]',
    }],
    operations: [
      { operation_id: 'op-existing', operation_type: 'OPEN_INVENTORY_SESSION', idempotency_key: 'dispatch-existing', status: 'COMMITTED' },
      { operation_id: input.envelope.operation_id, operation_type: 'OTHER_OPERATION', idempotency_key: 'other', status: 'COMMITTED' },
    ],
  });
  assert.equal(result.error_code, 'INVENTORY_SESSION_RECONCILIATION_REQUIRED');
  assert.deepEqual(result.write_plan, []);
});

test('Telegram reuse cannot replace the committed opening operation with the same ID', () => {
  const result = openOrReuseInventorySession({
    ...input,
    envelope: { ...input.envelope, event_type: 'TELEGRAM_UPDATE', business_date: null, payload: { command: '/kiemke' } },
    sessions: [{
      session_id: 'session-existing', branch_id: 'CN_HN', business_date: '2026-09-22',
      config_snapshot_id: 'cfg-old', dispatch_key: 'dispatch-existing',
      master_message_id: '501', bubble_state: 'SENT', status: 'ACTIVE', catalog_snapshot_json: '[]',
    }],
    operations: [{
      operation_id: input.envelope.operation_id, operation_type: 'OPEN_INVENTORY_SESSION',
      idempotency_key: 'dispatch-existing', status: 'COMMITTED',
    }],
  });
  assert.equal(result.error_code, 'INVENTORY_SESSION_RECONCILIATION_REQUIRED');
  assert.deepEqual(result.write_plan, []);
});

test('replaying a PREPARED opening with no send attempt recovers its frozen session', () => {
  const dispatchKey = input.envelope.payload.dispatch_key;
  const frozenCatalog = '[{"stt":1,"ma_bia":"B0","ten_bia":"Frozen","don_vi_dem":"két"}]';
  const staged = {
    session_id: 'session-lich-kiem-ke_CN_HN_2026-09-23', branch_id: 'CN_HN',
    business_date: '2026-09-23', config_snapshot_id: 'cfg-v2-fp',
    topic_id: 'old-topic', chat_id: '-100-old', message_thread_id: '41', dispatch_key: dispatchKey,
    catalog_snapshot_json: frozenCatalog, catalog_count: '1', page_size: '8',
    master_message_id: '', bubble_state: 'NONE', status: 'PREPARED',
    created_at: '2026-09-23T16:45:00.000Z', updated_at: '2026-09-23T16:45:00.000Z',
  };
  const opening = {
    operation_id: input.envelope.operation_id, request_id: input.envelope.request_id,
    operation_type: 'OPEN_INVENTORY_SESSION', idempotency_key: dispatchKey,
    expected_row_count: 3, actual_row_count: '', checksum: '', status: 'PREPARED', error_id: '',
    created_at: '2026-09-23T16:45:00.000Z', updated_at: '2026-09-23T16:45:00.000Z',
  };
  const result = openOrReuseInventorySession({
    ...input, sessions: [staged], operations: [opening],
    configSnapshotId: 'cfg-live-new', topics: [], beers: [], configGlobal: [],
  });
  assert.equal(result.status, 'OPENED');
  assert.equal(result.session.catalog_snapshot_json, frozenCatalog);
  assert.equal(result.session.chat_id, '-100-old');
  assert.equal(result.session.config_snapshot_id, 'cfg-v2-fp');
  assert.equal(result.write_plan.length, 3);
  assert.equal(result.write_plan[0].row.created_at, opening.created_at);
  assert.equal(result.write_plan[1].row.created_at, staged.created_at);
  assert.equal(result.write_plan[1].row.status, 'PREPARED');
  assert.equal(result.write_plan[2].row.event_id, 'evt-session-lich-kiem-ke_CN_HN_2026-09-23');
  assert.deepEqual(result.commit_plan.map((entry) => entry.sheet), ['PHIEN_KIEM_KE', 'EVENT_LOG', 'OPERATION']);
});

test('a PREPARED opening cannot be replayed after bubble send was requested', () => {
  const dispatchKey = input.envelope.payload.dispatch_key;
  const result = openOrReuseInventorySession({
    ...input,
    sessions: [{
      session_id: 'session-lich-kiem-ke_CN_HN_2026-09-23', branch_id: 'CN_HN',
      business_date: '2026-09-23', config_snapshot_id: 'cfg-v2-fp', dispatch_key: dispatchKey,
      bubble_state: 'SEND_REQUESTED', master_message_id: '', status: 'PREPARED',
    }],
    operations: [{ operation_id: input.envelope.operation_id, operation_type: 'OPEN_INVENTORY_SESSION', idempotency_key: dispatchKey, status: 'PREPARED' }],
  });
  assert.equal(result.error_code, 'INVENTORY_SESSION_RECONCILIATION_REQUIRED');
  assert.deepEqual(result.write_plan, []);
});

test('a staged session cannot be resumed or opened over', () => {
  const result = openOrReuseInventorySession({
    ...input,
    envelope: { ...input.envelope, event_type: 'TELEGRAM_UPDATE', payload: { command: '/kiemke' } },
    sessions: [{ session_id: 'session-pending', branch_id: 'CN_HN', status: 'PREPARED' }],
  });
  assert.equal(result.error_code, 'INVENTORY_SESSION_RECONCILIATION_REQUIRED');
  assert.deepEqual(result.write_plan, []);
});

test('a new session cannot stage over an operation ID already committed elsewhere', () => {
  const result = openOrReuseInventorySession({
    ...input, sessions: [],
    operations: [{ operation_id: input.envelope.operation_id, operation_type: 'CONFIG_SNAPSHOT', idempotency_key: 'another-key', status: 'COMMITTED' }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'INVENTORY_SESSION_RECONCILIATION_REQUIRED');
  assert.deepEqual(result.write_plan, []);
});

test('scheduled open freezes active beers in numeric display order with stable STT', () => {
  const result = openOrReuseInventorySession({ ...input, sessions: [] });
  assert.equal(result.ok, true);
  assert.equal(result.session.catalog_count, '2');
  assert.equal(result.session.page_size, '8');
  assert.deepEqual(JSON.parse(result.session.catalog_snapshot_json), [
    { stt: 1, ma_bia: 'B10', ten_bia: 'Bia 10', don_vi_dem: 'thùng' },
    { stt: 2, ma_bia: 'B20', ten_bia: 'Bia 20', don_vi_dem: 'thùng' },
  ]);
  assert.equal(result.write_plan[1].row.catalog_snapshot_json, result.session.catalog_snapshot_json);
});

test('resume preserves the frozen catalog despite changed CONFIG_BIA', () => {
  const frozen = '[{"stt":1,"ma_bia":"OLD","ten_bia":"Old beer","don_vi_dem":"két"}]';
  const reservation = telegramReservation();
  const existing = {
    session_id: 'session-existing', branch_id: 'CN_HN', business_date: '2026-09-22',
    config_snapshot_id: 'cfg-old', dispatch_key: 'dispatch-existing', catalog_snapshot_json: frozen, master_message_id: '501', bubble_state: 'SENT', status: 'ACTIVE',
  };
  const result = openOrReuseInventorySession({
    ...input,
    envelope: telegramEnvelope(reservation),
    sessions: [existing],
    operations: [input.operations[0], reservation],
  });
  assert.equal(result.session.catalog_snapshot_json, frozen);
});

test('scheduled open rejects invalid catalog and page size before any write', () => {
  const invalidCases = [
    { beers: [], error: 'INVENTORY_CATALOG_EMPTY' },
    { beers: [{ ...input.beers[0], ma_bia: '' }], error: 'INVENTORY_CATALOG_INVALID' },
    { beers: [input.beers[0], { ...input.beers[0] }], error: 'INVENTORY_CATALOG_DUPLICATE' },
    { configGlobal: [{ config_key: 'INVENTORY_PAGE_SIZE', config_value: '0', trang_thai: 'ACTIVE' }], error: 'INVENTORY_PAGE_SIZE_INVALID' },
  ];
  for (const { error, ...override } of invalidCases) {
    const result = openOrReuseInventorySession({ ...input, ...override, sessions: [] });
    assert.equal(result.error_code, error);
    assert.deepEqual(result.write_plan, []);
  }
});

test('scheduled open rejects an incoming snapshot that differs from current Gateway snapshot', () => {
  const result = openOrReuseInventorySession({ ...input, expectedConfigSnapshotId: 'cfg-stale', sessions: [] });
  assert.equal(result.error_code, 'INVENTORY_CONFIG_SNAPSHOT_MISMATCH');
  assert.deepEqual(result.write_plan, []);
});

test('resume refuses an ACTIVE row without its committed opening operation', () => {
  const existing = {
    session_id: 'session-existing', branch_id: 'CN_HN', business_date: '2026-09-22',
    dispatch_key: 'dispatch-existing', config_snapshot_id: 'cfg-old', master_message_id: '501',
    bubble_state: 'SENT', status: 'ACTIVE', catalog_snapshot_json: '[]',
  };
  const result = openOrReuseInventorySession({
    ...input,
    envelope: { ...input.envelope, event_type: 'TELEGRAM_UPDATE', payload: { command: '/kiemke' } },
    sessions: [existing], operations: [],
  });
  assert.equal(result.error_code, 'INVENTORY_SESSION_RECONCILIATION_REQUIRED');
  assert.deepEqual(result.write_plan, []);
});
