import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowDir = path.join(root, 'workflows');

async function loadGeneratedWorkflows() {
  const files = (await readdir(workflowDir)).filter((file) => file.endsWith('.json')).sort();
  return Promise.all(files.map(async (file) => JSON.parse(await readFile(path.join(workflowDir, file), 'utf8'))));
}

test('exports exactly one Telegram Trigger across the V2 workflows', async () => {
  const workflows = await loadGeneratedWorkflows();
  const v2 = workflows.filter((workflow) => workflow.name.startsWith('WF0'));
  const triggers = v2.flatMap((workflow) => workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.telegramTrigger'));
  assert.equal(triggers.length, 1);
  assert.equal(workflows.find((workflow) => workflow.name === 'WF03_V2_TELEGRAM_ROUTER').active, false);
});

test('exports contain placeholders and credential names but no secrets', async () => {
  const workflows = await loadGeneratedWorkflows();
  const text = JSON.stringify(workflows);
  assert.match(text, /PASTE_GOOGLE_SHEET_ID/);
  assert.match(text, /GOOGLE_SHEETS_KKB_V2/);
  assert.match(text, /TELEGRAM_KKB_V2/);
  assert.doesNotMatch(text, /\b\d{8,}:[A-Za-z0-9_-]{20,}\b|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._-]+/);
});

test('exports stage and target immutable ledger rows', async () => {
  const workflows = await loadGeneratedWorkflows();
  const gateway = workflows.find((workflow) => workflow.name === 'WF01_V2_CONFIG_GATEWAY');
  const snapshotCommit = gateway.nodes.find((node) => node.name === 'Commit CONFIG_SNAPSHOT');
  const operationCommit = gateway.nodes.find((node) => node.name === 'Commit OPERATION');
  assert.deepEqual(snapshotCommit.parameters.columns.matchingColumns, ['config_snapshot_id']);
  assert.deepEqual(operationCommit.parameters.columns.matchingColumns, ['operation_id']);
  assert.deepEqual(operationCommit.parameters.columns.schema.map((column) => column.id), ['operation_id', 'status', 'actual_row_count', 'updated_at']);
  assert.ok(gateway.nodes.some((node) => node.name === 'Prepare CONFIG_SNAPSHOT row'));

  const errorWorkflow = workflows.find((workflow) => workflow.name === 'WF02_V2_ERROR_HANDLER');
  assert.ok(errorWorkflow.nodes.some((node) => node.name === 'Project ERROR_BIA row'));
});

test('keeps live configuration reads behind the Config Gateway', async () => {
  const workflows = await loadGeneratedWorkflows();
  const router = workflows.find((workflow) => workflow.name === 'WF03_V2_TELEGRAM_ROUTER');
  assert.equal(router.nodes.filter((node) => node.type === 'n8n-nodes-base.googleSheets').length, 0);
  const gateway = workflows.find((workflow) => workflow.name === 'WF01_V2_CONFIG_GATEWAY');
  const reads = gateway.nodes.filter((node) => node.name.startsWith('Read '));
  assert.equal(reads.length, 9);
  assert.ok(reads.every((node) => node.alwaysOutputData === true));
  assert.deepEqual(gateway.connections['Read ERROR_BIA'].main[0].map((target) => target.node), ['Assemble Config Tables']);
  assert.deepEqual(gateway.connections['Execute Workflow Trigger'].main[0].map((target) => target.node), ['Read CONFIG_SCHEMA']);
});
