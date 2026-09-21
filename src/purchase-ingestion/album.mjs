const clone = (value) => structuredClone(value);

function businessDate(receivedAt, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(receivedAt));
  const values = Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function nextId(kind, command) {
  if (typeof command.id_factory === 'function') return command.id_factory(kind);
  return `${kind}-${command.operation_id}`;
}

export function createPurchaseState() {
  return {
    invoices: [],
    evidence: [],
    ocr_raw: [],
    lines: [],
    operations: [],
  };
}

export function expireDraft(draft, { now, ttl_minutes: ttlMinutes }) {
  const current = clone(draft);
  const ttl = Number(ttlMinutes);
  const expiresAt = new Date(current.last_activity_at).getTime() + ttl * 60_000;
  if (current.status !== 'DRAFT' || !Number.isFinite(expiresAt) || new Date(now).getTime() <= expiresAt) {
    return { changed: false, draft: current, ocr_started: false };
  }
  return {
    changed: true,
    draft: { ...current, status: 'NEEDS_CONTINUATION', ttl_expired_at: now, updated_at: now },
    ocr_started: false,
  };
}

export function requestOcr(draft, { actor_user_id: actorUserId, at }) {
  const current = clone(draft);
  if (current.owner_user_id !== actorUserId) return { ok: false, invoice: current, error_code: 'ALBUM_OWNER_ONLY' };
  if (!['DRAFT', 'NEEDS_CONTINUATION'].includes(current.status)) {
    return { ok: false, invoice: current, error_code: 'OCR_REQUEST_NOT_ALLOWED' };
  }
  if ((current.evidence_storage_statuses ?? []).some((status) => status !== 'STORED')) {
    return { ok: false, invoice: current, error_code: 'EVIDENCE_NOT_STORED' };
  }
  const invoice = { ...current, status: 'OCR_REQUESTED', ocr_requested_at: at, updated_at: at };
  return {
    ok: true,
    invoice,
    ocr_job: {
      invoice_id: invoice.invoice_id,
      evidence_ids: [...invoice.evidence_ids],
      provider: 'GEMINI',
      requested_at: at,
    },
  };
}

export function applyImageUpdate(state, command) {
  const input = clone(state ?? createPurchaseState());
  const config = command.config ?? {};
  const maxImages = Number(config.max_images_per_invoice);
  if (!Number.isInteger(maxImages) || maxImages < 5 || maxImages > 10) {
    return { ok: false, state: input, error_code: 'IMAGE_LIMIT_CONFIG_INVALID' };
  }

  const idempotencyKey = command.idempotency_key ?? command.operation_id;
  const priorOperation = input.operations.find(({ idempotency_key }) => idempotency_key === idempotencyKey);
  if (priorOperation) {
    const priorInvoice = input.invoices.find(({ invoice_id }) => invoice_id === priorOperation.invoice_id);
    const priorEvidence = input.evidence.find(({ evidence_id }) => evidence_id === priorOperation.evidence_id);
    return {
      ok: true,
      created: false,
      duplicate: true,
      state: input,
      invoice: priorInvoice,
      evidence: priorEvidence,
      warnings: [],
      status: 'DUPLICATE',
    };
  }

  const targeted = command.invoice_id
    ? input.invoices.find(({ invoice_id }) => invoice_id === command.invoice_id)
    : null;
  if (command.invoice_id && !targeted) {
    return { ok: false, state: input, error_code: 'DRAFT_NOT_FOUND' };
  }
  if (targeted && targeted.owner_user_id !== command.actor_user_id) {
    return { ok: false, state: input, error_code: 'ALBUM_OWNER_ONLY' };
  }
  if (targeted && targeted.branch_id !== command.branch_id) {
    return { ok: false, state: input, error_code: 'BRANCH_MISMATCH' };
  }
  if (targeted && !['DRAFT', 'NEEDS_CONTINUATION'].includes(targeted.status)) {
    return { ok: false, state: input, error_code: 'ALBUM_MUTATION_CLOSED' };
  }
  const activeDraft = input.invoices.find((candidate) => (
    candidate.branch_id === command.branch_id
    && candidate.owner_user_id === command.actor_user_id
    && ['DRAFT', 'NEEDS_CONTINUATION'].includes(candidate.status)
  ));
  const current = targeted ?? activeDraft;
  if (current && current.evidence_ids.length >= maxImages) {
    return { ok: false, state: input, error_code: 'IMAGE_LIMIT_REACHED' };
  }
  const created = !current;
  const invoiceId = current?.invoice_id ?? nextId('invoice', command);
  const evidenceId = nextId('evidence', command);
  const storageStatus = String(command.image.storage_status ?? (command.image.drive_file_id ? 'STORED' : 'PENDING_DRIVE')).toUpperCase();
  const invoice = current
    ? {
      ...current,
      last_activity_at: command.received_at,
      updated_at: command.received_at,
      evidence_ids: [...current.evidence_ids, evidenceId],
      evidence_storage_statuses: [...(current.evidence_storage_statuses ?? []), storageStatus],
      revision: Number(current.revision ?? 0) + 1,
    }
    : {
      invoice_id: invoiceId,
      branch_id: command.branch_id,
      owner_user_id: command.actor_user_id,
      status: 'DRAFT',
      business_date: businessDate(command.received_at, config.branch_timezone),
      first_received_at: command.received_at,
      last_activity_at: command.received_at,
      evidence_ids: [evidenceId],
      created_at: command.received_at,
      updated_at: command.received_at,
      revision: 1,
      evidence_storage_statuses: [storageStatus],
    };
  const evidence = {
    ...clone(command.image),
    evidence_id: evidenceId,
    invoice_id: invoiceId,
    ordinal: invoice.evidence_ids.length,
    branch_id: command.branch_id,
    sender_user_id: command.actor_user_id,
    received_at: command.received_at,
    storage_status: storageStatus,
  };

  if (created) input.invoices.push(invoice);
  else input.invoices[input.invoices.findIndex(({ invoice_id }) => invoice_id === invoiceId)] = invoice;
  input.evidence.push(evidence);
  input.operations.push({
    operation_id: command.operation_id,
    request_id: command.request_id,
    idempotency_key: idempotencyKey,
    invoice_id: invoiceId,
    evidence_id: evidenceId,
    status: 'APPLIED',
  });
  const warnings = invoice.evidence_ids.length >= 6
    ? [{ code: 'ALBUM_IMAGE_COUNT_HIGH', image_count: invoice.evidence_ids.length }]
    : [];
  return { ok: true, created, duplicate: false, state: input, invoice, evidence, warnings };
}
