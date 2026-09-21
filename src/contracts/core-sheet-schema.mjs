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

// The Issue #2 core contract stays intentionally stable. These are the
// approved V2 extensions shared by Dispatcher, Nhập hàng, Bán hàng and Kiểm
// kê. Business configuration remains Sheet data; workflow code only consumes
// these stable ASCII keys.
export const EXTENDED_SHEET_DEFINITIONS = Object.freeze({
  CONFIG_LICH: [
    'schedule_id', 'job_code', 'worker_workflow', 'branch_id', 'timezone',
    'days_of_week', 'local_time', 'grace_minutes', 'max_attempts', 'trang_thai',
  ],
  DISPATCH_HISTORY: [
    'history_id', 'record_type', 'dispatch_key', 'claim_token', 'operation_id',
    'schedule_id', 'job_code', 'worker_workflow', 'branch_id', 'occurrence_date',
    'scheduled_at_local', 'status', 'attempt_number', 'retryable', 'failure_count',
    'error_code', 'error_id', 'heartbeat_failure_count', 'alert_state',
    'critical_alert', 'recovery_alert', 'claimed_at', 'created_at', 'updated_at',
  ],
  CONFIG_TOPIC: [
    'topic_id', 'branch_id', 'topic_type', 'chat_id', 'message_thread_id', 'trang_thai',
  ],
  CONFIG_DRIVE: [
    'drive_config_id', 'branch_id', 'evidence_folder_id', 'archive_folder_id',
    'backup_folder_id', 'trang_thai',
  ],
  CONFIG_BIA: [
    'item_id', 'item_code', 'item_name', 'inventory_unit', 'tracked', 'ordinal', 'trang_thai',
  ],
  CONFIG_QUY_DOI: [
    'conversion_id', 'item_id', 'source_unit', 'target_unit', 'numerator', 'denominator',
    'effective_from', 'effective_to', 'trang_thai',
  ],
  CONFIG_MAPPING_NHAP: [
    'mapping_id', 'source_alias', 'item_id', 'source_unit', 'effective_from', 'effective_to', 'trang_thai',
  ],
  CONFIG_NGUON_BAN: [
    'source_config_id', 'source_name', 'sheet_name_pattern', 'missing_item_policy',
    'require_separate_approver', 'trang_thai',
  ],
  CONFIG_NGUON_BAN_COT: [
    'source_column_id', 'source_config_id', 'column_role', 'header_alias', 'required', 'ordinal', 'trang_thai',
  ],
  CONFIG_MAPPING_BAN: [
    'sales_mapping_id', 'source_config_id', 'source_item_code', 'source_item_name', 'item_id', 'trang_thai',
  ],
  CONFIG_ROLE_PERMISSION: [
    'role_permission_id', 'role_code', 'permission_code', 'trang_thai',
  ],
  CONFIG_USER_ROLE: [
    'user_role_id', 'user_id', 'role_code', 'branch_id', 'effective_from', 'effective_to', 'trang_thai',
  ],
  STATE_CHO: [
    'state_id', 'branch_id', 'topic_type', 'owner_user_id', 'invoice_id', 'status', 'revision',
    'expires_at', 'updated_at', 'operation_id',
  ],
  HOA_DON_NHAP: [
    'invoice_id', 'branch_id', 'owner_user_id', 'status', 'business_date', 'first_received_at',
    'last_activity_at', 'ocr_requested_at', 'ocr_raw_id', 'supplier_recorded', 'source_type',
    'config_snapshot_id', 'revision', 'operation_id', 'created_at', 'updated_at',
  ],
  ANH_HOA_DON: [
    'evidence_id', 'invoice_id', 'ordinal', 'branch_id', 'sender_user_id', 'source_message_id',
    'telegram_file_id', 'original_file_name', 'mime_type', 'checksum', 'drive_file_id',
    'storage_status', 'received_at', 'created_at',
  ],
  OCR_RAW: [
    'ocr_raw_id', 'invoice_id', 'provider', 'evidence_ids_json', 'raw_payload_json',
    'completed_at', 'status', 'created_at',
  ],
  DONG_NHAP: [
    'line_id', 'invoice_id', 'ocr_raw_id', 'source_line_number', 'source_item_code', 'item_id',
    'source_unit', 'inventory_unit', 'source_quantity', 'inventory_quantity', 'numerator',
    'denominator', 'line_total_before_vat', 'line_discount_amount', 'vat_amount',
    'converted_unit_price', 'supplier_recorded', 'price_warning_json', 'review_status',
    'reviewed_by', 'reviewed_at', 'review_reason', 'adjustment_id', 'operation_id', 'revision',
    'created_at', 'updated_at',
  ],
  LOG_NHAP: [
    'row_id', 'operation_id', 'invoice_id', 'line_id', 'branch_id', 'business_date', 'item_id',
    'inventory_quantity', 'inventory_unit', 'converted_unit_price', 'supplier_recorded',
    'source_evidence_ids_json', 'calculation_version', 'config_snapshot_id', 'status', 'created_at',
  ],
  DOT_NHAP_BAN: [
    'sales_upload_id', 'source_file_id', 'file_name', 'file_hash', 'source_config_id', 'branch_id',
    'uploaded_at', 'uploaded_by', 'config_snapshot_id', 'normalized_content_hash',
    'require_separate_approver', 'approver_user_id', 'status', 'operation_id', 'error_code',
    'created_at', 'updated_at',
  ],
  DONG_BAN_NGUON: [
    'source_line_id', 'sales_upload_id', 'source_file_id', 'source_file_hash', 'source_config_id',
    'source_row_number', 'branch_id', 'business_date', 'source_item_code', 'source_item_name',
    'source_quantity', 'source_unit', 'raw_values_json', 'mapping_status', 'conversion_status',
    'quantity_status', 'issue_code', 'created_at',
  ],
  LOG_BAN: [
    'sales_version_id', 'sales_upload_id', 'source_file_id', 'branch_id', 'business_date', 'item_id',
    'quantity_inventory_units', 'inventory_unit', 'source', 'status', 'file_hash',
    'normalized_content_hash', 'supersedes_version_id', 'config_snapshot_id', 'operation_id',
    'published_by', 'approver_user_id', 'created_at', 'published_at',
  ],
  PHIEN_KIEM_KE: [
    'session_id', 'branch_id', 'business_date', 'config_snapshot_id', 'config_version',
    'snapshot_json', 'status', 'opened_by', 'opened_at', 'expires_at', 'session_revision',
    'operation_id', 'write_state', 'updated_at',
  ],
  BIA_LOG: [
    'entry_id', 'session_id', 'branch_id', 'business_date', 'config_snapshot_id', 'ma_bia',
    'ten_bia', 'don_vi_dem', 'display_label', 'ton_thuc_te', 'revision', 'supersedes_entry_id',
    'status', 'explanation', 'actor_user_id', 'idempotency_key', 'operation_id', 'write_state',
    'created_at', 'updated_at',
  ],
  DIEU_CHINH_SO: [
    'adjustment_id', 'source_type', 'adjustment_type', 'source_invoice_id', 'source_line_id',
    'sales_upload_id', 'session_id', 'branch_id', 'business_date', 'item_id', 'ma_bia',
    'quantity_delta', 'quantity_inventory_units', 'inventory_unit', 'reason', 'created_by',
    'approved_by', 'status', 'operation_id', 'created_at', 'approved_at',
  ],
  EVENT_LOG: [
    'event_id', 'event_key', 'technical_key', 'request_id', 'operation_id', 'event_type', 'status',
    'error_code', 'branch_id', 'actor_user_id', 'entity_type', 'entity_id', 'outcome',
    'write_state', 'created_at', 'processed_at',
  ],
});

