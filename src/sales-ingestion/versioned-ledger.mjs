import { sha256 } from '../config-gateway/sha256.mjs';

const asText = (value) => (value == null ? '' : String(value).trim());
const isActive = (row) => !['INACTIVE', 'NO', 'FALSE', '0'].includes(asText(row?.trang_thai ?? row?.status).toUpperCase());
const isTracked = (row) => row?.tracked === true || ['YES', 'TRUE', '1', 'ACTIVE'].includes(asText(row?.tracked ?? row?.theo_doi).toUpperCase());
const isCurrentVersion = (row) => ['ACTIVE', 'PUBLISHED'].includes(asText(row?.status).toUpperCase());

function canonicalLines(lines = []) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => ({
      item_id: asText(line.item_id),
      quantity_inventory_units: Number(line.quantity_inventory_units),
      inventory_unit: asText(line.inventory_unit),
    }))
    .sort((left, right) => left.item_id.localeCompare(right.item_id));
}

export function computeNormalizedContentHash({ branchId, businessDate, canonicalLines: lines = [] } = {}) {
  return sha256(JSON.stringify({
    branch_id: asText(branchId),
    business_date: asText(businessDate),
    lines: canonicalLines(lines),
  }));
}

/**
 * Classify a file before any version is created. The file hash is evidence
 * identity; normalized content is the business identity for no-change checks.
 */
export function dedupeSalesFile({ fileHash, normalizedContentHash, branchId, businessDate, existingUploads = [], existingVersions = [] } = {}) {
  const sameFile = (Array.isArray(existingUploads) ? existingUploads : []).find((upload) => asText(upload.file_hash ?? upload.content_hash) === asText(fileHash));
  if (sameFile) {
    return {
      kind: 'DUPLICATE_FILE',
      existing_upload_id: asText(sameFile.upload_id ?? sameFile.sales_upload_id),
      existing_version_id: asText(sameFile.sales_version_id) || null,
    };
  }
  const sameContent = (Array.isArray(existingVersions) ? existingVersions : []).find((version) => (
    isCurrentVersion(version)
      && asText(version.branch_id) === asText(branchId)
      && asText(version.business_date) === asText(businessDate)
      && asText(version.normalized_content_hash) === asText(normalizedContentHash)
  ));
  if (sameContent && asText(sameContent.source).toUpperCase() !== 'SYSTEM_ZERO') {
    return { kind: 'NO_CHANGE', existing_version_id: asText(sameContent.sales_version_id ?? sameContent.version_id) };
  }
  return { kind: 'NEW' };
}

export function authorizeSalesPublish({ requireSeparateApprover = 'NO', uploaderUserId, approverUserId } = {}) {
  const required = ['YES', 'TRUE', '1'].includes(asText(requireSeparateApprover).toUpperCase());
  if (required && (!asText(approverUserId) || asText(approverUserId) === asText(uploaderUserId))) {
    return { ok: false, error_code: 'SEPARATE_APPROVER_REQUIRED' };
  }
  return { ok: true };
}

function salesVersionId({ branchId, businessDate, fileHash, normalizedContentHash, source }) {
  return `sales-${asText(source).toLowerCase()}-${sha256(`${asText(branchId)}|${asText(businessDate)}|${asText(fileHash)}|${asText(normalizedContentHash)}`).slice(0, 16)}`;
}

function zeroLines(trackedItems) {
  return (Array.isArray(trackedItems) ? trackedItems : [])
    .filter((item) => isActive(item) && isTracked(item))
    .map((item) => ({
      item_id: asText(item.item_id ?? item.ma_bia),
      quantity_inventory_units: 0,
      inventory_unit: asText(item.inventory_unit ?? item.don_vi_kiem_ke ?? item.don_vi_dem),
    }))
    .filter((line) => line.item_id)
    .sort((left, right) => left.item_id.localeCompare(right.item_id));
}

/**
 * Create a committed-looking SYSTEM_ZERO version plan only when there is no
 * real or broken file waiting for the same branch/date.
 */
