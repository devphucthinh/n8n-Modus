import { ALL_SHEET_DEFINITIONS, AUDIT_SHEET_NAMES, CORE_SHEET_DEFINITIONS, CORE_SHEET_NAMES, ROUTER_SHEET_NAMES } from '../contracts/core-sheet-schema.mjs';
import { sha256 } from './sha256.mjs';

const FINGERPRINT_SHEETS = ['CONFIG_SCHEMA', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', ...ROUTER_SHEET_NAMES];
const SCHEMA_DATA_TYPES = new Set(['STRING', 'INTEGER', 'NUMBER', 'BOOLEAN', 'DATE', 'DATETIME']);
const ACTIVE = 'ACTIVE';
const SNAPSHOT_CELL_MAX_CHARS = 49000;
const SNAPSHOT_FORMAT = 'columnar-v1';
const READ_ONLY_OPERATION_TYPES = new Set(['READ_STATUS', 'READ_HELP', 'COMMAND_NOT_AVAILABLE', 'ROUTE_COMMAND', 'MANUAL_RETRY']);
const REQUIRED_MESSAGE_KEYS = Object.freeze([
  'STATUS_HEADER',
  'STATUS_GATEWAY_HEALTH_LINE',
  'STATUS_CONFIG_LINE',
  'STATUS_BRANCH_COUNT_LINE',
  'STATUS_BRANCH_LINE',
  'STATUS_MAINTENANCE_LINE',
  'ERROR_GENERIC',
  'USER_NOT_ACTIVE',
  'COMMAND_NOT_AVAILABLE',
  'HELP_HEADER',
  'ROUTER_COMMAND_ACCEPTED',
  'ROUTER_RETRY_ACCEPTED',
  'ROUTER_DUPLICATE',
]);
const OPERATION_IDENTITY_FIELDS = Object.freeze(['request_id', 'operation_type', 'idempotency_key', 'checksum']);

const asText = (value) => (value == null ? '' : String(value).trim());
const isBlank = (value) => asText(value) === '';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function stripSheetRowMetadata(value) {
  if (Array.isArray(value)) return value.map(stripSheetRowMetadata);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'row_number')
      .map(([key, child]) => [key, stripSheetRowMetadata(child)]));
  }
  return value;
}

function containsSheetRowMetadata(value) {
  if (Array.isArray(value)) return value.some(containsSheetRowMetadata);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, child]) => key === 'row_number' || containsSheetRowMetadata(child));
  }
  return false;
}

function safeErrorId(operationId, errorCode) {
  const operation = asText(operationId).replace(/[^A-Za-z0-9_-]/g, '_') || 'unknown';
  return `err-${operation}-${errorCode}`;
}

function failure(errorCode, message, details = {}) {
  return {
    ok: false,
    response: {
      status: 'ERROR',
      error_code: errorCode,
      error_id: details.error_id,
      message: message || errorCode,
      ...details,
    },
    write_plan: [],
    diagnostics: { error_code: errorCode },
  };
}

function makeFailure(errorCode, message, envelope, details = {}) {
  const requestId = asText(envelope?.request_id);
  const operationId = asText(envelope?.operation_id);
  return failure(errorCode, message, {
    request_id: requestId,
    operation_id: operationId,
    retryable: false,
    error_id: safeErrorId(operationId, errorCode),
    ...details,
  });
}

function tableRows(tables, sheetName) {
  const rows = tables?.[sheetName];
  return Array.isArray(rows) ? rows : null;
}

function validateCoreTables(tables, envelope) {
  if (!tables || typeof tables !== 'object') return makeFailure('CONFIG_TABLES_MISSING', 'Configuration tables are missing', envelope);
  for (const sheetName of CORE_SHEET_NAMES) {
    const rows = tableRows(tables, sheetName);
    if (rows === null) return makeFailure('CONFIG_SHEET_MISSING', `Missing configuration sheet ${sheetName}`, envelope, { sheet_name: sheetName });
    if (rows.length === 0) continue;
    const keys = new Set(Object.keys(rows[0] ?? {}));
    for (const columnName of CORE_SHEET_DEFINITIONS[sheetName]) {
      if (!keys.has(columnName)) {
        return makeFailure('CONFIG_COLUMN_MISSING', `Missing ${sheetName}.${columnName}`, envelope, { sheet_name: sheetName, column_name: columnName });
      }
    }
  }
  return null;
}

