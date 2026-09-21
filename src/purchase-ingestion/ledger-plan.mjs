import { createHash } from 'node:crypto';

const TERMINAL_LINE_STATES = new Set(['CONFIRMED', 'IGNORED', 'REJECTED', 'ADJUSTED']);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function checksum(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function planStagedLedgerWrite({ invoice, lines, operation_id: operationId, request_id: requestId, now, calculation_version: calculationVersion }) {
  const configSnapshotId = String(invoice?.config_snapshot_id ?? '').trim();
  if (!configSnapshotId) {
    return { ok: false, status: 'CONFIG_SNAPSHOT_REQUIRED', error_code: 'CONFIG_SNAPSHOT_REQUIRED' };
  }
  const incomplete = lines.filter(({ review_status: status }) => !TERMINAL_LINE_STATES.has(status));
  if (incomplete.length > 0) {
    return {
      ok: false,
      status: 'REVIEW_INCOMPLETE',
      error_code: 'REVIEW_INCOMPLETE',
      pending_line_ids: incomplete.map(({ line_id: lineId }) => lineId),
    };
  }

  const ledgerRows = lines
    .filter(({ review_status: status }) => status === 'CONFIRMED')
    .map((line) => ({
      sheet: 'LOG_NHAP',
      domain_term: 'Sổ nhập bia',
      row_id: `purchase-ledger-${line.line_id}`,
      operation_id: operationId,
      invoice_id: invoice.invoice_id,
      line_id: line.line_id,
      branch_id: invoice.branch_id,
      business_date: invoice.business_date,
      item_id: line.item_id,
      inventory_quantity: line.inventory_quantity,
      inventory_unit: line.inventory_unit,
      converted_unit_price: line.converted_unit_price,
      supplier_recorded: invoice.supplier_recorded ?? line.supplier_recorded ?? null,
       source_evidence_ids_json: JSON.stringify(line.source_evidence_ids ?? []),
       calculation_version: calculationVersion,
       config_snapshot_id: configSnapshotId,
       status: 'PREPARED',
    }));
  const operationRow = {
    operation_id: operationId,
    request_id: requestId,
    operation_type: 'PURCHASE_INVOICE_COMMIT',
    idempotency_key: operationId,
    expected_row_count: String(ledgerRows.length),
    actual_row_count: '',
    checksum: checksum(ledgerRows),
    status: 'PREPARED',
    error_id: '',
    created_at: now,
    updated_at: now,
  };
  return {
    ok: true,
    status: 'PREPARED',
    operation_row: operationRow,
    ledger_rows: ledgerRows,
    write_plan: [
      { sheet: 'OPERATION', action: 'APPEND', rows: [operationRow] },
      { sheet: 'DONG_NHAP', action: 'APPEND', rows: lines.map((line) => ({ ...line, config_snapshot_id: configSnapshotId, status: 'PREPARED' })) },
      { sheet: 'LOG_NHAP', action: 'APPEND', rows: ledgerRows },
      { sheet: 'HOA_DON_NHAP', action: 'APPEND_VERSION', rows: [{ ...invoice, status: 'PREPARED', operation_id: operationId }] },
    ],
  };
}
