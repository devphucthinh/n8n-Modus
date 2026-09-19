# 03 — Mô hình dữ liệu hiện tại

## Quy ước đọc tài liệu này

Hai file `.xlsx` là snapshot tải từ Google Sheets. Tên sheet và cột phản ánh thời điểm tải xuống; Google Sheets đang hoạt động mới là nguồn dữ liệu thực tế. Các dòng hiện có là dữ liệu test/lịch sử thử nghiệm, không phải mặc định nghiệp vụ.

## Snapshot WF01_WF02_WF03

| Sheet | Vùng dữ liệu | Cột |
|---|---|---|
| `CONFIG_BIA` | A1:I12 | `ma_bia`, `ma_bia_pm`, `ten_bia`, `don_vi_dem`, `quy_doi`, `nguong_chenh_vang`, `nguong_chenh_do`, `thu_tu_hien_thi`, `trang_thai` |
| `CONFIG_BRANCH` | A1:F2 | `branch_id`, `branch_name`, `forum_chat_id`, `ttl_minutes`, `trang_thai`, `owner_chat_id` |
| `CONFIG_USER` | A1:E3 | `branch_id`, `user_id`, `display_name`, `role`, `trang_thai` |
| `TON_DAU_KY` | A1:F7 | `branch_id`, `ky`, `ma_bia`, `ton_dau`, `don_vi`, `updated_at` |
| `STATE_CHO` | A1:M42 | `session_id`, `branch_id`, `branch_name`, `chat_id`, `message_thread_id`, `master_message_id`, `snapshot_json`, `status`, `current_screen`, `pending_item_order`, `created_at`, `expires_at`, `updated_at` |
| `BIA_LOG` | A1:R51 | Xem chi tiết bên dưới |
| `BAO_CAO` | A1:R171 | Xem chi tiết bên dưới |
| `EVENT_LOG` | A1:H206 | `event_key`, `update_id`, `callback_query_id`, `event_type`, `status`, `error_message`, `created_at`, `processed_at` |
| `MOCK_SALES` | A1:E11 | `branch_id`, `ngay`, `ma_bia_pm`, `quantity`, `unit` |
| `MOCK_PURCHASE` | A1:E11 | `branch_id`, `ngay`, `ma_bia_pm`, `quantity`, `unit` |

### `BIA_LOG`

```text
entry_key, session_id, branch_id, chat_id, message_thread_id, user_id,
message_id, ma_bia, ten_bia, don_vi_dem, ton_moi, nhap, ban, ghi_chu,
validation_status, idempotency_key, received_at, updated_at
```

### `BAO_CAO`

```text
report_line_id, report_id, session_id, branch_id, branch_name, ma_bia,
ten_bia, ton_dau, nhap, ban, ton_ly_thuyet, ton_thuc_te, chenh_lech,
muc_canh_bao, report_status, generated_at, flags, unit
```

### Nhận xét hiện trạng

- `CONFIG_BIA` có 10 dòng active và 1 dòng inactive trong snapshot.
- Một số chuỗi `quy_doi` mang tính test/không đồng nhất; V2 cần cấu hình hệ số có kiểu dữ liệu và kiểm tra rõ ràng.
- Hai người dùng test đều mang role `INVENTORY`; mô hình này không đáp ứng nhiều role và quyền theo chi nhánh.
- Không có sheet protection trong file xuất.
- `EVENT_LOG`, `STATE_CHO`, `BIA_LOG`, `BAO_CAO` đã có dữ liệu thử nghiệm và sẽ không được coi là ledger đích của V2.

## Snapshot WF04

| Sheet | Vùng dữ liệu | Vai trò hiện tại |
|---|---|---|
| `LOG_MUA` | A1:S72 | Hóa đơn mua, OCR, xác nhận, thanh toán/công nợ |
| `LOG_NAP` | A1:F11 | Nạp quỹ |
| `TONGHOP` | A1:L16 | Tổng hợp quỹ/công nợ |
| `STATE_CHO` | A1:D3 | Trạng thái hội thoại ngắn hạn |
| `ERROR` | A1:L15 có dữ liệu | Log lỗi; vùng định dạng mở rộng đến khoảng 1000 dòng |
| `CONFIG_QUY` | A1:D7 | Cấu hình quỹ |
| `CONFIG_ROLE` | A1:E5 | Role/quyền hiện tại của WF04 |

