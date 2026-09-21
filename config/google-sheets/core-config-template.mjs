import { CORE_SHEET_DEFINITIONS, CORE_SHEET_NAMES } from '../../src/contracts/core-sheet-schema.mjs';

const fakeRows = {
  CONFIG_VERSION: [{ config_version: 'v1', schema_version: '1.0', maintenance_mode: 'NO', changed_by: 'SET_IN_GOOGLE_SHEET', changed_at: '2026-09-19T01:00:00.000Z', change_note: 'baseline', trang_thai: 'ACTIVE' }],
  CONFIG_GLOBAL: [{ config_key: 'DEFAULT_TIMEZONE', config_value: 'Asia/Ho_Chi_Minh', value_type: 'STRING', description_vi: 'Múi giờ mặc định', trang_thai: 'ACTIVE' }],
  CONFIG_BRANCH: [{ branch_id: 'BRANCH_ID_CONFIGURE', branch_name: 'Tên chi nhánh cần cấu hình', forum_chat_id: 'CHAT_ID_CONFIGURE', owner_chat_id: 'CHAT_ID_CONFIGURE', timezone: 'Asia/Ho_Chi_Minh', trang_thai: 'ACTIVE' }],
  CONFIG_USER: [{ user_id: 'USER_ID_CONFIGURE', display_name: 'Người dùng cần cấu hình', branch_id: 'BRANCH_ID_CONFIGURE', trang_thai: 'ACTIVE' }],
  CONFIG_THONG_BAO: [{ message_key: 'STATUS_HEADER', message_text: 'Trạng thái Kiểm kê bia V2', locale: 'vi-VN', trang_thai: 'ACTIVE' }],
  CONFIG_SCHEMA: [],
  CONFIG_SNAPSHOT: [],
  OPERATION: [],
  ERROR_BIA: [],
};

export const CORE_CONFIG_TEMPLATE = Object.freeze(Object.fromEntries(CORE_SHEET_NAMES.map((sheetName) => [sheetName, Object.freeze({
  sheet_name: sheetName,
  columns: Object.freeze([...CORE_SHEET_DEFINITIONS[sheetName]]),
  rows: Object.freeze((fakeRows[sheetName] ?? []).map((entry) => Object.freeze({ ...entry }))),
})])));
