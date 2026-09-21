import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCode } from '../../workflow-src/WF09_V2_BAO_CAO_BAN.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('WF09 sales ingestion export is inactive and has only an Execute Workflow Trigger', async () => {
  const workflow = JSON.parse(await readFile(path.join(root, 'workflows', 'WF09_V2_BAO_CAO_BAN.json'), 'utf8'));

  assert.equal(workflow.name, 'WF09_V2_BAO_CAO_BAN');
  assert.equal(workflow.active, false);
  assert.deepEqual(workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.executeWorkflowTrigger').map((node) => node.name), ['Execute Workflow Trigger']);
  assert.equal(workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.telegramTrigger').length, 0);
  assert.equal(workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.telegram').length, 0);
  assert.ok(workflow.nodes.some((node) => node.name === 'Normalize and Preview Sales File'));
  assert.ok(workflow.nodes.some((node) => node.name === 'Return Sales Ingestion Result'));
});

test('WF09 export contains no real credentials, tokens, or active state', async () => {
  const workflow = JSON.parse(await readFile(path.join(root, 'workflows', 'WF09_V2_BAO_CAO_BAN.json'), 'utf8'));
  const text = JSON.stringify(workflow);

  assert.doesNotMatch(text, /\b\d{8,}:[A-Za-z0-9_-]{20,}\b|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._-]+/);
  assert.doesNotMatch(text, /PASTE_TELEGRAM_BOT_TOKEN/);
});

test('WF09 source keeps missing-source files in CHO_SUA_FILE and exposes SYSTEM_ZERO intent', async () => {
  const source = await readFile(path.join(root, 'workflow-src', 'WF09_V2_BAO_CAO_BAN.mjs'), 'utf8');

  assert.match(source, /CHO_SUA_FILE/);
  assert.match(source, /payload\.intent.*SYSTEM_ZERO/);
});

async function runNormalize(input) {
  const code = await normalizeCode();
  return new Function('$input', code)({ first: () => ({ json: input }) })[0].json;
}

test('unmatched source is held in CHO_SUA_FILE before any publish plan', async () => {
  const result = await runNormalize({
    request_id: 'req-source-missing',
    operation_id: 'op-source-missing',
    payload: { sheet_name: 'Unknown', headers: ['X'], source_configs: [], source_columns: [], rows: [] },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'CHO_SUA_FILE');
  assert.equal(result.blocks_system_zero, true);
});

test('SYSTEM_ZERO intent reaches the version planner without a source file', async () => {
  const result = await runNormalize({
    request_id: 'req-zero',
    operation_id: 'op-zero',
    branch_id: 'CN1',
    payload: { intent: 'SYSTEM_ZERO', business_date: '2026-09-18', items: [] },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'SYSTEM_ZERO_REQUEST');
});