export function createSystemZero({ branchId, businessDate, trackedItems = [], pendingUploads = [], existingVersions = [], now = new Date().toISOString() } = {}) {
  const terminalUploadStatuses = new Set(['CANCELLED', 'PUBLISHED', 'SUPERSEDED', 'COMMITTED', 'REJECTED', 'DUPLICATE_FILE', 'NO_CHANGE']);
  const blockingUploads = (Array.isArray(pendingUploads) ? pendingUploads : []).filter((upload) => (
    (!upload.branch_id || asText(upload.branch_id) === asText(branchId))
      && (!upload.business_date || asText(upload.business_date) === asText(businessDate))
      && asText(upload.status)
      && !terminalUploadStatuses.has(asText(upload.status).toUpperCase())
  ));
  if (blockingUploads.length > 0) {
    return {
      ok: false,
      error_code: 'SYSTEM_ZERO_BLOCKED_PENDING_FILE',
      blocking_upload_ids: blockingUploads.map((upload) => asText(upload.upload_id ?? upload.sales_upload_id)).filter(Boolean),
    };
  }

  const active = (Array.isArray(existingVersions) ? existingVersions : []).find((version) => (
    isCurrentVersion(version) && asText(version.branch_id) === asText(branchId) && asText(version.business_date) === asText(businessDate)
  ));
  if (active?.source === 'SYSTEM_ZERO') return { ok: true, action: 'NO_CHANGE', existing_version_id: asText(active.sales_version_id ?? active.version_id) };
  if (active) return { ok: false, error_code: 'SYSTEM_ZERO_NOT_ALLOWED_ACTIVE_FILE', existing_version_id: asText(active.sales_version_id ?? active.version_id) };

  const lines = zeroLines(trackedItems);
  const normalizedContentHash = computeNormalizedContentHash({ branchId, businessDate, canonicalLines: lines });
  const version = {
    sales_version_id: salesVersionId({ branchId, businessDate, fileHash: '', normalizedContentHash, source: 'SYSTEM_ZERO' }),
    branch_id: asText(branchId),
    business_date: asText(businessDate),
    source: 'SYSTEM_ZERO',
    status: 'ACTIVE',
    file_hash: '',
    normalized_content_hash: normalizedContentHash,
    source_config_id: '',
    upload_id: '',
    source_file_id: '',
    uploader_user_id: 'SYSTEM',
    approver_user_id: 'SYSTEM',
    created_at: now,
    lines,
  };
  return { ok: true, action: 'CREATE', version };
}

function negativeRows(draft) {
  const sourceRows = Array.isArray(draft?.preview?.source_rows) ? draft.preview.source_rows : [];
  return sourceRows.filter((row) => Number(row.quantity_inventory_units) < 0 || Number(row.source_quantity) < 0);
}

export function createAdjustmentForNegative({ draft, actorUserId, reason } = {}) {
  const rows = negativeRows(draft);
  if (rows.length === 0) return { ok: false, error_code: 'NEGATIVE_QUANTITY_NOT_FOUND' };
  const adjustmentId = `adjustment-${sha256(`${asText(draft.upload_id)}|${rows.map((row) => row.source_line_id).join('|')}`).slice(0, 16)}`;
  return {
    ok: true,
    status: 'PENDING_APPROVAL',
    adjustment_id: adjustmentId,
    rows: rows.map((row) => ({
      adjustment_id: adjustmentId,
      adjustment_type: 'SALES_NEGATIVE_QUANTITY',
      reference_source_line_id: asText(row.source_line_id),
      sales_upload_id: asText(draft.upload_id),
      branch_id: asText(draft.branch_id),
      business_date: asText(draft.business_date),
      item_id: asText(row.item_id),
      quantity_inventory_units: Number(row.quantity_inventory_units),
      reason: asText(reason),
      created_by: asText(actorUserId),
      status: 'PENDING_APPROVAL',
    })),
  };
}

/**
 * Plan one immutable FILE version. A caller applies the returned version and
 * supersede records through the shared PREPARED → COMMITTED protocol.
 */
