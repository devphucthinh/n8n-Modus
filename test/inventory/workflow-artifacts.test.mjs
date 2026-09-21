import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowFiles = [
  'workflows/WF05_V2_MO_PHIEN_KIEM_KE.json',
  'workflows/WF06_V2_NHAN_SO_DEM.json',
];

test('exports inactive inventory workers with Execute Workflow Trigger only', async () => {
  const workflows = await Promise.all(workflowFiles.map(async (file) => JSON.parse(await readFile(file, 'utf8'))));

  for (const workflow of workflows) {
    assert.equal(workflow.active, false, workflow.name);
    assert.ok(workflow.nodes.some((node) => node.type === 'n8n-nodes-base.executeWorkflowTrigger'), workflow.name);
    assert.equal(workflow.nodes.some((node) => node.type === 'n8n-nodes-base.telegramTrigger'), false, workflow.name);
    assert.ok(workflow.nodes.some((node) => node.type === 'n8n-nodes-base.executeWorkflow'), workflow.name);
    assert.ok(workflow.nodes.some((node) => node.type === 'n8n-nodes-base.code'), workflow.name);
  }
});

test('inventory worker exports contain no credentials or live-write shortcuts', async () => {
  const text = await Promise.all(workflowFiles.map((file) => readFile(file, 'utf8'))).then((files) => files.join('\n'));
  assert.doesNotMatch(text, /PASTE_TELEGRAM_BOT_TOKEN|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._-]+/);
  assert.doesNotMatch(text, /googleSheetsOAuth2Api|telegramApi/);
  assert.match(text, /PASTE_WF01_WORKFLOW_ID/);
});
