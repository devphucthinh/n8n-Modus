import { codeNode, sourceFile } from './helpers.mjs';

export async function normalizeCode() {
  return codeNode(`
${await sourceFile('src/contracts/workflow-envelope.mjs')}
${await sourceFile('src/sales-ingestion/source-config.mjs')}
${await sourceFile('src/sales-ingestion/normalize-sales.mjs')}

const input = $input.first()?.json ?? {};
let envelope;
try {
  envelope = normalizeEnvelope(input);
} catch (error) {
  return [{ json: { ok: false, status: 'ERROR', error_code: 'ENVELOPE_INVALID', message: error.message } }];
}
const payload = envelope.payload ?? {};
if (String(payload.intent ?? '').toUpperCase() === 'SYSTEM_ZERO') {
  return [{ json: { ...envelope, ok: true, status: 'SYSTEM_ZERO_REQUEST', drafts: [] } }];
}
const match = matchSourceConfigs({
  sheetName: payload.sheet_name,
  headers: payload.headers,
  sourceConfigs: payload.source_configs,
  sourceColumns: payload.source_columns,
});
const selection = selectSourceConfig({ matches: match.matches, sourceConfigId: payload.source_config_id });
if (!selection.ok) {
  const status = match.status === 'NO_MATCH' ? 'CHO_SUA_FILE' : selection.error_code;
  return [{ json: { ...envelope, ok: false, status, error_code: selection.error_code, blocks_system_zero: status === 'CHO_SUA_FILE', source_options: selection.options } }];
}

const columnMap = selection.matched_columns;
const split = splitByBusinessDate({
  rows: payload.rows ?? [],
  businessDateField: columnMap.business_date,
  branchId: envelope.branch_id ?? payload.branch_id,
  branchField: columnMap.branch_id,
  uploadedAt: payload.uploaded_at,
});
const drafts = split.groups.map((group) => {
  const normalized = normalizeSourceRows({
    rows: group.rows,
    columnMap,
    sourceConfigId: selection.source_config_id,
    sourceFileId: payload.source_file_id,
    sourceFileHash: payload.file_hash,
    branchId: group.branch_id ?? envelope.branch_id ?? payload.branch_id,
    itemMappings: payload.item_mappings,
    items: payload.items,
    conversions: payload.conversions,
  });
  const preview = previewSales({
    normalizedRows: normalized.rows,
    trackedItems: payload.items,
    missingItemPolicy: selection.missing_item_policy,
    branchId: group.branch_id ?? envelope.branch_id ?? payload.branch_id,
    businessDate: group.business_date,
  });
  return {
    upload_id: payload.upload_id,
    source_file_id: payload.source_file_id,
    file_hash: payload.file_hash,
    source_config_id: selection.source_config_id,
    config_snapshot_id: payload.config_snapshot_id ?? envelope.config_snapshot_id ?? null,
    require_separate_approver: selection.require_separate_approver,
    branch_id: group.branch_id ?? envelope.branch_id ?? payload.branch_id,
    business_date: group.business_date,
    uploader_user_id: envelope.actor_user_id,
    approver_user_id: payload.approver_user_id,
    normalized_rows: normalized.rows,
    normalization_issues: normalized.issues,
    preview,
  };
});

const blockedByInput = split.invalid_rows.length > 0 || drafts.some((draft) => draft.preview?.status === 'CHO_SUA_FILE');
return [{ json: {
  ...envelope,
  ok: !blockedByInput,
  status: blockedByInput ? 'CHO_SUA_FILE' : 'PREVIEW_READY',
  source_match: match,
  source_config: selection.source_config,
  invalid_rows: split.invalid_rows,
  drafts,
} }];
`);
}

export async function planCode() {
  return codeNode(`
${await sourceFile('src/config-gateway/sha256.mjs')}
${await sourceFile('src/sales-ingestion/versioned-ledger.mjs')}

const input = $('Normalize and Preview Sales File').first()?.json ?? {};
if (input.ok !== true) return [{ json: input }];
const payload = input.payload ?? {};
if (String(payload.intent ?? '').toUpperCase() === 'SYSTEM_ZERO') {
  const zero = createSystemZero({
    branchId: input.branch_id ?? payload.branch_id,
    businessDate: input.business_date ?? payload.business_date,
    trackedItems: payload.items,
    pendingUploads: payload.pending_uploads,
    existingVersions: payload.existing_versions,
    now: payload.now,
  });
  return [{ json: { ...input, ok: zero.ok, status: zero.ok ? 'SYSTEM_ZERO_READY' : zero.error_code, system_zero: zero } }];
}

const plans = (input.drafts ?? []).map((draft) => planPublish({
  draft,
  existingUploads: payload.existing_uploads,
  existingVersions: payload.existing_versions,
  requireSeparateApprover: draft.require_separate_approver,
  now: payload.now,
}));
const failed = plans.find((plan) => plan.ok !== true);
return [{ json: {
  ...input,
  ok: !failed,
  status: failed ? failed.error_code : 'PUBLISH_READY',
  plans,
} }];
`);
}

export function returnCode() {
  return codeNode("const result = $('Plan Versioned Sales Publish').first()?.json ?? {}; return [{ json: result }];");
}
