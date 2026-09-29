import { schemaManifest } from '../../../tools/kiem-ke-bia-v2/schema-manifest.mjs';

const ALL_SHEET_DEFINITIONS = Object.freeze(Object.fromEntries(schemaManifest.sheets.map((sheet) => [sheet.name, sheet.headers])));
const CORE_SHEET_NAMES = Object.freeze(['CONFIG_SCHEMA', 'CONFIG_VERSION', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO', 'CONFIG_SNAPSHOT', 'OPERATION', 'ERROR_BIA']);
const AUDIT_SHEET_NAMES = Object.freeze(['EVENT_LOG']);
const CONFIG_SHEET_NAMES = Object.freeze(schemaManifest.sheets.filter((sheet) => sheet.group === 'config').map((sheet) => sheet.name));
const SNAPSHOT_CELL_MAX_CHARS = 50000;
const SNAPSHOT_FORMAT = 'columnar-v1';

const clone = (value) => {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (typeof globalThis?.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

/**
 * Normalize the small envelope shared by all KKB-V2 workflows.
 * Business configuration is deliberately not inferred here; it is read only
 * by the Config Gateway from the live Google Sheets tables.
 */
function normalizeEnvelope(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('workflow envelope must be an object');
  }

  const requestId = input.request_id;
  const operationId = input.operation_id;
  if (!requestId || !operationId) {
    throw new Error('workflow envelope requires request_id and operation_id');
  }

  return {
    request_id: String(requestId),
    operation_id: String(operationId),
    event_type: input.event_type ? String(input.event_type) : 'UNKNOWN',
    actor_user_id: input.actor_user_id == null ? null : String(input.actor_user_id),
    branch_id: input.branch_id == null || input.branch_id === '' ? null : String(input.branch_id),
    business_date: input.business_date == null || input.business_date === '' ? null : String(input.business_date),
    config_version: input.config_version == null || input.config_version === '' ? null : String(input.config_version),
    config_snapshot_id: input.config_snapshot_id == null || input.config_snapshot_id === '' ? null : String(input.config_snapshot_id),
    operation_type: input.operation_type == null || input.operation_type === '' ? null : String(input.operation_type),
    payload: input.payload && typeof input.payload === 'object' ? clone(input.payload) : {},
  };
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (value, bits) => (value >>> bits) | (value << (32 - bits));

/** Dependency-free SHA-256 for Node tests and n8n Code nodes. */
function sha256(input) {
  const bytes = new TextEncoder().encode(String(input));
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) schedule[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(schedule[i - 15], 7) ^ rotr(schedule[i - 15], 18) ^ (schedule[i - 15] >>> 3);
      const s1 = rotr(schedule[i - 2], 17) ^ rotr(schedule[i - 2], 19) ^ (schedule[i - 2] >>> 10);
      schedule[i] = (schedule[i - 16] + s0 + schedule[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + choice + K[i] + schedule[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((value) => value.toString(16).padStart(8, '0'))
    .join('');
}


const CORE_FINGERPRINT_SHEETS = ['CONFIG_SCHEMA', 'CONFIG_GLOBAL', 'CONFIG_BRANCH', 'CONFIG_USER', 'CONFIG_THONG_BAO'];
const SCHEMA_DATA_TYPES = new Set(['STRING', 'INTEGER', 'NUMBER', 'BOOLEAN', 'DATE', 'DATETIME']);
const ACTIVE = 'ACTIVE';

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
  const errorClass = errorCode === 'ENVELOPE_INVALID'
    ? 'VALIDATION'
      : errorCode === 'USER_NOT_ACTIVE'
        ? 'AUTHORIZATION'
      : ['CONFIG_VERSION_AMBIGUOUS', 'CONFIG_VERSION_NOT_INCREMENTED', 'CONFIG_VERSION_EMPTY_CHANGE', 'CONFIG_VERSION_SCOPE_MISMATCH', 'CONFIG_VERSION_FINGERPRINT_MISMATCH', 'CONFIG_SNAPSHOT_SCOPE_MISMATCH', 'OPERATION_IDEMPOTENCY_CONFLICT'].includes(errorCode)
        ? 'CONFLICT'
        : 'CONFIGURATION';
  return failure(errorCode, message, {
    request_id: requestId,
    operation_id: operationId,
    error_class: errorClass,
    message_safe: message || errorCode,
    retryable: false,
    error_id: safeErrorId(operationId, errorCode),
    ...details,
  });
}

function tableRows(tables, sheetName) {
  const rows = tables?.[sheetName];
  return Array.isArray(rows) ? rows : null;
}

function projectSheetRow(sheetName, values) {
  return Object.fromEntries((ALL_SHEET_DEFINITIONS[sheetName] ?? []).map((columnName) => [columnName, values?.[columnName] ?? '']));
}

function operationIsCommitted(operation) {
  return asText(operation?.status).toUpperCase() === 'COMMITTED'
    && asText(operation?.commit_state).toUpperCase() === 'COMMITTED';
}

function extractSheetValueRange(valueRange, sheetName) {
  const values = Array.isArray(valueRange?.values) ? valueRange.values : null;
  const expectedHeaders = ALL_SHEET_DEFINITIONS[sheetName] ?? [];
  const rawHeaders = values && Array.isArray(values[0]) ? values[0] : null;
  const observedWidth = values?.reduce((width, row) => Math.max(width, Array.isArray(row) ? row.length : 0), 0) ?? 0;
  const headers = rawHeaders === null ? null : Array.from(
    { length: Math.max(expectedHeaders.length, rawHeaders.length, observedWidth) },
    (_, index) => rawHeaders[index] == null ? '' : String(rawHeaders[index]),
  );
  return { headers, values };
}

function materializeRawValueTables(tables) {
  const rawTables = tables?.__raw_values;
  if (!rawTables || typeof rawTables !== 'object') return;
  for (const [sheetName, values] of Object.entries(rawTables)) {
    const headers = tables.__headers?.[sheetName];
    if (!Array.isArray(headers) || !Array.isArray(values)) continue;
    tables[sheetName] = values.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [
      header,
      row?.[index] == null ? '' : row[index],
    ])));
  }
}

function validateSheetHeaders(tables, sheetName, envelope) {
  const observedHeaders = tables?.__headers?.[sheetName];
  if (!tables?.__headers) return null;
  const expectedHeaders = ALL_SHEET_DEFINITIONS[sheetName] ?? [];
  if (!Array.isArray(observedHeaders)) {
    return makeFailure('CONFIG_HEADER_INVALID', `Could not verify the header row for ${sheetName}`, envelope, {
      sheet_name: sheetName, header_index: 1, column_name: expectedHeaders[0] ?? null, actual_column_name: null,
    });
  }
  const mismatchIndex = expectedHeaders.findIndex((columnName, index) => observedHeaders[index] !== columnName);
  const hasExtraHeader = observedHeaders.length > expectedHeaders.length;
  if (mismatchIndex >= 0 || hasExtraHeader) {
    const headerIndex = mismatchIndex >= 0 ? mismatchIndex : expectedHeaders.length;
    return makeFailure('CONFIG_HEADER_INVALID', `Invalid header row for ${sheetName}`, envelope, {
      sheet_name: sheetName,
      header_index: headerIndex + 1,
      column_name: expectedHeaders[headerIndex] ?? null,
      actual_column_name: observedHeaders[headerIndex] ?? null,
    });
  }
  return null;
}

function validateCoreTables(tables, envelope) {
  if (!tables || typeof tables !== 'object') return makeFailure('CONFIG_TABLES_MISSING', 'Configuration tables are missing', envelope);
  for (const sheetName of CORE_SHEET_NAMES) {
    const rows = tableRows(tables, sheetName);
    if (rows === null) return makeFailure('CONFIG_SHEET_MISSING', `Missing configuration sheet ${sheetName}`, envelope, { sheet_name: sheetName });
    const headerError = validateSheetHeaders(tables, sheetName, envelope);
    if (headerError) return headerError;
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

function requestedSheetNames(envelope) {
  const requested = envelope?.payload?.required_sheet_names;
  if (!Array.isArray(requested)) return [];
  return [...new Set(requested.map(asText).filter(Boolean))];
}

function validateRequestedTables(tables, envelope, requested) {
  for (const sheetName of requested) {
    if (![...CONFIG_SHEET_NAMES.filter((name) => !['CONFIG_SCHEMA', 'CONFIG_VERSION'].includes(name)), ...AUDIT_SHEET_NAMES].includes(sheetName)) {
      return makeFailure('CONFIG_SHEET_NOT_ALLOWED', `Unsupported requested configuration sheet ${sheetName}`, envelope, { sheet_name: sheetName });
    }
    const rows = tableRows(tables, sheetName);
    if (rows === null) return makeFailure('CONFIG_SHEET_MISSING', `Missing configuration sheet ${sheetName}`, envelope, { sheet_name: sheetName });
    const headerError = validateSheetHeaders(tables, sheetName, envelope);
    if (headerError) return headerError;
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
    const columnName = asText(row.field_name ?? row.column_name);
    const dataType = asText(row.data_type).toUpperCase();
    if (!ALL_SHEET_DEFINITIONS[sheetName]?.includes(columnName)) {
      return { error: makeFailure('CONFIG_SCHEMA_INVALID', `Invalid schema rule at row ${index + 2}`, envelope, { row_number: index + 2 }) };
    }
    if (!SCHEMA_DATA_TYPES.has(dataType)) {
      return { error: makeFailure('CONFIG_SCHEMA_INVALID', `Unsupported data type for ${sheetName}.${columnName}`, envelope, { sheet_name: sheetName, column_name: columnName }) };
    }
    const reference = asText(row.reference);
    const [referenceSheet = '', referenceColumn = ''] = reference ? reference.split('.', 2) : [asText(row.reference_sheet), asText(row.reference_column)];
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
      unique_group: asText(row.key_type),
      reference_sheet: referenceSheet,
      reference_column: referenceColumn,
      allowed_values: parseAllowedValues(row.allowed_values),
      schema_version: asText(row.schema_version),
      trang_thai: asText(row.trang_thai ?? row.status).toUpperCase() || ACTIVE,
    });
  }

  const duplicateRule = rules.find((rule, index) => rules.findIndex((candidate) => candidate.sheet_name === rule.sheet_name && candidate.column_name === rule.column_name) !== index);
  if (duplicateRule) {
    return { error: makeFailure('CONFIG_SCHEMA_DUPLICATE', `Duplicate schema rule for ${duplicateRule.sheet_name}.${duplicateRule.column_name}`, envelope, { sheet_name: duplicateRule.sheet_name, column_name: duplicateRule.column_name }) };
  }
  const activeRules = rules.filter((rule) => rule.trang_thai === ACTIVE);
  const declared = new Set(activeRules.map((rule) => `${rule.sheet_name}.${rule.column_name}`));
  const requiredSchemaSheets = [...CORE_SHEET_NAMES, ...requested];
  for (const sheetName of [...new Set(requiredSchemaSheets)]) {
    for (const columnName of ALL_SHEET_DEFINITIONS[sheetName]) {
      if (!declared.has(`${sheetName}.${columnName}`)) {
        return { error: makeFailure('CONFIG_SCHEMA_INCOMPLETE', `Schema does not declare ${sheetName}.${columnName}`, envelope, { sheet_name: sheetName, column_name: columnName }) };
      }
    }
  }
  return { rules: activeRules };
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
    const rows = tableRows(tables, rule.sheet_name) ?? [];
    const seen = new Map();
    const isHistoricalSnapshotVersion = rule.sheet_name === 'CONFIG_SNAPSHOT' && rule.column_name === 'config_version';
    const isSnapshotIdentity = rule.sheet_name === 'CONFIG_SNAPSHOT' && rule.column_name === 'config_snapshot_id';
    const enforceUnique = Boolean((rule.unique_group && !isHistoricalSnapshotVersion) || isSnapshotIdentity);
    for (const [index, row] of rows.entries()) {
      if (asText(row?.trang_thai ?? row?.status).toUpperCase() === 'INACTIVE') continue;
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
      if (enforceUnique && !isBlank(value)) {
        const key = asText(value);
        if (seen.has(key)) {
          return makeFailure('CONFIG_DUPLICATE_KEY', `Duplicate ${rule.sheet_name}.${rule.column_name}`, envelope, { sheet_name: rule.sheet_name, column_name: rule.column_name, first_row_number: seen.get(key) + 2, row_number: index + 2 });
        }
        seen.set(key, index);
      }
    }
    if (rule.reference_sheet && rule.reference_column) {
      const referenced = new Set((tableRows(tables, rule.reference_sheet) ?? [])
        .filter((row) => asText(row?.trang_thai ?? row?.status).toUpperCase() !== 'INACTIVE')
        .map((row) => asText(row?.[rule.reference_column])).filter(Boolean));
      for (const [index, row] of rows.entries()) {
        if (asText(row?.trang_thai ?? row?.status).toUpperCase() === 'INACTIVE') continue;
        const value = asText(row?.[rule.column_name]);
        if (value && !referenced.has(value)) {
          return makeFailure('CONFIG_REFERENCE_INVALID', `Invalid reference for ${rule.sheet_name}.${rule.column_name}`, envelope, { sheet_name: rule.sheet_name, column_name: rule.column_name, row_number: index + 2 });
        }
      }
    }
  }
  return null;
}

function normalizeConfigTables(tables, requested = [], branchScope = '*') {
  const requestedNames = new Set(requested.map(asText));
  const scopeSheets = [...new Set([...CORE_FINGERPRINT_SHEETS, ...CONFIG_SHEET_NAMES.filter((sheetName) => requestedNames.has(sheetName))])];
  return Object.fromEntries(scopeSheets.filter((sheetName) => tableRows(tables, sheetName) !== null).map((sheetName) => {
    const rows = (tableRows(tables, sheetName) ?? [])
      .filter((row) => asText(row.trang_thai ?? row.status).toUpperCase() !== 'INACTIVE')
      .filter((row) => branchScope === '*' || isBlank(row.branch_id) || asText(row.branch_id) === branchScope)
      .map((row) => Object.fromEntries(
      Object.entries(row ?? {}).map(([key, value]) => [key, value == null ? '' : String(value).trim()]),
      ));
    rows.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
    return [sheetName, rows];
  }));
}

function expandSnapshotPayload(payload) {
  if (!payload || typeof payload !== 'object' || payload.__snapshot_format !== SNAPSHOT_FORMAT || !payload.sheets || typeof payload.sheets !== 'object') {
    return payload;
  }
  return Object.fromEntries(Object.entries(payload.sheets).map(([sheetName, sheet]) => {
    const columns = Array.isArray(sheet?.columns) ? sheet.columns.map(asText) : [];
    const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
    return [sheetName, rows.map((values) => Object.fromEntries(columns.map((columnName, index) => {
      const encoded = values?.[index] ?? '';
      const value = Array.isArray(payload.dictionary) ? payload.dictionary[encoded] ?? '' : encoded;
      return [columnName, value];
    })))];
  }));
}

function snapshotStorageJson(normalizedConfigJson, fingerprint, branchScope) {
  if (normalizedConfigJson.length <= SNAPSHOT_CELL_MAX_CHARS) return normalizedConfigJson;
  let normalized;
  try {
    normalized = JSON.parse(normalizedConfigJson);
  } catch {
    return null;
  }
  const compact = canonicalJson({
    __snapshot_format: SNAPSHOT_FORMAT,
    __scope: branchScope,
    __fingerprint: fingerprint,
    dictionary: [],
    sheets: Object.fromEntries(Object.entries(normalized).map(([sheetName, rows]) => {
      const columnNames = [...new Set((Array.isArray(rows) ? rows : []).flatMap((row) => Object.keys(row ?? {})))].sort();
      return [sheetName, {
        columns: columnNames,
        rows: (Array.isArray(rows) ? rows : []).map((row) => columnNames.map((columnName) => row?.[columnName] ?? '')),
      }];
    })),
  });
  const rawColumns = JSON.parse(compact);
  const dictionary = [];
  const dictionaryIndex = new Map();
  const addValue = (value) => {
    const text = String(value ?? '');
    if (!dictionaryIndex.has(text)) {
      dictionaryIndex.set(text, dictionary.length);
      dictionary.push(text);
    }
    return dictionaryIndex.get(text);
  };
  const encoded = canonicalJson({
    __snapshot_format: SNAPSHOT_FORMAT,
    __scope: branchScope,
    __fingerprint: fingerprint,
    dictionary,
    sheets: Object.fromEntries(Object.entries(rawColumns.sheets).map(([sheetName, sheet]) => [sheetName, {
      columns: sheet.columns,
      rows: sheet.rows.map((row) => row.map(addValue)),
    }])),
  });
  return encoded.length <= SNAPSHOT_CELL_MAX_CHARS ? encoded : null;
}

function activeVersionRows(tables) {
  return (tableRows(tables, 'CONFIG_VERSION') ?? []).filter((row) => asText(row.status).toUpperCase() === 'ACTIVE');
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

function snapshotTableSet(normalizedConfigJson) {
  try {
    const payload = expandSnapshotPayload(typeof normalizedConfigJson === 'string' ? JSON.parse(normalizedConfigJson) : normalizedConfigJson);
    return payload && typeof payload === 'object' ? Object.keys(payload).sort().join('|') : '';
  } catch {
    return '';
  }
}

function acceptedVersionForSnapshot(tables, snapshot) {
  return activeVersionRows(tables).find((row) =>
    asText(row.config_snapshot_id) === asText(snapshot.config_snapshot_id)
    && asText(row.config_version) === asText(snapshot.config_version)
    && asText(row.content_fingerprint) === asText(snapshot.config_fingerprint));
}

function committedOperationIds(tables) {
  return new Set((tableRows(tables, 'OPERATION') ?? [])
    .filter(operationIsCommitted)
    .map((row) => asText(row.operation_id))
    .filter(Boolean));
}

function committedPredecessor(tables, scope, tableSet) {
  const committedIds = committedOperationIds(tables);
  return (tableRows(tables, 'CONFIG_SNAPSHOT') ?? [])
    .filter((row) => ['PREPARED', 'COMMITTED'].includes(asText(row.status).toUpperCase())
      && committedIds.has(asText(row.operation_id))
      && acceptedVersionForSnapshot(tables, row)
      && (asText(row.branch_scope) || '*') === scope
      && snapshotTableSet(row.normalized_config_json) === tableSet)
    .sort((left, right) => asText(left.created_at).localeCompare(asText(right.created_at)))
    .at(-1) ?? null;
}

function configuredMessages(tables) {
  return Object.fromEntries((tableRows(tables, 'CONFIG_THONG_BAO') ?? [])
    .filter((row) => asText(row.trang_thai ?? row.status).toUpperCase() !== 'INACTIVE' && !isBlank(row.notification_code))
    .map((row) => [asText(row.notification_code), asText(row.template_text)]));
}

function requestedConfigTables(tables, requested, branchScope = '*') {
  return Object.fromEntries(requested.map((sheetName) => [sheetName, (tableRows(tables, sheetName) ?? [])
    .filter((row) => asText(row.trang_thai ?? row.status).toUpperCase() !== 'INACTIVE')
    .filter((row) => branchScope === '*' || isBlank(row.branch_id) || asText(row.branch_id) === branchScope)
    .map((row) => ({ ...row }))]));
}

const CONTEXT_COLUMNS = Object.freeze({
  CONFIG_USER: ['user_id', 'branch_id', 'trang_thai'],
  CONFIG_THONG_BAO: ['notification_code', 'template_text', 'trang_thai'],
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
    config_fingerprint: fingerprint,
    branch_scope: asText(envelope.branch_id) || '*',
    maintenance_mode: maintenanceMode,
    active_branch_count: activeBranches.length,
    active_branches: activeBranches,
    messages,
    data: { config_tables: configTables, context_tables: contextTables },
    warnings: [],
  };
}

function committedSnapshotFor(tables, snapshotId) {
  const committedIds = committedOperationIds(tables);
  return (tableRows(tables, 'CONFIG_SNAPSHOT') ?? []).find((row) =>
    asText(row.config_snapshot_id) === snapshotId
    && ['PREPARED', 'COMMITTED'].includes(asText(row.status).toUpperCase())
    && committedIds.has(asText(row.operation_id))
    && acceptedVersionForSnapshot(tables, row));
}

function continueSnapshot({ envelope, tables, messages }) {
  const snapshotId = asText(envelope.config_snapshot_id);
  if (!snapshotId) return null;
  const snapshot = committedSnapshotFor(tables, snapshotId);
  if (!snapshot) return makeFailure('CONFIG_SNAPSHOT_NOT_COMMITTED', 'The requested configuration snapshot is not committed', envelope, { config_snapshot_id: snapshotId });
  const scope = asText(snapshot.branch_scope) || '*';
  if (scope !== '*' && asText(envelope.branch_id) !== scope) {
    return makeFailure('CONFIG_SNAPSHOT_SCOPE_MISMATCH', 'The requested configuration snapshot is outside this branch scope', envelope, { config_snapshot_id: snapshotId, branch_scope: scope });
  }
  let payload;
  try {
    payload = expandSnapshotPayload(JSON.parse(snapshot.normalized_config_json));
  } catch {
    return makeFailure('CONFIG_SNAPSHOT_INVALID', 'The requested configuration snapshot cannot be decoded', envelope, { config_snapshot_id: snapshotId });
  }
  const normalizedConfigJson = canonicalJson(payload);
  return {
    ok: true,
    response: {
      status: 'OK', request_id: asText(envelope.request_id), operation_id: asText(envelope.operation_id),
      gateway_health: 'OK', state: 'SNAPSHOT_CONTINUED', config_version: asText(snapshot.config_version),
      schema_version: asText(snapshot.schema_version), config_snapshot_id: snapshotId,
      config_fingerprint: asText(snapshot.config_fingerprint), branch_scope: scope,
      maintenance_mode: asText(activeVersionRows(tables).find((row) => !row.config_snapshot_id)?.maintenance_mode
        ?? acceptedVersionForSnapshot(tables, snapshot)?.maintenance_mode) || 'NO',
      messages, data: { normalized_config_json: normalizedConfigJson, config_tables: payload, context_tables: {} }, warnings: [],
    },
    write_plan: [],
    diagnostics: {
      normalized_config_json: normalizedConfigJson,
      reused_snapshot: true,
      continued_snapshot: true,
    },
  };
}

function activeCutoverRow(tables, branchScope) {
  return (tableRows(tables, 'CONFIG_CUTOVER') ?? []).find((row) =>
    asText(row.trang_thai ?? row.status).toUpperCase() !== 'INACTIVE'
    && (isBlank(row.branch_id) || branchScope === '*' || asText(row.branch_id) === branchScope));
}

function evaluateConfigGateway({ envelope = {}, tables, now = new Date().toISOString() } = {}) {
  const messages = configuredMessages(tables);
  if (!envelope || !envelope.request_id || !envelope.operation_id) {
    const result = makeFailure('ENVELOPE_INVALID', 'request_id and operation_id are required', envelope ?? {});
    result.response.messages = messages;
    return result;
  }
  const normalizedEnvelope = { ...envelope };
  const requested = requestedSheetNames(normalizedEnvelope);
  if (tableRows(tables, 'CONFIG_CUTOVER') !== null && !requested.includes('CONFIG_CUTOVER')) requested.push('CONFIG_CUTOVER');
  const requestedOperation = asText(envelope.operation_type || envelope.payload?.intent || '').toUpperCase();
  if (['CONTINUE_SESSION', 'CONTINUE_OPERATION', 'RESUME_OPERATION'].includes(requestedOperation) && envelope.config_snapshot_id) {
    return continueSnapshot({ envelope: normalizedEnvelope, tables, messages });
  }
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

  const requestedError = validateRequestedTables(tables, normalizedEnvelope, requested);
  if (requestedError) return decorateFailure(requestedError);

  materializeRawValueTables(tables);

  const schemaResult = readSchemaRules(tables, normalizedEnvelope, requested);
  if (schemaResult.error) return decorateFailure(schemaResult.error);
  const rowError = validateRows(tables, schemaResult.rules, normalizedEnvelope);
  if (rowError) return decorateFailure(rowError);

  if (asText(envelope.event_type).toUpperCase() === 'TELEGRAM_UPDATE' && !isBlank(envelope.actor_user_id)) {
    const actor = (tableRows(tables, 'CONFIG_USER') ?? []).find((row) => asText(row.user_id) === asText(envelope.actor_user_id));
    if (!actor || asText(actor.trang_thai ?? actor.status).toUpperCase() !== ACTIVE) {
      return decorateFailure(makeFailure('USER_NOT_ACTIVE', 'User is not active', normalizedEnvelope), { includeAudit: true });
    }
  }

  const branchScope = asText(envelope.branch_id) || '*';
  const normalizedConfig = normalizeConfigTables(tables, requested, branchScope);
  const normalizedConfigJson = canonicalJson(normalizedConfig);
  const fingerprint = sha256(normalizedConfigJson);
  const tableSet = Object.keys(normalizedConfig).sort().join('|');
  const predecessor = committedPredecessor(tables, branchScope, tableSet);
  const activeRows = activeVersionRows(tables);
  const proposedRows = activeRows.filter((row) => isBlank(row.config_snapshot_id));
  const acceptedRows = activeRows.filter((row) => !isBlank(row.config_snapshot_id)
    && committedSnapshotFor(tables, asText(row.config_snapshot_id)));
  if (proposedRows.length > 1) return decorateFailure(makeFailure('CONFIG_VERSION_AMBIGUOUS', 'At most one unlinked ACTIVE CONFIG_VERSION proposal is allowed', normalizedEnvelope, { active_config_version_count: proposedRows.length }));
  const scopedAcceptedVersionRow = predecessor
    ? acceptedRows.find((row) => asText(row.config_snapshot_id) === asText(predecessor.config_snapshot_id))
    : null;
  const fallbackAcceptedVersionRow = acceptedRows
    .sort((left, right) => asText(left.generated_at).localeCompare(asText(right.generated_at)))
    .at(-1);
  const versionRow = proposedRows[0] ?? scopedAcceptedVersionRow ?? fallbackAcceptedVersionRow;
  const fingerprintVersionRow = proposedRows[0] ?? scopedAcceptedVersionRow;
  if (!versionRow || isBlank(versionRow.config_version)) return decorateFailure(makeFailure('CONFIG_VERSION_MISSING', 'Active CONFIG_VERSION row is missing', normalizedEnvelope));
  const configVersion = asText(versionRow.config_version);
  const schemaVersion = asText(versionRow.schema_version);
  const mismatchedRule = schemaResult.rules.find((rule) => rule.schema_version && rule.schema_version !== schemaVersion);
  if (mismatchedRule) return decorateFailure(makeFailure('CONFIG_SCHEMA_VERSION_MISMATCH', `Schema version mismatch for ${mismatchedRule.sheet_name}.${mismatchedRule.column_name}`, normalizedEnvelope, { sheet_name: 'CONFIG_SCHEMA', column_name: 'schema_version', field_sheet_name: mismatchedRule.sheet_name, field_name: mismatchedRule.column_name, config_version: configVersion, schema_version: schemaVersion, rule_schema_version: mismatchedRule.schema_version }));
  const headerDiagnostics = {};
  if (fingerprintVersionRow && !isBlank(fingerprintVersionRow.content_fingerprint) && asText(fingerprintVersionRow.content_fingerprint) !== fingerprint) {
    return decorateFailure(makeFailure('CONFIG_VERSION_FINGERPRINT_MISMATCH', 'CONFIG_VERSION content_fingerprint does not match the current normalized configuration', normalizedEnvelope, {
      config_version: asText(fingerprintVersionRow.config_version), expected_content_fingerprint: asText(fingerprintVersionRow.content_fingerprint), actual_content_fingerprint: fingerprint,
    }));
  }
  const operationType = asText(envelope.payload?.intent || envelope.operation_type || (asText(envelope.payload?.command).toLowerCase().startsWith('/trangthai') ? 'READ_STATUS' : 'START_OPERATION')).toUpperCase();
  const maintenanceMode = asText(versionRow.maintenance_mode).toUpperCase() || 'NO';

  if (maintenanceMode === 'YES' && !['READ_STATUS', 'READ_HELP', 'COMMAND_NOT_AVAILABLE'].includes(operationType)) {
    return decorateFailure(makeFailure('CONFIG_MAINTENANCE', 'Configuration is in maintenance mode', normalizedEnvelope, { maintenance_mode: maintenanceMode }));
  }
  const cutover = activeCutoverRow(tables, branchScope);
  if (cutover && (asText(cutover.mode).toUpperCase() === 'V1_PRIMARY' || ['NO', 'FALSE', '0'].includes(asText(cutover.v2_enabled).toUpperCase()))) {
    return decorateFailure(makeFailure('CONFIG_CUTOVER_BLOCKED', 'V2 operations are disabled by the active cutover configuration', normalizedEnvelope, { cutover_mode: asText(cutover.mode).toUpperCase() }));
  }
  const activeBranches = (tableRows(tables, 'CONFIG_BRANCH') ?? [])
    .filter((row) => asText(row.trang_thai ?? row.status).toUpperCase() === ACTIVE)
    .map((row) => ({ branch_id: asText(row.branch_id), branch_name: asText(row.branch_name) }));
  if (operationType === 'COMMAND_NOT_AVAILABLE') {
    return {
      ok: true,
      response: statusResponse({ envelope: normalizedEnvelope, versionRow, configVersion, schemaVersion, snapshotId: predecessor?.config_snapshot_id ?? null, fingerprint, activeBranches, messages, configTables: requestedConfigTables(tables, requested, branchScope), contextTables: contextConfigTables(tables, requested) }),
      write_plan: [],
      diagnostics: { normalized_config_json: normalizedConfigJson, reused_snapshot: Boolean(predecessor), read_only: true, ...headerDiagnostics },
    };
  }
  if (predecessor) {
    const sameVersion = configVersion === asText(predecessor.config_version);
    const sameFingerprint = fingerprint === asText(predecessor.config_fingerprint);
    if (sameVersion && !sameFingerprint) return decorateFailure(makeFailure('CONFIG_VERSION_NOT_INCREMENTED', 'Configuration content changed without incrementing config_version', normalizedEnvelope));
    if (!sameVersion && sameFingerprint) return decorateFailure(makeFailure('CONFIG_VERSION_EMPTY_CHANGE', 'config_version changed without configuration content changing in the same requested-table scope', normalizedEnvelope));
    if (!sameVersion && !isVersionGreater(configVersion, predecessor.config_version)) return decorateFailure(makeFailure('CONFIG_VERSION_NOT_INCREMENTED', 'config_version must increase', normalizedEnvelope));
    if (sameVersion && sameFingerprint) {
      return {
        ok: true,
        response: statusResponse({ envelope: normalizedEnvelope, versionRow, configVersion, schemaVersion, snapshotId: predecessor.config_snapshot_id, fingerprint, activeBranches, messages, configTables: requestedConfigTables(tables, requested, branchScope), contextTables: contextConfigTables(tables, requested) }),
        write_plan: [],
        diagnostics: { normalized_config_json: normalizedConfigJson, reused_snapshot: true, ...headerDiagnostics },
      };
    }
  }

  const storedNormalizedConfigJson = snapshotStorageJson(normalizedConfigJson, fingerprint, branchScope);
  if (!storedNormalizedConfigJson) {
    return decorateFailure(makeFailure('CONFIG_SNAPSHOT_TOO_LARGE', 'Normalized configuration snapshot exceeds the Google Sheets cell limit', normalizedEnvelope, {
      snapshot_size_chars: normalizedConfigJson.length,
      max_cell_chars: SNAPSHOT_CELL_MAX_CHARS,
    }));
  }

  const scopedFingerprint = sha256(canonicalJson({ branch_scope: branchScope, config_fingerprint: fingerprint }));
  const snapshotId = `cfg-${configVersion.replace(/[^A-Za-z0-9._-]/g, '_')}-${scopedFingerprint.slice(0, 16)}`;
  const operationId = asText(envelope.operation_id) || `op-${snapshotId}`;
  const requestId = asText(envelope.request_id);
  const idempotencyKey = asText(envelope.payload?.idempotency_key) || requestId || operationId;
  const existingOperation = (tableRows(tables, 'OPERATION') ?? []).find((row) => asText(row.idempotency_key) === idempotencyKey);
  if (existingOperation && asText(existingOperation.operation_id) !== operationId) {
    return decorateFailure(makeFailure('OPERATION_IDEMPOTENCY_CONFLICT', 'The idempotency key is already linked to a different operation', normalizedEnvelope, { idempotency_key: idempotencyKey }));
  }
  if (existingOperation && !isBlank(existingOperation.config_snapshot_id)
    && asText(existingOperation.config_snapshot_id) !== snapshotId) {
    return decorateFailure(makeFailure('OPERATION_IDEMPOTENCY_CONFLICT', 'The idempotency key is already reserved for a different configuration snapshot', normalizedEnvelope, { idempotency_key: idempotencyKey }));
  }
  if (existingOperation && operationIsCommitted(existingOperation)) {
    return decorateFailure(makeFailure('OPERATION_IDEMPOTENCY_CONFLICT', 'The idempotency key is already committed to a different configuration snapshot', normalizedEnvelope, { idempotency_key: idempotencyKey }));
  }
  const operationValues = {
    operation_id: operationId,
    request_id: requestId,
    event_type: asText(envelope.event_type) || 'CONFIG_READ',
    idempotency_key: idempotencyKey,
    branch_id: asText(envelope.branch_id),
    actor_user_id: asText(envelope.actor_user_id),
    business_date: asText(envelope.business_date),
    config_version: configVersion,
    config_snapshot_id: snapshotId,
    workflow_code: 'WF01',
    parent_operation_id: asText(envelope.parent_operation_id),
    status: 'PREPARED',
    commit_state: 'PREPARED',
    attempt_number: String(Number(existingOperation?.attempt_number ?? 0) + 1),
    retryable: false,
    error_code: '',
    error_id: '',
    started_at: asText(existingOperation?.started_at) || now,
    created_at: asText(existingOperation?.created_at) || now,
    updated_at: now,
  };
  const preparedOperationRow = projectSheetRow('OPERATION', { ...existingOperation, ...operationValues });
  const committedOperationRow = projectSheetRow('OPERATION', {
    ...preparedOperationRow,
    status: 'COMMITTED',
    commit_state: 'COMMITTED',
    committed_at: now,
    updated_at: now,
  });
  const versionHistoryId = `cfgver-${sha256(canonicalJson({ branch_scope: branchScope, table_set: tableSet, config_version: configVersion, config_fingerprint: fingerprint })).slice(0, 24)}`;
  const versionHistoryRow = projectSheetRow('CONFIG_VERSION', {
    ...versionRow,
    config_version_id: versionHistoryId,
    config_version: configVersion,
    schema_version: schemaVersion,
    config_snapshot_id: snapshotId,
    generated_at: now,
    generated_by: asText(envelope.actor_user_id) || asText(versionRow.generated_by),
    content_fingerprint: fingerprint,
    status: 'ACTIVE',
  });
  const snapshotValues = {
    config_snapshot_id: snapshotId,
    config_version: configVersion,
    schema_version: schemaVersion,
    config_fingerprint: fingerprint,
    branch_scope: branchScope,
    normalized_config_json: storedNormalizedConfigJson,
    operation_id: operationId,
    status: 'PREPARED',
    created_at: now,
    created_by: asText(envelope.actor_user_id),
    source_revision: asText(versionRow.source_revision),
  };
  const snapshotRow = projectSheetRow('CONFIG_SNAPSHOT', snapshotValues);
  const existingVersionHistory = (tableRows(tables, 'CONFIG_VERSION') ?? []).find((row) => asText(row.config_version_id) === versionHistoryId);
  const existingSnapshot = (tableRows(tables, 'CONFIG_SNAPSHOT') ?? []).find((row) => asText(row.config_snapshot_id) === snapshotId);
  if (existingVersionHistory && (asText(existingVersionHistory.config_snapshot_id) !== snapshotId
    || asText(existingVersionHistory.content_fingerprint) !== fingerprint)) {
    return decorateFailure(makeFailure('CONFIG_VERSION_SCOPE_MISMATCH', 'The deterministic accepted-version identity is already linked to different content', normalizedEnvelope, { config_version_id: versionHistoryId }));
  }
  if (existingSnapshot && (asText(existingSnapshot.operation_id) !== operationId
    || asText(existingSnapshot.config_fingerprint) !== fingerprint)) {
    return decorateFailure(makeFailure('CONFIG_SNAPSHOT_SCOPE_MISMATCH', 'The deterministic snapshot identity is already linked to different content', normalizedEnvelope, { config_snapshot_id: snapshotId }));
  }
  const writePlan = [];
  if (!existingOperation || !['PREPARED', 'RUNNING', 'RETRYING'].includes(asText(existingOperation.status).toUpperCase())) {
    writePlan.push({ sheet: 'OPERATION', action: 'APPEND', row: preparedOperationRow });
  }
  if (!existingVersionHistory) writePlan.push({ sheet: 'CONFIG_VERSION', action: 'APPEND', row: versionHistoryRow });
  if (!existingSnapshot) writePlan.push({ sheet: 'CONFIG_SNAPSHOT', action: 'APPEND', row: snapshotRow });
  writePlan.push({
    sheet: 'OPERATION', action: 'UPDATE', match: { idempotency_key: idempotencyKey },
    patch: { status: 'COMMITTED', commit_state: 'COMMITTED', committed_at: now, updated_at: now },
    row: committedOperationRow,
  });
  return {
    ok: true,
    response: statusResponse({ envelope: normalizedEnvelope, versionRow, configVersion, schemaVersion, snapshotId, fingerprint, activeBranches, messages, configTables: requestedConfigTables(tables, requested, branchScope), contextTables: contextConfigTables(tables, requested) }),
    write_plan: writePlan,
    diagnostics: {
      normalized_config_json: normalizedConfigJson,
      snapshot_storage_format: storedNormalizedConfigJson === normalizedConfigJson ? 'json-v1' : SNAPSHOT_FORMAT,
      reused_snapshot: false,
      ...headerDiagnostics,
    },
  };
}



export { evaluateConfigGateway, normalizeEnvelope, expandSnapshotPayload, canonicalJson, sha256, extractSheetValueRange };
