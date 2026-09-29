# Kiểm tra import và binding Kiểm kê bia V2

> [!CAUTION]
> Workflow hiện ở trạng thái scaffold, đều có guard chặn execution và chưa sẵn sàng bind/activate. Chỉ dùng phần checklist này sau khi implementation hoàn tất; hiện tại import (nếu cần xem cấu trúc) vào n8n test và giữ inactive.

## A. Preflight

- [ ] Workbook test đã import đủ 50 tab.
- [ ] Header khớp `DATA_DICTIONARY`.
- [ ] Chưa có credential hoặc ID thật trong JSON.
- [ ] Tất cả config mẫu chưa sẵn sàng vẫn là `INACTIVE`.
- [ ] N8n instance có quyền dùng bốn credential kỹ thuật.
- [ ] Có bản ghi owner, branch, topic, catalog và mapping ngoài repository.

## B. Import order

| Bước | File | Sau import |
|---:|---|---|
| 1 | WF02_ERROR_HANDLER.json | Ghi workflow ID vào binding register |
| 2 | WF01_CONFIG_GATEWAY.json | Ghi workflow ID; kiểm tra config read |
| 3 | WF05_OPEN_SESSION.json | Kiểm tra gọi WF01 placeholder |
| 4 | WF06_COUNT_INTAKE.json | Kiểm tra revision/zero/blank |
| 5 | WF08_INVOICE_INGESTION.json | Kiểm tra Drive/Gemini slots |
| 6 | WF09_SALES_INGESTION.json | Kiểm tra Drive/Sheets slots |
| 7 | WF07_RECONCILE_CLOSE.json | Kiểm tra read ledger/write report |
| 8 | WF10_REPORTING.json | Kiểm tra report read |
| 9 | WF11_WEEKLY_ARCHIVE.json | Kiểm tra archive folder/index |
| 10 | WF12_BACKUP_RECOVERY.json | Kiểm tra backup folder/index |
| 11 | WF03_TELEGRAM_ROUTER.json | Kiểm tra Telegram Trigger; chưa activate |
| 12 | WF04_DISPATCHER.json | Kiểm tra technical tick 10 phút; chưa activate |

## C. Binding map

Điền ID thật sau khi n8n cấp ID:

| Trường | Giá trị cần điền |
|---|---|
| `CONFIG_LENH.worker_workflow` | ID của worker tương ứng |
| `CONFIG_LICH.worker_workflow` | ID WF05/WF07/WF10/WF11/WF12 tương ứng |
| Error workflow | ID WF02 |
| Google Sheets credential | `GOOGLE_SHEETS_KKB_V2` |
| Google Drive credential | `GOOGLE_DRIVE_KKB_V2` |
| Telegram credential | `TELEGRAM_KKB_V2` |
| Gemini credential | `GEMINI_KKB_V2` |

Không thay placeholder bằng tên người dùng hoặc ID tự đoán.

## D. Node-level checks

- [ ] Mọi Google Sheets read node dùng one-execution guard và trả về toàn bộ hàng cần thiết.
- [ ] Write node có `operation_id`, `idempotency_key`, `config_snapshot_id`.
- [ ] Workflow worker không tự tạo Telegram Trigger.
- [ ] WF04 không chứa business schedule hard-code.
- [ ] WF08 lưu Drive trước OCR.
- [ ] WF09 không tự động biến file lỗi thành `SYSTEM_ZERO`.
- [ ] WF07 chỉ đọc purchase/sales đã confirmed/published.
- [ ] WF11 verify manifest trước purge.
- [ ] WF12 restore sang file mới trước source switch.

## E. Activation gate

- [ ] Smoke matrix hoàn tất.
- [ ] Negative, idempotency, conflict và retry test hoàn tất.
- [ ] Archive/restore test hoàn tất.
- [ ] Shadow tối thiểu 7 business days.
- [ ] Owner phê duyệt `V2_PRIMARY`.
- [ ] Bật WF03 trước; bật WF04 sau khi router shadow ổn định.

## F. Rollback gate

- [ ] Dừng WF03 và WF04 V2.
- [ ] Giữ nguyên ledger V2 và error log.
- [ ] Đổi `CONFIG_CUTOVER` về V1.
- [ ] Bật V1.
- [ ] Nếu restore, dùng file mới và giữ file cũ.
