# Lane handoff — WF08_V2_HOA_DON_NHAP

## Delivered

This lane adds pure purchase-ingestion logic under `src/purchase-ingestion/`:

- `album.mjs`: creates and groups a Bộ ảnh hóa đơn, enforces `max_images_per_invoice` in the configured range `5..10`, records Chứng từ gốc metadata, applies owner-only mutation, handles Lặp kỹ thuật, and transitions Hóa đơn nháp TTL without starting OCR.
- `ocr.mjs`: keeps Kết quả OCR gốc separate from the reviewed invoice version.
- `review.mjs`: models Dòng nhập bia review terminal states, Điều chỉnh sổ routing, unit-independent price-warning acknowledgement, and supplier normalization.
- `conversion.mjs`: requires explicit source/target units and numerator/denominator inputs and calculates Giá nhập quy đổi.
- `ledger-plan.mjs`: builds a `PREPARED` staged write with an `OPERATION` row and only `CONFIRMED` lines for the proposed physical ledger sheet.
- `ports.mjs`: defines the only allowed I/O boundary: source-evidence storage, Gemini OCR, and staged/committed ledger storage.

`workflow-src/WF08_V2_HOA_DON_NHAP.mjs` and `workflows/WF08_V2_HOA_DON_NHAP.json` are inactive and contain only an Execute Workflow Trigger, a Config Gateway placeholder, and adapter-boundary placeholders. No live credential, token, Drive call, Gemini call, Google Sheet call, or workflow activation was performed.

## Expected configuration tables and columns

These are the columns the pure module and adapter plan expect. They are a proposal for the shared schema, not a change to `src/contracts/core-sheet-schema.mjs`.

| Table | Expected columns / values |
|---|---|
| `CONFIG_GLOBAL` | `config_key`, `config_value`, `value_type`, `description_vi`, `trang_thai`; keys include `max_images_per_invoice` (integer `5..10`), `draft_ttl_minutes`, `price_warning_threshold_ratio`, Gemini model/timeout/retry keys, and `calculation_version`. |
| `CONFIG_BRANCH` | Existing core columns `branch_id`, `branch_name`, `forum_chat_id`, `owner_chat_id`, `timezone`, `trang_thai`; purchase review additionally needs branch-level `require_separate_approver` (`YES`/`NO`) or an explicitly approved alternative. |
| `CONFIG_TOPIC` | `topic_id`, `branch_id`, `topic_type`, `chat_id`, `message_thread_id`, `trang_thai`; `topic_type=NHAP_HOA_DON` identifies the branch receiving a Hóa đơn nháp. |
| `CONFIG_DRIVE` | `drive_config_id`, `branch_id`, `evidence_folder_id`, `archive_folder_id`, `backup_folder_id`, `trang_thai`. |
| `CONFIG_BIA` | `item_id`, `item_name`, `inventory_unit`, `tracked`, `trang_thai`. |
| `CONFIG_QUY_DOI` | `conversion_id`, `item_id`, `source_unit`, `target_unit`, `numerator`, `denominator`, `effective_from`, `effective_to`, `trang_thai`. `target_unit` must be the Đơn vị kiểm kê; no factor is inferred. |
| `CONFIG_MAPPING_NHAP` | `mapping_id`, `source_alias`, `item_id`, `source_unit`, `effective_from`, `effective_to`, `trang_thai`. |
| `CONFIG_SCHEMA` | Existing schema-rule columns, with one rule per newly approved table/column and unique/reference metadata before any purchase write is enabled. |
| `CONFIG_VERSION` / `CONFIG_SNAPSHOT` | Existing Issue #2 columns; every Hóa đơn nháp and staged write must retain the accepted `config_snapshot_id`. |
| `CONFIG_THONG_BAO` | Existing core columns `message_key`, `message_text`, `locale`, `trang_thai`; templates are needed for image-limit, TTL continuation, OCR/manual fallback, Cảnh báo giá nhập, and review errors. |

## Expected state, evidence, review, and ledger tables

