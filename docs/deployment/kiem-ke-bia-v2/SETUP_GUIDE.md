# Hướng dẫn setup Kiểm kê bia V2

> [!CAUTION]
> Gói hiện tại **chưa sẵn sàng triển khai**. Cả 12 workflow JSON còn là scaffold và có node `Block Incomplete Workflow` ngay sau trigger; node này dừng execution trước khi đọc/ghi Google Sheets hoặc gọi dịch vụ ngoài. Chỉ import để xem cấu trúc trong n8n test; không bind credential/ID thật, không chạy smoke test nghiệp vụ và không activate. Chỉ bỏ guard sau khi workflow tương ứng đã được triển khai, kiểm thử và rà soát theo điều kiện ở mục 8.

Tài liệu này mô tả các bước setup đích cho gói sau khi hoàn tất. Không điền credential hoặc ID thật vào repository.

## 1. Chuẩn bị giá trị ngoài repository

Người vận hành chuẩn bị trong hệ thống quản trị bí mật hoặc hệ thống quản trị riêng:

- Google Spreadsheet ID cho workbook sống.
- Credential tên `GOOGLE_SHEETS_KKB_V2`.
- Credential tên `GOOGLE_DRIVE_KKB_V2`.
- Credential tên `TELEGRAM_KKB_V2`.
- Credential tên `GEMINI_KKB_V2`.
- Branch, timezone, topic/chat/thread, user, role, permission.
- Danh mục bia, đơn vị, quy đổi, mapping nhập và mapping bán.
- Drive folder cho evidence, archive và backup.
- Lịch nghiệp vụ, TTL, grace, retry, retention và owner cutover.

Giá trị thật chỉ được nhập vào workbook sống và n8n instance được bảo vệ.

## 2. Tạo workbook sống

1. Mở `KKB_V2_WORKBOOK_TEMPLATE.xlsx`.
2. Import thành một Google Spreadsheet mới dùng cho môi trường test.
3. Giữ nguyên tên 50 tab và hàng header.
4. Điền lần lượt `CONFIG_GLOBAL`, `CONFIG_BRANCH`, `CONFIG_TOPIC`, `CONFIG_USER`, role/permission, `CONFIG_BIA`, `CONFIG_QUY_DOI`, mapping nhập, nguồn/cột/mapping bán, lệnh, thông báo, Drive, backup và cutover.
5. Điền `CONFIG_SCHEMA`/`CONFIG_VERSION` theo hướng dẫn trong workbook.
6. Tạo header-only cho runtime/ledger nếu tab bị import thiếu.
7. Đặt các config chưa sẵn sàng về `INACTIVE`.
8. Bảo vệ `OPERATION`, `DISPATCH_HISTORY`, `HEARTBEAT`, `STATE_CHO`, `RETRY_CONTEXT`, intake, ledger, report và audit khỏi chỉnh sửa trực tiếp.
9. Chỉ cho service account/n8n writer ghi các vùng runtime.
10. Giữ mode ban đầu là `SHADOW` trong `CONFIG_CUTOVER`.

## 3. Tạo credential trong n8n

Tạo bốn credential theo đúng tên kỹ thuật:

| Tên | Phạm vi |
|---|---|
| `GOOGLE_SHEETS_KKB_V2` | Đọc/ghi workbook sống và archive/backup theo quyền được cấp |
| `GOOGLE_DRIVE_KKB_V2` | Evidence invoice, archive workbook và backup file |
| `TELEGRAM_KKB_V2` | Bot token và gửi reply/topic |
| `GEMINI_KKB_V2` | Gemini OCR |

Credential thật không được ghi vào JSON, Markdown, log hoặc workbook template.

Các node Drive/Gemini trong WF08/WF09 được import ở trạng thái disabled để tránh gọi dịch vụ thật trong môi trường test. WF11/WF12 có boundary node chờ thao tác file bên ngoài. Chỉ enable/thay thế các node này sau khi đã bind credential, folder và endpoint thật trong n8n.

## 4. Import workflow để xem cấu trúc

Nếu cần xem cấu trúc, chỉ import các JSON ở trạng thái inactive vào n8n test riêng theo thứ tự:

