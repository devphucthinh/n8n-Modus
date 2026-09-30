import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { schemaManifest } from '../../tools/kiem-ke-bia-v2/schema-manifest.mjs';
import { syntheticConfiguration, syntheticEnvelope } from './fixtures/configuration.mjs';

const contracts = () => import(process.env.KKB_TEST_CONTRACTS_MODULE ?? '../../src/kiem-ke-bia-v2/contracts.mjs');
const emitter = () => import('../../src/kiem-ke-bia-v2/n8n-code.mjs');

test('synthetic configuration fixture uses schemaManifest sheet headers', () => {
  for (const [name, rows] of Object.entries(syntheticConfiguration)) {
    const sheet = schemaManifest.sheets.find((entry) => entry.name === name);
    assert.ok(sheet, name);
    for (const row of rows) assert.deepEqual(Object.keys(row), sheet.headers);
  }
});

test('synthetic configuration fixture satisfies manifest values and references', () => {
  for (const [name, rows] of Object.entries(syntheticConfiguration)) {
    const sheet = schemaManifest.sheets.find((entry) => entry.name === name);
    for (const row of rows) {
      for (const field of sheet.fields) {
        const value = row[field.name];
        if (field.required) assert.ok(value !== '' && value !== null && value !== undefined, `${name}.${field.name} is required`);
        if (value === '' || value === null || value === undefined) continue;
        if (Array.isArray(field.allowed)) assert.ok(field.allowed.includes(value), `${name}.${field.name} is allowed`);
        if (field.type === 'text') assert.equal(typeof value, 'string', `${name}.${field.name} is text`);
        if (field.type === 'boolean') assert.equal(typeof value, 'boolean', `${name}.${field.name} is boolean`);
        if (field.type === 'number') assert.ok(typeof value === 'number' && Number.isFinite(value), `${name}.${field.name} is finite number`);
        if (field.type === 'date') assert.match(value, /^\d{4}-\d{2}-\d{2}$/, `${name}.${field.name} is date`);
        if (field.type === 'datetime') {
          assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/, `${name}.${field.name} is UTC datetime`);
          assert.ok(!Number.isNaN(Date.parse(value)), `${name}.${field.name} is datetime`);
        }
        if (field.reference) {
          const [targetSheet, targetField] = field.reference.split('.');
          const targets = syntheticConfiguration[targetSheet];
          assert.ok(targets, `${name}.${field.name} has fixture target ${targetSheet}`);
          assert.ok(targets.some((target) => target[targetField] === value), `${name}.${field.name} references ${targetSheet}.${targetField}`);
        }
      }
    }
  }
});

test('CONFIG_BIA exposes the per-item count precision, step, and bounds as numeric configuration', () => {
  const sheet = schemaManifest.sheets.find((entry) => entry.name === 'CONFIG_BIA');
  for (const name of ['decimal_places', 'quantity_step', 'minimum_quantity', 'maximum_quantity']) {
    const field = sheet.fields.find((entry) => entry.name === name);
    assert.ok(field, `CONFIG_BIA.${name} exists`);
    assert.equal(field.type, 'number', `CONFIG_BIA.${name} is numeric`);
    assert.equal(field.required, true, `CONFIG_BIA.${name} is required`);
  }
});

test('invoice and error references are nullable on rows that do not belong to those entities', () => {
  const field = (sheetName, fieldName) => schemaManifest.sheets.find((entry) => entry.name === sheetName).fields.find((entry) => entry.name === fieldName);
  const stateInvoice = field('STATE_CHO', 'invoice_id');
  const operationError = field('OPERATION', 'error_id');

  assert.equal(stateInvoice.required, false);
  assert.equal(stateInvoice.reference, 'HOA_DON_NHAP.invoice_id');
  assert.equal(operationError.required, false);
  assert.equal(operationError.reference, 'ERROR_BIA.error_id');
});

test('valid envelope preserves supplied identifiers and adds workflow code', async () => {
  const { normalizeEnvelope } = await contracts();
  assert.deepEqual(normalizeEnvelope(syntheticEnvelope, 'WF06'), {
    ok: true, envelope: { ...syntheticEnvelope, workflow_code: 'WF06' },
  });
});

test('missing operation identifier is rejected instead of fabricated', async () => {
  const { normalizeEnvelope } = await contracts();
  const { operation_id, ...input } = syntheticEnvelope;
  const result = normalizeEnvelope(input, 'WF06');
  assert.equal(result.ok, false);
  assert.equal(result.error.error_code, 'INVALID_ENVELOPE');
  assert.equal(result.error.error_class, 'VALIDATION');
  assert.equal(result.error.field, 'operation_id');
  assert.equal(JSON.stringify(result).includes('CONFIGURE'), false);
});

