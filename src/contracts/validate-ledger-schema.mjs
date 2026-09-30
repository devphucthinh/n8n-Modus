import { ALL_SHEET_DEFINITIONS } from './core-sheet-schema.mjs';

export const LEDGER_IDENTITY_COLUMNS = Object.freeze({
  DISPATCH_HISTORY: 'dispatch_key',
  HEARTBEAT: 'heartbeat_id',
  PHIEN_KIEM_KE: 'session_id',
  OPERATION: 'operation_id',
  EVENT_LOG: 'event_id',
});

const INTEGER_COLUMNS = new Set([
  'attempt_count', 'retry_delay_minutes', 'retry_limit', 'failure_count',
  'threshold', 'catalog_count', 'page_size', 'grace_window_minutes', 'thu_tu_hien_thi',
]);
const DATE_COLUMNS = new Set(['business_date']);
const DATETIME_COLUMNS = new Set(['scheduled_at', 'retry_at', 'heartbeat_at', 'created_at', 'updated_at']);
const BOOLEAN_COLUMNS = new Set(['critical_notified']);

export function expectedLedgerDataType(sheet, column) {
  if (sheet === 'CONFIG_LICH' && column === 'enabled') return 'BOOLEAN';
  if (INTEGER_COLUMNS.has(column)) return 'INTEGER';
  if (DATE_COLUMNS.has(column)) return 'DATE';
  if (DATETIME_COLUMNS.has(column)) return 'DATETIME';
  if (BOOLEAN_COLUMNS.has(column)) return 'BOOLEAN';
  return 'STRING';
}

export function expectedLedgerSchemaRule(sheet, column) {
  const identityColumn = LEDGER_IDENTITY_COLUMNS[sheet]
    ?? ({ CONFIG_LICH: 'schedule_id', CONFIG_BIA: 'ma_bia' })[sheet];
  return {
    data_type: expectedLedgerDataType(sheet, column),
    unique_group: column === identityColumn ? `${sheet}_KEY` : '',
  };
}

export function validateLedgerRows({ tables, requiredSheets }) {
  for (const sheet of requiredSheets) {
    if (!Object.hasOwn(ALL_SHEET_DEFINITIONS, sheet) || !Object.hasOwn(tables ?? {}, sheet)
      || !Array.isArray(tables[sheet])) {
      return { ok: false, error_code: 'CONFIG_SHEET_MISSING', sheet_name: sheet, column_name: null };
    }
    const columns = ALL_SHEET_DEFINITIONS[sheet];
    // Reads have no header metadata, and n8n omits trailing empty cells.
    // For the exported stable column order, only the observable prefix can be
    // checked. Empty sheets and omitted suffix headers require a manual check;
    // never fill absent keys and pretend they prove a physical header exists.
    for (const row of tables[sheet]) {
      const lastObserved = columns.reduce((last, column, index) => row != null && Object.hasOwn(row, column) ? index : last, 0);
      for (const column of columns.slice(0, lastObserved + 1)) {
        if (row == null || !Object.hasOwn(row, column)) {
          return { ok: false, error_code: 'CONFIG_COLUMN_MISSING', sheet_name: sheet, column_name: column };
        }
      }
    }
  }
  return { ok: true };
}

export function validateLedgerSchema({ schemaRows, tables, requiredSheets }) {
  const rowsValidation = validateLedgerRows({ tables, requiredSheets });
  if (!rowsValidation.ok) return rowsValidation;
  const declarations = new Map();
  for (const rule of Array.isArray(schemaRows) ? schemaRows : []) {
    if (String(rule?.trang_thai ?? '').trim().toUpperCase() !== 'ACTIVE') continue;
    const sheet = String(rule?.sheet_name ?? '').trim();
    if (!declarations.has(sheet)) declarations.set(sheet, new Map());
    const column = String(rule?.column_name ?? '').trim();
    if (!declarations.get(sheet).has(column)) declarations.get(sheet).set(column, []);
    declarations.get(sheet).get(column).push(rule);
  }
  for (const sheet of requiredSheets) {
    for (const column of ALL_SHEET_DEFINITIONS[sheet]) {
      const rules = declarations.get(sheet)?.get(column) ?? [];
      if (rules.length === 0) {
        return { ok: false, error_code: 'CONFIG_SCHEMA_INCOMPLETE', sheet_name: sheet, column_name: column };
      }
      const expectedType = expectedLedgerDataType(sheet, column);
      if (rules.some((rule) => String(rule?.data_type ?? '').trim().toUpperCase() !== expectedType)) {
        return { ok: false, error_code: 'CONFIG_SCHEMA_TYPE_MISMATCH', sheet_name: sheet, column_name: column };
      }
    }
    const identityColumn = LEDGER_IDENTITY_COLUMNS[sheet];
    if (identityColumn) {
      const expectedGroup = `${sheet}_KEY`;
      const identityRules = declarations.get(sheet)?.get(identityColumn) ?? [];
      const groupMembers = [...(declarations.get(sheet) ?? new Map()).entries()]
        .flatMap(([column, rules]) => rules.filter((rule) => String(rule?.unique_group ?? '').trim() === expectedGroup).map(() => column));
      if (identityRules.length !== 1
        || String(identityRules[0]?.unique_group ?? '').trim() !== expectedGroup
        || groupMembers.length !== 1
        || groupMembers[0] !== identityColumn) {
        return { ok: false, error_code: 'CONFIG_SCHEMA_KEY_MISMATCH', sheet_name: sheet, column_name: identityColumn };
      }
    }
  }
  return { ok: true };
}