WF04 có ích để học cách lưu OCR, preview và quản lý callback. Tên cột, trạng thái và ý nghĩa quỹ/công nợ không được tái sử dụng làm schema V2.

## Dữ liệu `.xls` nguồn

### `mã bia và kho lạnh.xls`

| Sheet | Kích thước | Nội dung |
|---|---:|---|
| `Sheet` | 21 × 5 | `Mã hàng`, `Mã nhà cung cấp`, `Tên hàng bán hàng`, `Tên nhà cung cấp`, `Đơn vị tính`; có dòng tiêu đề nhóm |
| `mã bia` | 24 × 7 | Mapping mã/tên/đơn vị giữa nhà hàng và nhà cung cấp, kèm ghi chú |
| `mã kho` | 65 × 3 | Danh mục hàng kho; dòng đầu là tiêu đề lớn, header thực ở dòng 2 |

### `Báo cáo bán hàng bia nước từ phần mềm.xls`

- Một sheet, 21 × 4.
- Cột: `Mã hàng`, `Tên hàng`, `Số lượng`, `Đơn vị tính`.
- Có các dòng tiêu đề nhóm xen giữa dòng hàng hóa; parser V2 phải nhận diện và bỏ qua theo cấu hình, không theo vị trí hard-code.

## Mapping khái niệm hiện tại → V2

| Hiện tại | Hướng V2 |
|---|---|
| `CONFIG_BIA` | Tách danh mục bia và hệ số quy đổi; version hóa cấu hình |
| `CONFIG_USER.role` | `CONFIG_USER` + `CONFIG_ROLE` + bảng nối user-role và role-permission |
| `STATE_CHO` | Trạng thái Telegram có TTL cấu hình và cleanup bởi Dispatcher |
| `BIA_LOG` | Ledger số đếm theo phiên, bản ghi bất biến/versioned |
| `MOCK_PURCHASE` | Ledger nhập chuẩn từ OCR hoặc nguồn được duyệt |
| `MOCK_SALES` | Snapshot bán hàng có version, preview và publish |
| `BAO_CAO` | Báo cáo ngày/tuần tái tạo được từ ledger chuẩn |
| `EVENT_LOG` / `ERROR` | Log kỹ thuật có retry, archive tuần và index backup |
| `LOG_MUA` WF04 | Chỉ lấy mẫu lifecycle OCR; V2 tách hóa đơn, ảnh, dòng OCR và ledger nhập |

## Quy tắc dữ liệu đã chốt cho V2

- Ngày nhập hàng là ngày ảnh được tải lên Telegram.
- Một hóa đơn chỉ thuộc một chi nhánh.
- Nhà cung cấp chỉ được ghi nhận; nếu không rõ dùng `Nhà cung cấp không rõ`.
- Hóa đơn nghi trùng vẫn có thể được lưu như hóa đơn mới khi người dùng xác nhận.
- Một lần gửi hỗ trợ nhiều ảnh, giới hạn cấu hình trong khoảng 5–10 ảnh; giá trị cụ thể nằm ở Google Sheets.
- Số đếm tồn nằm trong topic riêng.
- Không có nhập trong ngày: thông báo rồi dùng `0`, không cần xác nhận.
- Bán hàng bằng `0`: thông báo và không cần xác nhận.
- Không dùng ngày trên hóa đơn để xác định ngày nghiệp vụ nhập.
- Mọi phép quy đổi cần hệ số được cấu hình rõ; không suy đoán từ tên hàng hoặc dữ liệu lịch sử.

## Khoảng trống cần khóa trong spec

- Data type, nullability, unique key và retention của từng cột V2.
- Định dạng ID bất biến cho hóa đơn, ảnh, dòng nhập, snapshot bán, phiên đếm và report.
- Công thức quy đổi cụ thể cho từng đơn vị và ngày hiệu lực.
- Header alias/mapping của file bán hàng.
- Cách bảo vệ range và tài khoản được phép sửa config/ledger.
- Phiên bản schema ban đầu và migration từ snapshot test.
