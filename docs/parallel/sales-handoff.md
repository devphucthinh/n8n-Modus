# Handoff — WF09_V2_BAO_CAO_BAN

Lane C implements the deterministic sales-report ingestion slice from `d199eca`. It does not read Google Sheets or Google Drive, call Telegram, activate n8n, or contain credentials. The live Google Sheet remains the authoritative source of the configuration listed below.

## Implemented pure pipeline

The modules under `src/sales-ingestion/` expose the following seams:

- `source-config.mjs`: `matchSourceConfigs`, `selectSourceConfig`, `normalizeBusinessDate`, and `splitByBusinessDate`.
- `normalize-sales.mjs`: `normalizeSourceRows` preserves every Dòng bán nguồn, applies configured mapping and quy đổi, and `previewSales` returns `PREVIEW_READY`, `BLOCKED`, `CHO_SUA_FILE`, or `ADJUSTMENT_REQUIRED` without writing a ledger.
- `versioned-ledger.mjs`: `dedupeSalesFile`, `computeNormalizedContentHash`, `planPublish`, `createSystemZero`, `createAdjustmentForNegative`, and `authorizeSalesPublish` produce immutable/versioned write plans.

`SYSTEM_ZERO` is blocked by a pending `CHO_SUA_FILE`. A real file creates a new `FILE` version that supersedes the active `SYSTEM_ZERO`, including when the normalized content is also all zero. Same file hash is `DUPLICATE_FILE`; a different file with the same normalized content is `NO_CHANGE`. Negative quantities are never published automatically and produce a pending `DIEU_CHINH_SO` plan. `require_separate_approver=YES` rejects self-publish.

`workflow-src/WF09_V2_BAO_CAO_BAN.mjs` and `workflows/WF09_V2_BAO_CAO_BAN.json` are an inactive, self-contained Execute Workflow worker export. It intentionally has no Telegram Trigger, Google Sheets node, Drive node, or Telegram node; production wiring must pass the Config Gateway snapshot and evidence/ledger adapters through the shared envelope.

## Expected configuration tables and columns

Column names below are the proposed stable ASCII keys. `trang_thai` is an active/inactive lifecycle field unless another status is explicitly stated.

| Table | Exact expected columns | Used by |
|---|---|---|
| `CONFIG_NGUON_BAN` | `source_config_id`, `source_name`, `sheet_name_pattern`, `missing_item_policy`, `require_separate_approver`, `trang_thai` | Source matching, `ZERO`/`BLOCK`, separate approver policy |
| `CONFIG_NGUON_BAN_COT` | `source_column_id`, `source_config_id`, `column_role`, `header_alias`, `required`, `ordinal`, `trang_thai` | Header aliases and roles: `business_date`, `branch_id`, `item_code`, `item_name`, `quantity`, `unit` |
| `CONFIG_BIA` | `item_id`, `item_code`, `item_name`, `inventory_unit`, `tracked`, `ordinal`, `trang_thai` | Tracked-item catalogue and canonical Đơn vị kiểm kê |
| `CONFIG_MAPPING_BAN` | `sales_mapping_id`, `source_config_id`, `source_item_code`, `source_item_name`, `item_id`, `trang_thai` | Source mã hàng → Mã mặt hàng mapping |
| `CONFIG_QUY_DOI` | `conversion_id`, `item_id`, `source_unit`, `target_unit`, `numerator`, `denominator`, `effective_from`, `effective_to`, `trang_thai` | Date-effective unit conversion; no inferred units |
| `CONFIG_BRANCH` | `branch_id`, `branch_name`, `forum_chat_id`, `owner_chat_id`, `timezone`, `trang_thai` | Branch identity and local business-date context |
| `CONFIG_LICH` | `schedule_id`, `job_code`, `branch_id`, `run_at`, `timezone`, `grace_minutes`, `enabled`, `trang_thai` | Missing-sales cutoff and Dispatcher handoff for `SYSTEM_ZERO` |
| `CONFIG_THONG_BAO` | `message_key`, `message_text`, `locale`, `trang_thai` | Missing-data, preview, and correction notices |
| `CONFIG_VERSION` / `CONFIG_SNAPSHOT` | Existing Issue #2 columns and immutable snapshot reference | `config_version` and `config_snapshot_id` on every upload/version |
| `CONFIG_ROLE_PERMISSION` / `CONFIG_USER_ROLE` | Existing role-permission and branch-scoped user-role columns | `NHAP_BAN`, `BAO_CAO`, `ADMIN`, and separate approver authorization |

