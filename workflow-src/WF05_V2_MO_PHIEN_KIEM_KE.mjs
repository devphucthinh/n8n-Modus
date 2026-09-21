import { sourceFile, codeNode } from './helpers.mjs';

export async function openSessionCode() {
  return codeNode(`
${await sourceFile('src/contracts/workflow-envelope.mjs')}
${await sourceFile('src/inventory/inventory-session.mjs')}

const triggerInput = $('Execute Workflow Trigger').first()?.json ?? {};
const gatewayResult = $('Call Config Gateway').first()?.json ?? {};
const envelope = normalizeEnvelope(triggerInput.envelope ?? triggerInput);
if (gatewayResult.ok === false) return [{ json: gatewayResult }];
const payload = envelope.payload ?? {};
const configSnapshot = payload.config_snapshot ?? payload.configSnapshot ?? gatewayResult.response?.config_snapshot ?? {};
const result = openOrReuseInventorySession({
  branch_id: envelope.branch_id ?? payload.branch_id,
  business_date: envelope.business_date ?? payload.business_date,
  config_snapshot: configSnapshot,
  existing_sessions: payload.existing_sessions ?? [],
  actor_user_id: envelope.actor_user_id,
  now: payload.now ?? new Date().toISOString(),
  expires_at: payload.expires_at,
  operation_id: envelope.operation_id,
  request_id: envelope.request_id,
});
return [{ json: { ...result, request_id: envelope.request_id, operation_id: envelope.operation_id } }];
`);
}

export function returnCode() {
  return codeNode(`
const result = $('Open or Reuse Inventory Session').first()?.json ?? {};
return [{ json: result }];
`);
}
