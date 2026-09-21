import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatcherCode } from '../workflow-src/WF04_V2_DISPATCHER.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'workflows');
const GOOGLE_CREDENTIAL = 'GOOGLE_SHEETS_KKB_V2';

const id = (name) => `kkb-v2-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
const pos = (x, y) => [x, y];

function node({ name, type, typeVersion = 2, parameters = {}, position = [0, 0], credentials, notes }) {
  return {
    parameters,
    id: id(name),
    name,
    type,
    typeVersion,
    position,
    ...(credentials ? { credentials } : {}),
    ...(notes ? { notes } : {}),
  };
}

function googleSheetReadNode(name, sheetName) {
  return node({
    name,
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5,
    parameters: {
      operation: 'read',
      documentId: { __rl: true, value: 'PASTE_GOOGLE_SHEET_ID', mode: 'id' },
      sheetName: { __rl: true, value: sheetName, mode: 'name' },
      options: { returnAll: true },
    },
    credentials: { googleSheetsOAuth2Api: { name: GOOGLE_CREDENTIAL } },
  });
}

function link(connections, from, to) {
  connections[from] ??= { main: [[]] };
  connections[from].main[0].push({ node: to, type: 'main', index: 0 });
}

const trigger = node({
  name: 'Schedule Trigger',
  type: 'n8n-nodes-base.scheduleTrigger',
  typeVersion: 1.2,
  parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] } },
  position: pos(0, 0),
});
const envelope = node({
  name: 'Create Dispatcher Envelope',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  parameters: {
    jsCode: `const input = $('Schedule Trigger').first()?.json ?? {};\nconst tickAt = input.tick_at ?? input.timestamp ?? new Date().toISOString();\nconst tick = new Date(tickAt);\ntick.setUTCSeconds(0, 0);\ntick.setUTCMinutes(Math.floor(tick.getUTCMinutes() / 10) * 10);\nconst tickKey = tick.toISOString();\nreturn [{ json: { envelope: {\n  request_id: 'req-dispatch-' + tickKey,\n  operation_id: 'op-dispatch-tick-' + tickKey.replace(/[^0-9A-Z]/gi, ''),\n  event_type: 'SCHEDULED_JOB',\n  actor_user_id: 'SYSTEM',\n  branch_id: null,\n  business_date: null,\n  config_version: null,\n  payload: { intent: 'READ_STATUS', tick_at: tickAt }\n} } }];`,
  },
  position: pos(280, 0),
});
const gateway = node({
  name: 'Call Config Gateway',
  type: 'n8n-nodes-base.executeWorkflow',
  typeVersion: 1.2,
  parameters: {
    workflowId: { __rl: true, value: 'PASTE_WF01_WORKFLOW_ID', mode: 'id' },
    options: { waitForSubWorkflow: true },
  },
  position: pos(560, 0),
  notes: 'V2 technical placeholder; select WF01_V2_CONFIG_GATEWAY after import. The gateway must expose the normalized dispatcher tables in its response snapshot.',
});
const history = googleSheetReadNode('Read DISPATCH_HISTORY', 'DISPATCH_HISTORY');
history.position = pos(820, 0);
history.notes = 'Operational history read; corrections are append-only and must not edit committed rows directly.';
const plan = node({
  name: 'Assemble Dispatcher Plan',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  parameters: { jsCode: await dispatcherCode() },
  position: pos(1080, 0),
});
const output = node({
  name: 'Return Dispatch Plan',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  parameters: { jsCode: "const result = $('Assemble Dispatcher Plan').first()?.json ?? {}; return [{ json: result }];" },
  position: pos(1340, 0),
});

const connections = {};
link(connections, trigger.name, envelope.name);
link(connections, envelope.name, gateway.name);
link(connections, gateway.name, history.name);
link(connections, history.name, plan.name);
link(connections, plan.name, output.name);

const workflow = {
  name: 'WF04_V2_DISPATCHER',
  nodes: [trigger, envelope, gateway, history, plan, output],
  connections,
  active: false,
  settings: { executionOrder: 'v1' },
  versionId: id('WF04_V2_DISPATCHER-version'),
  meta: { templateCredsSetupCompleted: false },
  pinData: {},
  tags: [],
};

await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, 'WF04_V2_DISPATCHER.json'), `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
console.log('Built workflows/WF04_V2_DISPATCHER.json');
