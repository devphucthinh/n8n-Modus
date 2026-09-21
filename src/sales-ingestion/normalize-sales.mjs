import { normalizeBusinessDate } from './source-config.mjs';

const salesText = (value) => (value == null ? '' : String(value).trim());
const normalizedText = (value) => salesText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const salesIsActive = (row) => !['INACTIVE', 'NO', 'FALSE', '0'].includes(salesText(row?.trang_thai ?? row?.status).toUpperCase());
const salesIsTracked = (row) => row?.tracked === true || ['YES', 'TRUE', '1', 'ACTIVE'].includes(salesText(row?.tracked ?? row?.theo_doi).toUpperCase());

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = salesText(value).replace(',', '.');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function mappingFor({ sourceConfigId, sourceItemCode, sourceItemName, itemMappings }) {
  const code = salesText(sourceItemCode);
  const name = normalizedText(sourceItemName);
  const candidates = (Array.isArray(itemMappings) ? itemMappings : []).filter((mapping) => {
    if (!salesIsActive(mapping)) return false;
    const mappingSource = salesText(mapping.source_config_id ?? mapping.nguon_ban_id);
    if (mappingSource && mappingSource !== sourceConfigId && mappingSource !== '*') return false;
    const mappingCode = salesText(mapping.source_item_code ?? mapping.source_code ?? mapping.ma_hang_nguon);
    const mappingName = normalizedText(mapping.source_item_name ?? mapping.source_name ?? mapping.ten_hang_nguon);
    return (code && mappingCode === code) || (!code && name && mappingName === name);
  });
  if (candidates.length === 0) return { status: 'MISSING', mapping: null };
  const itemIds = new Set(candidates.map((mapping) => salesText(mapping.item_id ?? mapping.ma_bia)).filter(Boolean));
  if (itemIds.size !== 1) return { status: 'AMBIGUOUS', mapping: null };
  const selected = candidates.find((mapping) => salesText(mapping.source_config_id ?? mapping.nguon_ban_id) === sourceConfigId)
    ?? candidates.find((mapping) => !salesText(mapping.source_config_id ?? mapping.nguon_ban_id) || salesText(mapping.source_config_id ?? mapping.nguon_ban_id) === '*')
    ?? candidates[0];
  const mappingName = normalizedText(selected.source_item_name ?? selected.source_name ?? selected.ten_hang_nguon);
  if (mappingName && name && mappingName !== name) return { status: 'NAME_MISMATCH', mapping: selected };
  return { status: 'MAPPED', mapping: selected };
}

function itemFor(itemId, items) {
  return (Array.isArray(items) ? items : []).find((item) => salesIsActive(item) && salesText(item.item_id ?? item.ma_bia) === itemId) ?? null;
}

function conversionFor({ itemId, sourceUnit, targetUnit, businessDate, conversions }) {
  const source = salesText(sourceUnit);
  const target = salesText(targetUnit);
  const candidates = (Array.isArray(conversions) ? conversions : []).filter((conversion) => {
    if (!salesIsActive(conversion)) return false;
    if (salesText(conversion.item_id ?? conversion.ma_bia) !== itemId) return false;
    if (salesText(conversion.source_unit ?? conversion.don_vi_nguon) !== source) return false;
    if (salesText(conversion.target_unit ?? conversion.don_vi_dich) !== target) return false;
    const from = normalizeBusinessDate(conversion.effective_from ?? conversion.hieu_luc_tu) ?? '0000-01-01';
    const to = normalizeBusinessDate(conversion.effective_to ?? conversion.hieu_luc_den) ?? '9999-12-31';
    return businessDate >= from && businessDate <= to;
  });
  if (candidates.length > 1) return { status: 'AMBIGUOUS', conversion: null };
  if (candidates.length === 1) return { status: 'CONVERTED', conversion: candidates[0] };
  if (source === target && source) return { status: 'CONVERTED', conversion: { numerator: 1, denominator: 1, source_unit: source, target_unit: target } };
  return { status: 'MISSING', conversion: null };
}

function issue(code, row, details = {}) {
  return { code, source_line_id: row.source_line_id, row_number: row.source_row_number, ...details };
}

/**
 * Preserve each Dòng bán nguồn while deriving canonical item and unit fields.
 * This function performs no ledger writes and never drops an input row.
 */
