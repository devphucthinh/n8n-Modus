import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowDir = path.join(root, 'workflows');
const expected = ['WF01_V2_CONFIG_GATEWAY.json', 'WF02_V2_ERROR_HANDLER.json', 'WF03_V2_TELEGRAM_ROUTER.json'];
const googleSheetId = '1wQ76EpIx35Trkx5JZg8GZ0xZsEBcKAFA6eb7nKDvLu4';
const workflowTargets = new Map([
  ['Call Error Handler', 'MoG6coBccYkIS0nK'],
  ['Call Config Gateway', 'WEL83s9bZeB3ixxF'],
  ['Call Config Gateway - Command Check', 'WEL83s9bZeB3ixxF'],
]);
const secretPattern = /\b\d{8,}:[A-Za-z0-9_-]{20,}\b|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._-]+/;
const errors = [];

const files = (await readdir(workflowDir)).filter((file) => file.endsWith('.json')).sort();
for (const filename of expected) {
  if (!files.includes(filename)) errors.push(`missing ${filename}`);
}
const workflows = [];
for (const filename of files) {
  try {
    const workflow = JSON.parse(await readFile(path.join(workflowDir, filename), 'utf8'));
    workflows.push(workflow);
    if (workflow.active !== false) errors.push(`${filename}: workflow must be inactive`);
    const ids = workflow.nodes.map((node) => node.id);
    if (new Set(ids).size !== ids.length) errors.push(`${filename}: duplicate node id`);
    const known = new Set(workflow.nodes.map((node) => node.name));
    for (const [from, connection] of Object.entries(workflow.connections ?? {})) {
      if (!known.has(from)) errors.push(`${filename}: connection source ${from} missing`);
      for (const output of connection.main ?? []) for (const target of output) if (!known.has(target.node)) errors.push(`${filename}: connection target ${target.node} missing`);
    }
    const text = JSON.stringify(workflow);
    if (secretPattern.test(text)) errors.push(`${filename}: possible secret detected`);
    for (const node of workflow.nodes) {
      if (node.type === 'n8n-nodes-base.googleSheets') {
        if (node.credentials?.googleSheetsOAuth2Api?.name !== 'GOOGLE_SHEETS_KKB_V2') errors.push(`${filename}: Google Sheets credential mismatch`);
        if (node.parameters?.documentId?.value !== googleSheetId) errors.push(`${filename}: Google Sheets node ${node.name} has an unexpected document ID`);
        if (node.parameters?.operation === 'read' && node.executeOnce !== true) errors.push(`${filename}: Google Sheets read node ${node.name} must execute once to prevent row fan-out`);
        if (JSON.stringify(node.parameters).includes('PASTE_TELEGRAM_BOT_TOKEN')) errors.push(`${filename}: Telegram token placeholder is forbidden`);
      }
      if (node.type === 'n8n-nodes-base.if') {
        const conditions = node.parameters?.conditions;
        if (conditions?.boolean || conditions?.string || conditions?.number) errors.push(`${filename}: IF node ${node.name} uses a legacy conditions schema`);
        if (conditions?.combinator !== 'and' || !Array.isArray(conditions?.conditions) || conditions.conditions.length === 0) errors.push(`${filename}: IF node ${node.name} has no n8n v2 conditions`);
        for (const condition of conditions?.conditions ?? []) {
          if (typeof condition.leftValue !== 'string' || condition.leftValue.trim() === '') errors.push(`${filename}: IF node ${node.name} has an empty leftValue`);
          if (!condition.operator || typeof condition.operator !== 'object') errors.push(`${filename}: IF node ${node.name} has no n8n v2 operator`);
        }
      }
      if (workflowTargets.has(node.name) && node.parameters?.workflowId?.value !== workflowTargets.get(node.name)) errors.push(`${filename}: Execute Workflow node ${node.name} has an unexpected workflow ID`);
      if (node.type === 'n8n-nodes-base.telegram' || node.type === 'n8n-nodes-base.telegramTrigger') {
        if (node.credentials?.telegramApi?.name !== 'TELEGRAM_KKB_V2') errors.push(`${filename}: Telegram credential mismatch`);
      }
      if (node.type === 'n8n-nodes-base.code' && /\b(?:import|export)\b/.test(node.parameters?.jsCode ?? '')) errors.push(`${filename}: Code node is not self-contained`);
      if (node.type === 'n8n-nodes-base.code') {
        try {
          // Parse the embedded Code node exactly as n8n will compile it. This
          // catches duplicate top-level declarations introduced by bundling.
          new Function(node.parameters?.jsCode ?? '');
        } catch (error) {
          errors.push(`${filename}: Code node ${node.name} has invalid JavaScript: ${error.message}`);
        }
      }
    }
    if (workflow.name === 'WF03_V2_TELEGRAM_ROUTER') {
      const nodeByName = new Map(workflow.nodes.map((node) => [node.name, node]));
      const worker = nodeByName.get('Execute Configured Worker');
      const workerInput = nodeByName.get('Prepare Worker Envelope');
      const workerCheck = nodeByName.get('Worker succeeded?');
      if (!worker || worker.type !== 'n8n-nodes-base.executeWorkflow') errors.push(`${filename}: missing configured worker Execute Workflow node`);
      if (worker && (worker.parameters?.workflowId?.mode !== 'id' || !/worker_workflow/.test(worker.parameters?.workflowId?.value ?? ''))) errors.push(`${filename}: worker target must be the workflow ID from CONFIG_LENH.worker_workflow`);
      if (worker && worker.parameters?.options?.waitForSubWorkflow !== true) errors.push(`${filename}: configured worker call must wait for completion`);
      if (worker && worker.onError !== 'continueErrorOutput') errors.push(`${filename}: configured worker errors must reach the failure path`);
      if (!workerInput || !/worker_envelope/.test(workerInput.parameters?.jsCode ?? '')) errors.push(`${filename}: missing standard worker envelope projection`);
      if (!workerCheck || !/ok\s*===\s*true/.test(workerCheck.parameters?.conditions?.conditions?.[0]?.leftValue ?? '')) errors.push(`${filename}: success reply must require explicit worker ok=true`);
      const outgoing = (name, output = 0) => (workflow.connections?.[name]?.main?.[output] ?? []).map((target) => target.node);
      if (!outgoing('Append OPERATION reservation').includes('Prepare Worker Envelope')) errors.push(`${filename}: reservation must precede worker dispatch`);
      if (!outgoing('Execute Configured Worker').includes('Worker succeeded?')) errors.push(`${filename}: worker result must be checked before success`);
      if (!outgoing('Worker succeeded?', 0).includes('Project OPERATION committed')) errors.push(`${filename}: successful workers must commit OPERATION`);
      if (!outgoing('Worker succeeded?', 1).includes('Prepare Worker Error Input') || !outgoing('Execute Configured Worker', 1).includes('Prepare Worker Error Input') || !outgoing('Call WF02 Error Handler', 0).includes('Project OPERATION failed')) errors.push(`${filename}: worker false/error results must be logged through WF02 and fail OPERATION`);
    }
  } catch (error) {
    errors.push(`${filename}: ${error.message}`);
  }
}
const triggers = workflows.flatMap((workflow) => workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.telegramTrigger'));
if (triggers.length !== 1) errors.push(`expected exactly one Telegram Trigger, got ${triggers.length}`);
if (!workflows.some((workflow) => workflow.name === 'WF03_V2_TELEGRAM_ROUTER')) errors.push('missing WF03 router');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Validated ${workflows.length} workflows`);
}
