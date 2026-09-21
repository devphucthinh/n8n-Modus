const asText = (value) => (value == null ? '' : String(value).trim());

const isActive = (row) => !['INACTIVE', 'NO', 'FALSE', '0'].includes(asText(row?.trang_thai ?? row?.status).toUpperCase());

const isRequired = (row) => !['NO', 'FALSE', '0', 'OPTIONAL'].includes(asText(row?.required).toUpperCase());

/**
 * Normalize display headers for matching without changing the source value
 * retained in Dòng bán nguồn. Header aliases remain configuration data.
 */
export function normalizeHeader(value) {
  return asText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function configuredColumnRows(sourceConfigId, sourceConfig, sourceColumns) {
  const rows = Array.isArray(sourceColumns)
    ? sourceColumns.filter((row) => asText(row?.source_config_id) === sourceConfigId)
    : [];
  if (rows.length > 0) return rows;

  const aliases = sourceConfig?.column_aliases ?? sourceConfig?.columns ?? {};
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) return [];
  return Object.entries(aliases).flatMap(([columnRole, configured]) => {
    const values = Array.isArray(configured) ? configured : [configured];
    return values.map((headerAlias) => ({
      source_config_id: sourceConfigId,
      column_role: columnRole,
      header_alias: headerAlias,
      required: 'YES',
    }));
  });
}

function sheetNameMatches(pattern, sheetName) {
  const text = asText(sheetName);
  if (!pattern) return false;
  try {
    return new RegExp(String(pattern), 'i').test(text);
  } catch {
    return false;
  }
}

function orderedAliases(rows) {
  const byRole = new Map();
  for (const row of rows) {
    const role = asText(row?.column_role);
    const alias = asText(row?.header_alias ?? row?.column_alias ?? row?.header_name);
    if (!role || !alias) continue;
    const roleRows = byRole.get(role) ?? [];
    roleRows.push({ alias, required: isRequired(row) });
    byRole.set(role, roleRows);
  }
  return byRole;
}

/**
 * Return every active Cấu hình nguồn bán whose configured sheet pattern and
 * required header aliases match. More than one match is intentionally not
 * resolved here; the caller must ask the user to select one.
 */
export function matchSourceConfigs({ sheetName, headers, sourceConfigs = [], sourceColumns = [] } = {}) {
  const headerByNormalized = new Map();
  for (const header of Array.isArray(headers) ? headers : []) {
    const normalized = normalizeHeader(header);
    if (normalized && !headerByNormalized.has(normalized)) headerByNormalized.set(normalized, asText(header));
  }

  const matches = [];
  for (const config of sourceConfigs) {
    if (!isActive(config)) continue;
    const sourceConfigId = asText(config?.source_config_id ?? config?.nguon_ban_id ?? config?.id);
    if (!sourceConfigId || !sheetNameMatches(config?.sheet_name_pattern ?? config?.sheet_pattern ?? config?.sheet_name, sheetName)) continue;
    const roles = orderedAliases(configuredColumnRows(sourceConfigId, config, sourceColumns));
    if (roles.size === 0) continue;

    const matchedColumns = {};
    let requiredMissing = false;
    for (const [role, aliases] of roles.entries()) {
      const matched = aliases.find(({ alias }) => headerByNormalized.has(normalizeHeader(alias)));
      if (matched) matchedColumns[role] = headerByNormalized.get(normalizeHeader(matched.alias));
      if (!matched && aliases.some(({ required }) => required)) requiredMissing = true;
    }
    if (requiredMissing) continue;

    matches.push({
      source_config_id: sourceConfigId,
      source_config: structuredClone(config),
      source_name: asText(config.source_name ?? config.ten_nguon ?? sourceConfigId),
      // Missing policy is a contract gap, not an implicit BLOCK decision. The
      // caller must reject or route the source for configuration when it is
      // absent rather than silently changing business behavior.
      missing_item_policy: asText(config.missing_item_policy ?? config.chinh_sach_mat_hang_vang).toUpperCase(),
      require_separate_approver: asText(config.require_separate_approver).toUpperCase() || 'NO',
      matched_columns: matchedColumns,
      score: Object.keys(matchedColumns).length,
    });
  }

  return {
    status: matches.length === 0 ? 'NO_MATCH' : matches.length === 1 ? 'MATCHED' : 'AMBIGUOUS',
    matches,
  };
}

export function selectSourceConfig({ matches = [], sourceConfigId } = {}) {
  const options = matches.map((match) => asText(match?.source_config_id)).filter(Boolean);
  if (options.length === 0) return { ok: false, error_code: 'SOURCE_NOT_FOUND', options: [] };
  if (sourceConfigId != null && sourceConfigId !== '') {
    const selected = matches.find((match) => asText(match.source_config_id) === asText(sourceConfigId));
    if (!selected) return { ok: false, error_code: 'SOURCE_SELECTION_INVALID', options };
    return { ok: true, ...structuredClone(selected), source_config: structuredClone(selected.source_config ?? selected) };
  }
  if (matches.length > 1) return { ok: false, error_code: 'SOURCE_AMBIGUOUS', options };
  return { ok: true, ...structuredClone(matches[0]), source_config: structuredClone(matches[0].source_config ?? matches[0]) };
}

export function normalizeBusinessDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const text = asText(value);
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Split parsed Dòng bán nguồn by the date present in the file. Upload time is
 * retained only as evidence metadata and never becomes Ngày kinh doanh.
 */
export function splitByBusinessDate({ rows = [], businessDateField = 'business_date', branchId = null, branchField = null, uploadedAt = null } = {}) {
  const grouped = new Map();
  const invalidRows = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const businessDate = normalizeBusinessDate(row?.[businessDateField]);
    if (!businessDate) {
      invalidRows.push({ ...structuredClone(row), error_code: 'BUSINESS_DATE_INVALID' });
      continue;
    }
    const rowBranchId = asText(branchField ? row?.[branchField] : branchId) || null;
    const key = `${rowBranchId ?? ''}|${businessDate}`;
    const group = grouped.get(key) ?? { branch_id: rowBranchId, business_date: businessDate, rows: [] };
    group.rows.push(structuredClone(row));
    grouped.set(key, group);
  }
  const groups = [...grouped.values()].sort((left, right) => (
    `${left.branch_id ?? ''}|${left.business_date}`.localeCompare(`${right.branch_id ?? ''}|${right.business_date}`)
  ));
  return { groups, invalid_rows: invalidRows, uploaded_at: uploadedAt ?? null };
}