`missing_item_policy` accepts only `ZERO` or `BLOCK`; `require_separate_approver` accepts `YES` or `NO`. These are configuration values, not workflow defaults.

## Expected ledger and audit tables/columns

| Table | Exact expected columns | Lifecycle/notes |
|---|---|---|
| `OPERATION` | Existing Issue #2 columns: `operation_id`, `request_id`, `operation_type`, `idempotency_key`, `expected_row_count`, `actual_row_count`, `checksum`, `status`, `error_id`, `created_at`, `updated_at` | `PREPARED` → `COMMITTED`; retry reuses `operation_id` |
| `DOT_NHAP_BAN` | `sales_upload_id`, `source_file_id`, `file_name`, `file_hash`, `source_config_id`, `branch_id`, `uploaded_at`, `uploaded_by`, `config_snapshot_id`, `normalized_content_hash`, `require_separate_approver`, `approver_user_id`, `status`, `operation_id`, `error_code`, `created_at`, `updated_at` | File evidence/header; `CHO_SUA_FILE` remains visible and blocks zero |
| `DONG_BAN_NGUON` | `source_line_id`, `sales_upload_id`, `source_file_id`, `source_file_hash`, `source_config_id`, `source_row_number`, `branch_id`, `business_date`, `source_item_code`, `source_item_name`, `source_quantity`, `source_unit`, `raw_values_json`, `mapping_status`, `conversion_status`, `quantity_status`, `issue_code`, `created_at` | Append-only Dòng bán nguồn; retain raw values before mapping/quy đổi |
| `LOG_BAN` | `sales_version_id`, `sales_upload_id`, `source_file_id`, `branch_id`, `business_date`, `item_id`, `quantity_inventory_units`, `inventory_unit`, `source`, `status`, `file_hash`, `normalized_content_hash`, `supersedes_version_id`, `config_snapshot_id`, `operation_id`, `published_by`, `approver_user_id`, `created_at`, `published_at` | Canonical Sổ bán bia, as fixed by the V2 spec; append new version, retain `SUPERSEDED` history, never add real file quantities to `SYSTEM_ZERO` |
| `DIEU_CHINH_SO` | `adjustment_id`, `adjustment_type`, `reference_source_line_id`, `sales_upload_id`, `branch_id`, `business_date`, `item_id`, `quantity_inventory_units`, `reason`, `status`, `created_by`, `approved_by`, `operation_id`, `created_at`, `approved_at` | Negative sales require a reviewable adjustment; no automatic ledger effect |
| `EVENT_LOG` | `event_id`, `event_key`, `request_id`, `operation_id`, `event_type`, `status`, `error_code`, `created_at`, `processed_at` | Technical idempotency and retry audit |
| `ERROR_BIA` | Existing Issue #2 columns: `error_id`, `error_code`, `error_class`, `retryable`, `message_safe`, `workflow`, `node`, `operation_id`, `request_id`, `config_version`, `fingerprint`, `status`, `created_at`, `resolved_at` | Safe errors only; no secrets |

The active Sổ bán bia for a branch and Ngày kinh doanh is the `LOG_BAN` version with `status=ACTIVE`. A replacement carries `supersedes_version_id`; the old row remains auditable with `status=SUPERSEDED`.

## Shared schema gaps to resolve before live integration

