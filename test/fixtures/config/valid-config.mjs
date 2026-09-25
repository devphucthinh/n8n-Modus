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
      [['10001', 'Người kiểm thử', 'CN_HN', 'ACTIVE'], ['admin-1', 'Quản trị kiểm thử', 'CN_HN', 'ACTIVE']],
    ),
    CONFIG_THONG_BAO: rowsFrom(
      ['message_key', 'message_text', 'locale', 'trang_thai'],
      [
        ['STATUS_HEADER', 'Trạng thái Kiểm kê bia V2', 'vi-VN', 'ACTIVE'],
        ['STATUS_GATEWAY_HEALTH_LINE', 'Config Gateway: {gateway_health}', 'vi-VN', 'ACTIVE'],
        ['STATUS_CONFIG_LINE', 'Cấu hình: {config_version}', 'vi-VN', 'ACTIVE'],
        ['STATUS_BRANCH_COUNT_LINE', 'Chi nhánh hoạt động: {active_branch_count}', 'vi-VN', 'ACTIVE'],
        ['STATUS_BRANCH_LINE', '- {branch_name} ({branch_id})', 'vi-VN', 'ACTIVE'],
        ['STATUS_MAINTENANCE_LINE', 'Bảo trì cấu hình: {maintenance_mode}', 'vi-VN', 'ACTIVE'],
        ['ERROR_GENERIC', 'Không thể hoàn tất thao tác. Mã lỗi: {error_id}', 'vi-VN', 'ACTIVE'],
        ['USER_NOT_ACTIVE', 'Tài khoản chưa được cấp quyền hoạt động. Mã lỗi: {error_id}', 'vi-VN', 'ACTIVE'],
        ['COMMAND_NOT_AVAILABLE', 'Lệnh này chưa được bật. Mã lỗi: {error_id}', 'vi-VN', 'ACTIVE'],
        ['HELP_HEADER', 'Danh sách lệnh theo cấu hình:', 'vi-VN', 'ACTIVE'],
        ['ROUTER_COMMAND_ACCEPTED', 'Đã tiếp nhận lệnh.', 'vi-VN', 'ACTIVE'],
        ['ROUTER_RETRY_ACCEPTED', 'Đã tiếp nhận yêu cầu retry.', 'vi-VN', 'ACTIVE'],
        ['ROUTER_DUPLICATE', 'Yêu cầu đã được xử lý.', 'vi-VN', 'ACTIVE'],
      ],
    ),
    CONFIG_SNAPSHOT: [],
    OPERATION: [],
    ERROR_BIA: [],
  };
}

export const ROUTER_SHEET_DEFINITIONS = Object.freeze({
  CONFIG_ROLE: ['role_code', 'role_name', 'description_vi', 'trang_thai'],
  CONFIG_PERMISSION: ['permission_code', 'permission_name', 'description_vi', 'trang_thai'],
  CONFIG_USER_ROLE: ['user_role_id', 'user_id', 'role_code', 'branch_id', 'effective_from', 'effective_to', 'trang_thai'],
  CONFIG_ROLE_PERMISSION: ['role_permission_id', 'role_code', 'permission_code', 'trang_thai'],
  CONFIG_TOPIC: ['topic_id', 'branch_id', 'topic_type', 'chat_id', 'message_thread_id', 'trang_thai'],
  CONFIG_LENH: ['command_code', 'command_text', 'syntax', 'description_vi', 'permission_code', 'topic_type', 'worker_workflow', 'example', 'ordinal', 'trang_thai'],
});

export const AUDIT_SHEET_DEFINITIONS = Object.freeze({
  EVENT_LOG: ['event_id', 'event_type', 'request_id', 'operation_id', 'actor_user_id', 'branch_id', 'topic_type', 'command', 'outcome', 'error_code', 'created_at', 'trang_thai'],
});