```text
WF02, WF01, WF05, WF06, WF08, WF09, WF07, WF10, WF11, WF12, WF03, WF04
```

Sau mỗi import:

- Chọn credential placeholder đúng loại.
- Không activate.
- Ghi ID workflow n8n thật vào bảng binding riêng trong môi trường vận hành.
- Chỉ sau khi đủ ID mới điền `CONFIG_LENH.worker_workflow` và `CONFIG_LICH.worker_workflow`.

Trong trạng thái hiện tại, không cần bind credential hoặc workflow ID: guard sẽ dừng mọi execution trước các node nghiệp vụ. Các bước binding chỉ áp dụng sau khi phần triển khai workflow hoàn tất.

## 5. Binding sau import

| Workflow | Gọi/được gọi bởi |
|---|---|
| WF01 | Được WF02–WF12 gọi để lấy config |
| WF02 | Error workflow và error branch của WF03/WF04 |
| WF03 | Gọi WF01, WF02 và worker WF05/WF06/WF08/WF09/WF10 |
| WF04 | Gọi WF01, WF02, WF05, WF07, WF10, WF11, WF12 |
| WF05 | Gọi WF01 |
| WF06 | Gọi WF01 và WF07 khi finalize |
| WF07 | Gọi WF01 và ghi report |
| WF08 | Gọi WF01 và publish dữ liệu nhập |
| WF09 | Gọi WF01 và publish dữ liệu bán |
| WF10 | Gọi WF01 và đọc report đã khóa |
| WF11 | Gọi WF01 và ghi `ARCHIVE_INDEX` |
| WF12 | Gọi WF01 và ghi `BACKUP_INDEX` |

Đặt WF02 làm Error Workflow chung sau khi ID WF02 đã có. Chỉ WF03 có Telegram Trigger; WF04 dùng technical tick cố định 10 phút.

## 6. Kiểm tra Google Sheets read guard

Mỗi node đọc Google Sheets phải:

- chạy đúng một lần trong một execution;
- trả về toàn bộ hàng cần đọc;
- giới hạn range theo sheet/branch/date khi phù hợp;
- không đặt node đọc trong loop làm tăng số lần đọc ngoài dự kiến;
- đưa lỗi đọc vào WF02 với `error_class=EXTERNAL` hoặc `SYSTEM` phù hợp.

## 7. Trình tự kiểm thử

1. Chạy các case trong `SMOKE_TEST_MATRIX.md` bằng dữ liệu test không chứa private data.
2. Kiểm tra idempotency bằng cách gửi lại cùng `request_id`/`idempotency_key`.
3. Kiểm tra conflict bằng revision cũ.
4. Kiểm tra retry cùng operation không tạo ledger duplicate.
5. Chạy WF11 trên tuần test và verify manifest trước purge giả lập.
6. Chạy WF12 backup và restore sang file mới ở read-only test mode.
7. Chạy shadow tối thiểu 7 business days.

## 8. Điều kiện activate

Chỉ activate sau khi tất cả điều kiện sau đạt:

- Workflow đã được triển khai đầy đủ; node `Block Incomplete Workflow` đã được gỡ có chủ đích sau review.
- Header/schema/config snapshot hợp lệ.
- Credential đã test trong môi trường đúng.
- Workflow IDs đã bind, không còn placeholder.
- WF03 là Telegram Trigger duy nhất.
- Read guard đã kiểm tra.
- Negative/idempotency/conflict/retry đã pass.
- Archive và restore đã verify.
- Owner phê duyệt `V2_PRIMARY` trong `CONFIG_CUTOVER`.

## 9. Rollback

1. Dừng WF03 và WF04 V2.
2. Giữ nguyên dữ liệu V2 và `ERROR_BIA` để điều tra.
3. Đổi cutover về V1.
4. Bật lại V1 theo quy trình đã được phê duyệt.
5. Không nhập ngược ledger V2 vào V1.

Nếu cần restore, restore sang workbook mới, verify read-only, sau đó chỉ switch source khi owner approve; giữ file nguồn cũ.
