import test from 'node:test';
import assert from 'node:assert/strict';

import { applyImageUpdate, createPurchaseState, requestOcr } from '../../src/purchase-ingestion/album.mjs';
import { recordOcrResult } from '../../src/purchase-ingestion/ocr.mjs';

const config = {
  max_images_per_invoice: 10,
  draft_ttl_minutes: 30,
  branch_timezone: 'Asia/Ho_Chi_Minh',
};

test('Đọc hóa đơn creates an explicit Gemini OCR job after Chứng từ gốc is stored', () => {
  const received = applyImageUpdate(createPurchaseState(), {
    request_id: 'request-ocr-001',
    operation_id: 'operation-ocr-001',
    actor_user_id: 'user-001',
    branch_id: 'branch-001',
    received_at: '2026-09-21T10:00:00.000Z',
    config,
    image: {
      telegram_file_id: 'telegram-file-ocr-001',
      source_message_id: 'message-ocr-001',
      original_file_name: 'hoa-don-ocr.jpg',
      mime_type: 'image/jpeg',
      checksum: 'sha256:ocr-001',
      drive_file_id: 'drive-file-ocr-001',
      storage_status: 'STORED',
    },
    id_factory: (kind) => `${kind}-ocr-001`,
  });

  const result = requestOcr(received.invoice, {
    actor_user_id: 'user-001',
    at: '2026-09-21T10:05:00.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.invoice.status, 'OCR_REQUESTED');
  assert.equal(result.ocr_job.provider, 'GEMINI');
  assert.deepEqual(result.ocr_job.evidence_ids, ['evidence-ocr-001']);
});

test('Kết quả OCR gốc remains separate from the reviewed invoice version', () => {
  const invoice = {
    invoice_id: 'invoice-ocr-002',
    status: 'OCR_REQUESTED',
    evidence_ids: ['evidence-ocr-002'],
  };
  const rawPayload = {
    supplier: 'Nhà máy A',
    lines: [{ item_code: 'BIA-001', quantity: 2 }],
  };

  const result = recordOcrResult(invoice, {
    ocr_raw_id: 'ocr-raw-002',
    provider: 'GEMINI',
    raw_payload: rawPayload,
    completed_at: '2026-09-21T10:06:00.000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.invoice.status, 'REVIEW');
  assert.equal(result.invoice.ocr_raw_id, 'ocr-raw-002');
  assert.deepEqual(result.ocr_raw.raw_payload, rawPayload);
  assert.deepEqual(result.ocr_raw.evidence_ids, ['evidence-ocr-002']);
  assert.equal(result.invoice.supplier_recorded, undefined);
  result.ocr_raw.raw_payload.supplier = 'changed';
  assert.equal(rawPayload.supplier, 'Nhà máy A');
});