function validateConfiguredMessages(tables, envelope) {
  const activeKeys = new Set((tableRows(tables, 'CONFIG_THONG_BAO') ?? [])
    .filter((row) => asText(row.trang_thai).toUpperCase() === ACTIVE && !isBlank(row.message_text))
    .map((row) => asText(row.message_key))
    .filter(Boolean));
  const missingKey = REQUIRED_MESSAGE_KEYS.find((key) => !activeKeys.has(key));
  return missingKey
    ? makeFailure('CONFIG_MESSAGE_MISSING', `Missing active message template ${missingKey}`, envelope, { message_key: missingKey })
    : null;
}

function requestedSheetNames(envelope) {
  const requested = envelope?.payload?.required_sheet_names;
  if (!Array.isArray(requested)) return [];
  return [...new Set(requested.map(asText).filter(Boolean))];
}

function validateRequestedTables(tables, envelope, requested) {
  for (const sheetName of requested) {
    if (![...ROUTER_SHEET_NAMES, ...AUDIT_SHEET_NAMES].includes(sheetName)) {
      return makeFailure('CONFIG_SHEET_NOT_ALLOWED', `Unsupported requested configuration sheet ${sheetName}`, envelope, { sheet_name: sheetName });
    }
    const rows = tableRows(tables, sheetName);
    if (rows === null) return makeFailure('CONFIG_SHEET_MISSING', `Missing configuration sheet ${sheetName}`, envelope, { sheet_name: sheetName });
    if (rows.length === 0) continue;
    const keys = new Set(Object.keys(rows[0] ?? {}));
    for (const columnName of ALL_SHEET_DEFINITIONS[sheetName]) {
      if (!keys.has(columnName)) {
        return makeFailure('CONFIG_COLUMN_MISSING', `Missing ${sheetName}.${columnName}`, envelope, { sheet_name: sheetName, column_name: columnName });
      }
    }
  }
  return null;
}

function parseAllowedValues(value) {
  const text = asText(value);
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.map(asText) : [];
    } catch {
      return text.split('|').map(asText).filter(Boolean);
    }
  }
  return text.split('|').map(asText).filter(Boolean);
}