const routerRows = {
  CONFIG_ROLE: [
    ['ADMIN', 'Quản trị', 'Toàn quyền kỹ thuật', 'ACTIVE'],
    ['KIEM_KE', 'Kiểm kê', 'Thực hiện kiểm kê', 'ACTIVE'],
    ['NHAP_HANG', 'Nhập hàng', 'Ghi nhận nhập hàng', 'ACTIVE'],
    ['NHAP_BAN', 'Nhập bán', 'Ghi nhận bán hàng', 'ACTIVE'],
    ['BAO_CAO', 'Báo cáo', 'Xem báo cáo', 'ACTIVE'],
  ],
  CONFIG_PERMISSION: [
    ['ADMIN_RETRY', 'Retry lỗi', 'Cho phép retry lỗi', 'ACTIVE'],
    ['KIEM_KE_WRITE', 'Ghi kiểm kê', 'Cho phép ghi kiểm kê', 'ACTIVE'],
    ['NHAP_HANG_WRITE', 'Ghi nhập hàng', 'Cho phép ghi nhập hàng', 'ACTIVE'],
    ['NHAP_BAN_WRITE', 'Ghi nhập bán', 'Cho phép ghi nhập bán', 'ACTIVE'],
    ['BAO_CAO_READ', 'Đọc báo cáo', 'Cho phép xem báo cáo', 'ACTIVE'],
  ],
  CONFIG_USER_ROLE: [
    ['ur-10001', '10001', 'KIEM_KE', 'CN_HN', FIXED_NOW, '', 'ACTIVE'],
    ['ur-admin', 'admin-1', 'ADMIN', '*', FIXED_NOW, '', 'ACTIVE'],
  ],
  CONFIG_ROLE_PERMISSION: [
    ['rp-1', 'KIEM_KE', 'KIEM_KE_WRITE', 'ACTIVE'],
    ['rp-2', 'ADMIN', 'ADMIN_RETRY', 'ACTIVE'],
    ['rp-3', 'NHAP_HANG', 'NHAP_HANG_WRITE', 'ACTIVE'],
    ['rp-4', 'NHAP_BAN', 'NHAP_BAN_WRITE', 'ACTIVE'],
    ['rp-5', 'BAO_CAO', 'BAO_CAO_READ', 'ACTIVE'],
  ],
  CONFIG_TOPIC: [
    ['topic-kiem-ke', 'CN_HN', 'KIEM_KE', '-100100', '77', 'ACTIVE'],
    ['topic-nhap-hang', 'CN_HN', 'NHAP_HANG', '-100100', '77', 'ACTIVE'],
    ['topic-nhap-ban', 'CN_HN', 'NHAP_BAN', '-100100', '77', 'ACTIVE'],
    ['topic-bao-cao', 'CN_HN', 'BAO_CAO', '-100100', '77', 'ACTIVE'],
  ],
  CONFIG_LENH: [
    ['CMD_KIEM_KE', '/kiemke', '/kiemke', 'Mở phiên kiểm kê', 'KIEM_KE_WRITE', 'KIEM_KE', 'WF05RouterTest001', '/kiemke', '10', 'ACTIVE'],
    ['CMD_NHAP_HANG', '/nhaphang', '/nhaphang', 'Ghi nhận nhập hàng', 'NHAP_HANG_WRITE', 'NHAP_HANG', 'WF08RouterTest001', '/nhaphang', '20', 'ACTIVE'],
    ['CMD_NHAP_BAN', '/nhapban', '/nhapban', 'Ghi nhận bán hàng', 'NHAP_BAN_WRITE', 'NHAP_BAN', 'WF09RouterTest001', '/nhapban', '30', 'ACTIVE'],
    ['CMD_BAO_CAO', '/baocaobia', '/baocaobia', 'Xem báo cáo bia', 'BAO_CAO_READ', 'BAO_CAO', 'WF12RouterTest001', '/baocaobia', '40', 'ACTIVE'],
    ['CMD_HELP', '/help', '/help', 'Hiển thị danh sách lệnh', '', '', '', '/help', '1', 'ACTIVE'],
    ['CMD_STATUS', '/trangthai', '/trangthai', 'Hiển thị trạng thái', '', '', '', '/trangthai', '2', 'ACTIVE'],
    ['CMD_RETRY', '/retry', '/retry <error_id>', 'Retry lỗi tạm thời', 'ADMIN_RETRY', '', '', '/retry err-42', '90', 'ACTIVE'],
    ['INACTIVE_COMMAND', '/an', '/an', 'Không hiển thị', '', '', '', '/an', '99', 'INACTIVE'],
  ],
};

export function validConfigWithRouterTables() {
  const tables = validConfig();
  const definitions = Object.fromEntries([...Object.entries(ROUTER_SHEET_DEFINITIONS), ...Object.entries(AUDIT_SHEET_DEFINITIONS)]);
  const schemaRows = Object.entries(definitions).flatMap(([sheetName, columns]) => columns.map((columnName, ordinal) => rowsFrom(
    SCHEMA_COLUMNS,
    [[`rule-${sheetName}-${columnName}`, '1.0', sheetName, columnName, columnName === 'ordinal' ? 'INTEGER' : 'STRING', 'NO', '', '', '', '', String(ordinal + 1), `Fixture ${sheetName}.${columnName}`, 'ACTIVE']],
  )[0]));
  tables.CONFIG_SCHEMA = [...tables.CONFIG_SCHEMA, ...schemaRows];
  for (const [sheetName, columns] of Object.entries(ROUTER_SHEET_DEFINITIONS)) {
    tables[sheetName] = rowsFrom(columns, routerRows[sheetName]);
  }
  tables.EVENT_LOG = [];
  tables.ERROR_BIA = rowsFrom([
    'error_id', 'error_code', 'error_class', 'retryable', 'message_safe', 'workflow', 'node', 'operation_id', 'request_id', 'config_version', 'fingerprint', 'status', 'created_at', 'resolved_at',
  ], [['err-42', 'TEMPORARY', 'TRANSIENT', 'YES', 'Tạm thời', 'WF05', 'Node', 'op-original-42', 'tg-original-42', 'v1', 'fp', 'OPEN', FIXED_NOW, '']]);
  return tables;
}

export function topicFor(topicType = 'KIEM_KE') {
  return validConfigWithRouterTables().CONFIG_TOPIC.find((row) => row.topic_type === topicType);
}
