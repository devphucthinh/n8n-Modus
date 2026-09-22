import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowDir = path.join(root, 'workflows');
const GOOGLE_SHEET_ID = '1wQ76EpIx35Trkx5JZg8GZ0xZsEBcKAFA6eb7nKDvLu4';
const WF01_WORKFLOW_ID = 'WEL83s9bZeB3ixxF';
const WF02_WORKFLOW_ID = 'MoG6coBccYkIS0nK';

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

test('exports contain the configured Sheet ID and credential names but no secrets', async () => {
  const workflows = await loadGeneratedWorkflows();
  const text = JSON.stringify(workflows);
  assert.doesNotMatch(text, /PASTE_GOOGLE_SHEET_ID/);
  const sheetNodes = workflows.flatMap((workflow) => workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.googleSheets'));
  assert.ok(sheetNodes.length > 0);
  assert.ok(sheetNodes.every((node) => node.parameters.documentId?.value === GOOGLE_SHEET_ID));
  assert.match(text, /GOOGLE_SHEETS_KKB_V2/);
  assert.match(text, /TELEGRAM_KKB_V2/);
  assert.doesNotMatch(text, /\b\d{8,}:[A-Za-z0-9_-]{20,}\b|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._-]+/);
});

test('exports every IF node with the n8n v2 conditions schema', async () => {
  const workflows = await loadGeneratedWorkflows();
  const ifNodes = workflows.flatMap((workflow) => workflow.nodes.filter((node) => node.type === 'n8n-nodes-base.if'));
  assert.ok(ifNodes.length > 0);
  for (const node of ifNodes) {
    const conditions = node.parameters?.conditions;
    assert.equal(conditions?.boolean, undefined, `${node.name} uses legacy boolean conditions`);
    assert.equal(conditions?.string, undefined, `${node.name} uses legacy string conditions`);
    assert.equal(conditions?.number, undefined, `${node.name} uses legacy number conditions`);
    assert.equal(conditions?.combinator, 'and', `${node.name} has no v2 combinator`);
    assert.ok(Array.isArray(conditions?.conditions) && conditions.conditions.length > 0, `${node.name} has no v2 conditions`);
    for (const condition of conditions.conditions) {
      assert.equal(typeof condition.leftValue, 'string', `${node.name} has no leftValue`);
      assert.notEqual(condition.leftValue.trim(), '', `${node.name} has an empty leftValue`);
      assert.equal(typeof condition.operator, 'object', `${node.name} has no v2 operator`);
    }
  }
});

test('exports the current n8n Cloud workflow dependencies without manual placeholders', async () => {
  const workflows = await loadGeneratedWorkflows();
  const text = JSON.stringify(workflows);
  assert.doesNotMatch(text, /PASTE_WF0[12]_WORKFLOW_ID/);

  const gateway = workflows.find((workflow) => workflow.name === 'WF01_V2_CONFIG_GATEWAY');
  const errorCall = gateway.nodes.find((node) => node.name === 'Call Error Handler');
  assert.equal(errorCall.parameters.workflowId?.value, WF02_WORKFLOW_ID);

  const router = workflows.find((workflow) => workflow.name === 'WF03_V2_TELEGRAM_ROUTER');
  for (const name of ['Call Config Gateway', 'Call Config Gateway - Command Check']) {
    const gatewayCall = router.nodes.find((node) => node.name === name);
    assert.equal(gatewayCall.parameters.workflowId?.value, WF01_WORKFLOW_ID);
  }
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
  assert.equal(router.nodes.filter((node) => node.type === 'n8n-nodes-base.googleSheets' && node.parameters.operation === 'read').length, 0);
  const gateway = workflows.find((workflow) => workflow.name === 'WF01_V2_CONFIG_GATEWAY');
  const reads = gateway.nodes.filter((node) => node.name.startsWith('Read '));
  assert.equal(reads.length, 16);
  assert.ok(gateway.nodes.some((node) => node.name === 'Router tables requested?'));
  for (const sheet of ['CONFIG_ROLE', 'CONFIG_PERMISSION', 'CONFIG_USER_ROLE', 'CONFIG_ROLE_PERMISSION', 'CONFIG_TOPIC', 'CONFIG_LENH', 'EVENT_LOG']) {
    const selector = gateway.nodes.find((node) => node.name === `Router sheet ${sheet} requested?`);
    assert.ok(selector, `missing selector for ${sheet}`);
    assert.match(selector.parameters.conditions.conditions[0].leftValue, new RegExp(`includes\\('${sheet}'\\)`));
  }
  assert.ok(reads.every((node) => node.alwaysOutputData === true));
  assert.ok(reads.every((node) => node.executeOnce === true));
  assert.deepEqual(gateway.connections['Router sheet EVENT_LOG requested?'].main[1].map((target) => target.node), ['Assemble Config Tables']);
  assert.deepEqual(gateway.connections['Read EVENT_LOG'].main[0].map((target) => target.node), ['Assemble Config Tables']);
  assert.deepEqual(gateway.connections['Execute Workflow Trigger'].main[0].map((target) => target.node), ['Read CONFIG_SCHEMA']);
});