function readSchemaRules(tables, envelope, requested = []) {
  const schemaRows = tableRows(tables, 'CONFIG_SCHEMA') ?? [];
  if (schemaRows.length === 0) return { error: makeFailure('CONFIG_SCHEMA_EMPTY', 'CONFIG_SCHEMA must declare every core column before writes', envelope) };
  const rules = [];
  for (const [index, row] of schemaRows.entries()) {
    const sheetName = asText(row.sheet_name);
    const columnName = asText(row.column_name);
    const dataType = asText(row.data_type).toUpperCase();
    if (!ALL_SHEET_DEFINITIONS[sheetName]?.includes(columnName)) {
      return { error: makeFailure('CONFIG_SCHEMA_INVALID', `Invalid schema rule at row ${index + 2}`, envelope, { row_number: index + 2 }) };
    }
    if (!SCHEMA_DATA_TYPES.has(dataType)) {
      return { error: makeFailure('CONFIG_SCHEMA_INVALID', `Unsupported data type for ${sheetName}.${columnName}`, envelope, { sheet_name: sheetName, column_name: columnName }) };
    }
    const referenceSheet = asText(row.reference_sheet);
    const referenceColumn = asText(row.reference_column);
    if ((referenceSheet && !referenceColumn) || (!referenceSheet && referenceColumn)) {
      return { error: makeFailure('CONFIG_SCHEMA_INVALID', `Incomplete reference for ${sheetName}.${columnName}`, envelope) };
    }
    if (referenceSheet && (!ALL_SHEET_DEFINITIONS[referenceSheet] || !ALL_SHEET_DEFINITIONS[referenceSheet].includes(referenceColumn))) {
      return { error: makeFailure('CONFIG_SCHEMA_INVALID', `Invalid reference for ${sheetName}.${columnName}`, envelope) };
    }
    rules.push({
      ...row,
      sheet_name: sheetName,
      column_name: columnName,
      data_type: dataType,
      required: ['YES', 'TRUE', '1'].includes(asText(row.required).toUpperCase()),
      unique_group: asText(row.unique_group),
      reference_sheet: referenceSheet,
      reference_column: referenceColumn,
      allowed_values: parseAllowedValues(row.allowed_values),
      trang_thai: asText(row.trang_thai).toUpperCase() || ACTIVE,
    });
  }

  const duplicateRule = rules.find((rule, index) => rules.findIndex((candidate) => candidate.sheet_name === rule.sheet_name && candidate.column_name === rule.column_name) !== index);
  if (duplicateRule) {
    return { error: makeFailure('CONFIG_SCHEMA_DUPLICATE', `Duplicate schema rule for ${duplicateRule.sheet_name}.${duplicateRule.column_name}`, envelope, { sheet_name: duplicateRule.sheet_name, column_name: duplicateRule.column_name }) };
  }
  const declared = new Set(rules.map((rule) => `${rule.sheet_name}.${rule.column_name}`));
  const requiredSchemaSheets = [...CORE_SHEET_NAMES, ...requested];
  for (const sheetName of [...new Set(requiredSchemaSheets)]) {
    for (const columnName of ALL_SHEET_DEFINITIONS[sheetName]) {
      if (!declared.has(`${sheetName}.${columnName}`)) {
        return { error: makeFailure('CONFIG_SCHEMA_INCOMPLETE', `Schema does not declare ${sheetName}.${columnName}`, envelope, { sheet_name: sheetName, column_name: columnName }) };
      }
    }
  }
  return { rules };
}

function typeValid(value, dataType) {
  const text = asText(value);
  if (!text) return true;
  if (dataType === 'INTEGER') return /^-?\d+$/.test(text);
  if (dataType === 'NUMBER') return /^-?(?:\d+|\d*\.\d+)$/.test(text);
  if (dataType === 'BOOLEAN') return ['YES', 'NO', 'TRUE', 'FALSE', '1', '0'].includes(text.toUpperCase());
  if (dataType === 'DATE') return /^\d{4}-\d{2}-\d{2}$/.test(text);
  if (dataType === 'DATETIME') return !Number.isNaN(Date.parse(text));
  return true;
}

function validateRows(tables, rules, envelope) {
  for (const rule of rules) {
    if (rule.trang_thai !== ACTIVE) continue;
    const rows = tableRows(tables, rule.sheet_name) ?? [];
    const seen = new Map();
    for (const [index, row] of rows.entries()) {
      const value = row?.[rule.column_name];
      if (rule.required && isBlank(value)) {
        return makeFailure('CONFIG_REQUIRED_VALUE_MISSING', `Missing value for ${rule.sheet_name}.${rule.column_name}`, envelope, { sheet_name: rule.sheet_name, column_name: rule.column_name, row_number: index + 2 });
      }
      if (!typeValid(value, rule.data_type)) {
        return makeFailure('CONFIG_TYPE_INVALID', `Invalid ${rule.data_type} for ${rule.sheet_name}.${rule.column_name}`, envelope, { sheet_name: rule.sheet_name, column_name: rule.column_name, row_number: index + 2 });
      }
      if (!isBlank(value) && rule.allowed_values.length > 0 && !rule.allowed_values.includes(asText(value))) {
        return makeFailure('CONFIG_ALLOWED_VALUE_INVALID', `Invalid value for ${rule.sheet_name}.${rule.column_name}`, envelope, { sheet_name: rule.sheet_name, column_name: rule.column_name, row_number: index + 2 });
      }
      if (rule.unique_group && !isBlank(value)) {
        const key = asText(value);
        if (seen.has(key)) {
          return makeFailure('CONFIG_DUPLICATE_KEY', `Duplicate ${rule.sheet_name}.${rule.column_name}`, envelope, { sheet_name: rule.sheet_name, column_name: rule.column_name, first_row_number: seen.get(key) + 2, row_number: index + 2 });
        }
        seen.set(key, index);
      }
    }
    if (rule.reference_sheet && rule.reference_column) {
      const referenced = new Set((tableRows(tables, rule.reference_sheet) ?? []).map((row) => asText(row?.[rule.reference_column])).filter(Boolean));
      for (const [index, row] of rows.entries()) {
        const value = asText(row?.[rule.column_name]);
        if (value && !referenced.has(value)) {
          return makeFailure('CONFIG_REFERENCE_INVALID', `Invalid reference for ${rule.sheet_name}.${rule.column_name}`, envelope, { sheet_name: rule.sheet_name, column_name: rule.column_name, row_number: index + 2 });
        }
      }
    }
  }
  return null;
}

