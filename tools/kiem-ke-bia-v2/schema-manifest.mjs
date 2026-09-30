const GROUPS = {
  docs: { label: "Tài liệu", color: "#1F4E78", writer: "TEMPLATE", reader: "ADMIN" },
  config: { label: "Cấu hình", color: "#5B9BD5", writer: "ADMIN", reader: "WF01-WF12" },
  runtime: { label: "Gateway/runtime", color: "#7030A0", writer: "WF01-WF04", reader: "WF01-WF12" },
  intake: { label: "Tiếp nhận/evidence", color: "#C55A11", writer: "WF08/WF09", reader: "WF07/WF10-WF12" },
  ledger: { label: "Ledger chính", color: "#548235", writer: "WF05-WF09", reader: "WF07/WF10-WF12" },
  audit: { label: "Báo cáo/audit", color: "#2F75B5", writer: "WF07/WF10-WF12", reader: "READ_ONLY" },
};

const STATUS_VALUES = ["INACTIVE", "ACTIVE", "PREPARED", "COMMITTED", "FAILED", "RETRYING", "MANUAL_REVIEW", "ARCHIVED", "PURGED", "EMPTY_VERIFIED", "OPEN", "RESOLVED", "PENDING", "APPROVED", "REJECTED", "PUBLISHED", "PREVIEW", "CONFIRMED", "CLOSED", "EXPIRED", "ACTIVE_SESSION", "SHADOW", "V1_PRIMARY", "V2_PRIMARY", "MAINTENANCE", "CHO_SUA_FILE", "SYSTEM_ZERO", "READY", "CLAIMED", "SKIPPED", "WARNING", "RUNNING", "SUCCEEDED"];

const REFERENCE_BY_FIELD = {
  config_version: "CONFIG_VERSION.config_version",
  config_snapshot_id: "CONFIG_SNAPSHOT.config_snapshot_id",
  branch_id: "CONFIG_BRANCH.branch_id",
  topic_id: "CONFIG_TOPIC.topic_id",
  schedule_id: "CONFIG_LICH.schedule_id",
  user_id: "CONFIG_USER.user_id",
  owner_user_id: "CONFIG_USER.user_id",
  actor_user_id: "CONFIG_USER.user_id",
  created_by: "CONFIG_USER.user_id",
  updated_by: "CONFIG_USER.user_id",
  approved_by: "CONFIG_USER.user_id",
  reviewed_by: "CONFIG_USER.user_id",
  published_by: "CONFIG_USER.user_id",
  resolved_by: "CONFIG_USER.user_id",
  role_code: "CONFIG_ROLE.role_code",
  permission_code: "CONFIG_PERMISSION.permission_code",
  item_id: "CONFIG_BIA.item_id",
  conversion_id: "CONFIG_QUY_DOI.conversion_id",
  mapping_id: "CONFIG_MAPPING_NHAP.mapping_id",
  source_config_id: "CONFIG_NGUON_BAN.source_config_id",
  source_column_id: "CONFIG_NGUON_BAN_COT.source_column_id",
  sales_mapping_id: "CONFIG_MAPPING_BAN.sales_mapping_id",
  command_id: "CONFIG_LENH.command_id",
  notification_id: "CONFIG_THONG_BAO.notification_id",
  drive_config_id: "CONFIG_DRIVE.drive_config_id",
  backup_config_id: "CONFIG_BACKUP.backup_config_id",
  cutover_id: "CONFIG_CUTOVER.cutover_id",
  operation_id: "OPERATION.operation_id",
  parent_operation_id: "OPERATION.operation_id",
  source_operation_id: "OPERATION.operation_id",
  invoice_id: "HOA_DON_NHAP.invoice_id",
  evidence_id: "ANH_HOA_DON.evidence_id",
  ocr_raw_id: "OCR_RAW.ocr_raw_id",
  line_id: "DONG_NHAP.line_id",
  sales_upload_id: "DOT_NHAP_BAN.sales_upload_id",
  session_id: "PHIEN_KIEM_KE.session_id",
  opening_balance_id: "TON_DAU_KY.opening_balance_id",
  adjustment_id: "DIEU_CHINH_SO.adjustment_id",
  daily_report_id: "BAO_CAO_NGAY.daily_report_id",
  weekly_report_id: "BAO_CAO_TUAN.weekly_report_id",
  error_id: "ERROR_BIA.error_id",
  archive_id: "ARCHIVE_INDEX.archive_id",
  backup_id: "BACKUP_INDEX.backup_id",
};

