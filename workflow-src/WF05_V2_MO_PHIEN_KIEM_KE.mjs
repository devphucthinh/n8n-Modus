import { sourceFile, codeNode } from './helpers.mjs';

export async function inventorySessionCode() {
  return codeNode(`
${await sourceFile('src/inventory-session/open-session.mjs')}
const trigger = $('Execute Workflow Trigger').first()?.json ?? {};
const gateway = $('Call Config Gateway').first()?.json ?? {};
const envelope = trigger.envelope ?? trigger;
const topics = gateway.response?.data?.config_tables?.CONFIG_TOPIC ?? [];
const snapshotId = envelope.payload?.config_snapshot_id || gateway.response?.config_snapshot_id || null;
const rows = (() => { try { return $items('Read PHIEN_KIEM_KE').map((item) => item.json).filter((row) => row && Object.keys(row).length > 0); } catch { return []; } })();
const result = openOrReuseInventorySession({ envelope, configSnapshotId: snapshotId, topics, sessions: rows, now: new Date().toISOString() });
return [{ json: result }];
`);
}