function normalizeConfigTables(tables) {
  return Object.fromEntries(FINGERPRINT_SHEETS.filter((sheetName) => tableRows(tables, sheetName) !== null).map((sheetName) => {
    const columns = ALL_SHEET_DEFINITIONS[sheetName] ?? [];
    const rows = (tableRows(tables, sheetName) ?? []).map((row) => Object.fromEntries(
      columns.map((column) => [column, row?.[column] == null ? '' : String(row[column]).trim()]),
    ));
    rows.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
    return [sheetName, rows];
  }));
}

function snapshotStorageJson(normalizedConfigJson, fingerprint) {
  if (normalizedConfigJson.length <= SNAPSHOT_CELL_MAX_CHARS) return normalizedConfigJson;
  let normalized;
  try {
    normalized = JSON.parse(normalizedConfigJson);
  } catch {
    return null;
  }

  const packed = canonicalJson({
    __snapshot_format: SNAPSHOT_FORMAT,
    __scope: Object.keys(normalized).sort().join('|'),
    __fingerprint: fingerprint,
    sheets: Object.fromEntries(Object.entries(normalized).map(([sheetName, rows]) => {
      const columns = [...new Set((Array.isArray(rows) ? rows : []).flatMap((row) => Object.keys(row ?? {})))].sort();
      return [sheetName, {
        columns,
        rows: (Array.isArray(rows) ? rows : []).map((row) => columns.map((column) => row?.[column] ?? '')),
      }];
    })),
  });

  return packed.length <= SNAPSHOT_CELL_MAX_CHARS ? packed : null;
}

function expandSnapshotPayload(value) {
  if (!value || typeof value !== 'object' || value.__snapshot_format !== SNAPSHOT_FORMAT) return value;
  if (!value.sheets || typeof value.sheets !== 'object' || Array.isArray(value.sheets)) return null;
  const expanded = {};
  for (const [sheetName, sheet] of Object.entries(value.sheets)) {
    const columns = Array.isArray(sheet?.columns) ? sheet.columns.map(asText) : null;
    const rows = Array.isArray(sheet?.rows) ? sheet.rows : null;
    if (!columns || !rows || new Set(columns).size !== columns.length || columns.some(isBlank)) return null;
    if (rows.some((row) => !Array.isArray(row) || row.length !== columns.length)) return null;
    expanded[sheetName] = rows.map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index] ?? ''])));
  }
  return expanded;
}

function activeVersionRow(tables) {
  return (tableRows(tables, 'CONFIG_VERSION') ?? []).find((row) => asText(row.trang_thai).toUpperCase() !== 'INACTIVE') ?? null;
}

function versionNumber(version) {
  const match = /(?:^|\D)(\d+(?:\.\d+)?)$/.exec(asText(version));
  return match ? Number(match[1]) : null;
}

function isVersionGreater(current, previous) {
  const currentNumber = versionNumber(current);
  const previousNumber = versionNumber(previous);
  if (currentNumber !== null && previousNumber !== null) return currentNumber > previousNumber;
  return asText(current) > asText(previous);
}

