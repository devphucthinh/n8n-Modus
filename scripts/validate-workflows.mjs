import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowDir = path.join(root, 'workflows');
const expected = [
  'WF01_V2_CONFIG_GATEWAY.json', 'WF01_V2_HEARTBEAT_GATEWAY.json',
  'WF02_V2_ERROR_HANDLER.json', 'WF03_V2_TELEGRAM_ROUTER.json',
  'WF04_V2_DISPATCHER.json', 'WF05_V2_MO_PHIEN_KIEM_KE.json',
];
const googleSheetId = '1wQ76EpIx35Trkx5JZg8GZ0xZsEBcKAFA6eb7nKDvLu4';
const workflowTargets = new Map([
  ['Call Error Handler', 'MoG6coBccYkIS0nK'],
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
      for (const output of connection.main ?? []) for (const target of output ?? []) if (!known.has(target.node)) errors.push(`${filename}: connection target ${target.node} missing`);
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
      if (workflow.name === 'WF04_V2_DISPATCHER' && node.name === 'Call Config Gateway'
        && node.parameters?.workflowId?.value !== 'BIND_WF01_HEARTBEAT_GATEWAY_WORKFLOW_ID_BEFORE_IMPORT') {
        errors.push(`${filename}: dispatcher must target the dedicated heartbeat Gateway placeholder`);
      }
      if (node.type === 'n8n-nodes-base.telegram' || node.type === 'n8n-nodes-base.telegramTrigger') {
        if (node.credentials?.telegramApi?.name !== 'TELEGRAM_KKB_V2') errors.push(`${filename}: Telegram credential mismatch`);
      }
      if (node.type === 'n8n-nodes-base.code' && /\b(?:import|export)\b/.test(node.parameters?.jsCode ?? '')) errors.push(`${filename}: Code node is not self-contained`);
      if (node.type === 'n8n-nodes-base.code') {
        if (/\bstructuredClone\s*\(/.test(node.parameters?.jsCode ?? '')) errors.push(`${filename}: Code node uses an unavailable structuredClone API`);
        try {
          // Parse the embedded Code node exactly as n8n will compile it. This
          // catches duplicate top-level declarations introduced by bundling.
          new Function(node.parameters?.jsCode ?? '');
        } catch (error) {
          errors.push(`${filename}: Code node ${node.name} has invalid JavaScript: ${error.message}`);
        }
      }
    }
    if (workflow.name === 'WF01_V2_CONFIG_GATEWAY') {
      const auditGate = workflow.nodes.find((node) => node.name === 'Gateway failure safe to audit?');
      if (!auditGate || auditGate.parameters?.conditions?.conditions?.[0]?.leftValue !== '={{true}}') errors.push(`${filename}: shared Gateway must always audit failures`);
      if (!workflow.nodes.some((node) => node.name === 'Call Error Handler')) errors.push(`${filename}: shared Gateway must retain WF02 failure auditing`);
      if (workflow.nodes.some((node) => node.type === 'n8n-nodes-base.googleSheets' && node.parameters?.operation === 'read' && node.continueOnFail !== true)) errors.push(`${filename}: Gateway reads must route sheet read failures to schema validation`);
    }
    if (workflow.name === 'WF01_V2_HEARTBEAT_GATEWAY') {
      const auditGate = workflow.nodes.find((node) => node.name === 'Gateway failure safe to audit?');
      const outgoing = workflow.connections?.[auditGate?.name]?.main ?? [];
      if (workflow.settings?.callerPolicy !== 'workflowsFromAList'
        || workflow.settings?.callerIds !== 'BIND_WF04_WORKFLOW_ID_BEFORE_IMPORT') errors.push(`${filename}: heartbeat Gateway must use the native WF04-only caller allowlist placeholder`);
      if (!auditGate || auditGate.parameters?.conditions?.conditions?.[0]?.leftValue !== '={{false}}') errors.push(`${filename}: heartbeat Gateway must bypass WF02 on failure`);
      if (workflow.nodes.some((node) => node.name === 'Call Error Handler') || (outgoing[0] ?? []).length > 0
        || (outgoing[1] ?? []).map((target) => target.node).join(',') !== 'Return Gateway Result') errors.push(`${filename}: heartbeat Gateway failure must return directly without auditing through WF02`);
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
    if (workflow.name === 'WF04_V2_DISPATCHER') {
      const nodeByName = new Map(workflow.nodes.map((node) => [node.name, node]));
      const outgoing = (name, output = 0) => (workflow.connections?.[name]?.main?.[output] ?? []).map((target) => target.node);
      const requestCode = nodeByName.get('Prepare Dispatcher Gateway Request')?.parameters?.jsCode ?? '';
      const decideCode = nodeByName.get('Decide Dispatcher Actions')?.parameters?.jsCode ?? '';
      const heartbeatSettingsCode = nodeByName.get('Validate current heartbeat settings')?.parameters?.jsCode ?? '';
      const heartbeatCode = nodeByName.get('Project post-worker HEARTBEAT')?.parameters?.jsCode ?? '';
      const finalizeCode = nodeByName.get('Finalize Dispatch History')?.parameters?.jsCode ?? '';
      const ledgerReadNode = nodeByName.get('Decide Dispatcher Actions')?.parameters?.jsCode ?? '';
      const claimTokenMapping = nodeByName.get('Claim DISPATCH_HISTORY')?.parameters?.columns?.value?.claim_token;
      const runningTokenMapping = nodeByName.get('Mark Dispatch RUNNING')?.parameters?.columns?.value?.claim_token;
      if (!/dispatcher_attempt_id/.test(requestCode) || !/heartbeat_id/.test(requestCode) || !/claim_token/.test(requestCode) || /\$execution\b/.test(requestCode)) errors.push(`${filename}: dispatcher entry must create V2-owned attempt, heartbeat, and claim identities without n8n execution metadata`);
      if (!/Prepare Dispatcher Gateway Request/.test(decideCode) || !/claim_token/.test(decideCode) || !/heartbeat_id/.test(decideCode) || /\$execution\b/.test(decideCode)) errors.push(`${filename}: dispatcher planning must reuse the entry-owned attempt identities`);
      if (!/validateDispatcherHeartbeatSettings/.test(heartbeatSettingsCode) || !/HEARTBEAT_CONFIG_INVALID/.test(heartbeatSettingsCode)
        || !outgoing('Gateway configuration available?', 0).includes('Validate current heartbeat settings')
        || !outgoing('Validate current heartbeat settings').includes('Current heartbeat settings valid?')
        || !outgoing('Current heartbeat settings valid?', 0).includes('Read DISPATCH_HISTORY')
        || !outgoing('Current heartbeat settings valid?', 1).includes('Return Dispatcher Result')) {
        errors.push(`${filename}: current heartbeat settings must fail closed before business-ledger reads`);
      }
      if (!/Prepare Dispatcher Gateway Request/.test(heartbeatCode) || !/heartbeat_id/.test(heartbeatCode) || /\$execution\b/.test(heartbeatCode)) errors.push(`${filename}: post-worker heartbeat must reuse the entry-owned heartbeat identity`);
      if (claimTokenMapping !== '={{$json.claim_token}}' || runningTokenMapping !== '={{$json.claim_token}}' || !/\.\.\.claim/.test(finalizeCode)) errors.push(`${filename}: claim token must survive claim, RUNNING, and finalization`);
      if (!/readDispatcherLedgers\(/.test(ledgerReadNode)
        || !/gatewayReady\s*,\s*heartbeatSettingsValid:\s*currentHeartbeatSettings\?\.ok\s*===\s*true/.test(ledgerReadNode)
        || !/heartbeatRowsValid:\s*\(rows\)\s*=>/.test(ledgerReadNode)
        || !/validateHeartbeatRows\(rows\)\.ok/.test(ledgerReadNode)
        || !/HEARTBEAT:\s*'HEARTBEAT'/.test(ledgerReadNode)
        || !/DISPATCH_HISTORY:\s*'DISPATCH_HISTORY'/.test(ledgerReadNode)
        || !/OPERATION:\s*'OPERATION for dispatcher'/.test(ledgerReadNode)) {
        errors.push(`${filename}: the dispatcher adapter must use the tested ledger read policy, with heartbeat first and business reads gated`);
      }
      if (!/planGatewayFailureHeartbeat\(/.test(ledgerReadNode)
        || !/hasValidPersistedHeartbeatSettings/.test(ledgerReadNode)
        || !/reuseValidatedHeartbeatSettings/.test(ledgerReadNode)) errors.push(`${filename}: Gateway failures must use the fail-closed persisted-heartbeat contract`);
    }
    if (workflow.name === 'WF05_V2_MO_PHIEN_KIEM_KE') {
      const workerCode = workflow.nodes.find((node) => node.name === 'Open or Reuse Inventory Session')?.parameters?.jsCode ?? '';
      if (!/validateLedgerSchema\(/.test(workerCode) || !/openOrReuseInventorySession\(/.test(workerCode)
        || workerCode.indexOf('validateLedgerSchema(') > workerCode.indexOf('openOrReuseInventorySession(')) {
        errors.push(`${filename}: inventory contract validation must precede the session planner`);
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
