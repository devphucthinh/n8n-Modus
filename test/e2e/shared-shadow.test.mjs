import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateConfigGateway } from '../../src/config-gateway/evaluate-config.mjs';
import { atomicClaim } from '../../src/dispatcher/atomic-claim.mjs';
import { buildDispatchPlan } from '../../src/dispatcher/decide-dispatch.mjs';
import { ALL_SHEET_DEFINITIONS } from '../../src/contracts/core-sheet-schema.mjs';
import { envelope, FIXED_NOW, validConfig } from '../fixtures/config/valid-config.mjs';

const row = (sheetName, values = {}) => Object.fromEntries(
  ALL_SHEET_DEFINITIONS[sheetName].map((column) => [column, values[column] ?? '']),
);

function addSchema(tables, sheetNames) {
  for (const sheetName of sheetNames) {
    for (const columnName of ALL_SHEET_DEFINITIONS[sheetName]) {
      tables.CONFIG_SCHEMA.push(row('CONFIG_SCHEMA', {
        schema_rule_id: `shadow-${sheetName}-${columnName}`,
        schema_version: '1.0',
        sheet_name: sheetName,
        column_name: columnName,
        data_type: 'STRING',
        required: 'NO',
        ordinal: '1',
        description_vi: 'Shadow contract fixture',
        trang_thai: 'ACTIVE',
      }));
    }
  }
}

test('shadow Gateway → Dispatcher → atomic claim stays inactive and idempotent', async () => {
  const tables = validConfig();
  const requested = ['CONFIG_LICH', 'CONFIG_BIA', 'CONFIG_QUY_DOI', 'CONFIG_MAPPING_BAN', 'CONFIG_NGUON_BAN', 'CONFIG_NGUON_BAN_COT'];
  addSchema(tables, requested);
  for (const sheetName of requested) tables[sheetName] ??= [];
  tables.CONFIG_LICH = [row('CONFIG_LICH', {
    schedule_id: 'SCHED-SHADOW', job_code: 'OPEN_COUNT_SESSION', worker_workflow: 'WF05_V2_MO_PHIEN_KIEM_KE', branch_id: 'CN_HN',
    timezone: 'Asia/Ho_Chi_Minh', days_of_week: '*', local_time: '08:00', grace_minutes: '20', max_attempts: '3', trang_thai: 'ACTIVE',
  })];
  tables.CONFIG_BIA = [row('CONFIG_BIA', {
    item_id: 'BIA-001', item_code: 'BIA-001', item_name: 'Bia mẫu', inventory_unit: 'chai', tracked: 'YES', ordinal: '1', trang_thai: 'ACTIVE',
  })];

  const gateway = evaluateConfigGateway({
    envelope: { ...envelope, payload: { intent: 'SCHEDULED_JOB', required_sheet_names: requested } },
    tables,
    now: FIXED_NOW,
  });
  assert.equal(gateway.ok, true);
  assert.equal(gateway.response.config_snapshot.catalog[0].item_id, 'BIA-001');

  const dispatcher = buildDispatchPlan({
    scheduleRows: gateway.response.data.dispatcher_tables.CONFIG_LICH,
    branchRows: tables.CONFIG_BRANCH,
    historyRows: [],
    heartbeatRows: [],
    defaultTimezone: tables.CONFIG_GLOBAL[0].config_value,
    now: '2026-09-19T01:10:00.000Z',
    requestId: 'req-shadow-dispatch',
    configVersion: gateway.response.config_version,
    configSnapshotId: gateway.response.config_snapshot_id,
    heartbeatSuccess: true,
    heartbeatFailureThreshold: 3,
  });
  assert.equal(dispatcher.dispatches.length, 1);
  assert.equal(dispatcher.dispatches[0].envelope.config_snapshot_id, gateway.response.config_snapshot_id);

  let claim = null;
  const readClaim = async () => claim;
  const tryClaim = async (candidate) => {
    if (claim) return false;
    claim = { ...candidate.row, claim_token: candidate.claim_token };
    return true;
  };
  const first = await atomicClaim({ candidate: dispatcher.atomic_claims[0], readClaim, tryClaim });
  const replay = await atomicClaim({ candidate: dispatcher.atomic_claims[0], readClaim, tryClaim });
  assert.equal(first.claimed, true);
  assert.equal(replay.reason, 'ALREADY_CLAIMED');
  assert.equal(claim.claim_token, dispatcher.dispatches[0].operation_id);
});