function committedPredecessor(tables) {
  const committedOperations = new Map((tableRows(tables, 'OPERATION') ?? [])
    .filter((row) => asText(row.status).toUpperCase() === 'COMMITTED')
    .map((row) => [asText(row.operation_id), asText(row.operation_type).toUpperCase()])
    .filter(([operationId]) => Boolean(operationId)));
  return (tableRows(tables, 'CONFIG_SNAPSHOT') ?? [])
    .filter((row) => {
      if (asText(row.status).toUpperCase() !== 'COMMITTED') return false;
      if (!committedOperations.has(asText(row.operation_id))) return false;
      const operationType = committedOperations.get(asText(row.operation_id));
      return !READ_ONLY_OPERATION_TYPES.has(operationType);
    })
    .sort((left, right) => asText(left.created_at).localeCompare(asText(right.created_at)))
    .at(-1) ?? null;
}

function operationIdentityConflict(existing, proposed) {
  return OPERATION_IDENTITY_FIELDS.find((field) => {
    const stored = asText(existing?.[field]);
    return !stored || stored !== asText(proposed?.[field]);
  }) ?? null;
}

function snapshotContentMatches(predecessor, normalizedConfigJson) {
  try {
    const stored = JSON.parse(asText(predecessor?.normalized_config_json));
    if (stored?.__snapshot_format === SNAPSHOT_FORMAT) {
      const expanded = expandSnapshotPayload(stored);
      if (!expanded) return false;
      if (stored.__scope !== Object.keys(expanded).sort().join('|')) return false;
      const expandedJson = canonicalJson(expanded);
      if (stored.__fingerprint !== sha256(expandedJson)) return false;
      if (stored.__fingerprint !== asText(predecessor?.fingerprint)) return false;
      return expandedJson === normalizedConfigJson;
    }
    if (canonicalJson(stored) === normalizedConfigJson) return asText(predecessor?.fingerprint) === sha256(normalizedConfigJson);
    if (!containsSheetRowMetadata(stored)) return false;
    const legacyJson = canonicalJson(stripSheetRowMetadata(stored));
    return asText(predecessor?.fingerprint) === sha256(legacyJson) && legacyJson === normalizedConfigJson;
  } catch {
    return false;
  }
}

function configuredMessages(tables) {
  return Object.fromEntries((tableRows(tables, 'CONFIG_THONG_BAO') ?? [])
    .filter((row) => asText(row.trang_thai).toUpperCase() !== 'INACTIVE' && !isBlank(row.message_key))
    .map((row) => [asText(row.message_key), asText(row.message_text)]));
}

function requestedConfigTables(tables, requested) {
  return Object.fromEntries(requested.map((sheetName) => [sheetName, (tableRows(tables, sheetName) ?? [])
    .filter((row) => asText(row.trang_thai).toUpperCase() !== 'INACTIVE')
    .map((row) => ({ ...row }))]));
}

const CONTEXT_COLUMNS = Object.freeze({
  CONFIG_USER: ['user_id', 'branch_id', 'trang_thai'],
  CONFIG_THONG_BAO: ['message_key', 'message_text', 'locale', 'trang_thai'],
  ERROR_BIA: ['error_id', 'error_code', 'retryable', 'operation_id', 'request_id', 'status'],
  OPERATION: ['operation_id', 'request_id', 'operation_type', 'idempotency_key', 'status'],
  EVENT_LOG: ['event_id', 'event_type', 'request_id', 'operation_id', 'command', 'outcome', 'error_code', 'trang_thai'],
});

function contextConfigTables(tables, requested, includeAudit = false) {
  const entries = requested.length ? Object.entries(CONTEXT_COLUMNS) : includeAudit ? [['EVENT_LOG', CONTEXT_COLUMNS.EVENT_LOG]] : [];
  return Object.fromEntries(entries.map(([sheetName, columns]) => [sheetName, (tableRows(tables, sheetName) ?? []).map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? ''])))]));
}

