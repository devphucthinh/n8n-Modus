import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countEntryCode, returnCode as returnCountCode } from '../workflow-src/WF06_V2_NHAN_SO_DEM.mjs';
import { openSessionCode, returnCode as returnSessionCode } from '../workflow-src/WF05_V2_MO_PHIEN_KIEM_KE.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'workflows');

const id = (name) => `kkb-v2-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
const node = ({ name, type, typeVersion = 2, parameters = {}, position = [0, 0], notes }) => ({
  parameters,
  id: id(name),
  name,
  type,
  typeVersion,
  position,
  ...(notes ? { notes } : {}),
});

function executeTrigger() {
  return node({ name: 'Execute Workflow Trigger', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1 });
}

function gatewayCall() {
  return node({
    name: 'Call Config Gateway',
    type: 'n8n-nodes-base.executeWorkflow',
    typeVersion: 1.2,
    parameters: {
      workflowId: { __rl: true, value: 'PASTE_WF01_WORKFLOW_ID', mode: 'id' },
      options: { waitForSubWorkflow: true },
    },
    position: [280, 0],
    notes: 'V2 technical placeholder; select WF01_V2_CONFIG_GATEWAY after import. Keep inactive for shadow validation.',
  });
}

function code(name, jsCode, position) {
  return node({ name, type: 'n8n-nodes-base.code', parameters: { jsCode }, position });
}

function workflow(name, nodes, connections) {
  return {
    name,
    nodes,
    connections,
    active: false,
    settings: { executionOrder: 'v1' },
    versionId: id(`${name}-version`),
    meta: { templateCredsSetupCompleted: false },
    pinData: {},
    tags: [],
  };
}

const wf05Trigger = executeTrigger();
const wf05Gateway = gatewayCall();
const wf05Open = code('Open or Reuse Inventory Session', await openSessionCode(), [560, 0]);
const wf05Return = code('Return Inventory Session Result', returnSessionCode(), [840, 0]);
const wf05 = workflow('WF05_V2_MO_PHIEN_KIEM_KE', [wf05Trigger, wf05Gateway, wf05Open, wf05Return], {
  [wf05Trigger.name]: { main: [[{ node: wf05Gateway.name, type: 'main', index: 0 }]] },
  [wf05Gateway.name]: { main: [[{ node: wf05Open.name, type: 'main', index: 0 }]] },
  [wf05Open.name]: { main: [[{ node: wf05Return.name, type: 'main', index: 0 }]] },
});

const wf06Trigger = executeTrigger();
const wf06Gateway = gatewayCall();
const wf06Count = code('Handle Count Entry', await countEntryCode(), [560, 0]);
const wf06Return = code('Return Count Entry Result', returnCountCode(), [840, 0]);
const wf06 = workflow('WF06_V2_NHAN_SO_DEM', [wf06Trigger, wf06Gateway, wf06Count, wf06Return], {
  [wf06Trigger.name]: { main: [[{ node: wf06Gateway.name, type: 'main', index: 0 }]] },
  [wf06Gateway.name]: { main: [[{ node: wf06Count.name, type: 'main', index: 0 }]] },
  [wf06Count.name]: { main: [[{ node: wf06Return.name, type: 'main', index: 0 }]] },
});

await mkdir(outputDir, { recursive: true });
for (const item of [wf05, wf06]) {
  await writeFile(path.join(outputDir, `${item.name}.json`), `${JSON.stringify(item, null, 2)}\n`, 'utf8');
}
console.log('Built workflows/WF05_V2_MO_PHIEN_KIEM_KE.json and workflows/WF06_V2_NHAN_SO_DEM.json');
