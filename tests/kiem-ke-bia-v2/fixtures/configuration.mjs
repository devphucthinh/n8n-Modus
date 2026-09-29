// Synthetic values only; the live Google Sheet remains authoritative.
export const syntheticEnvelope = {
  envelope_version: 'v2', request_id: 'req-synthetic-1', operation_id: 'op-synthetic-1',
  event_type: 'COUNT_SUBMITTED', branch_id: 'branch-synthetic-1',
  actor_user_id: 'user-synthetic-1', business_date: '2026-01-02',
  config_version: 'v-synthetic-1', config_snapshot_id: 'snapshot-synthetic-1',
  payload: { count: 0 }, reply_target: {},
};

export const syntheticConfiguration = {
  CONFIG_BRANCH: [{ branch_id: 'branch-synthetic-1', branch_code: 'SYN', branch_name: 'Synthetic branch', timezone: 'Asia/Bangkok', locale: 'vi', status: 'ACTIVE', effective_from: '2026-01-01', effective_to: '', updated_by: 'user-synthetic-1', updated_at: '2026-01-01T00:00:00Z' }],
  CONFIG_USER: [{ user_id: 'user-synthetic-1', telegram_user_id: 'telegram-user-synthetic-1', display_name: 'Synthetic user', username: 'synthetic_user', branch_id: 'branch-synthetic-1', language: 'vi', trang_thai: 'ACTIVE', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }],
  CONFIG_BIA: [{ item_id: 'item-synthetic-1', item_code: 'SYN_ITEM', item_name: 'Synthetic item', inventory_unit: 'unit', tracked: true, ordinal: 1, effective_from: '2026-01-01', effective_to: '', trang_thai: 'ACTIVE', updated_by: 'user-synthetic-1', updated_at: '2026-01-01T00:00:00Z' }],
};
