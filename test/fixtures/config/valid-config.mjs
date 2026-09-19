export const FIXED_NOW = '2026-09-19T01:00:00.000Z';

const SCHEMA_COLUMNS = [
  'schema_rule_id',
  'schema_version',
  'sheet_name',
  'column_name',
  'data_type',
  'required',
  'unique_group',
  'reference_sheet',
  'reference_column',
  'allowed_values',
  'ordinal',
  'description_vi',
  'trang_thai',
];

export const envelope = Object.freeze({
  request_id: 'req-001',
  operation_id: 'op-001',
  event_type: 'TELEGRAM_UPDATE',
  actor_user_id: '10001',
  branch_id: null,
  business_date: null,
  config_version: null,
  payload: { command: '/trangthai', intent: 'READ_STATUS' },
});

const rowsFrom = (columns, values) => values.map((value) => Object.fromEntries(
  columns.map((column, index) => [column, value[index] ?? '']),
));

export function validConfig() {
  const definitions = {
    CONFIG_SCHEMA: SCHEMA_COLUMNS,
    CONFIG_VERSION: ['config_version', 'schema_version', 'maintenance_mode', 'changed_by', 'changed_at', 'change_note', 'trang_thai'],
    CONFIG_GLOBAL: ['config_key', 'config_value', 'value_type', 'description_vi', 'trang_thai'],
    CONFIG_BRANCH: ['branch_id', 'branch_name', 'forum_chat_id', 'owner_chat_id', 'timezone', 'trang_thai'],
    CONFIG_USER: ['user_id', 'display_name', 'branch_id', 'trang_thai'],
    CONFIG_THONG_BAO: ['message_key', 'message_text', 'locale', 'trang_thai'],
    CONFIG_SNAPSHOT: ['config_snapshot_id', 'config_version', 'schema_version', 'fingerprint', 'normalized_config_json', 'operation_id', 'status', 'created_at'],
    OPERATION: ['operation_id', 'request_id', 'operation_type', 'idempotency_key', 'expected_row_count', 'actual_row_count', 'checksum', 'status', 'error_id', 'created_at', 'updated_at'],
    ERROR_BIA: ['error_id', 'error_code', 'error_class', 'retryable', 'message_safe', 'workflow', 'node', 'operation_id', 'request_id', 'config_version', 'fingerprint', 'status', 'created_at', 'resolved_at'],
  };
  const unique = {
    CONFIG_VERSION: new Set(['config_version']),
    CONFIG_GLOBAL: new Set(['config_key']),
    CONFIG_BRANCH: new Set(['branch_id']),
    CONFIG_USER: new Set(['user_id']),
    CONFIG_THONG_BAO: new Set(['message_key']),
  };
  const schemaRows = Object.entries(definitions).flatMap(([sheetName, columns]) => columns.map((columnName, ordinal) => rowsFrom(
    SCHEMA_COLUMNS,
    [[
      `rule-${sheetName}-${columnName}`,
      '1.0',
      sheetName,
      columnName,
      'STRING',
      'NO',
      unique[sheetName]?.has(columnName) ? `${sheetName}_KEY` : '',
      sheetName === 'CONFIG_USER' && columnName === 'branch_id' ? 'CONFIG_BRANCH' : '',
      sheetName === 'CONFIG_USER' && columnName === 'branch_id' ? 'branch_id' : '',
      '',
      String(ordinal + 1),
      `Fixture ${sheetName}.${columnName}`,
      'ACTIVE',
    ]],
  )[0]));

  return {
    CONFIG_SCHEMA: schemaRows,
    CONFIG_VERSION: rowsFrom(
      ['config_version', 'schema_version', 'maintenance_mode', 'changed_by', 'changed_at', 'change_note', 'trang_thai'],
      [['v1', '1.0', 'NO', 'fixture-admin', FIXED_NOW, 'baseline', 'ACTIVE']],
    ),
    CONFIG_GLOBAL: rowsFrom(
      ['config_key', 'config_value', 'value_type', 'description_vi', 'trang_thai'],
      [
        ['DEFAULT_TIMEZONE', 'Asia/Ho_Chi_Minh', 'STRING', 'Múi giờ mặc định', 'ACTIVE'],
        ['DEFAULT_LOCALE', 'vi-VN', 'STRING', 'Định dạng hiển thị', 'ACTIVE'],
      ],
    ),
    CONFIG_BRANCH: rowsFrom(
      ['branch_id', 'branch_name', 'forum_chat_id', 'owner_chat_id', 'timezone', 'trang_thai'],
      [['CN_HN', 'Chi nhánh Hà Nội', 'fixture-chat', 'fixture-owner', 'Asia/Ho_Chi_Minh', 'ACTIVE']],
    ),
    CONFIG_USER: rowsFrom(
      ['user_id', 'display_name', 'branch_id', 'trang_thai'],
      [['10001', 'Người kiểm thử', 'CN_HN', 'ACTIVE']],
    ),
    CONFIG_THONG_BAO: rowsFrom(
      ['message_key', 'message_text', 'locale', 'trang_thai'],
      [
        ['STATUS_HEADER', 'Trạng thái Kiểm kê bia V2', 'vi-VN', 'ACTIVE'],
        ['STATUS_CONFIG_LINE', 'Cấu hình: {config_version}', 'vi-VN', 'ACTIVE'],
        ['STATUS_BRANCH_COUNT_LINE', 'Chi nhánh hoạt động: {active_branch_count}', 'vi-VN', 'ACTIVE'],
        ['STATUS_BRANCH_LINE', '- {branch_name} ({branch_id})', 'vi-VN', 'ACTIVE'],
        ['STATUS_MAINTENANCE_LINE', 'Bảo trì cấu hình: {maintenance_mode}', 'vi-VN', 'ACTIVE'],
        ['ERROR_GENERIC', 'Không thể hoàn tất thao tác. Mã lỗi: {error_id}', 'vi-VN', 'ACTIVE'],
        ['USER_NOT_ACTIVE', 'Tài khoản chưa được cấp quyền hoạt động. Mã lỗi: {error_id}', 'vi-VN', 'ACTIVE'],
        ['COMMAND_NOT_AVAILABLE', 'Lệnh này chưa được bật. Mã lỗi: {error_id}', 'vi-VN', 'ACTIVE'],
      ],
    ),
    CONFIG_SNAPSHOT: [],
    OPERATION: [],
    ERROR_BIA: [],
  };
}
