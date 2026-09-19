export const CORE_SHEET_DEFINITIONS = Object.freeze({
  CONFIG_SCHEMA: ['schema_rule_id', 'schema_version', 'sheet_name', 'column_name', 'data_type', 'required', 'unique_group', 'reference_sheet', 'reference_column', 'allowed_values', 'ordinal', 'description_vi', 'trang_thai'],
  CONFIG_VERSION: ['config_version', 'schema_version', 'maintenance_mode', 'changed_by', 'changed_at', 'change_note', 'trang_thai'],
  CONFIG_GLOBAL: ['config_key', 'config_value', 'value_type', 'description_vi', 'trang_thai'],
  CONFIG_BRANCH: ['branch_id', 'branch_name', 'forum_chat_id', 'owner_chat_id', 'timezone', 'trang_thai'],
  CONFIG_USER: ['user_id', 'display_name', 'branch_id', 'trang_thai'],
  CONFIG_THONG_BAO: ['message_key', 'message_text', 'locale', 'trang_thai'],
  CONFIG_SNAPSHOT: ['config_snapshot_id', 'config_version', 'schema_version', 'fingerprint', 'normalized_config_json', 'operation_id', 'status', 'created_at'],
  OPERATION: ['operation_id', 'request_id', 'operation_type', 'idempotency_key', 'expected_row_count', 'actual_row_count', 'checksum', 'status', 'error_id', 'created_at', 'updated_at'],
  ERROR_BIA: ['error_id', 'error_code', 'error_class', 'retryable', 'message_safe', 'workflow', 'node', 'operation_id', 'request_id', 'config_version', 'fingerprint', 'status', 'created_at', 'resolved_at'],
});

export const CORE_SHEET_NAMES = Object.freeze(Object.keys(CORE_SHEET_DEFINITIONS));