export function normalizeSourceRows({
  rows = [],
  columnMap = {},
  sourceConfigId,
  sourceFileId,
  sourceFileHash,
  branchId,
  itemMappings = [],
  items = [],
  conversions = [],
} = {}) {
  const issues = [];
  const normalizedRows = [];
  for (const [index, raw] of (Array.isArray(rows) ? rows : []).entries()) {
    const sourceRowNumber = raw?.row_number ?? raw?.source_row_number ?? index + 1;
    const sourceLineId = `line-${salesText(sourceFileId) || 'file'}-${sourceRowNumber}`;
    const sourceItemCode = salesText(raw?.[columnMap.item_code]);
    const sourceItemName = salesText(raw?.[columnMap.item_name]);
    const sourceUnit = salesText(raw?.[columnMap.unit]);
    const businessDate = normalizeBusinessDate(raw?.[columnMap.business_date]);
    const sourceQuantity = parseNumber(raw?.[columnMap.quantity]);
    const row = {
      source_line_id: sourceLineId,
      source_file_id: salesText(sourceFileId),
      source_file_hash: salesText(sourceFileHash),
      source_config_id: salesText(sourceConfigId),
      source_row_number: sourceRowNumber,
      branch_id: salesText(branchId) || null,
      business_date: businessDate,
      source_item_code: sourceItemCode,
      source_item_name: sourceItemName,
      source_quantity: sourceQuantity,
      source_unit: sourceUnit,
      raw_values: structuredClone(raw ?? {}),
      mapping_status: 'MAPPING_REQUIRED',
      conversion_status: 'NOT_ATTEMPTED',
      quantity_status: sourceQuantity == null ? 'INVALID' : sourceQuantity < 0 ? 'NEGATIVE' : 'VALID',
      inclusion: 'PENDING',
      item_id: null,
      inventory_unit: null,
      quantity_inventory_units: null,
      issue_code: null,
    };

    if (!businessDate) {
      row.issue_code = 'BUSINESS_DATE_INVALID';
      issues.push(issue(row.issue_code, row));
    }
    if (sourceQuantity == null) {
      row.issue_code ??= 'QUANTITY_INVALID';
      issues.push(issue('QUANTITY_INVALID', row));
    }

    const mappingResult = mappingFor({ sourceConfigId: salesText(sourceConfigId), sourceItemCode, sourceItemName, itemMappings });
    if (mappingResult.status === 'MISSING') {
      row.issue_code ??= 'ITEM_MAPPING_MISSING';
      issues.push(issue('ITEM_MAPPING_MISSING', row, { source_item_code: sourceItemCode }));
    } else if (mappingResult.status === 'AMBIGUOUS') {
      row.issue_code ??= 'ITEM_MAPPING_AMBIGUOUS';
      issues.push(issue('ITEM_MAPPING_AMBIGUOUS', row, { source_item_code: sourceItemCode }));
    } else if (mappingResult.status === 'NAME_MISMATCH') {
      row.issue_code ??= 'ITEM_NAME_MISMATCH';
      issues.push(issue('ITEM_NAME_MISMATCH', row, { source_item_code: sourceItemCode }));
    } else {
      const mappedItemId = salesText(mappingResult.mapping.item_id ?? mappingResult.mapping.ma_bia);
      const item = itemFor(mappedItemId, items);
      if (!item) {
        row.issue_code ??= 'ITEM_NOT_CONFIGURED';
        issues.push(issue('ITEM_NOT_CONFIGURED', row, { item_id: mappedItemId }));
      } else {
        row.item_id = mappedItemId;
        row.inventory_unit = salesText(item.inventory_unit ?? item.don_vi_kiem_ke ?? item.don_vi_dem);
        row.mapping_status = salesIsTracked(item) ? 'MAPPED' : 'UNTRACKED';
        row.inclusion = salesIsTracked(item) ? 'PENDING' : 'IGNORED_UNTRACKED';
        if (row.mapping_status === 'MAPPED' && businessDate && sourceQuantity != null) {
          const conversionResult = conversionFor({ itemId: mappedItemId, sourceUnit, targetUnit: row.inventory_unit, businessDate, conversions });
          if (conversionResult.status === 'CONVERTED') {
            const numerator = parseNumber(conversionResult.conversion.numerator);
            const denominator = parseNumber(conversionResult.conversion.denominator);
            if (numerator == null || denominator == null || denominator === 0) {
              row.conversion_status = 'INVALID';
              row.issue_code ??= 'UNIT_CONVERSION_INVALID';
              issues.push(issue('UNIT_CONVERSION_INVALID', row, { item_id: mappedItemId }));
            } else {
              row.quantity_inventory_units = sourceQuantity * numerator / denominator;
              row.conversion_status = 'CONVERTED';
            }
          } else {
            row.conversion_status = conversionResult.status === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'CONVERSION_REQUIRED';
            row.issue_code ??= conversionResult.status === 'AMBIGUOUS' ? 'UNIT_CONVERSION_AMBIGUOUS' : 'UNIT_CONVERSION_MISSING';
            issues.push(issue(row.issue_code, row, { item_id: mappedItemId, source_unit: sourceUnit, target_unit: row.inventory_unit }));
          }
        }
      }
    }
    if (sourceQuantity != null && sourceQuantity < 0) {
      row.issue_code ??= 'NEGATIVE_QUANTITY_REQUIRES_ADJUSTMENT';
      issues.push(issue('NEGATIVE_QUANTITY_REQUIRES_ADJUSTMENT', row, { quantity: sourceQuantity }));
    }
    normalizedRows.push(row);
  }
  return { rows: normalizedRows, issues };
}