function statusResponse({ envelope, versionRow, configVersion, schemaVersion, snapshotId, fingerprint, activeBranches, messages, configTables = {}, contextTables = {} }) {
  const maintenanceMode = asText(versionRow.maintenance_mode).toUpperCase() || 'NO';
  return {
    status: 'OK',
    request_id: asText(envelope.request_id),
    operation_id: asText(envelope.operation_id),
    gateway_health: 'OK',
    state: maintenanceMode === 'YES' ? 'MAINTENANCE' : 'ACTIVE',
    config_version: configVersion,
    schema_version: schemaVersion,
    config_snapshot_id: snapshotId,
    fingerprint,
    maintenance_mode: maintenanceMode,
    active_branch_count: activeBranches.length,
    active_branches: activeBranches,
    messages,
    data: { config_tables: configTables, context_tables: contextTables },
    warnings: [],
  };
}

export function evaluateConfigGateway({ envelope = {}, tables, now = new Date().toISOString() } = {}) {
  const messages = configuredMessages(tables);
  if (!envelope || !envelope.request_id || !envelope.operation_id) {
    const result = makeFailure('ENVELOPE_INVALID', 'request_id and operation_id are required', envelope ?? {});
    result.response.messages = messages;
    return result;
  }
  const normalizedEnvelope = { ...envelope };
  const requested = requestedSheetNames(normalizedEnvelope);
  const decorateFailure = (result, { includeAudit = false } = {}) => {
    if (!result?.ok) {
      result.response = { ...(result.response ?? {}), messages };
      if ((requested.length > 0 || includeAudit) && !result.response.data) {
        result.response.data = { config_tables: {}, context_tables: contextConfigTables(tables, requested, includeAudit) };
      }
    }
    return result;
  };
  const tableError = validateCoreTables(tables, normalizedEnvelope);
  if (tableError) return decorateFailure(tableError);

  const messageError = validateConfiguredMessages(tables, normalizedEnvelope);
  if (messageError) return decorateFailure(messageError);

  const requestedError = validateRequestedTables(tables, normalizedEnvelope, requested);
  if (requestedError) return decorateFailure(requestedError);

  const schemaResult = readSchemaRules(tables, normalizedEnvelope, requested);
  if (schemaResult.error) return decorateFailure(schemaResult.error);
  const rowError = validateRows(tables, schemaResult.rules, normalizedEnvelope);
  if (rowError) return decorateFailure(rowError);

  if (asText(envelope.event_type).toUpperCase() === 'TELEGRAM_UPDATE' && !isBlank(envelope.actor_user_id)) {
    const actor = (tableRows(tables, 'CONFIG_USER') ?? []).find((row) => asText(row.user_id) === asText(envelope.actor_user_id));
    if (!actor || asText(actor.trang_thai).toUpperCase() !== ACTIVE) {
      return decorateFailure(makeFailure('USER_NOT_ACTIVE', 'User is not active', normalizedEnvelope), { includeAudit: true });
    }
  }

  const versionRow = activeVersionRow(tables);
  if (!versionRow || isBlank(versionRow.config_version)) return decorateFailure(makeFailure('CONFIG_VERSION_MISSING', 'Active CONFIG_VERSION row is missing', normalizedEnvelope));
  const configVersion = asText(versionRow.config_version);
  const schemaVersion = asText(versionRow.schema_version);
  const normalizedConfig = normalizeConfigTables(tables);
  const normalizedConfigJson = canonicalJson(normalizedConfig);
  const fingerprint = sha256(normalizedConfigJson);
  const predecessor = committedPredecessor(tables);
  const operationType = asText(envelope.payload?.intent || envelope.operation_type || (asText(envelope.payload?.command).toLowerCase().startsWith('/trangthai') ? 'READ_STATUS' : 'START_OPERATION')).toUpperCase();
  const maintenanceMode = asText(versionRow.maintenance_mode).toUpperCase() || 'NO';

  if (maintenanceMode === 'YES' && !['READ_STATUS', 'READ_HELP', 'COMMAND_NOT_AVAILABLE'].includes(operationType)) {
    return decorateFailure(makeFailure('CONFIG_MAINTENANCE', 'Configuration is in maintenance mode', normalizedEnvelope, { maintenance_mode: maintenanceMode }));
  }
  const activeBranches = (tableRows(tables, 'CONFIG_BRANCH') ?? [])
    .filter((row) => asText(row.trang_thai).toUpperCase() === ACTIVE)
    .map((row) => ({ branch_id: asText(row.branch_id), branch_name: asText(row.branch_name) }));
  if (operationType === 'COMMAND_NOT_AVAILABLE') {
    return {
      ok: true,
      response: statusResponse({ envelope: normalizedEnvelope, versionRow, configVersion, schemaVersion, snapshotId: predecessor?.config_snapshot_id ?? null, fingerprint, activeBranches, messages, configTables: requestedConfigTables(tables, requested), contextTables: contextConfigTables(tables, requested) }),
      write_plan: [],
      diagnostics: { normalized_config_json: normalizedConfigJson, reused_snapshot: Boolean(predecessor), read_only: true },
    };
  }
  if (READ_ONLY_OPERATION_TYPES.has(operationType)) {
    return {
      ok: true,
      response: statusResponse({ envelope: normalizedEnvelope, versionRow, configVersion, schemaVersion, snapshotId: predecessor?.config_snapshot_id ?? null, fingerprint, activeBranches, messages, configTables: requestedConfigTables(tables, requested), contextTables: contextConfigTables(tables, requested) }),
      write_plan: [],
      diagnostics: { normalized_config_json: normalizedConfigJson, reused_snapshot: Boolean(predecessor), read_only: true },
    };
  }
  if (predecessor) {
    const sameVersion = configVersion === asText(predecessor.config_version);
    const sameFingerprint = snapshotContentMatches(predecessor, normalizedConfigJson);
    if (sameVersion && !sameFingerprint) return decorateFailure(makeFailure('CONFIG_VERSION_NOT_INCREMENTED', 'Configuration content changed without incrementing config_version', normalizedEnvelope));
    if (!sameVersion && sameFingerprint) return decorateFailure(makeFailure('CONFIG_VERSION_EMPTY_CHANGE', 'config_version changed without configuration content changing', normalizedEnvelope));
    if (!sameVersion && !isVersionGreater(configVersion, predecessor.config_version)) return decorateFailure(makeFailure('CONFIG_VERSION_NOT_INCREMENTED', 'config_version must increase', normalizedEnvelope));
    if (sameVersion && sameFingerprint) {
      return {
        ok: true,
        response: statusResponse({ envelope: normalizedEnvelope, versionRow, configVersion, schemaVersion, snapshotId: predecessor.config_snapshot_id, fingerprint, activeBranches, messages, configTables: requestedConfigTables(tables, requested), contextTables: contextConfigTables(tables, requested) }),
        write_plan: [],
        diagnostics: { normalized_config_json: normalizedConfigJson, reused_snapshot: true },
      };
    }
  }

  const storedNormalizedConfigJson = snapshotStorageJson(normalizedConfigJson, fingerprint);
  if (!storedNormalizedConfigJson) {
    return decorateFailure(makeFailure('CONFIG_SNAPSHOT_TOO_LARGE', 'Normalized configuration snapshot exceeds the Google Sheets cell limit', normalizedEnvelope, {
      snapshot_size_chars: normalizedConfigJson.length,
      max_cell_chars: SNAPSHOT_CELL_MAX_CHARS,
    }));
  }

  const snapshotBaseId = `cfg-${configVersion.replace(/[^A-Za-z0-9._-]/g, '_')}-${fingerprint.slice(0, 16)}`;
  const operationId = asText(envelope.operation_id) || `op-${snapshotBaseId}`;
  const requestId = asText(envelope.request_id);
  const operationIdentity = {
    request_id: requestId,
    operation_type: operationType,
    idempotency_key: asText(envelope.payload?.idempotency_key) || requestId || operationId,
    checksum: fingerprint,
  };
  const existingOperation = (tableRows(tables, 'OPERATION') ?? []).find((row) => asText(row.operation_id) === operationId);
  if (asText(existingOperation?.status).toUpperCase() === 'COMMITTED') {
    return decorateFailure(makeFailure('OPERATION_ID_COMMITTED', 'operation_id is already committed', normalizedEnvelope));
  }
  const identityConflict = existingOperation ? operationIdentityConflict(existingOperation, operationIdentity) : null;
  if (identityConflict) {
    return decorateFailure(makeFailure('OPERATION_ID_COLLISION', 'operation identity conflicts with an existing operation', normalizedEnvelope, { identity_field: identityConflict }));
  }
  const snapshotRows = tableRows(tables, 'CONFIG_SNAPSHOT') ?? [];
  const snapshotsForOperation = snapshotRows.filter((row) => asText(row.operation_id) === operationId);
  const existingSnapshotForOperation = snapshotRows.find((row) => asText(row.operation_id) === operationId
    && asText(row.config_version) === configVersion
    && asText(row.fingerprint) === fingerprint);
  if (existingOperation && snapshotsForOperation.some((row) => asText(row.config_version) !== configVersion || asText(row.fingerprint) !== fingerprint)) {
    return decorateFailure(makeFailure('OPERATION_RECOVERY_MISMATCH', 'operation recovery does not match its existing snapshot', normalizedEnvelope));
  }
  const occupiedSnapshotIds = new Set(snapshotRows
    .map((row) => asText(row.config_snapshot_id))
    .filter(Boolean));
  let snapshotId = asText(existingSnapshotForOperation?.config_snapshot_id) || snapshotBaseId;
  if (occupiedSnapshotIds.has(snapshotId) && !existingSnapshotForOperation) {
    const repairSuffix = operationId.replace(/[^A-Za-z0-9._-]/g, '_') || 'unknown';
    snapshotId = `${snapshotBaseId}-repair-${repairSuffix}`;
    let attempt = 2;
    while (occupiedSnapshotIds.has(snapshotId)) {
      snapshotId = `${snapshotBaseId}-repair-${repairSuffix}-${attempt}`;
      attempt += 1;
    }
  }
  const operationRow = {
    operation_id: operationId,
    ...operationIdentity,
    expected_row_count: '1',
    actual_row_count: '',
    status: 'PREPARED',
    error_id: '',
    created_at: asText(existingOperation?.created_at) || now,
    updated_at: now,
  };
  const snapshotRow = {
    config_snapshot_id: snapshotId,
    config_version: configVersion,
    schema_version: schemaVersion,
    fingerprint,
    normalized_config_json: storedNormalizedConfigJson,
    operation_id: operationId,
    status: 'PREPARED',
    created_at: now,
  };
  return {
    ok: true,
    response: statusResponse({ envelope: normalizedEnvelope, versionRow, configVersion, schemaVersion, snapshotId, fingerprint, activeBranches, messages, configTables: requestedConfigTables(tables, requested), contextTables: contextConfigTables(tables, requested) }),
    write_plan: [
      { sheet: 'OPERATION', action: existingOperation ? 'UPSERT' : 'APPEND', row: operationRow },
      { sheet: 'CONFIG_SNAPSHOT', action: snapshotRows.some((row) => asText(row.config_snapshot_id) === snapshotId) ? 'UPSERT' : 'APPEND', row: snapshotRow },
      { sheet: 'CONFIG_SNAPSHOT', action: 'UPDATE', match: { config_snapshot_id: snapshotId }, patch: { status: 'COMMITTED' } },
      { sheet: 'OPERATION', action: 'UPDATE', match: { operation_id: operationId }, patch: { status: 'COMMITTED', actual_row_count: '1', updated_at: now } },
    ],
    diagnostics: {
      normalized_config_json: normalizedConfigJson,
      snapshot_storage_format: storedNormalizedConfigJson === normalizedConfigJson ? 'json-v1' : SNAPSHOT_FORMAT,
      reused_snapshot: false,
    },
  };
}

export { canonicalJson, expandSnapshotPayload };