const list = (text) => text.split(",").map((value) => value.trim()).filter(Boolean);

const FIELD_OVERRIDES = {
  status: { type: "enum", allowed: STATUS_VALUES },
  trang_thai: { type: "enum", allowed: STATUS_VALUES },
  approval_status: { type: "enum", allowed: ["PENDING", "APPROVED", "REJECTED"] },
  write_state: { type: "enum", allowed: ["PREPARED", "COMMITTED", "FAILED"] },
  commit_state: { type: "enum", allowed: ["PREPARED", "COMMITTED", "FAILED"] },
  missing_item_policy: { type: "enum", allowed: ["ZERO", "BLOCK"] },
  mapping_status: { type: "enum", allowed: ["MAPPED", "UNMAPPED", "AMBIGUOUS", "BLOCKED"] },
  conversion_status: { type: "enum", allowed: ["CONVERTED", "NOT_REQUIRED", "MISSING", "BLOCKED"] },
  quantity_status: { type: "enum", allowed: ["VALID", "ZERO", "BLANK", "NEGATIVE", "BLOCKED"] },
  review_status: { type: "enum", allowed: ["PENDING", "CONFIRMED", "REJECTED", "MANUAL_REVIEW"] },
  error_class: { type: "enum", allowed: ["VALIDATION", "AUTHORIZATION", "CONFLICT", "TRANSIENT", "CONFIGURATION", "EXTERNAL", "SYSTEM", "MANUAL_REVIEW"] },
  retryable: { type: "boolean", allowed: [true, false] },
  tracked: { type: "boolean", allowed: [true, false] },
  enabled: { type: "boolean", allowed: [true, false] },
  required: { type: "boolean", allowed: [true, false] },
  require_separate_approver: { type: "boolean", allowed: [true, false] },
  v1_enabled: { type: "boolean", allowed: [true, false] },
  v2_enabled: { type: "boolean", allowed: [true, false] },
  archive_restore_verified: { type: "boolean", allowed: [true, false] },
  sensitive: { type: "boolean", allowed: [true, false] },
  maintenance_mode: { type: "enum", allowed: ["YES", "NO"] },
  mode: { type: "enum", allowed: ["SHADOW", "V1_PRIMARY", "V2_PRIMARY"] },
};

const TEXT_FIELDS = new Set([
  "id", "code", "name", "description", "text", "value", "scope", "type", "unit", "source", "role", "permission",
  "message", "reason", "explanation", "notes", "locale", "timezone", "language", "pattern", "mode", "target",
  "prefix", "format", "provider", "class", "file_name", "mime_type", "storage_status", "source_type", "severity",
]);

function inferField(name) {
  if (FIELD_OVERRIDES[name]) return { ...FIELD_OVERRIDES[name] };
  if (name.endsWith("_json")) return { type: "json", allowed: "valid JSON text" };
  if (name.endsWith("_at") || name.endsWith("_timestamp")) return { type: "datetime", allowed: "ISO-8601 UTC" };
  if (["business_date", "occurrence_date", "effective_from", "effective_to", "week_start", "week_end", "eligible_after", "retention_expires_at"].includes(name)) {
    return { type: "date", allowed: "yyyy-mm-dd" };
  }
  if (name.endsWith("_hash") || name === "checksum" || name === "content_fingerprint" || name === "schema_hash" || name === "manifest_hash") {
    return { type: "hash", allowed: "SHA-256 hex" };
  }
  if (TEXT_FIELDS.has(name) || name.endsWith("_id") || name.endsWith("_code") || name.endsWith("_name") || name.endsWith("_text")) {
    return { type: "text", allowed: "text" };
  }
  if (name.includes("quantity") || name.includes("amount") || name.includes("price") || name.includes("numerator") || name.includes("denominator") || name.includes("minutes") || name.includes("count") || name.includes("ordinal") || name.includes("attempt") || name.includes("revision") || name.includes("version") || name.includes("row_count")) {
    return { type: "number", allowed: "number" };
  }
  return { type: "text", allowed: "text" };
}