function catalogItemId(item) {
  return salesText(item?.item_id ?? item?.ma_bia);
}

/**
 * Build a deterministic preview. A preview may contain ZERO-filled lines, but
 * CHO_SUA_FILE and adjustment states never become publishable.
 */
export function previewSales({ normalizedRows = [], trackedItems = [], missingItemPolicy, branchId = null, businessDate = null } = {}) {
  const relevantRows = (Array.isArray(normalizedRows) ? normalizedRows : []).filter((row) => (
    (branchId == null || salesText(row.branch_id) === salesText(branchId))
      && (businessDate == null || row.business_date === businessDate)
  ));
  const expectedItems = (Array.isArray(trackedItems) ? trackedItems : []).filter((item) => salesIsActive(item) && salesIsTracked(item));
  const expectedIds = expectedItems.map(catalogItemId).filter(Boolean).sort();
  const policy = salesText(missingItemPolicy).toUpperCase();
  const policyValid = ['ZERO', 'BLOCK'].includes(policy);
  const errors = [];
  const warnings = [];
  const quantities = new Map();
  const observedIds = new Set();
  let negativeQuantity = false;

  for (const row of relevantRows) {
    if (row.inclusion === 'IGNORED_UNTRACKED') {
      warnings.push({ code: 'UNTRACKED_ITEM_IGNORED', source_line_id: row.source_line_id, source_item_code: row.source_item_code });
      continue;
    }
    if (row.issue_code === 'NEGATIVE_QUANTITY_REQUIRES_ADJUSTMENT' || row.quantity_status === 'NEGATIVE') {
      negativeQuantity = true;
      errors.push({ code: 'NEGATIVE_QUANTITY_REQUIRES_ADJUSTMENT', source_line_id: row.source_line_id, quantity: row.source_quantity });
      continue;
    }
    if (row.mapping_status !== 'MAPPED') {
      errors.push({ code: row.issue_code ?? 'ITEM_MAPPING_MISSING', source_line_id: row.source_line_id });
      continue;
    }
    if (row.conversion_status !== 'CONVERTED' || !Number.isFinite(row.quantity_inventory_units)) {
      errors.push({ code: row.issue_code ?? 'UNIT_CONVERSION_MISSING', source_line_id: row.source_line_id });
      continue;
    }
    observedIds.add(row.item_id);
    quantities.set(row.item_id, (quantities.get(row.item_id) ?? 0) + row.quantity_inventory_units);
  }

  const missingItemIds = expectedIds.filter((itemId) => !observedIds.has(itemId));
  const zeroLines = missingItemIds.map((itemId) => {
    const item = expectedItems.find((candidate) => catalogItemId(candidate) === itemId);
    return { item_id: itemId, quantity_inventory_units: 0, inventory_unit: salesText(item.inventory_unit ?? item.don_vi_kiem_ke ?? item.don_vi_dem) };
  });
  if (!policyValid) errors.push({ code: 'MISSING_ITEM_POLICY_INVALID' });
  if (missingItemIds.length > 0 && policy === 'ZERO') {
    warnings.push({ code: 'MISSING_ITEM_ZERO', item_ids: missingItemIds });
    for (const line of zeroLines) quantities.set(line.item_id, 0);
  }
  if (missingItemIds.length > 0 && policy === 'BLOCK') {
    errors.push({ code: 'MISSING_TRACKED_ITEMS', item_ids: missingItemIds });
  }

  const canonicalLines = [...quantities.entries()]
    .map(([itemId, quantity]) => {
      const item = expectedItems.find((candidate) => catalogItemId(candidate) === itemId);
      return { item_id: itemId, quantity_inventory_units: quantity, inventory_unit: salesText(item?.inventory_unit ?? item?.don_vi_kiem_ke ?? item?.don_vi_dem) };
    })
    .sort((left, right) => left.item_id.localeCompare(right.item_id));
  const hasFileDataError = errors.some((error) => !['MISSING_TRACKED_ITEMS', 'NEGATIVE_QUANTITY_REQUIRES_ADJUSTMENT'].includes(error.code));
  const status = hasFileDataError ? 'CHO_SUA_FILE' : negativeQuantity ? 'ADJUSTMENT_REQUIRED' : errors.some((error) => error.code === 'MISSING_TRACKED_ITEMS') ? 'BLOCKED' : 'PREVIEW_READY';
  return {
    status,
    can_publish: status === 'PREVIEW_READY',
    blocks_system_zero: status !== 'PREVIEW_READY',
    branch_id: branchId,
    business_date: businessDate,
    missing_item_policy: policy,
    missing_item_ids: missingItemIds,
    zero_lines: policy === 'ZERO' ? zeroLines : [],
    source_row_count: relevantRows.length,
    canonical_lines: canonicalLines,
    total_quantity_inventory_units: canonicalLines.reduce((total, line) => total + line.quantity_inventory_units, 0),
    warnings,
    errors,
    source_rows: structuredClone(relevantRows),
  };
}
