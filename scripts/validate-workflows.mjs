import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableWorkerTargets } from '../src/telegram-router/worker-targets.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowDir = path.join(root, 'workflows');
const expected = ['WF01_V2_CONFIG_GATEWAY.json', 'WF02_V2_ERROR_HANDLER.json', 'WF03_V2_TELEGRAM_ROUTER.json'];
const googleSheetId = '1wQ76EpIx35Trkx5JZg8GZ0xZsEBcKAFA6eb7nKDvLu4';
const workflowTargets = new Map([
  ['Call Error Handler', 'WF02_V2_ERROR_HANDLER'],
  ['Call Config Gateway', 'WF01_V2_CONFIG_GATEWAY'],
  ['Call Config Gateway - Command Check', 'WF01_V2_CONFIG_GATEWAY'],
  ['Call Error Handler - Worker Failure', 'WF02_V2_ERROR_HANDLER'],
]);
for (const target of availableWorkerTargets()) workflowTargets.set(target.node_name, target.workflow_name);
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
      if (workflowTargets.has(node.name)) {
        const workflowId = node.parameters?.workflowId;
        const targetName = workflowTargets.get(node.name);
        if (workflowId?.value !== '' || workflowId?.mode !== 'list' || !node.notes?.includes(targetName)) {
          errors.push(`${filename}: Execute Workflow node ${node.name} must be an unselected workflow-list reference annotated with ${targetName}`);
        }
      }
      if (node.name.startsWith('Call Worker ') && node.onError !== 'continueErrorOutput') {
        errors.push(`${filename}: worker node ${node.name} must route thrown errors to the Error Handler path`);
      }
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