function fieldMeta(name, sheetName, group, overrides = {}) {
  const inferred = inferField(name);
  const privateField = /telegram|file_id|source_message|raw_payload|normalized_payload|drive_file|chat_id|thread_id/i.test(name);
  return {
    name,
    type: overrides.type ?? inferred.type,
    dataClass: privateField ? "PRIVATE" : group === "docs" ? "PUBLIC" : "INTERNAL",
    required: overrides.required ?? ["id", "_id", "operation_id", "branch_id", "business_date"].some((token) => name === token || name.endsWith(token)),
    keyType: overrides.keyType ?? (name.endsWith("_id") || name === "id" ? "PK/FK" : name.includes("idempotency") || name.includes("dispatch_key") ? "IDEMPOTENCY" : name.includes("version") || name.includes("revision") ? "VERSION" : ""),
    reference: overrides.reference ?? REFERENCE_BY_FIELD[name] ?? "",
    allowed: overrides.allowed ?? inferred.allowed,
    writer: overrides.writer ?? GROUPS[group].writer,
    reader: overrides.reader ?? GROUPS[group].reader,
    retention: overrides.retention ?? (group === "docs" ? "template" : group === "audit" ? "policy-configured" : "operational"),
    purpose: overrides.purpose ?? `${name} của ${sheetName}`,
  };
}

function sheet(name, group, headerText, description, options = {}) {
  const headers = list(headerText);
  const overrides = options.fieldOverrides ?? {};
  return {
    name,
    group,
    groupLabel: GROUPS[group].label,
    tabColor: GROUPS[group].color,
    headers,
    description,
    protection: options.protection ?? (group === "config" ? "CONFIG_INPUT" : group === "docs" ? "TEMPLATE" : "PROTECTED_RUNTIME"),
    appendOnly: options.appendOnly ?? (group !== "config" && group !== "docs"),
    fields: headers.map((header) => fieldMeta(header, name, group, overrides[header])),
    rows: options.rows ?? [],
  };
}

