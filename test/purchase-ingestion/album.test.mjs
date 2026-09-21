import test from 'node:test';
import assert from 'node:assert/strict';

import { applyImageUpdate, createPurchaseState, expireDraft } from '../../src/purchase-ingestion/album.mjs';

const config = {
  max_images_per_invoice: 10,
  draft_ttl_minutes: 30,
  branch_timezone: 'Asia/Ho_Chi_Minh',
};

const image = (overrides = {}) => ({
  telegram_file_id: 'telegram-file-001',
  source_message_id: 'message-001',
  original_file_name: 'hoa-don-001.jpg',
  mime_type: 'image/jpeg',
  checksum: 'sha256:invoice-001',
  drive_file_id: 'drive-file-001',
  storage_status: 'STORED',
  ...overrides,
});

test('first image creates a new Hóa đơn nháp and Bộ ảnh hóa đơn', () => {
  const result = applyImageUpdate(createPurchaseState(), {
    request_id: 'request-001',
    operation_id: 'operation-001',
    actor_user_id: 'user-001',
    branch_id: 'branch-001',
    received_at: '2026-09-21T10:00:00.000Z',
    config,
    image: image(),
    id_factory: (kind) => `${kind}-001`,
  });

  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.invoice.status, 'DRAFT');
  assert.equal(result.invoice.owner_user_id, 'user-001');
  assert.equal(result.invoice.branch_id, 'branch-001');
  assert.equal(result.invoice.business_date, '2026-09-21');
  assert.deepEqual(result.invoice.evidence_ids, ['evidence-001']);
  assert.equal(result.evidence.source_message_id, 'message-001');
  assert.equal(result.evidence.drive_file_id, 'drive-file-001');
  assert.equal(result.evidence.checksum, 'sha256:invoice-001');
  assert.equal(result.state.invoices.length, 1);
  assert.equal(result.state.evidence.length, 1);
});

test('same sender and branch group later images into the same Bộ ảnh hóa đơn', () => {
  const first = applyImageUpdate(createPurchaseState(), {
    request_id: 'request-001',
    operation_id: 'operation-001',
    actor_user_id: 'user-001',
    branch_id: 'branch-001',
    received_at: '2026-09-21T10:00:00.000Z',
    config,
    image: image(),
    id_factory: (kind) => `${kind}-001`,
  });

  const second = applyImageUpdate(first.state, {
    request_id: 'request-002',
    operation_id: 'operation-002',
    actor_user_id: 'user-001',
    branch_id: 'branch-001',
    received_at: '2026-09-21T10:01:00.000Z',
    config,
    image: image({
      telegram_file_id: 'telegram-file-002',
      source_message_id: 'message-002',
      checksum: 'sha256:invoice-002',
      drive_file_id: 'drive-file-002',
    }),
    id_factory: (kind) => `${kind}-002`,
  });

  assert.equal(second.ok, true);
  assert.equal(second.created, false);
  assert.equal(second.invoice.invoice_id, first.invoice.invoice_id);
  assert.equal(second.invoice.evidence_ids.length, 2);
  assert.deepEqual(second.state.invoices.map(({ invoice_id }) => invoice_id), [first.invoice.invoice_id]);
  assert.deepEqual(second.state.evidence.map(({ evidence_id }) => evidence_id), ['evidence-001', 'evidence-002']);
});

test('only the Hóa đơn nháp owner may mutate a targeted Bộ ảnh hóa đơn', () => {
  const first = applyImageUpdate(createPurchaseState(), {
    request_id: 'request-001',
    operation_id: 'operation-001',
    actor_user_id: 'user-001',
    branch_id: 'branch-001',
    received_at: '2026-09-21T10:00:00.000Z',
    config,
    image: image(),
    id_factory: (kind) => `${kind}-001`,
  });

  const unauthorized = applyImageUpdate(first.state, {
    request_id: 'request-003',
    operation_id: 'operation-003',
    actor_user_id: 'user-002',
    branch_id: 'branch-001',
    invoice_id: first.invoice.invoice_id,
    received_at: '2026-09-21T10:02:00.000Z',
    config,
    image: image({ telegram_file_id: 'telegram-file-003' }),
    id_factory: (kind) => `${kind}-003`,
  });

  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorized.error_code, 'ALBUM_OWNER_ONLY');
  assert.equal(unauthorized.state.invoices.length, 1);
  assert.equal(unauthorized.state.evidence.length, 1);
});