| Table | Expected columns |
|---|---|
| `OPERATION` | Existing core columns `operation_id`, `request_id`, `operation_type`, `idempotency_key`, `expected_row_count`, `actual_row_count`, `checksum`, `status`, `error_id`, `created_at`, `updated_at`. Purchase commit uses `operation_type=PURCHASE_INVOICE_COMMIT` and `PREPARED → COMMITTED` semantics. |
| `STATE_CHO` | `state_id`, `branch_id`, `topic_type`, `owner_user_id`, `invoice_id`, `status`, `revision`, `expires_at`, `updated_at`, `operation_id`. It represents mutable conversation state only; it is not a ledger. |
| `HOA_DON_NHAP` | `invoice_id`, `branch_id`, `owner_user_id`, `status`, `business_date`, `first_received_at`, `last_activity_at`, `ocr_requested_at`, `ocr_raw_id`, `supplier_recorded`, `source_type`, `config_snapshot_id`, `revision`, `operation_id`, `created_at`, `updated_at`. `business_date` is the Ngày ghi nhận nhập from the first received image. |
| `ANH_HOA_DON` | `evidence_id`, `invoice_id`, `ordinal`, `branch_id`, `sender_user_id`, `source_message_id`, `telegram_file_id`, `original_file_name`, `mime_type`, `checksum`, `drive_file_id`, `storage_status`, `received_at`, `created_at`. The original evidence is stored before OCR. |
| `OCR_RAW` | `ocr_raw_id`, `invoice_id`, `provider`, `evidence_ids_json`, `raw_payload_json`, `completed_at`, `status`, `created_at`. This is Kết quả OCR gốc and must not be overwritten by review edits. |
| `DONG_NHAP` | `line_id`, `invoice_id`, `ocr_raw_id`, `source_line_number`, `source_item_code`, `item_id`, `source_unit`, `inventory_unit`, `source_quantity`, `inventory_quantity`, `numerator`, `denominator`, `line_total_before_vat`, `line_discount_amount`, `vat_amount`, `converted_unit_price`, `supplier_recorded`, `price_warning_json`, `review_status`, `reviewed_by`, `reviewed_at`, `review_reason`, `adjustment_id`, `operation_id`, `revision`, `created_at`, `updated_at`. |
| `LOG_NHAP` — proposed physical name only | The domain term is **Sổ nhập bia**. Shared-schema confirmation is required before adopting this physical name. Proposed columns: `row_id`, `operation_id`, `invoice_id`, `line_id`, `branch_id`, `business_date`, `item_id`, `inventory_quantity`, `inventory_unit`, `converted_unit_price`, `supplier_recorded`, `source_evidence_ids_json`, `calculation_version`, `status`, `created_at`. Only `CONFIRMED` Dòng nhập bia can produce rows here. |
| `DIEU_CHINH_SO` | `adjustment_id`, `source_type`, `source_invoice_id`, `source_line_id`, `branch_id`, `business_date`, `item_id`, `quantity_delta`, `inventory_unit`, `reason`, `created_by`, `approved_by`, `status`, `operation_id`, `created_at`, `approved_at`. Negative quantities and returns must use this path rather than an unreviewed negative Sổ nhập bia row. |
| `EVENT_LOG` | `event_id`, `event_type`, `technical_key`, `request_id`, `operation_id`, `branch_id`, `actor_user_id`, `entity_type`, `entity_id`, `outcome`, `created_at`. `technical_key` is the replay/idempotency evidence for Lặp kỹ thuật. |
| `ERROR_BIA` | Existing Issue #2 columns `error_id`, `error_code`, `error_class`, `retryable`, `message_safe`, `workflow`, `node`, `operation_id`, `request_id`, `config_version`, `fingerprint`, `status`, `created_at`, `resolved_at`. |

## Shared-schema gaps to resolve before integration

1. `src/contracts/core-sheet-schema.mjs` currently defines only the Issue #2 core tables. The purchase tables above, `CONFIG_TOPIC`, `CONFIG_DRIVE`, `CONFIG_BIA`, `CONFIG_QUY_DOI`, `CONFIG_MAPPING_NHAP`, `STATE_CHO`, `DIEU_CHINH_SO`, and `EVENT_LOG` need an approved shared schema extension.
2. `LOG_NHAP` is not an approved shared physical name in this lane. Confirm the physical sheet name for the domain term Sổ nhập bia and update the adapter contract before import.
3. The shared schema needs approved allowed values for invoice/review statuses, `storage_status`, `operation_type`, and `calculation_version` handling.
4. Config Gateway fingerprinting must include the approved purchase configuration tables. This lane deliberately does not modify the existing Gateway or its schema definitions.
5. The shared envelope has the stable Issue #2 fields; `config_snapshot_id` is currently carried in purchase payload/records rather than as a new shared envelope field. Confirm that placement during integration.
6. The repository’s shared workflow builder still builds WF01–WF03. This lane uses a uniquely named build script for WF08; decide whether the main builder should invoke it in a later integration change.
7. n8n Code nodes cannot import these ESM modules directly. The adapter implementation must either bundle pure functions into Code nodes or call a separately packaged worker; do not add imports or credentials to the inactive export without an approved packaging decision.

## Live smoke tests needed later

Run only with a dedicated shadow Google Sheet, Drive folder, Gemini credential, bot/topic, and test branch after the shared schema is approved:

1. Gateway accepts the purchase config snapshot and rejects `max_images_per_invoice` values outside `5..10`, missing conversion factors, and unversioned config changes.
2. Send the first image in the Nhập hóa đơn topic; verify one Hóa đơn nháp, one Bộ ảnh hóa đơn, one Chứng từ gốc record, first-image Ngày ghi nhận nhập, and private Drive storage.
3. Send more images from the same sender/branch; verify order, duplicate Telegram update suppression, sixth-image warning, and eleventh-image rejection at configured maximum. Attempt a mutation by another sender and verify no album change.
4. Let the configured TTL pass; verify the Hóa đơn nháp becomes continuation-needed, sends a configured reminder, and does not start OCR or write Sổ nhập bia.
5. Press `Đọc hóa đơn`; verify Drive storage is confirmed before the Gemini adapter runs. Exercise Gemini primary failure, controlled rescue, and manual fallback without losing Kết quả OCR gốc.
6. Review a mapped line, an unmapped line, an ignored line, a rejected line, a confirmed line, and a negative/return line. Verify only the confirmed line is staged for the Sổ nhập bia proposal and the negative/return line creates an Điều chỉnh sổ requirement.
7. Verify conversion uses the configured numerator/denominator and Đơn vị kiểm kê; no free-text or inferred unit factor is accepted.
8. Verify a supplier-normalized price deviation creates a Cảnh báo giá nhập that is non-blocking after explicit acknowledgement, while `NHÀ CUNG CẤP KHÔNG RÕ` has no comparison baseline.
9. Replay the same `operation_id`/technical key at the album and staged-write seams; verify exactly one business effect and an auditable Lặp kỹ thuật event.
10. After all lines are terminal, run a staged commit/retry test and verify `OPERATION` checksum/count transitions `PREPARED → COMMITTED` without direct ledger edits or partial publication.