const sheets = [
  sheet("README", "docs", "section, key, value, owner, last_updated_at", "Mục tiêu, phạm vi và cách dùng template."),
  sheet("TAB_CATALOG", "docs", "sheet_name, group_name, runtime_role, protected, append_only, primary_key, writer_workflows, reader_workflows, notes", "Danh mục 50 tab."),
  sheet("DATA_DICTIONARY", "docs", "sheet_name, field_name, ordinal, data_type, data_class, required, key_type, reference, allowed_values_or_format, writer, reader, retention, purpose", "Từ điển dữ liệu đầy đủ theo field."),
  sheet("COPY_HEADERS", "docs", "sheet_name, header_row, copy_instruction, protection_mode, initial_status", "Hướng dẫn copy header sang workbook sống."),

  sheet("CONFIG_SCHEMA", "config", "schema_id, sheet_name, field_name, ordinal, data_type, required, key_type, reference, allowed_values, default_value, validation_rule, sensitive, description, schema_version, trang_thai", "Schema versioned của toàn bộ workbook.", { appendOnly: false }),
  sheet("CONFIG_VERSION", "config", "config_version_id, config_version, schema_version, maintenance_mode, config_snapshot_id, generated_at, generated_by, source_workbook_id, source_revision, content_fingerprint, status, notes", "Version cấu hình đã tạo.", { appendOnly: true }),
  sheet("CONFIG_GLOBAL", "config", "config_key, config_value, value_type, scope, effective_from, effective_to, description, trang_thai, updated_by, updated_at", "Giá trị cấu hình toàn cục.", { appendOnly: false }),
  sheet("CONFIG_BRANCH", "config", "branch_id, branch_code, branch_name, timezone, locale, status, effective_from, effective_to, updated_by, updated_at", "Branch và timezone.", { appendOnly: false }),
  sheet("CONFIG_TOPIC", "config", "topic_id, branch_id, topic_type, chat_id, message_thread_id, trang_thai, effective_from, effective_to, updated_by, updated_at", "Telegram topic/chat theo branch.", { appendOnly: false }),
  sheet("CONFIG_LICH", "config", "schedule_id, job_code, worker_workflow, branch_id, timezone, days_of_week, local_time, grace_minutes, max_attempts, effective_from, effective_to, trang_thai, updated_by, updated_at", "Lịch nghiệp vụ cho dispatcher.", { appendOnly: false }),
  sheet("CONFIG_USER", "config", "user_id, telegram_user_id, display_name, username, branch_id, language, trang_thai, created_at, updated_at", "Người dùng Telegram.", { appendOnly: false }),
  sheet("CONFIG_ROLE", "config", "role_code, role_name, description, trang_thai, updated_by, updated_at", "Role.", { appendOnly: false }),
  sheet("CONFIG_PERMISSION", "config", "permission_code, permission_name, description, trang_thai, updated_by, updated_at", "Permission.", { appendOnly: false }),
  sheet("CONFIG_USER_ROLE", "config", "user_role_id, user_id, role_code, branch_id, effective_from, effective_to, trang_thai, updated_by, updated_at", "Gán user vào role/branch.", { appendOnly: false }),
  sheet("CONFIG_ROLE_PERMISSION", "config", "role_permission_id, role_code, permission_code, trang_thai, updated_by, updated_at", "Gán permission vào role.", { appendOnly: false }),
  sheet("CONFIG_BIA", "config", "item_id, item_code, item_name, inventory_unit, decimal_places, quantity_step, minimum_quantity, maximum_quantity, tracked, ordinal, effective_from, effective_to, trang_thai, updated_by, updated_at", "Danh mục bia và quy tắc số đếm theo mặt hàng.", { appendOnly: false, fieldOverrides: {
    decimal_places: { required: true, type: "number", allowed: "non-negative integer" },
    quantity_step: { required: true, type: "number", allowed: "positive number" },
    minimum_quantity: { required: true, type: "number", allowed: "number; must allow zero" },
    maximum_quantity: { required: true, type: "number", allowed: "number greater than or equal to minimum_quantity" },
  } }),
  sheet("CONFIG_QUY_DOI", "config", "conversion_id, item_id, source_unit, target_unit, numerator, denominator, effective_from, effective_to, trang_thai, updated_by, updated_at", "Quy đổi đơn vị.", { appendOnly: false }),
  sheet("CONFIG_MAPPING_NHAP", "config", "mapping_id, source_alias, item_id, source_unit, effective_from, effective_to, trang_thai, updated_by, updated_at", "Mapping alias nhập.", { appendOnly: false }),
  sheet("CONFIG_NGUON_BAN", "config", "source_config_id, source_name, sheet_name_pattern, missing_item_policy, require_separate_approver, effective_from, effective_to, trang_thai, updated_by, updated_at", "Nguồn file bán.", { appendOnly: false }),
  sheet("CONFIG_NGUON_BAN_COT", "config", "source_column_id, source_config_id, column_role, header_alias, required, ordinal, source_unit, effective_from, effective_to, trang_thai, updated_by, updated_at", "Header/cột file bán.", { appendOnly: false }),
  sheet("CONFIG_MAPPING_BAN", "config", "sales_mapping_id, source_config_id, source_item_code, source_item_name, source_unit, item_id, effective_from, effective_to, trang_thai, updated_by, updated_at", "Mapping item bán.", { appendOnly: false }),
  sheet("CONFIG_LENH", "config", "command_id, command_code, command_text, topic_type, permission_code, target_workflow, reply_mode, effective_from, effective_to, trang_thai, updated_by, updated_at", "Command router.", { appendOnly: false }),
  sheet("CONFIG_THONG_BAO", "config", "notification_id, notification_code, event_type, branch_id, topic_type, severity, template_text, enabled, cooldown_minutes, effective_from, effective_to, trang_thai, updated_by, updated_at", "Template thông báo.", { appendOnly: false }),
  sheet("CONFIG_DRIVE", "config", "drive_config_id, branch_id, evidence_folder_id, archive_folder_id, backup_folder_id, archive_workbook_prefix, backup_workbook_prefix, trang_thai, updated_by, updated_at", "Drive folders.", { appendOnly: false }),
  sheet("CONFIG_BACKUP", "config", "backup_config_id, config_key, config_value, value_type, effective_from, effective_to, trang_thai, updated_by, updated_at", "Chính sách backup/restore.", { appendOnly: false }),
  sheet("CONFIG_CUTOVER", "config", "cutover_id, mode, v1_enabled, v2_enabled, ingress_mode, shadow_start_at, shadow_end_at, min_shadow_business_days, archive_restore_verified, approved_by, approved_at, rollback_reason, effective_from, effective_to, trang_thai", "Mode shadow/cutover/rollback.", { appendOnly: false }),

  sheet("CONFIG_SNAPSHOT", "runtime", "config_snapshot_id, config_version, schema_version, config_fingerprint, branch_scope, normalized_config_json, operation_id, created_at, created_by, status, source_revision, expires_at", "Immutable config snapshot.", { appendOnly: true }),
  sheet("OPERATION", "runtime", "operation_id, request_id, event_type, idempotency_key, branch_id, actor_user_id, business_date, config_version, config_snapshot_id, workflow_code, parent_operation_id, status, commit_state, attempt_number, retryable, error_code, error_id, started_at, committed_at, created_at, updated_at", "Operation and commit lifecycle.", { appendOnly: true, fieldOverrides: { error_id: { required: false } } }),
  sheet("DISPATCH_HISTORY", "runtime", "history_id, record_type, dispatch_key, claim_token, operation_id, schedule_id, job_code, worker_workflow, branch_id, occurrence_date, scheduled_at_local, status, attempt_number, retryable, failure_count, error_code, error_id, heartbeat_failure_count, alert_state, critical_alert, recovery_alert, claimed_at, created_at, updated_at", "Dispatcher claim/history.", { appendOnly: true }),
  sheet("HEARTBEAT", "runtime", "heartbeat_id, workflow_code, worker_workflow_id, branch_id, schedule_id, dispatch_key, operation_id, last_started_at, last_seen_at, last_completed_at, status, failure_count, error_code, error_id, alert_state, created_at, updated_at", "Worker liveness.", { appendOnly: true }),
  sheet("STATE_CHO", "runtime", "state_id, branch_id, topic_type, owner_user_id, invoice_id, status, revision, expires_at, updated_at, operation_id", "Conversation/session state.", { appendOnly: false, fieldOverrides: { invoice_id: { required: false } } }),
  sheet("RETRY_CONTEXT", "runtime", "retry_id, operation_id, request_id, workflow_code, event_type, branch_id, idempotency_key, attempt_number, max_attempts, next_retry_at, last_error_code, last_error_id, last_error_class, retryable, status, payload_fingerprint, created_at, updated_at", "Retry and recovery context.", { appendOnly: true }),

  sheet("HOA_DON_NHAP", "intake", "invoice_id, branch_id, owner_user_id, status, business_date, first_received_at, last_activity_at, ocr_requested_at, ocr_raw_id, supplier_recorded, source_type, config_snapshot_id, revision, operation_id, created_at, updated_at", "Invoice intake state.", { appendOnly: false }),
  sheet("ANH_HOA_DON", "intake", "evidence_id, invoice_id, ordinal, branch_id, sender_user_id, source_message_id, telegram_file_id, original_file_name, mime_type, checksum, drive_file_id, storage_status, received_at, created_at", "Original invoice evidence.", { appendOnly: true }),
  sheet("OCR_RAW", "intake", "ocr_raw_id, invoice_id, provider, provider_request_id, evidence_ids_json, raw_payload_json, normalized_payload_json, completed_at, status, error_code, message_safe, created_at, updated_at", "Raw and normalized OCR output.", { appendOnly: true }),
  sheet("DONG_NHAP", "intake", "line_id, invoice_id, ocr_raw_id, source_line_number, source_item_code, item_id, source_unit, inventory_unit, source_quantity, inventory_quantity, numerator, denominator, line_total_before_vat, line_discount_amount, vat_amount, converted_unit_price, supplier_recorded, price_warning_json, review_status, reviewed_by, reviewed_at, review_reason, adjustment_id, operation_id, revision, created_at, updated_at", "Invoice line review.", { appendOnly: false }),
  sheet("DOT_NHAP_BAN", "intake", "sales_upload_id, source_file_id, file_name, file_hash, source_config_id, branch_id, uploaded_at, uploaded_by, config_snapshot_id, normalized_content_hash, require_separate_approver, approver_user_id, status, operation_id, error_code, created_at, updated_at", "Sales file version.", { appendOnly: false }),
  sheet("DONG_BAN_NGUON", "intake", "source_line_id, sales_upload_id, source_file_id, source_file_hash, source_config_id, source_row_number, branch_id, business_date, source_item_code, source_item_name, source_quantity, source_unit, raw_values_json, mapping_status, conversion_status, quantity_status, issue_code, created_at", "Normalized source sales line.", { appendOnly: true }),

  sheet("TON_DAU_KY", "ledger", "opening_balance_id, branch_id, business_date, item_id, quantity_inventory_units, inventory_unit, source_reference, approval_status, approved_by, approved_at, config_snapshot_id, operation_id, created_at, updated_at", "Admin-confirmed opening balance.", { appendOnly: false }),
  sheet("LOG_NHAP", "ledger", "row_id, operation_id, invoice_id, line_id, branch_id, business_date, item_id, inventory_quantity, inventory_unit, converted_unit_price, supplier_recorded, source_evidence_ids_json, calculation_version, config_snapshot_id, status, created_at", "Canonical confirmed purchase ledger.", { appendOnly: true }),
  sheet("LOG_BAN", "ledger", "sales_version_id, sales_upload_id, source_file_id, branch_id, business_date, item_id, quantity_inventory_units, inventory_unit, source, status, file_hash, normalized_content_hash, supersedes_version_id, config_snapshot_id, operation_id, published_by, approver_user_id, created_at, published_at", "Canonical published sales ledger.", { appendOnly: true }),
  sheet("PHIEN_KIEM_KE", "ledger", "session_id, branch_id, business_date, config_snapshot_id, config_version, snapshot_json, status, opened_by, opened_at, expires_at, session_revision, operation_id, write_state, updated_at", "Inventory count session.", { appendOnly: false }),
  sheet("BIA_LOG", "ledger", "entry_id, session_id, branch_id, business_date, config_snapshot_id, ma_bia, ten_bia, don_vi_dem, display_label, ton_thuc_te, revision, supersedes_entry_id, status, explanation, actor_user_id, idempotency_key, operation_id, write_state, created_at, updated_at", "Beer count entries.", { appendOnly: true }),
  sheet("DIEU_CHINH_SO", "ledger", "adjustment_id, branch_id, business_date, item_id, adjustment_type, quantity_inventory_units, inventory_unit, reason_code, reason_text, source_operation_id, supersedes_adjustment_id, approved_by, approved_at, config_snapshot_id, status, created_by, created_at, updated_at", "Versioned ledger adjustments.", { appendOnly: true }),

  sheet("BAO_CAO_NGAY", "audit", "daily_report_id, branch_id, business_date, item_id, inventory_unit, session_id, config_snapshot_id, opening_quantity, purchase_quantity, sales_quantity, adjustment_quantity, theoretical_quantity, actual_quantity, variance_quantity, explanation, status, report_version, supersedes_report_id, operation_id, approved_by, approved_at, created_at, updated_at", "Daily reconciliation report.", { appendOnly: true }),
  sheet("BAO_CAO_TUAN", "audit", "weekly_report_id, branch_id, week_start, week_end, item_id, inventory_unit, opening_quantity, purchase_quantity, sales_quantity, adjustment_quantity, actual_quantity, variance_quantity, exception_count, source_daily_version_max, report_version, supersedes_report_id, status, operation_id, created_at, updated_at", "Weekly report.", { appendOnly: true }),
  sheet("EVENT_LOG", "audit", "event_id, operation_id, request_id, event_type, source_workflow, actor_user_id, branch_id, business_date, entity_type, entity_id, idempotency_key, event_payload_json, status, created_at", "Auditable domain events.", { appendOnly: true }),
  sheet("ERROR_BIA", "audit", "error_id, operation_id, request_id, workflow_code, node_name, error_code, error_class, retryable, message_safe, sanitized_context_json, branch_id, actor_user_id, business_date, status, notified_at, resolved_by, resolved_at, created_at, updated_at", "Sanitized operational errors.", { appendOnly: true }),
  sheet("ARCHIVE_INDEX", "audit", "archive_id, archive_week_start, archive_week_end, branch_id, source_workbook_id, archive_workbook_id, manifest_hash, source_row_counts_json, status, verified_at, purged_at, eligible_after, operation_id, created_at, updated_at", "Archive manifest/index.", { appendOnly: true }),
  sheet("BACKUP_INDEX", "audit", "backup_id, source_workbook_id, backup_file_id, backup_file_name, backup_at, content_fingerprint, schema_hash, row_counts_json, status, verified_at, restore_tested_at, retention_expires_at, operation_id, created_at, updated_at", "Backup manifest/index.", { appendOnly: true }),
];

