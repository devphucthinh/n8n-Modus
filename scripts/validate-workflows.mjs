import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowDir = path.join(root, 'workflows');
const expected = ['WF01_V2_CONFIG_GATEWAY.json', 'WF02_V2_ERROR_HANDLER.json', 'WF03_V2_TELEGRAM_ROUTER.json'];
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
        if (JSON.stringify(node.parameters).includes('PASTE_TELEGRAM_BOT_TOKEN')) errors.push(`${filename}: Telegram token placeholder is forbidden`);
      }
      if (node.type === 'n8n-nodes-base.telegram' || node.type === 'n8n-nodes-base.telegramTrigger') {
        if (node.credentials?.telegramApi?.name !== 'TELEGRAM_KKB_V2') errors.push(`${filename}: Telegram credential mismatch`);
      }
      if (node.type === 'n8n-nodes-base.code' && /\b(?:import|export)\b/.test(node.parameters?.jsCode ?? '')) errors.push(`${filename}: Code node is not self-contained`);
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
