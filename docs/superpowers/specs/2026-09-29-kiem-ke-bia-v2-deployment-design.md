# Kiểm kê bia V2 — Thiết kế gói triển khai

**Ngày:** 2026-09-29
**Trạng thái:** Thiết kế đã được phê duyệt để tạo artifact cục bộ
**Phạm vi:** 12 workflow n8n, một workbook Google Sheets sống, hướng dẫn setup, import/binding, smoke test và rollback

## 1. Mục tiêu và ranh giới

Kiểm kê bia V2 là một hệ thống độc lập gồm mười hai workflow n8n phối hợp qua một workbook Google Sheets. Workbook sống là nguồn dữ liệu nghiệp vụ; file `.xlsx` trong gói này chỉ là template/snapshot để tạo workbook hoặc phân tích.

Gói này không tạo credential, không nhập dữ liệu vào Google Drive/n8n Cloud, không activate workflow và không thay đổi V1/WF04 hiện hữu. Mọi ID thật, token và dữ liệu riêng tư phải được người vận hành điền ở bước setup ngoài repository.

Các boundary node Drive/Gemini trong JSON được giữ disabled hoặc chờ binding để package không gọi dịch vụ thật khi import vào môi trường test.

## 2. Bất biến kiến trúc

- Một Telegram Trigger duy nhất nằm trong WF03.
- WF04 có technical tick cố định 10 phút; lịch nghiệp vụ, grace, retry và timezone nằm trong `CONFIG_LICH`.
- Mọi operation có `request_id`, `operation_id`, `idempotency_key`, `config_snapshot_id` và trạng thái commit.
- Ghi nhiều sheet đi qua `PREPARED` rồi mới `COMMITTED`; reader chỉ đọc record đã commit.
- Lỗi được phân loại thành `VALIDATION`, `AUTHORIZATION`, `CONFLICT`, `TRANSIENT`, `CONFIGURATION`, `EXTERNAL`, `SYSTEM`, `MANUAL_REVIEW`.
- Retry dùng cùng idempotency key; retry không được nhân đôi ledger.
- Mọi cấu hình thay đổi được đọc qua WF01 và gắn với `config_version`/`config_snapshot_id`.
- Ledger không sửa trực tiếp; hiệu chỉnh dùng record versioned hoặc `DIEU_CHINH_SO`.
- V2 không import đè, đổi tên hoặc sửa workflow V1/WF04.

## 3. Common envelope và output

Envelope chuẩn có các trường:

```json
{
  "envelope_version": "v2",
  "request_id": "REQUEST_ID_CONFIGURE",
  "operation_id": "OPERATION_ID_CONFIGURE",
  "event_type": "EVENT_TYPE_CONFIGURE",
  "branch_id": "BRANCH_ID_CONFIGURE",
  "actor_user_id": "USER_ID_CONFIGURE",
  "business_date": "YYYY-MM-DD",
  "config_version": "CONFIG_VERSION_CONFIGURE",
  "config_snapshot_id": "CONFIG_SNAPSHOT_CONFIGURE",
  "payload": {},
  "reply_target": {}
}
```

Output thành công tối thiểu gồm `ok`, các ID liên quan, `status`, `data`, `warnings`. Output lỗi gồm `ok=false`, `error_code`, `error_class`, `retryable`, `message_safe`, workflow/node, operation/config context. Không ghi stack trace, token, credential hoặc raw private payload vào thông báo người dùng.

## 4. Mười hai workflow

| Mã | Workflow | Kích hoạt | Trách nhiệm chính | Ghi chính |
|---|---|---|---|---|
| WF01 | Config Gateway | Execute Workflow | Đọc, validate, version, fingerprint và snapshot cấu hình | `CONFIG_VERSION`, `CONFIG_SNAPSHOT`, `OPERATION` |
| WF02 | Error Handler | Execute Workflow/Error Workflow | Chuẩn hóa, redact, phân loại, lưu và thông báo lỗi an toàn | `ERROR_BIA`, `EVENT_LOG` |
| WF03 | Telegram Router | Telegram Trigger | Normalize, dedupe, authorize, reserve operation, gọi worker, reply | `OPERATION`, `STATE_CHO`, `RETRY_CONTEXT`, `EVENT_LOG` |
| WF04 | Dispatcher | Cron/Interval 10 phút | Đọc lịch, claim dispatch key, gọi worker, heartbeat và recovery | `DISPATCH_HISTORY`, `HEARTBEAT`, `RETRY_CONTEXT` |
| WF05 | Open Session | Execute Workflow | Mở một phiên kiểm kê cho branch/topic, chụp catalog/config | `PHIEN_KIEM_KE`, `STATE_CHO` |
| WF06 | Count Intake | Execute Workflow | Validate số đếm, revision, preview và finalize rõ ràng | `BIA_LOG`, `STATE_CHO`, `OPERATION` |
| WF07 | Reconcile/Close | Execute Workflow | Tính tồn lý thuyết, so với tồn thực tế, yêu cầu giải trình, khóa ngày | `BAO_CAO_NGAY`, `OPERATION` |
| WF08 | Invoice Ingestion | Execute Workflow | Lưu album vào Drive, OCR Gemini khi được yêu cầu, mapping, review, publish nhập | `HOA_DON_NHAP`, `ANH_HOA_DON`, `OCR_RAW`, `LOG_NHAP` |
| WF09 | Sales Ingestion | Execute Workflow | Đọc file, mapping cột/mặt hàng, preview/publish versioned sales | `DOT_NHAP_BAN`, `DONG_BAN_NGUON`, `LOG_BAN` |
| WF10 | Reporting | Execute Workflow | Tổng hợp ngày/tuần từ ledger và report đã khóa | `BAO_CAO_TUAN` |
| WF11 | Weekly Archive | Dispatcher/Execute Workflow | Tạo archive workbook, manifest, verify rồi mới purge | `ARCHIVE_INDEX` và file archive |
| WF12 | Backup/Recovery | Dispatcher/Execute Workflow | Backup toàn workbook, verify, retention và restore sang file mới | `BACKUP_INDEX` và file backup |

