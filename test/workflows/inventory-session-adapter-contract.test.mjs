import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIT_SHEET_DEFINITIONS,
  CORE_SHEET_DEFINITIONS,
  OPERATIONAL_SHEET_DEFINITIONS,
} from '../../src/contracts/core-sheet-schema.mjs';
import {
  expectedLedgerDataType,
  expectedLedgerSchemaRule,
} from '../../src/contracts/validate-ledger-schema.mjs';
import { inventorySessionCode } from '../../workflow-src/WF05_V2_MO_PHIEN_KIEM_KE.mjs';

const NOW = '2026-09-30T03:00:00.000Z';
const LEDGER_DEFINITIONS = {
  PHIEN_KIEM_KE: OPERATIONAL_SHEET_DEFINITIONS.PHIEN_KIEM_KE,
  OPERATION: CORE_SHEET_DEFINITIONS.OPERATION,
  EVENT_LOG: AUDIT_SHEET_DEFINITIONS.EVENT_LOG,
};

function schemaRows() {
  return Object.entries(LEDGER_DEFINITIONS).flatMap(([sheet_name, columns]) => columns.map((column_name) => ({
    schema_rule_id: `rule-${sheet_name}-${column_name}`,
    schema_version: '1.0',
    sheet_name,
    column_name,
    data_type: expectedLedgerDataType(sheet_name, column_name),
    required: 'YES',
    unique_group: expectedLedgerSchemaRule(sheet_name, column_name).unique_group,
    trang_thai: 'ACTIVE',
  })));
}

function gateway(snapshotId) {
  return {
    ok: true,
    response: {
      config_snapshot_id: snapshotId,
      data: {
        config_tables: {
          CONFIG_SCHEMA: schemaRows(),
          CONFIG_TOPIC: [],
          CONFIG_BRANCH: [],
          CONFIG_GLOBAL: [],
          CONFIG_BIA: [],
          EVENT_LOG: [],
        },
      },
    },
  };
}

async function runInventoryAdapter({ trigger, gatewayResult, sessions = [], operations = [] }) {
  const nodeResults = [{ json: trigger }, { json: gatewayResult }];
  const itemResults = [sessions, operations];
  const $ = () => ({ first: () => nodeResults.shift() });
  const $items = () => (itemResults.shift() ?? []).map((json) => ({ json }));
  const code = await inventorySessionCode();
  return new Function('$', '$items', code)($, $items)[0]?.json;
}

test('WF05 adapter accepts the standard Router envelope and preserves the stored session snapshot on resume', async () => {
  const session = {
    session_id: 'session-2026-09-29',
    branch_id: 'CN_HN',
    business_date: '2026-09-29',
    config_snapshot_id: 'snapshot-frozen-session',
    topic_id: 'topic-42',
    chat_id: '-10042',
    message_thread_id: '42',
    dispatch_key: 'scheduled:CN_HN:2026-09-29',
    catalog_snapshot_json: '[{"stt":1,"ma_bia":"B42"}]',
    catalog_count: '1',
    page_size: '8',
    master_message_id: '501',
    bubble_state: 'SENT',
    status: 'ACTIVE',
    created_at: NOW,
    updated_at: NOW,
  };
  const reservation = {
    operation_id: 'router-operation-42',
    request_id: 'router-request-42',
    operation_type: 'ROUTE_COMMAND',
    idempotency_key: 'telegram-idempotency-42',
    config_snapshot_id: 'snapshot-router-current',
    expected_row_count: '',
    actual_row_count: '',
    checksum: '',
    error_id: '',
    created_at: NOW,
    updated_at: NOW,
    status: 'RUNNING',
  };
  const openingOperation = {
    operation_id: 'opening-operation-42',
    request_id: 'opening-request-42',
    operation_type: 'OPEN_INVENTORY_SESSION',
    idempotency_key: session.dispatch_key,
    config_snapshot_id: session.config_snapshot_id,
    expected_row_count: '3',
    actual_row_count: '3',
    checksum: '',
    error_id: '',
    created_at: NOW,
    updated_at: NOW,
    status: 'COMMITTED',
  };
  const result = await runInventoryAdapter({
    trigger: {
      envelope: {
        request_id: reservation.request_id,
        operation_id: reservation.operation_id,
        event_type: 'TELEGRAM_UPDATE',
        actor_user_id: '10001',
        branch_id: 'CN_HN',
        config_snapshot_id: reservation.config_snapshot_id,
        payload: { command: '/kiemke', idempotency_key: reservation.idempotency_key },
      },
    },
    gatewayResult: gateway('snapshot-gateway-latest'),
    sessions: [session],
    operations: [openingOperation, reservation],
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'REUSED');
  assert.equal(result.session.session_id, 'session-2026-09-29');
  assert.equal(result.session.config_snapshot_id, 'snapshot-frozen-session');
  assert.equal(result.operation.operation_id, reservation.operation_id);
  assert.equal(result.operation.idempotency_key, reservation.idempotency_key);
  assert.equal(result.write_plan.some((entry) => entry.sheet === 'PHIEN_KIEM_KE'), false);
});

test('WF05 adapter still enforces the scheduled snapshot supplied in the payload', async () => {
  const result = await runInventoryAdapter({
    trigger: {
      envelope: {
        request_id: 'scheduled-request-42',
        operation_id: 'scheduled-operation-42',
        event_type: 'SCHEDULED_JOB',
        actor_user_id: 'SYSTEM',
        branch_id: 'CN_HN',
        business_date: '2026-09-30',
        payload: {
          dispatch_key: 'nightly-inventory:CN_HN:2026-09-30',
          idempotency_key: 'nightly-inventory:CN_HN:2026-09-30',
          config_snapshot_id: 'snapshot-from-scheduled-payload',
        },
      },
    },
    gatewayResult: gateway('snapshot-current-gateway'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error_code, 'INVENTORY_CONFIG_SNAPSHOT_MISMATCH');
  assert.deepEqual(result.write_plan, []);
});