No shared contract was edited in this lane. The Issue #2 `CORE_SHEET_DEFINITIONS` currently covers only the nine core tabs and does not declare the sales-specific tables or their references. Before live integration, the owning schema lane should:

1. The shared contract defines `CONFIG_NGUON_BAN`, `CONFIG_NGUON_BAN_COT`, `CONFIG_BIA`, `CONFIG_MAPPING_BAN`, `CONFIG_QUY_DOI`, `CONFIG_LICH`, `DOT_NHAP_BAN`, `DONG_BAN_NGUON`, `LOG_BAN`, and `DIEU_CHINH_SO`.
2. Add unique keys and references: source-column/mapping rows → `CONFIG_NGUON_BAN`; mappings/conversions → `CONFIG_BIA`; upload/version/source rows → `CONFIG_BRANCH`, `CONFIG_SNAPSHOT`, and `OPERATION`; adjustments → source lines and uploads.
3. Lock allowed-value sets for policies and lifecycle statuses, including `ZERO`, `BLOCK`, `PREVIEW_READY`, `CHO_SUA_FILE`, `ADJUSTMENT_REQUIRED`, `ACTIVE`, `SUPERSEDED`, `SYSTEM_ZERO`, `PREPARED`, and `COMMITTED`.
4. Decide whether the live canonical item keys use the proposed ASCII names or the legacy aliases (`ma_bia`, `don_vi_dem`, `theo_doi`). The pure module currently accepts the documented canonical names plus the existing glossary-compatible aliases for fixture interoperability.
5. Define the sales mapping table explicitly. The current baseline lists `CONFIG_MAPPING_NHAP` for purchase/OCR mapping but no sales-specific mapping table.
6. Define retention and protection rules for `DONG_BAN_NGUON`, `DOT_NHAP_BAN`, `LOG_BAN`, and `DIEU_CHINH_SO`; all are operational records and must not be corrected by direct Sheet edits.

## Live smoke tests needed after adapters are integrated

Run only against a dedicated test Google Sheet, Drive folder, Telegram bot/topic, and test branch. Do not activate production workflows until these pass:

1. Config Gateway returns a committed `config_snapshot_id` containing all sales config tables and the worker rejects stale/missing schema.
2. Upload one known source with header aliases; verify the original file is retained, Dòng bán nguồn rows preserve raw values, and mapping/quy đổi produce canonical units.
3. Upload a file containing two Ngày kinh doanh values after both dates have passed; verify two Bản bán hàng nháp records use the dates in the file, not upload time.
4. Present no matching source and multiple matching sources; verify `CHO_SUA_FILE`/selection behavior and no publish plan before explicit source selection.
5. Verify `ZERO` fills absent tracked items while `BLOCK` prevents publish; verify untracked items are intentionally ignored and unknown mã hàng blocks the file.
6. Upload the same file twice; verify the second attempt is `DUPLICATE_FILE` with no new version. Upload a different file with identical normalized content; verify `NO_CHANGE`.
7. Run the missing-sales cutoff with no pending file; verify one `SYSTEM_ZERO` version and one configured notification. Repeat the job with the same operation/idempotency key and verify no duplicate.
8. Leave a file in `CHO_SUA_FILE`; verify the cutoff refuses `SYSTEM_ZERO` and the day remains blocked until sửa or admin hủy có lý do.
9. Publish a real file after `SYSTEM_ZERO`; verify one new `FILE` version supersedes the zero version and the quantities are not added to zero quantities.
10. Upload a negative quantity; verify no `LOG_BAN` publish, a `DIEU_CHINH_SO` row is pending review, and the source evidence remains available.
11. Set `require_separate_approver=YES`; verify the uploader cannot publish their own draft, while a different authorized approver can.
12. After a controlled correction on a closed day, verify the old Sổ bán bia remains unchanged, a new version/adjustment is linked, and downstream Báo cáo ngày is reissued by the Dispatcher with audit.
