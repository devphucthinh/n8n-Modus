# Smoke test matrix Kiểm kê bia V2

> [!CAUTION]
> Đây là ma trận nghiệm thu mục tiêu, chưa thể chạy với workflow JSON hiện tại. Cả 12 workflow đang dừng ở `Block Incomplete Workflow` trước mọi xử lý nghiệp vụ. Chỉ chạy các case sau khi từng workflow đã được triển khai và guard được gỡ sau review.

Khi đủ điều kiện, chạy trong workbook test, dùng placeholder không chứa dữ liệu riêng tư. Mỗi case ghi `request_id`, `operation_id`, kết quả và bằng chứng vào hệ thống kiểm thử riêng.

| ID | Nhóm | Tình huống | Kết quả mong đợi |
|---|---|---|---|
| S01 | WF01 | Config hợp lệ | Tạo snapshot/fingerprint; trả `ok=true` |
| S02 | WF01 | Thiếu header hoặc enum sai | Chặn trước worker; lỗi configuration an toàn |
| S03 | WF01 | Mode maintenance | Worker nghiệp vụ bị chặn; status vẫn đọc được |
| S04 | WF02 | Error có token trong context | Message bị redact; `ERROR_BIA` không chứa secret |
| S05 | WF03 | `/help` hợp lệ | Đúng quyền/topic; reply an toàn |
| S06 | WF03 | User không có permission | Từ chối; không ghi ledger |
| S07 | WF03 | Replay cùng idempotency key | Trả kết quả cũ; không tạo operation/ledger mới |
| S08 | WF05 | Mở session branch hợp lệ | Tạo một session với config/catalog snapshot |
| S09 | WF05 | Mở session thứ hai khi session cũ active | Chặn conflict; giữ session cũ |
| S10 | WF06 | Count bằng 0 | Chấp nhận và finalize được |
| S11 | WF06 | Count blank hoặc âm | Chặn; không commit `BIA_LOG` |
| S12 | WF06 | Finalize với revision cũ | Conflict; yêu cầu đọc lại state |
| S13 | WF08 | Album nhiều ảnh cùng invoice | Dedupe, lưu Drive trước OCR, một invoice |
| S14 | WF08 | OCR/manual review | Raw OCR giữ evidence IDs; chỉ line confirmed mới vào `LOG_NHAP` |
| S15 | WF09 | File bán hợp lệ | Preview rồi publish versioned `LOG_BAN` |
| S16 | WF09 | File duplicate hoặc mapping lỗi | Duplicate reuse/no-op; mapping lỗi block, không tạo zero giả |
| S17 | WF07 | Close ngày có variance | Công thức canonical đúng; variance đỏ cần explanation |
| S18 | WF10 | Tổng hợp báo cáo | Đọc report/ledger đã khóa; không tự sửa canonical ledger |
| S19 | WF11 | Archive tuần đủ điều kiện | Tạo manifest, verify row/key/date/hash rồi mới đánh dấu purge |
| S20 | WF11 | Verify archive fail | Không purge; `ARCHIVE_INDEX` giữ trạng thái lỗi |
| S21 | WF12 | Backup bình thường | Tạo backup, verify schema/row/hash, cập nhật retention |
| S22 | WF12 | Có `OPERATION=PREPARED` | Backup chờ theo config; không làm mất dữ liệu |
| S23 | Recovery | Restore test | Tạo file mới, read-only verify, không đổi source |
| S24 | Recovery | Worker transient failure | Retry cùng key; không duplicate ledger |
| S25 | Recovery | Worker failure kéo dài | Chuyển manual review, cảnh báo critical/recovery đúng trạng thái |

## Bằng chứng tối thiểu mỗi case

- Input envelope đã redact.
- `request_id`, `operation_id`, `idempotency_key`.
- Sheet rows hoặc file IDs liên quan đã redact.
- Output `status`, `error_code`/`warning`.
- Kết quả kiểm tra duplicate, commit state và retry state.