export const EXTENDED_SHEET_NAMES = Object.freeze(Object.keys(EXTENDED_SHEET_DEFINITIONS));
export const EXTENDED_CONFIG_SHEET_NAMES = Object.freeze([
  'CONFIG_LICH',
  'CONFIG_TOPIC',
  'CONFIG_DRIVE',
  'CONFIG_BIA',
  'CONFIG_QUY_DOI',
  'CONFIG_MAPPING_NHAP',
  'CONFIG_NGUON_BAN',
  'CONFIG_NGUON_BAN_COT',
  'CONFIG_MAPPING_BAN',
  'CONFIG_ROLE_PERMISSION',
  'CONFIG_USER_ROLE',
]);
export const CONFIG_SHEET_NAMES = Object.freeze([
  'CONFIG_SCHEMA',
  'CONFIG_VERSION',
  'CONFIG_GLOBAL',
  'CONFIG_BRANCH',
  'CONFIG_USER',
  'CONFIG_THONG_BAO',
  ...EXTENDED_CONFIG_SHEET_NAMES,
]);
export const GATEWAY_SHEET_NAMES = Object.freeze([
  ...CONFIG_SHEET_NAMES,
  'CONFIG_SNAPSHOT',
  'OPERATION',
  'ERROR_BIA',
]);
export const ALL_SHEET_DEFINITIONS = Object.freeze({
  ...CORE_SHEET_DEFINITIONS,
  ...EXTENDED_SHEET_DEFINITIONS,
});
export const ALL_SHEET_NAMES = Object.freeze(Object.keys(ALL_SHEET_DEFINITIONS));