const allFields = sheets.flatMap((entry) => entry.fields.map((field, index) => ({ ...field, sheetName: entry.name, ordinal: index + 1 })));

const placeholderValue = (field) => {
  if (["status", "trang_thai"].includes(field.name)) return "INACTIVE";
  if (field.type === "boolean") return false;
  if (field.type === "number") return 0;
  if (field.type === "json") return "{}";
  if (field.type === "date") return null;
  if (field.type === "datetime") return null;
  if (field.type === "hash") return "HASH_CONFIGURE";
  if (field.name.endsWith("_id") || field.name === "schema_id") return `${field.name.toUpperCase()}_CONFIGURE`;
  return "CONFIGURE";
};

const configRows = new Map();
for (const entry of sheets.filter((item) => item.group === "config")) {
  configRows.set(entry.name, [entry.fields.map(placeholderValue)]);
}

const readmeRows = [
  ["workbook", "name", "Kiểm kê bia V2 — template 50 tab", "ADMIN", "2026-09-29"],
  ["workbook", "authority", "Workbook sống trên Google Sheets là nguồn dữ liệu nghiệp vụ", "ADMIN", "2026-09-29"],
  ["workbook", "template_policy", "Config có placeholder INACTIVE; runtime/ledger chỉ có header", "ADMIN", "2026-09-29"],
  ["workbook", "timezone_rule", "business_date theo branch; *_at là ISO-8601 UTC", "ADMIN", "2026-09-29"],
  ["security", "secrets", "Không ghi credential, token, private data hoặc ID thật vào template", "ADMIN", "2026-09-29"],
  ["deployment", "activation", "Chỉ activate sau shadow, archive/restore và owner approval", "OWNER", "2026-09-29"],
];

