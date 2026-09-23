import { AUDIT_SHEET_DEFINITIONS, AUDIT_SHEET_NAMES, CORE_SHEET_DEFINITIONS, CORE_SHEET_NAMES, ROUTER_SHEET_DEFINITIONS, ROUTER_SHEET_NAMES } from '../../src/contracts/core-sheet-schema.mjs';

const fakeRows = {
  CONFIG_VERSION: [{ config_version: 'v1', schema_version: '1.0', maintenance_mode: 'NO', changed_by: 'SET_IN_GOOGLE_SHEET', changed_at: '2026-09-19T01:00:00.000Z', change_note: 'baseline', trang_thai: 'ACTIVE' }],
  CONFIG_GLOBAL: [{ config_key: 'DEFAULT_TIMEZONE', config_value: 'Asia/Ho_Chi_Minh', value_type: 'STRING', description_vi: 'Múi giờ mặc định', trang_thai: 'ACTIVE' }],
  CONFIG_BRANCH: [{ branch_id: 'BRANCH_ID_CONFIGURE', branch_name: 'Tên chi nhánh cần cấu hình', forum_chat_id: 'CHAT_ID_CONFIGURE', owner_chat_id: 'CHAT_ID_CONFIGURE', timezone: 'Asia/Ho_Chi_Minh', trang_thai: 'ACTIVE' }],
  CONFIG_USER: [{ user_id: 'USER_ID_CONFIGURE', display_name: 'Người dùng cần cấu hình', branch_id: 'BRANCH_ID_CONFIGURE', trang_thai: 'ACTIVE' }],
  CONFIG_THONG_BAO: [
    { message_key: 'STATUS_HEADER', message_text: 'Trạng thái Kiểm kê bia V2', locale: 'vi-VN', trang_thai: 'ACTIVE' },
    { message_key: 'STATUS_GATEWAY_HEALTH_LINE', message_text: 'Config Gateway: {gateway_health}', locale: 'vi-VN', trang_thai: 'ACTIVE' },
    { message_key: 'STATUS_CONFIG_LINE', message_text: 'Cấu hình: {config_version}', locale: 'vi-VN', trang_thai: 'ACTIVE' },
    { message_key: 'STATUS_BRANCH_COUNT_LINE', message_text: 'Chi nhánh hoạt động: {active_branch_count}', locale: 'vi-VN', trang_thai: 'ACTIVE' },
    { message_key: 'STATUS_BRANCH_LINE', message_text: '- {branch_name} ({branch_id})', locale: 'vi-VN', trang_thai: 'ACTIVE' },
    { message_key: 'STATUS_MAINTENANCE_LINE', message_text: 'Bảo trì cấu hình: {maintenance_mode}', locale: 'vi-VN', trang_thai: 'ACTIVE' },
    { message_key: 'ERROR_GENERIC', message_text: 'Không thể hoàn tất thao tác. Mã lỗi: {error_id}', locale: 'vi-VN', trang_thai: 'ACTIVE' },
    { message_key: 'USER_NOT_ACTIVE', message_text: 'Tài khoản chưa được cấp quyền hoạt động. Mã lỗi: {error_id}', locale: 'vi-VN', trang_thai: 'ACTIVE' },
    { message_key: 'COMMAND_NOT_AVAILABLE', message_text: 'Lệnh này chưa được bật. Mã lỗi: {error_id}', locale: 'vi-VN', trang_thai: 'ACTIVE' },
    { message_key: 'HELP_HEADER', message_text: 'Danh sách lệnh theo cấu hình:', locale: 'vi-VN', trang_thai: 'ACTIVE' },
    { message_key: 'ROUTER_COMMAND_ACCEPTED', message_text: 'Đã tiếp nhận lệnh.', locale: 'vi-VN', trang_thai: 'ACTIVE' },
    { message_key: 'ROUTER_RETRY_ACCEPTED', message_text: 'Đã tiếp nhận yêu cầu retry.', locale: 'vi-VN', trang_thai: 'ACTIVE' },
    { message_key: 'ROUTER_DUPLICATE', message_text: 'Yêu cầu đã được xử lý.', locale: 'vi-VN', trang_thai: 'ACTIVE' },
  ],
  CONFIG_SCHEMA: [],
  CONFIG_SNAPSHOT: [],
  OPERATION: [],
  ERROR_BIA: [],
  CONFIG_ROLE: [
    { role_code: 'ROLE_CODE_CONFIGURE', role_name: 'Tên vai trò', description_vi: 'Mô tả vai trò', trang_thai: 'ACTIVE' },
  ],
  CONFIG_PERMISSION: [
    { permission_code: 'PERMISSION_CODE_CONFIGURE', permission_name: 'Tên quyền', description_vi: 'Mô tả quyền', trang_thai: 'ACTIVE' },
  ],
  CONFIG_USER_ROLE: [
    { user_role_id: 'USER_ROLE_ID_CONFIGURE', user_id: 'USER_ID_CONFIGURE', role_code: 'ROLE_CODE_CONFIGURE', branch_id: 'BRANCH_ID_CONFIGURE', effective_from: '2026-01-01T00:00:00.000Z', effective_to: '', trang_thai: 'ACTIVE' },
  ],
  CONFIG_ROLE_PERMISSION: [
    { role_permission_id: 'ROLE_PERMISSION_ID_CONFIGURE', role_code: 'ROLE_CODE_CONFIGURE', permission_code: 'PERMISSION_CODE_CONFIGURE', trang_thai: 'ACTIVE' },
  ],
  CONFIG_TOPIC: [
    { topic_id: 'TOPIC_ID_CONFIGURE', branch_id: 'BRANCH_ID_CONFIGURE', topic_type: 'TOPIC_TYPE_CONFIGURE', chat_id: 'CHAT_ID_CONFIGURE', message_thread_id: 'THREAD_ID_CONFIGURE', trang_thai: 'ACTIVE' },
  ],
  CONFIG_LENH: [
    { command_code: 'COMMAND_CODE_CONFIGURE', command_text: '/lenh', syntax: '/lenh [tham_so]', description_vi: 'Mô tả lệnh', permission_code: 'PERMISSION_CODE_CONFIGURE', topic_type: 'TOPIC_TYPE_CONFIGURE', worker_workflow: 'WORKFLOW_ID_CONFIGURE', example: '/lenh vi_du', ordinal: '1', trang_thai: 'ACTIVE' },
  ],
};

export const CORE_CONFIG_TEMPLATE = Object.freeze(Object.fromEntries(CORE_SHEET_NAMES.map((sheetName) => [sheetName, Object.freeze({
  sheet_name: sheetName,
  columns: Object.freeze([...CORE_SHEET_DEFINITIONS[sheetName]]),
  rows: Object.freeze((fakeRows[sheetName] ?? []).map((entry) => Object.freeze({ ...entry }))),
})])));

export const ROUTER_CONFIG_TEMPLATE = Object.freeze(Object.fromEntries(ROUTER_SHEET_NAMES.map((sheetName) => [sheetName, Object.freeze({
  sheet_name: sheetName,
  columns: Object.freeze([...ROUTER_SHEET_DEFINITIONS[sheetName]]),
  rows: Object.freeze((fakeRows[sheetName] ?? []).map((entry) => Object.freeze({ ...entry }))),
})])));

export const AUDIT_CONFIG_TEMPLATE = Object.freeze(Object.fromEntries(AUDIT_SHEET_NAMES.map((sheetName) => [sheetName, Object.freeze({
  sheet_name: sheetName,
  columns: Object.freeze([...AUDIT_SHEET_DEFINITIONS[sheetName]]),
  rows: Object.freeze([]),
})])));