test('configurable image limit accepts five images and rejects the sixth', () => {
  const limitedConfig = { ...config, max_images_per_invoice: 5 };
  let state = createPurchaseState();
  let invoice;

  for (let index = 1; index <= 5; index += 1) {
    const result = applyImageUpdate(state, {
      request_id: `request-${index}`,
      operation_id: `operation-${index}`,
      actor_user_id: 'user-001',
      branch_id: 'branch-001',
      invoice_id: invoice?.invoice_id,
      received_at: `2026-09-21T10:0${index}:00.000Z`,
      config: limitedConfig,
      image: image({ telegram_file_id: `telegram-file-${index}` }),
      id_factory: (kind) => `${kind}-${index}`,
    });
    assert.equal(result.ok, true);
    invoice = result.invoice;
    state = result.state;
  }

  const sixth = applyImageUpdate(state, {
    request_id: 'request-006',
    operation_id: 'operation-006',
    actor_user_id: 'user-001',
    branch_id: 'branch-001',
    invoice_id: invoice.invoice_id,
    received_at: '2026-09-21T10:06:00.000Z',
    config: limitedConfig,
    image: image({ telegram_file_id: 'telegram-file-006' }),
    id_factory: (kind) => `${kind}-006`,
  });

  assert.equal(sixth.ok, false);
  assert.equal(sixth.error_code, 'IMAGE_LIMIT_REACHED');
  assert.equal(sixth.state.evidence.length, 5);
});

test('draft TTL moves a Hóa đơn nháp to continuation-needed without starting OCR', () => {
  const first = applyImageUpdate(createPurchaseState(), {
    request_id: 'request-ttl-001',
    operation_id: 'operation-ttl-001',
    actor_user_id: 'user-001',
    branch_id: 'branch-001',
    received_at: '2026-09-21T10:00:00.000Z',
    config,
    image: image(),
    id_factory: (kind) => `${kind}-ttl-001`,
  });

  const expired = expireDraft(first.invoice, {
    now: '2026-09-21T10:31:00.000Z',
    ttl_minutes: 30,
  });

  assert.equal(expired.changed, true);
  assert.equal(expired.draft.status, 'NEEDS_CONTINUATION');
  assert.equal(expired.draft.ocr_requested_at, undefined);
  assert.equal(expired.ocr_started, false);
});

test('duplicate technical update is acknowledged without adding another image', () => {
  const command = {
    request_id: 'request-duplicate-001',
    operation_id: 'operation-duplicate-001',
    actor_user_id: 'user-001',
    branch_id: 'branch-001',
    received_at: '2026-09-21T10:00:00.000Z',
    config,
    image: image(),
    id_factory: (kind) => `${kind}-duplicate-001`,
  };
  const first = applyImageUpdate(createPurchaseState(), command);
  const replay = applyImageUpdate(first.state, {
    ...command,
    request_id: 'request-duplicate-retry',
    image: image({ telegram_file_id: 'telegram-file-replayed' }),
  });

  assert.equal(replay.ok, true);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.status, 'DUPLICATE');
  assert.deepEqual(replay.state, first.state);
  assert.equal(replay.state.evidence.length, 1);
});

test('sixth image is accepted with a Bộ ảnh hóa đơn size warning', () => {
  let state = createPurchaseState();
  let invoice;
  let sixth;
  for (let index = 1; index <= 6; index += 1) {
    const result = applyImageUpdate(state, {
      request_id: `request-large-${index}`,
      operation_id: `operation-large-${index}`,
      actor_user_id: 'user-001',
      branch_id: 'branch-001',
      invoice_id: invoice?.invoice_id,
      received_at: `2026-09-21T11:0${index}:00.000Z`,
      config,
      image: image({ telegram_file_id: `telegram-large-${index}` }),
      id_factory: (kind) => `${kind}-large-${index}`,
    });
    assert.equal(result.ok, true);
    state = result.state;
    invoice = result.invoice;
    if (index === 6) sixth = result;
  }

  assert.deepEqual(sixth.warnings, [{ code: 'ALBUM_IMAGE_COUNT_HIGH', image_count: 6 }]);
});

test('album mutation is rejected after OCR starts even for the Hóa đơn nháp owner', () => {
  const first = applyImageUpdate(createPurchaseState(), {
    request_id: 'request-closed-001',
    operation_id: 'operation-closed-001',
    actor_user_id: 'user-001',
    branch_id: 'branch-001',
    received_at: '2026-09-21T12:00:00.000Z',
    config,
    image: image(),
    id_factory: (kind) => `${kind}-closed-001`,
  });
  const stateAfterOcr = {
    ...first.state,
    invoices: [{ ...first.invoice, status: 'OCR_REQUESTED' }],
  };

  const result = applyImageUpdate(stateAfterOcr, {
    request_id: 'request-closed-002',
    operation_id: 'operation-closed-002',
    actor_user_id: 'user-001',
    branch_id: 'branch-001',
    invoice_id: first.invoice.invoice_id,
    received_at: '2026-09-21T12:01:00.000Z',
    config,
    image: image({ telegram_file_id: 'telegram-closed-002' }),
    id_factory: (kind) => `${kind}-closed-002`,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'ALBUM_MUTATION_CLOSED');
  assert.equal(result.state.evidence.length, 1);
});
