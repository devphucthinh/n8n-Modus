import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('exports an inactive ten-minute dispatcher without a Telegram Trigger', async () => {
  const workflow = JSON.parse(await readFile(path.join(root, 'workflows', 'WF04_V2_DISPATCHER.json'), 'utf8'));
  const scheduleTrigger = workflow.nodes.find((node) => node.type === 'n8n-nodes-base.scheduleTrigger');
  const gatewayCall = workflow.nodes.find((node) => node.name === 'Call Config Gateway');
  const code = workflow.nodes
    .filter((node) => node.type === 'n8n-nodes-base.code')
    .map((node) => node.parameters?.jsCode ?? '')
    .join('\n');

  assert.equal(workflow.active, false);
  assert.ok(scheduleTrigger);
  assert.deepEqual(scheduleTrigger.parameters.rule.interval, [{ field: 'minutes', minutesInterval: 10 }]);
  assert.equal(workflow.nodes.some((node) => node.type === 'n8n-nodes-base.telegramTrigger'), false);
  assert.equal(gatewayCall.parameters.workflowId.value, 'PASTE_WF01_WORKFLOW_ID');
  assert.match(code, /SCHEDULED_JOB/);
  assert.match(code, /DISPATCH_HISTORY/);
  assert.match(code, /ATOMIC_CLAIM/);
  assert.match(code, /atomic_claims/);
});
