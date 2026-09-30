import { sourceFile, codeNode } from './helpers.mjs';

export async function bubbleCode(body) {
  const workerResultBody = body.includes('INVENTORY_COMMIT_RECONCILIATION_REQUIRED')
    ? body.replace('operation_committed: false}}];', 'operation_committed: false, reconciliation_required: true}}];')
    : body;
  return codeNode(`${await sourceFile('src/inventory-session/bubble-state.mjs')}\n${workerResultBody}`);
}

export async function inventorySessionCode() {
  return codeNode(`
${await sourceFile('src/contracts/core-sheet-schema.mjs')}
${await sourceFile('src/contracts/validate-ledger-schema.mjs')}
${await sourceFile('src/inventory-session/open-session.mjs')}
const trigger = $('Execute Workflow Trigger').first()?.json ?? {};
const gateway = $('Call Config Gateway').first()?.json ?? {};
const envelope = trigger.envelope ?? trigger;
const topics = gateway.response?.data?.config_tables?.CONFIG_TOPIC ?? [];
const branch = (gateway.response?.data?.config_tables?.CONFIG_BRANCH ?? []).find((row) => String(row.branch_id || '').trim() === String(envelope.branch_id || '').trim()) || { branch_id: envelope.branch_id };
const configGlobal = gateway.response?.data?.config_tables?.CONFIG_GLOBAL ?? [];
const beers = gateway.response?.data?.config_tables?.CONFIG_BIA ?? [];
const snapshotId = gateway.response?.config_snapshot_id || null;
const expectedConfigSnapshotId = envelope.payload?.config_snapshot_id || trigger.config_snapshot_id || null;
const rows = (() => { try { return $items('Read PHIEN_KIEM_KE').map((item) => item.json).filter((row) => row && Object.keys(row).length > 0); } catch { return null; } })();
const operations = (() => { try { return $items('Read OPERATION for inventory').map((item) => item.json).filter((row) => row && Object.keys(row).length > 0); } catch { return null; } })();
if (gateway.ok !== true || (envelope.event_type === 'SCHEDULED_JOB' && !expectedConfigSnapshotId)) {
  return [{ json: { ok: false, status: 'ERROR', error_code: 'INVENTORY_CONFIG_GATEWAY_UNAVAILABLE', write_plan: [] } }];
}
const validation = validateLedgerSchema({
  schemaRows: gateway.response?.data?.config_tables?.CONFIG_SCHEMA,
  tables: { PHIEN_KIEM_KE: rows, OPERATION: operations, EVENT_LOG: gateway.response?.data?.config_tables?.EVENT_LOG },
  requiredSheets: ['PHIEN_KIEM_KE', 'OPERATION', 'EVENT_LOG'],
});
if (!validation.ok) return [{ json: { status: 'ERROR', ...validation, write_plan: [] } }];
const result = openOrReuseInventorySession({ envelope, configSnapshotId: snapshotId, expectedConfigSnapshotId, topics, sessions: rows, operations, branch, beers, configGlobal, now: new Date().toISOString() });
return [{ json: result }];
`);
}
