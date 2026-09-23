import { sourceFile, codeNode } from './helpers.mjs';

export async function inventorySessionCode() {
  return codeNode(`
${await sourceFile('src/inventory-session/open-session.mjs')}
const trigger = $('Execute Workflow Trigger').first()?.json ?? {};
const input = $input.first()?.json ?? {};
const gateway = $('Call Config Gateway').first()?.json ?? {};
const envelope = trigger.envelope ?? trigger;
const topics = gateway.response?.data?.config_tables?.CONFIG_TOPIC ?? [];
const branch = (gateway.response?.data?.config_tables?.CONFIG_BRANCH ?? []).find((row) => String(row.branch_id || '').trim() === String(envelope.branch_id || '').trim()) || { branch_id: envelope.branch_id };
const configGlobal = gateway.response?.data?.config_tables?.CONFIG_GLOBAL ?? [];
const snapshotId = envelope.payload?.config_snapshot_id || gateway.response?.config_snapshot_id || null;
const createdTopic = trigger.created_topic || input.created_topic || input.body || (input.result || input.error ? input : null);
const rows = (() => { try { return $items('Read PHIEN_KIEM_KE').map((item) => item.json).filter((row) => row && Object.keys(row).length > 0); } catch { return []; } })();
const result = openOrReuseInventorySession({ envelope, configSnapshotId: snapshotId, topics, sessions: rows, branch, configGlobal, createdTopic, now: new Date().toISOString() });
return [{ json: result }];
`);
}
