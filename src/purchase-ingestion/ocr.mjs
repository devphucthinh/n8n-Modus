const clone = (value) => structuredClone(value);

export function recordOcrResult(invoice, { ocr_raw_id: ocrRawId, provider, raw_payload: rawPayload, completed_at: completedAt }) {
  const current = clone(invoice);
  const ocrRaw = {
    ocr_raw_id: ocrRawId,
    invoice_id: current.invoice_id,
    provider: String(provider).toUpperCase(),
    evidence_ids: [...current.evidence_ids],
    raw_payload: clone(rawPayload),
    completed_at: completedAt,
    status: 'RECEIVED',
  };
  return {
    ok: true,
    invoice: {
      ...current,
      status: 'REVIEW',
      ocr_raw_id: ocrRawId,
      ocr_completed_at: completedAt,
    },
    ocr_raw: ocrRaw,
  };
}