const tabCatalogRows = sheets.map((entry) => [
  entry.name,
  entry.groupLabel,
  entry.description,
  entry.protection !== "TEMPLATE",
  entry.appendOnly,
  entry.fields.filter((field) => field.keyType.includes("PK")).map((field) => field.name).join(", "),
  entry.fields.map((field) => field.writer).filter((value, index, values) => values.indexOf(value) === index).join(", "),
  entry.fields.map((field) => field.reader).filter((value, index, values) => values.indexOf(value) === index).join(", "),
  entry.protection,
]);

const dataDictionaryRows = allFields.map((field) => [
  field.sheetName,
  field.name,
  field.ordinal,
  field.type,
  field.dataClass,
  field.required,
  field.keyType,
  field.reference,
  Array.isArray(field.allowed) ? field.allowed.join(" | ") : field.allowed,
  field.writer,
  field.reader,
  field.retention,
  field.purpose,
]);

const copyHeaderRows = sheets.map((entry) => [
  entry.name,
  1,
  entry.group === "docs" ? "Giữ lại trong template; không dùng làm runtime ledger" : "Copy hàng 1 sang workbook sống; không đổi tên header",
  entry.protection,
  entry.group === "config" ? "INACTIVE" : "HEADER_ONLY",
]);

for (const entry of sheets) {
  if (entry.name === "README") entry.rows = readmeRows;
  if (entry.name === "TAB_CATALOG") entry.rows = tabCatalogRows;
  if (entry.name === "DATA_DICTIONARY") entry.rows = dataDictionaryRows;
  if (entry.name === "COPY_HEADERS") entry.rows = copyHeaderRows;
  if (configRows.has(entry.name)) entry.rows = configRows.get(entry.name);
}

export const schemaManifest = {
  manifestVersion: "kkb-v2-schema-2026-09-29",
  generatedDate: "2026-09-29",
  workbookName: "KKB_V2_WORKBOOK_TEMPLATE",
  sheetCount: sheets.length,
  groups: GROUPS,
  statusValues: STATUS_VALUES,
  sheets,
};

export const sheetNames = sheets.map((entry) => entry.name);
