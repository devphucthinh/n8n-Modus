import test from 'node:test';
import assert from 'node:assert/strict';

import { planStagedLedgerWrite } from '../../src/purchase-ingestion/ledger-plan.mjs';

const invoice = {
  invoice_id: 'invoice-001',
  branch_id: 'branch-001',
  business_date: '2026-09-21',
  config_snapshot_id: 'config-snapshot-001',
  supplier_recorded: 'Nhà máy A',
};

const baseLine = (overrides = {}) => ({
  line_id: 'line-001',
  invoice_id: 'invoice-001',
  item_id: 'bia-001',
  inventory_quantity: 24,
  inventory_unit: 'chai',
  converted_unit_price: 22_500,
  source_evidence_ids: ['evidence-001'],
  review_status: 'CONFIRMED',
  ...overrides,
});

test('only CONFIRMED Dòng nhập bia are staged for the Sổ nhập bia', () => {
  const result = planStagedLedgerWrite({
    invoice,
    lines: [
      baseLine(),
      baseLine({ line_id: 'line-ignored', review_status: 'IGNORED' }),
      baseLine({ line_id: 'line-rejected', review_status: 'REJECTED' }),
      baseLine({ line_id: 'line-adjusted', review_status: 'ADJUSTED' }),
    ],
    operation_id: 'operation-commit-001',
    request_id: 'request-commit-001',
    now: '2026-09-21T10:40:00.000Z',
    calculation_version: 'purchase-ingestion-v1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'PREPARED');
  assert.equal(result.ledger_rows.length, 1);
  assert.equal(result.ledger_rows[0].line_id, 'line-001');
  assert.equal(result.ledger_rows[0].sheet, 'LOG_NHAP');
  assert.equal(result.ledger_rows[0].domain_term, 'Sổ nhập bia');
  assert.equal(result.ledger_rows[0].config_snapshot_id, 'config-snapshot-001');
  assert.equal(result.ledger_rows[0].source_evidence_ids_json, '["evidence-001"]');
  assert.equal(result.operation_row.status, 'PREPARED');
  assert.equal(result.operation_row.idempotency_key, 'operation-commit-001');
});

test('rejects a purchase commit without immutable configuration lineage', () => {
  const result = planStagedLedgerWrite({
    invoice: { ...invoice, config_snapshot_id: '' },
    lines: [baseLine()],
    operation_id: 'operation-commit-002',
    request_id: 'request-commit-002',
    now: '2026-09-21T10:40:00.000Z',
    calculation_version: 'purchase-ingestion-v1',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'CONFIG_SNAPSHOT_REQUIRED');
});
