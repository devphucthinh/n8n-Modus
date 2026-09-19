export const FIXED_NOW = '2026-09-19T01:00:00.000Z';

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
  return {
    CONFIG_SCHEMA: [],
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
