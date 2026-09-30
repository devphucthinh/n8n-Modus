import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_SHEET_DEFINITIONS } from '../../src/contracts/core-sheet-schema.mjs';
import {
  expectedLedgerSchemaRule,
  validateLedgerRows,
  validateLedgerSchema,
} from '../../src/contracts/validate-ledger-schema.mjs';

function declarations(sheetNames) {
  return sheetNames.flatMap((sheet_name) => ALL_SHEET_DEFINITIONS[sheet_name].map((column_name, index) => ({
    schema_rule_id: `${sheet_name}-${column_name}`,
    schema_version: '2',
    sheet_name,
    column_name,
    ...expectedLedgerSchemaRule(sheet_name, column_name),
    required: 'NO',
    reference_sheet: '',
    reference_column: '',
    allowed_values: '',
    ordinal: String(index + 1),
    description_vi: '',
    trang_thai: 'ACTIVE',
  })));
}

function completeRow(sheet, overrides = {}) {
  return { ...Object.fromEntries(ALL_SHEET_DEFINITIONS[sheet].map((column) => [column, ''])), ...overrides };
}

test('complete active schema declarations authorize empty ledgers', () => {
  const sheetNames = ['DISPATCH_HISTORY', 'HEARTBEAT', 'PHIEN_KIEM_KE', 'OPERATION', 'EVENT_LOG'];
  assert.deepEqual(validateLedgerSchema({
    schemaRows: declarations(sheetNames),
    tables: Object.fromEntries(sheetNames.map((sheet) => [sheet, []])),
    requiredSheets: sheetNames,
  }), { ok: true });
});

test('missing, inactive, or duplicate declarations cannot authorize a ledger write', () => {
  const schemaRows = declarations(['DISPATCH_HISTORY']);
  const sheet = 'DISPATCH_HISTORY';
  const column = ALL_SHEET_DEFINITIONS[sheet][0];
  const tables = { [sheet]: [] };

  for (const rows of [
    schemaRows.filter((row) => row.column_name !== column),
    schemaRows.map((row) => row.column_name === column ? { ...row, trang_thai: 'INACTIVE' } : row),
    [...schemaRows, { ...schemaRows.find((row) => row.column_name === column) }],
  ]) {
    const result = validateLedgerSchema({ schemaRows: rows, tables, requiredSheets: [sheet] });
    assert.notEqual(result.ok, true);
    assert.equal(result.sheet_name, sheet);
    assert.equal(result.column_name, column);
  }
});

test('schema data types and immutable identity declarations must match the contract', () => {
  const sheet = 'DISPATCH_HISTORY';
  const schemaRows = declarations([sheet]);
  const tables = { [sheet]: [] };
  const key = schemaRows.find((row) => row.column_name === 'dispatch_key');

  assert.deepEqual(validateLedgerSchema({
    schemaRows: schemaRows.map((row) => row.column_name === 'updated_at' ? { ...row, data_type: 'STRING' } : row),
    tables,
    requiredSheets: [sheet],
  }), {
    ok: false, error_code: 'CONFIG_SCHEMA_TYPE_MISMATCH', sheet_name: sheet, column_name: 'updated_at',
  });
  assert.deepEqual(validateLedgerSchema({
    schemaRows: schemaRows.map((row) => row === key ? { ...row, unique_group: '' } : row),
    tables,
    requiredSheets: [sheet],
  }), {
    ok: false, error_code: 'CONFIG_SCHEMA_KEY_MISMATCH', sheet_name: sheet, column_name: 'dispatch_key',
  });
});

test('missing, inherited, or non-array ledger tables are not valid empty tables', () => {
  const schemaRows = declarations(['EVENT_LOG']);
  for (const tables of [undefined, null, {}, Object.create({ EVENT_LOG: [] }), { EVENT_LOG: null }, { EVENT_LOG: {} }]) {
    assert.deepEqual(validateLedgerSchema({ schemaRows, tables, requiredSheets: ['EVENT_LOG'] }), {
      ok: false, error_code: 'CONFIG_SHEET_MISSING', sheet_name: 'EVENT_LOG', column_name: null,
    });
  }
});

test('row validation checks observable prefixes without mutating data or claiming physical headers', () => {
  const sheet = 'HEARTBEAT';
  const row = { heartbeat_id: 'hb-test', heartbeat_at: '2026-09-23T16:50:00.000Z', status: 'HEALTHY', failure_count: '0', threshold: '3', critical_notified: 'NO' };
  const before = structuredClone(row);

  assert.deepEqual(validateLedgerRows({ tables: { [sheet]: [row] }, requiredSheets: [sheet] }), { ok: true });
  assert.deepEqual(row, before);
  assert.deepEqual(validateLedgerRows({ tables: { [sheet]: [completeRow(sheet)] }, requiredSheets: [sheet] }), { ok: true });
  assert.deepEqual(validateLedgerRows({ tables: { [sheet]: [null] }, requiredSheets: [sheet] }), {
    ok: false, error_code: 'CONFIG_COLUMN_MISSING', sheet_name: sheet, column_name: 'heartbeat_id',
  });
});

test('validation is bounded to declared sheets and rejects unknown sheet names', () => {
  assert.deepEqual(validateLedgerSchema({
    schemaRows: declarations(['EVENT_LOG']),
    tables: { EVENT_LOG: [], DISPATCH_HISTORY: [{}] },
    requiredSheets: ['EVENT_LOG'],
  }), { ok: true });

  for (const sheet of ['UNKNOWN_LEDGER', 'toString', 'constructor', '__proto__']) {
    assert.equal(validateLedgerSchema({ schemaRows: [], tables: { [sheet]: [] }, requiredSheets: [sheet] }).error_code, 'CONFIG_SHEET_MISSING');
  }
});
