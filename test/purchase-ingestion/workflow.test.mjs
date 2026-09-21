import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('WF08_V2_HOA_DON_NHAP is inactive and has only an Execute Workflow Trigger', async () => {
  const workflow = JSON.parse(await readFile(path.join(root, 'workflows', 'WF08_V2_HOA_DON_NHAP.json'), 'utf8'));
  const triggers = workflow.nodes.filter(({ type }) => type.includes('Trigger'));
  const serialized = JSON.stringify(workflow);

  assert.equal(workflow.name, 'WF08_V2_HOA_DON_NHAP');
  assert.equal(workflow.active, false);
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].type, 'n8n-nodes-base.executeWorkflowTrigger');
  assert.match(serialized, /GOOGLE_DRIVE_KKB_V2/);
  assert.match(serialized, /GEMINI_KKB_V2/);
  assert.match(serialized, /PASTE_WF01_WORKFLOW_ID/);
  assert.doesNotMatch(serialized, /\b\d{8,}:[A-Za-z0-9_-]{20,}\b|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._-]+/);
});
