import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCode, planCode, returnCode } from '../workflow-src/WF09_V2_BAO_CAO_BAN.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'workflows');

const id = (name) => `kkb-v2-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
const node = ({ name, type, typeVersion = 2, parameters = {}, position = [0, 0] }) => ({
  parameters,
  id: id(name),
  name,
  type,
  typeVersion,
  position,
});
const trigger = node({ name: 'Execute Workflow Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 0] });
const normalize = node({ name: 'Normalize and Preview Sales File', type: 'n8n-nodes-base.code', parameters: { jsCode: await normalizeCode() }, position: [300, 0] });
const plan = node({ name: 'Plan Versioned Sales Publish', type: 'n8n-nodes-base.code', parameters: { jsCode: await planCode() }, position: [620, 0] });
const result = node({ name: 'Return Sales Ingestion Result', type: 'n8n-nodes-base.code', parameters: { jsCode: returnCode() }, position: [920, 0] });

const workflow = {
  name: 'WF09_V2_BAO_CAO_BAN',
  nodes: [trigger, normalize, plan, result],
  connections: {
    [trigger.name]: { main: [[{ node: normalize.name, type: 'main', index: 0 }]] },
    [normalize.name]: { main: [[{ node: plan.name, type: 'main', index: 0 }]] },
    [plan.name]: { main: [[{ node: result.name, type: 'main', index: 0 }]] },
  },
  active: false,
  settings: { executionOrder: 'v1' },
  versionId: id('WF09_V2_BAO_CAO_BAN-version'),
  meta: { templateCredsSetupCompleted: false },
  pinData: {},
  tags: [],
};

await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, 'WF09_V2_BAO_CAO_BAN.json'), `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
console.log('Built workflows/WF09_V2_BAO_CAO_BAN.json');