test('stable replay key repeats for the same event and changes for another', async () => {
  const { stableKey } = await contracts();
  const first = stableKey(['WF06', 'branch-synthetic-1', 'session-synthetic-1', 0]);
  assert.equal(first, stableKey(['WF06', 'branch-synthetic-1', 'session-synthetic-1', 0]));
  assert.notEqual(first, stableKey(['WF06', 'branch-synthetic-1', 'session-synthetic-2', 0]));
  assert.notEqual(first, stableKey(['WF06', 'branch-synthetic-1', 'session-synthetic-1', 1]));
  assert.ok(typeof first === 'string' && first.length > 0);
});

test('stable replay key matches a SHA-256 vector for canonical UTF-8 event parts', async () => {
  const { stableKey } = await contracts();
  assert.equal(stableKey(['abc']), 'kkb2_sha256_02f393ea9358560882c1fe797bf99d600aa4643a68276d8e3d714d1c4f19aecc');
  assert.equal(stableKey(['đếm', '😀']), 'kkb2_sha256_e512ab250315572ccf34e1803535e66c121df4c2bf49ceb99589b46ee5c188f0');
});

test('success returns common result fields without copying the raw payload', async () => {
  const { success } = await contracts();
  const result = success({ ...syntheticEnvelope, workflow_code: 'WF06' }, 'PREVIEW', { count: 0 }, []);
  assert.equal(result.ok, true);
  assert.equal(result.request_id, syntheticEnvelope.request_id);
  assert.equal(result.operation_id, syntheticEnvelope.operation_id);
  assert.equal(result.config_snapshot_id, syntheticEnvelope.config_snapshot_id);
  assert.equal(result.status, 'PREVIEW');
  assert.deepEqual(result.data, { count: 0 });
  assert.deepEqual(result.warnings, []);
  assert.equal('payload' in result, false);
});

test('failure redacts secret and raw payload even when error carries them', async () => {
  const { failure } = await contracts();
  const secret = 'synthetic-secret-never-return';
  const result = failure({ ...syntheticEnvelope, workflow_code: 'WF06' }, {
    error_code: 'BAD_COUNT', error_class: 'VALIDATION', retryable: false,
    message: `Bearer ${secret}`, message_safe: `Bearer ${secret}`,
    raw_payload: { token: secret }, stack: `stack ${secret}`, node_name: 'Validate Count',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'BAD_COUNT');
  assert.equal(result.error_class, 'VALIDATION');
  assert.equal(result.retryable, false);
  assert.equal(result.workflow_code, 'WF06');
  assert.equal(result.operation_id, syntheticEnvelope.operation_id);
  assert.equal(result.config_snapshot_id, syntheticEnvelope.config_snapshot_id);
  assert.equal(typeof result.message_safe, 'string');
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes('raw_payload'), false);
  assert.equal(JSON.stringify(result).includes('stack'), false);
});

test('failure maps an untrusted uppercase error code to a fixed safe fallback', async () => {
  const { failure } = await contracts();
  const secret = 'SYNTHETIC_SECRET_NEVER_RETURN';
  const result = failure({ ...syntheticEnvelope, workflow_code: 'WF06' }, {
    error_code: secret, error_class: 'SYSTEM', retryable: false,
  });
  assert.equal(result.error_code, 'UNEXPECTED_ERROR');
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('emitted source executes the imported function against a literal VM input', async () => {
  const { normalizeEnvelope } = await contracts();
  const { buildCodeNodeSource } = await emitter();
  const literalInput = { envelope_version: 'v2', request_id: 'req-vm-1', operation_id: 'op-vm-1', event_type: 'COUNT_SUBMITTED', branch_id: 'branch-vm-1', config_snapshot_id: 'snapshot-vm-1', payload: {}, reply_target: {} };
  const entryPoint = function evaluate(input) { return normalizeEnvelope(input, 'WF06'); };
  const source = buildCodeNodeSource(entryPoint, [normalizeEnvelope]);
  const actual = vm.runInNewContext(`(function () { ${source} })()`, { $input: { first: () => ({ json: literalInput }) } });
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), [{ json: normalizeEnvelope(literalInput, 'WF06') }]);
});

test('emitted stableKey matches imported SHA-256 for a literal VM event', async () => {
  const { sha256Hex, stableKey } = await contracts();
  const { buildCodeNodeSource } = await emitter();
  const entryPoint = function keyForEvent(input) { return stableKey(input.parts); };
  const source = buildCodeNodeSource(entryPoint, [sha256Hex, stableKey]);
  const literalInput = { parts: ['đếm', '😀', { branch: 'branch-synthetic-1', count: 0 }] };
  const actual = vm.runInNewContext(`(function () { ${source} })()`, { $input: { first: () => ({ json: literalInput }) } });
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), [{ json: stableKey(literalInput.parts) }]);
  assert.equal(actual[0].json, 'kkb2_sha256_e2b902ff6298b0e05be6715bc565c097b2a6ee5a5dd8c434345a4f243ad01251');
});