export function planPublish({ draft, existingUploads = [], existingVersions = [], requireSeparateApprover = 'NO', now = new Date().toISOString() } = {}) {
  const preview = draft?.preview ?? {};
  const hasNegative = preview.status === 'ADJUSTMENT_REQUIRED'
    || (Array.isArray(preview.errors) && preview.errors.some((error) => error.code === 'NEGATIVE_QUANTITY_REQUIRES_ADJUSTMENT'));
  if (hasNegative) return { ok: false, error_code: 'NEGATIVE_QUANTITY_REQUIRES_ADJUSTMENT', adjustment_required: true };
  if (preview.status === 'CHO_SUA_FILE') return { ok: false, error_code: 'CHO_SUA_FILE', status: 'CHO_SUA_FILE' };
  if (preview.can_publish !== true) return { ok: false, error_code: asText(preview.status) || 'PREVIEW_NOT_READY' };
  const configSnapshotId = asText(draft.config_snapshot_id);
  if (!configSnapshotId) return { ok: false, error_code: 'CONFIG_SNAPSHOT_REQUIRED' };

  const approver = authorizeSalesPublish({
    requireSeparateApprover: requireSeparateApprover === 'NO' ? draft.require_separate_approver ?? requireSeparateApprover : requireSeparateApprover,
    uploaderUserId: draft.uploader_user_id,
    approverUserId: draft.approver_user_id,
  });
  if (!approver.ok) return approver;

  const normalizedContentHash = asText(draft.normalized_content_hash) || computeNormalizedContentHash({
    branchId: draft.branch_id,
    businessDate: draft.business_date,
    canonicalLines: preview.canonical_lines,
  });
  const dedupe = dedupeSalesFile({
    fileHash: draft.file_hash,
    normalizedContentHash,
    branchId: draft.branch_id,
    businessDate: draft.business_date,
    existingUploads,
    existingVersions,
  });
  if (dedupe.kind === 'DUPLICATE_FILE') return { ok: true, action: 'DUPLICATE_FILE', ...dedupe };
  if (dedupe.kind === 'NO_CHANGE') return { ok: true, action: 'NO_CHANGE', ...dedupe };

  const active = (Array.isArray(existingVersions) ? existingVersions : []).find((version) => (
    isCurrentVersion(version) && asText(version.branch_id) === asText(draft.branch_id) && asText(version.business_date) === asText(draft.business_date)
  ));
  const versionId = salesVersionId({ branchId: draft.branch_id, businessDate: draft.business_date, fileHash: draft.file_hash, normalizedContentHash, source: 'FILE' });
  const version = {
    sales_version_id: versionId,
    upload_id: asText(draft.upload_id),
    source_file_id: asText(draft.source_file_id),
    source_config_id: asText(draft.source_config_id),
    branch_id: asText(draft.branch_id),
    business_date: asText(draft.business_date),
    source: 'FILE',
    status: 'ACTIVE',
    file_hash: asText(draft.file_hash),
    normalized_content_hash: normalizedContentHash,
    config_snapshot_id: configSnapshotId,
    uploader_user_id: asText(draft.uploader_user_id),
    approver_user_id: asText(draft.approver_user_id),
    created_at: now,
    supersedes_version_id: active ? asText(active.sales_version_id ?? active.version_id) : null,
    lines: canonicalLines(preview.canonical_lines),
  };
  return {
    ok: true,
    action: 'PUBLISH',
    version,
    supersede: active ? {
      sales_version_id: asText(active.sales_version_id ?? active.version_id),
      status: 'SUPERSEDED',
      superseded_by: versionId,
    } : null,
    source_rows: structuredClone(preview.source_rows ?? []),
    write_plan: [
      { action: 'APPEND', sheet: 'LOG_BAN', row: version },
      ...(active ? [{ action: 'SUPERSEDE', sheet: 'LOG_BAN', row: { sales_version_id: asText(active.sales_version_id ?? active.version_id), status: 'SUPERSEDED', superseded_by: versionId } }] : []),
    ],
  };
}

export const classifySalesUpload = dedupeSalesFile;
export const publishSalesVersion = planPublish;
