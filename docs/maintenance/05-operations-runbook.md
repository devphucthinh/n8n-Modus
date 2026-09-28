# 05 — Runbook vận hành và bàn giao

## Nguyên tắc vận hành

- V1 và V2 không dùng chung ledger/state trong giai đoạn chạy song song.
- Mọi thay đổi config có người sửa, thời điểm, lý do và `config_version`.
- Ledger đã commit không sửa trực tiếp; dùng adjustment/version mới.
- Thao tác retry phải giữ nguyên idempotency key/operation ID.
- Không xóa log gốc trước khi archive được xác minh.

## Checklist cấu hình n8n

### Credential

- [ ] Google Sheets OAuth2 truy cập được file config/ledger live.
- [ ] Google Drive OAuth2 truy cập được folder evidence, archive và backup.
- [ ] Telegram bot credential đúng bot V2 và webhook chỉ thuộc Router.
- [ ] Gemini credential hoạt động và không còn API key đặt trực tiếp trong Code/HTTP node.

### Workflow sau import

- [ ] Import theo thứ tự tại [thiết kế 12 workflow](./04-v2-target-design.md#danh-mục-12-workflow).
- [ ] Gắn credential cho từng node bằng tên/ID môi trường thực.
- [ ] Gắn lại mọi Execute Workflow node theo workflow ID vừa import.
- [ ] Gắn Error Workflow về `WF02_V2_ERROR_HANDLER`.
- [ ] Đặt Spreadsheet ID bootstrap cho Config Gateway.
- [ ] Kiểm tra Telegram Router là workflow duy nhất sở hữu Telegram Trigger của bot.
- [ ] Chỉ active Config Gateway/Error Handler/subworkflow theo yêu cầu của n8n; active Router và Dispatcher sau smoke test.
- [ ] Xác nhận timezone runtime nhất quán với timezone trong config.
- [ ] Không active cutover V2 trước khi shadow test đạt.

### Kiểm tra hard-code

- [ ] Tìm spreadsheet ID, chat ID, thread ID, branch ID, mã bia, role, TTL, giờ chạy, ngưỡng và template trong JSON V2.
- [ ] Mọi kết quả tìm thấy được phân loại: bootstrap kỹ thuật hợp lệ hoặc business config cần chuyển sang sheet.
- [ ] Không có bot token/Gemini API key trong JSON export.

## Checklist cấu hình Google Sheets

### Nền tảng

- [ ] Tạo/chuẩn hóa các sheet trong blueprint V2.
- [ ] Điền `schema_version` và trạng thái migration.
- [ ] Tạo named range hoặc quy ước vùng dữ liệu ổn định.
- [ ] Bảo vệ header, công thức và ledger; chỉ mở range config cho đúng người.
- [ ] Thêm data validation/dropdown cho role, permission, branch, status, unit và job code.

### Nghiệp vụ

- [ ] Điền chi nhánh và Telegram chat/topic ID.
- [ ] Điền user, role, permission và mapping theo chi nhánh.
- [ ] Điền danh mục bia, mã phần mềm và thứ tự hiển thị.
- [ ] Điền mọi hệ số quy đổi; không để workflow tự suy đoán.
- [ ] Điền alias OCR và mapping file bán hàng.
- [ ] Điền lịch, TTL, giới hạn ảnh 5–10, timeout, retry, grace window.
- [ ] Điền command catalog đầy đủ để `/help` hiển thị lệnh, cú pháp, mô tả và ví dụ.
- [ ] Với issue #3, tạo đủ sáu tab `CONFIG_ROLE`, `CONFIG_PERMISSION`, `CONFIG_USER_ROLE`, `CONFIG_ROLE_PERMISSION`, `CONFIG_TOPIC`, `CONFIG_LENH` theo [handoff Router](./08-issue-3-router-handoff.md), rồi cập nhật `CONFIG_SCHEMA` và `config_version`.
- [ ] Điền folder Drive cho evidence, archive, backup và group/topic báo lỗi.
- [ ] Đặt mode ban đầu `SHADOW` hoặc giá trị tương đương; chưa bật `V2_PRIMARY`.

## Smoke test trước khi chạy song song

1. Config Gateway tải đúng config version và từ chối schema thiếu cột/duplicate key.
2. Router từ chối user không có quyền và định tuyến đúng từng topic.
3. `/help` phản ánh đúng bảng `CONFIG_LENH`.
4. Album nhiều ảnh được gom đúng TTL, lưu Drive và OCR một lần theo nhóm.
5. Hóa đơn nghi trùng chỉ cảnh báo; xác nhận tạo ID mới.
6. File bán có dòng nhóm/header alias được parse theo config; preview khớp tổng.
7. Số đếm chỉ đi vào topic đếm tồn, chốt có optimistic/version check.
8. Thiếu nhập/bán tạo thông báo và dùng `0` đúng quy tắc.
9. Lỗi retry không tạo ledger trùng.
10. Archive thử nghiệm chỉ dọn nguồn sau verification.
11. Restore từ backup thử nghiệm tái tạo đúng count/checksum.
12. Error Handler ghi đủ context an toàn và gửi đúng Telegram group lỗi khi bật.

Chi tiết smoke test, import order và mapping workflow ID của Telegram Router nằm trong [handoff issue #3](./08-issue-3-router-handoff.md).

## Chạy song song và cutover

### Giai đoạn shadow

- Chạy V1 như nguồn chính.
- V2 đọc cùng đầu vào nhưng ghi ledger/state V2 riêng.
- So sánh kết quả theo ngày/chi nhánh/mã bia, không so sánh theo row order.
- Thời gian đề xuất: tối thiểu 7 ngày nghiệp vụ liên tiếp, gồm ít nhất một chu kỳ archive tuần.
- Ghi mọi chênh lệch thành issue/ticket; không sửa tay để làm báo cáo khớp.

### Điều kiện chuyển V2 thành chính

- Không có lỗi severity cao chưa xử lý.
- Đối soát nhập, bán, tồn và báo cáo đạt tiêu chí trong spec.
- Archive và restore test đã chạy thành công.
- Chủ hệ thống xác nhận cutover rõ ràng.
- Checklist credential, config và workflow đã ký nhận.

### Cutover

1. Đóng cửa sổ thay đổi config.
2. Ghi lại config version và backup trước cutover.
3. Chuyển công tắc mode trong `CONFIG_CUTOVER`.
4. Active Router/Dispatcher V2 theo kế hoạch; vô hiệu ingress/lịch V1 có xung đột.
5. Chạy bộ smoke test sản xuất có kiểm soát.
6. Theo dõi Error Handler, job trễ và duplicate trong cửa sổ tăng cường.

### Rollback

1. Chặn ingress/job V2 nhưng giữ nguyên dữ liệu để điều tra.
2. Chuyển mode về V1 bằng công tắc đã định nghĩa.
3. Khôi phục trigger V1 cần thiết.
4. Không nhập ngược ledger V2 vào V1 nếu chưa có migration/reconciliation được duyệt.
5. Ghi incident, khoảng thời gian ảnh hưởng và operation ID liên quan.

## Xử lý lỗi thường gặp

| Triệu chứng | Kiểm tra | Hành động an toàn |
|---|---|---|
| Command không phản hồi | Router active, webhook, EVENT_LOG, quyền user/topic | Retry cùng update chỉ khi idempotency cho phép |
| Dispatcher bỏ job | `CONFIG_LICH`, timezone, grace window, `DISPATCH_HISTORY` | Manual retry với cùng job window/key |
| OCR thiếu ảnh | Album state, TTL, Drive upload và checksum | Mở lại review; không OCR lại mù quáng nếu đã commit |
| Ghi một phần nhiều sheet | `OPERATION=PREPARED/FAILED` và row checksum | Chạy recovery theo operation ID |
| Báo cáo lệch | Config snapshot, mapping, version nhập/bán/đếm | Tạo adjustment/version mới; không sửa ledger |
| Archive không dọn nguồn | `ARCHIVE_INDEX` chưa VERIFIED | Giữ nguyên nguồn, sửa verification rồi chạy lại |
| Backup có file nhưng restore lỗi | Manifest, quyền Drive, schema version | Đánh dấu backup không hợp lệ và tạo backup mới |

## Archive tuần

Tên file đề xuất, lấy giá trị thời gian từ workflow:

```text
KiemKeBia_Log_YYYY-MM-DD_den_YYYY-MM-DD
```

Folder tháng đề xuất:

```text
YYYY-MM — KiemKeBia Archive
```

Mỗi archive cần manifest: source spreadsheet ID, sheet/range, thời gian từ–đến, số dòng, checksum, config/schema version, file đích, thời điểm verify và người/job thực hiện.

Danh sách rotate phải đọc từ config, không gắn cứng trong workflow. Baseline gồm `EVENT_LOG`, `BIA_LOG`, `ERROR_BIA` và các log vận hành tương tự; mọi dòng còn active, đang retry, chưa khóa hoặc chưa đủ kỳ phải được giữ lại ở sheet gốc.

## Backup phục hồi

- Backup hằng ngày và archive tuần là hai mục tiêu khác nhau.
- Backup giữ ảnh chụp phục hồi đủ config + ledger cần thiết.
- Định kỳ chọn một backup, phục hồi vào file tạm, chạy count/checksum và kiểm tra quan hệ khóa.
- Chỉ đánh dấu `RESTORE_VERIFIED` sau kiểm tra thực tế.
- Retention, giờ chạy và folder không hard-code trong workflow.

## Bảo trì schema/config

1. Tạo ADR nếu thay đổi ý nghĩa nghiệp vụ hoặc kiến trúc.
2. Tăng `schema_version`/`config_version`.
3. Thêm cột/sheet tương thích ngược trước khi workflow mới đọc nó.
4. Chạy validator và migration trên bản sao test.
5. Deploy workflow tương thích cả version cũ/mới nếu cần cửa sổ chuyển đổi.
6. Chuyển config version và theo dõi.
7. Chỉ bỏ cấu trúc cũ sau retention và xác nhận rollback không còn cần.

## Bàn giao cuối dự án

- [ ] 12 workflow JSON đã kiểm tra và sắp đúng thứ tự import.
- [ ] Data dictionary và mẫu Google Sheets V2.
- [ ] Danh sách credential/ID cần điền, không chứa secret.
- [ ] Checklist n8n và Google Sheets đã điền trạng thái.
- [ ] Bộ test, dữ liệu test và expected result.
- [ ] Bằng chứng shadow/cutover/rollback drill.
- [ ] Bằng chứng archive tuần và restore backup.
- [ ] Diagram nguồn Mermaid và ảnh render cập nhật.
- [ ] Runbook incident, retry, correction và escalation.
- [ ] Chủ sở hữu hệ thống xác nhận nghiệm thu.
