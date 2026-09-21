import { sourceFile, codeNode } from './helpers.mjs';

export async function countEntryCode() {
  return codeNode(`
${await sourceFile('src/contracts/workflow-envelope.mjs')}
${await sourceFile('src/config-gateway/sha256.mjs')}
${await sourceFile('src/inventory/count-entry.mjs')}
${await sourceFile('src/inventory/review-finalize.mjs')}

const triggerInput = $('Execute Workflow Trigger').first()?.json ?? {};
const gatewayResult = $('Call Config Gateway').first()?.json ?? {};
if (gatewayResult.ok === false) return [{ json: gatewayResult }];
const envelope = normalizeEnvelope(triggerInput.envelope ?? triggerInput);
const payload = envelope.payload ?? {};
const gatewaySnapshotId = gatewayResult.response?.config_snapshot_id ?? gatewayResult.response?.config_snapshot?.config_snapshot_id ?? '';
if (!gatewaySnapshotId) return [{ json: { ok: false, status: 'ERROR', error_code: 'CONFIG_SNAPSHOT_REQUIRED', request_id: envelope.request_id, operation_id: envelope.operation_id } }];
if (payload.session?.config_snapshot_id && payload.session.config_snapshot_id !== gatewaySnapshotId) {
  return [{ json: { ok: false, status: 'ERROR', error_code: 'CONFIG_SNAPSHOT_MISMATCH', request_id: envelope.request_id, operation_id: envelope.operation_id } }];
}
const intent = String(payload.intent ?? payload.action ?? 'SAVE_COUNT').toUpperCase();
let result;
if (intent === 'REVIEW') {
  result = reviewInventorySession(payload);
} else if (intent === 'FINALIZE') {
  result = finalizeInventorySession(payload);
} else {
  result = planCountSave({ ...payload, operation_id: envelope.operation_id, request_id: envelope.request_id, actor_user_id: envelope.actor_user_id });
}
return [{ json: { ...result, request_id: envelope.request_id, operation_id: envelope.operation_id } }];
`);
}

export function returnCode() {
  return codeNode(`
const result = $('Handle Count Entry').first()?.json ?? {};
return [{ json: result }];
`);
}
