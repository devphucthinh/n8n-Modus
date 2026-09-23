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

export const ROUTER_SHEET_DEFINITIONS = Object.freeze({
  CONFIG_ROLE: ['role_code', 'role_name', 'description_vi', 'trang_thai'],
  CONFIG_PERMISSION: ['permission_code', 'permission_name', 'description_vi', 'trang_thai'],
  CONFIG_USER_ROLE: ['user_role_id', 'user_id', 'role_code', 'branch_id', 'effective_from', 'effective_to', 'trang_thai'],
  CONFIG_ROLE_PERMISSION: ['role_permission_id', 'role_code', 'permission_code', 'trang_thai'],
  CONFIG_TOPIC: ['topic_id', 'branch_id', 'topic_type', 'chat_id', 'message_thread_id', 'trang_thai'],
  CONFIG_LENH: ['command_code', 'command_text', 'syntax', 'description_vi', 'permission_code', 'topic_type', 'worker_workflow', 'example', 'ordinal', 'trang_thai'],
});

export const ROUTER_SHEET_NAMES = Object.freeze(Object.keys(ROUTER_SHEET_DEFINITIONS));
export const AUDIT_SHEET_DEFINITIONS = Object.freeze({
  EVENT_LOG: ['event_id', 'event_type', 'request_id', 'operation_id', 'actor_user_id', 'branch_id', 'topic_type', 'command', 'outcome', 'error_code', 'created_at', 'trang_thai'],
});
export const AUDIT_SHEET_NAMES = Object.freeze(Object.keys(AUDIT_SHEET_DEFINITIONS));
export const DISPATCHER_SHEET_DEFINITIONS = Object.freeze({
  CONFIG_LICH: ['schedule_id', 'job_code', 'branch_id', 'local_time', 'timezone', 'days_of_week', 'grace_window_minutes', 'retry_limit', 'retry_delay_minutes', 'worker_workflow', 'enabled', 'trang_thai'],
});
export const DISPATCHER_SHEET_NAMES = Object.freeze(Object.keys(DISPATCHER_SHEET_DEFINITIONS));
export const ALL_SHEET_DEFINITIONS = Object.freeze({ ...CORE_SHEET_DEFINITIONS, ...ROUTER_SHEET_DEFINITIONS, ...AUDIT_SHEET_DEFINITIONS, ...DISPATCHER_SHEET_DEFINITIONS });
export const ALL_SHEET_NAMES = Object.freeze(Object.keys(ALL_SHEET_DEFINITIONS));