test('WF03 carries router table requests and keeps command policy Sheet-driven', async () => {
  const workflows = await loadGeneratedWorkflows();
  const router = workflows.find((workflow) => workflow.name === 'WF03_V2_TELEGRAM_ROUTER');
  assert.equal(router.nodes.filter((node) => node.type === 'n8n-nodes-base.telegramTrigger').length, 1);
  const decision = router.nodes.find((node) => node.name === 'Router Decision');
  assert.ok(decision);
  assert.match(decision.parameters.jsCode, /CONFIG_LENH/);
  const normalize = router.nodes.find((node) => node.name === 'Normalize Telegram Update');
  assert.ok(normalize.parameters.jsCode.includes('requiredSheetNames(normalized.command)'));
  assert.ok(normalize.parameters.jsCode.includes("if (normalized === '/help') return ['CONFIG_LENH']"));
  assert.doesNotMatch(JSON.stringify(router), /WF05_V2_MO_PHIEN_KIEM_KE|KIEM_KE_WRITE/);
  assert.ok(router.nodes.some((node) => node.name === 'Append EVENT_LOG'));
  assert.ok(router.nodes.some((node) => node.name === 'Append OPERATION reservation'));
  assert.ok(router.nodes.some((node) => node.name === 'Split Router Reply'));
  const reservation = router.nodes.find((node) => node.name === 'Append OPERATION reservation');
  const audit = router.nodes.find((node) => node.name === 'Append EVENT_LOG');
  assert.equal(reservation.parameters.operation, 'appendOrUpdate');
  assert.deepEqual(reservation.parameters.columns.matchingColumns, ['idempotency_key']);
  assert.equal(audit.parameters.operation, 'appendOrUpdate');
  assert.deepEqual(audit.parameters.columns.matchingColumns, ['event_id']);
});

test('WF03 preserves the reply after audit writes and acknowledges callback queries', async () => {
  const workflows = await loadGeneratedWorkflows();
  const router = workflows.find((workflow) => workflow.name === 'WF03_V2_TELEGRAM_ROUTER');
  assert.ok(router.nodes.some((node) => node.name === 'Restore Router Reply'));
  assert.deepEqual(router.connections['Append EVENT_LOG'].main[0].map((target) => target.node), ['Restore Router Reply']);
  assert.deepEqual(router.connections['Restore Router Reply'].main[0].map((target) => target.node), ['Split Router Reply']);
  const callback = router.nodes.find((node) => node.name === 'Answer Telegram Callback');
  assert.equal(callback.parameters.resource, 'callback');
  assert.equal(callback.parameters.operation, 'answerQuery');
  assert.deepEqual(router.connections['Normalize Telegram Update'].main[0].map((target) => target.node), ['Status command?', 'Callback query?']);
});