## 5. Dependency và import order

Dependency lõi:

```text
WF02 -> WF01
WF05 -> WF06 -> WF07 -> WF10 -> WF11
WF08 -> WF07
WF09 -> WF07
WF03 -> WF01, WF02, WF05, WF06, WF08, WF09, WF10
WF04 -> WF01, WF02, WF05, WF07, WF10, WF11, WF12
```

Import theo thứ tự:

```text
WF02, WF01, WF05, WF06, WF08, WF09, WF07, WF10, WF11, WF12, WF03, WF04
```

Sau import, người vận hành thay placeholder trong `CONFIG_LENH.worker_workflow` và `CONFIG_LICH.worker_workflow` bằng ID workflow thật do n8n cấp. Không dùng fake ID trong file JSON.

## 6. Workbook contract

Workbook có 50 tab theo sáu nhóm: tài liệu, cấu hình, gateway/runtime, intake/evidence, ledger và báo cáo/audit. Header chính thức, kiểu dữ liệu, key/reference, enum, writer/reader và retention nằm trong `DATA_DICTIONARY`. Các tab runtime/ledger trong template chỉ có header; config có placeholder an toàn và `INACTIVE`.

Quy ước dữ liệu:

- `*_id` là định danh bất biến dạng text.
- `business_date` theo timezone của branch; `*_at` là ISO-8601 UTC.
- Hash là SHA-256; JSON lưu dưới dạng text JSON hợp lệ.
- `0` là số đếm hợp lệ; blank không hoàn tất; số âm bị từ chối trong count.
- Hàng ledger đã commit được bảo vệ; bản sửa tạo version/superseding record.
- `TON_DAU_KY` là opening balance được admin xác nhận, không tự suy diễn từ dữ liệu thiếu.

## 7. Luồng nghiệp vụ quan trọng

### Nhập hàng

Album được dedupe, lưu Drive trước OCR. Gemini là OCR provider duy nhất ở giai đoạn đầu. Invoice date là ngày local của lần Telegram nhận đầu tiên. Supplier được ghi theo text hoặc `NHÀ CUNG CẤP KHÔNG RÕ`. Không có OCR tự động trước hành động rõ ràng của người dùng; manual fallback không chặn việc ghi nhận có kiểm soát.

### Bán hàng

WF09 đọc cấu hình nguồn/cột/header alias, tạo preview, mapping và conversion. File trùng hash được reuse; normalized-content no-op không tạo version mới. File lỗi là `CHO_SUA_FILE` và block `SYSTEM_ZERO`; file thật đến muộn có thể thay thế `SYSTEM_ZERO`. Sales âm đi qua adjustment.

### Kiểm kê và đóng ngày

Chỉ một phiên active trên mỗi branch. Session snapshot config khi mở. Finalize dùng optimistic revision check. Công thức canonical:

```text
tồn lý thuyết = tồn thực tế đã khóa trước + nhập confirmed - bán ACTIVE/published + điều chỉnh
```

Missing purchase/sales chỉ trở thành zero sau notify và kiểm tra không còn pending data. Variance đỏ cần explanation. Sau close, thay đổi tạo report version/adjustment.

### Archive và backup

WF11 kiểm tra row count/key/date/hash trong manifest trước purge; tuần rỗng dùng `EMPTY_VERIFIED`; không purge nếu verify fail. WF12 backup toàn workbook hằng ngày, bỏ qua khi có `OPERATION=PREPARED` theo cấu hình, giữ retention mặc định 14 bản. Restore luôn tạo file mới và read-only verify; source switch cần owner approval, file cũ được giữ lại.

## 8. Cutover và rollback

Chạy V1/V2 song song trên sheet/state riêng, shadow tối thiểu 7 business days và có kiểm thử archive/restore. Chỉ chuyển `V2_PRIMARY` sau khi owner approve qua `CONFIG_CUTOVER`.

Rollback:

1. Dừng WF03 và WF04 V2.
2. Giữ nguyên ledger V2 để điều tra.
3. Chuyển mode về V1 qua `CONFIG_CUTOVER`.
4. Khôi phục V1 theo quy trình đang được phê duyệt.
5. Không reverse-import ledger V2 vào V1.

## 9. Không nằm trong gói artifact cục bộ

- Tạo hoặc chia sẻ credential.
- Nhập workbook vào Google Drive thật.
- Import/activate workflow vào n8n thật.
- Tạo bot Telegram, Drive folder hoặc branch thật.
- Tạo issue, PR, commit hoặc push.
