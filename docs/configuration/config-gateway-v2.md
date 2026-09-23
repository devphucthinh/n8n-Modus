# KKB-V2 Config Gateway và cấu hình live Google Sheet

`KKB_V2_CONFIG_BASELINE.xlsx` là fixture được tải/copy vào Google Sheet live. Nguồn nghiệp vụ vẫn là Google Sheet hiện có trong phần Config Flow; file `.xlsx` không được coi là nguồn thay thế và không được dùng để ghi đè các tab V1.

## Chín tab V2

| Tab | Mục đích | Cách chỉnh sửa |
| --- | --- | --- |
| `CONFIG_SCHEMA` | Khai báo cột, kiểu, bắt buộc, unique, reference và allowed values | Chỉ quản trị cấu hình |
| `CONFIG_VERSION` | Phiên bản, schema version và maintenance mode | Tăng `config_version` khi nội dung cấu hình thay đổi |
| `CONFIG_GLOBAL` | Giá trị dùng chung như timezone/locale | Quản trị cấu hình |
| `CONFIG_BRANCH` | Danh sách chi nhánh hoạt động | Quản trị cấu hình |
| `CONFIG_USER` | User Telegram được phép dùng flow | Quản trị cấu hình |
| `CONFIG_THONG_BAO` | Template thông báo theo `message_key` | Quản trị nội dung |
| `CONFIG_SNAPSHOT` | Fingerprint và snapshot bất biến | Không sửa trực tiếp |
| `OPERATION` | Ledger PREPARED → COMMITTED | Không sửa trực tiếp |
| `ERROR_BIA` | Error ledger đã chuẩn hóa | Không sửa trực tiếp |

`CONFIG_SNAPSHOT`, `OPERATION` và `ERROR_BIA` phải được bảo vệ khỏi chỉnh sửa trực tiếp. Điều chỉnh dữ liệu lịch sử dùng workflow adjustment/versioned record, không xóa/sửa hàng đã commit.

Dispatcher dùng các khóa `CONFIG_GLOBAL` `DISPATCHER_NOTIFICATION_CHAT_ID`, `DISPATCHER_NOTIFICATION_THREAD_ID` và `DISPATCHER_HEARTBEAT_THRESHOLD`. Khi `CONFIG_TOPIC` chưa có topic `KIEM_KE` active, WF05 dùng `INVENTORY_TOPIC_NAME_TEMPLATE` cùng `CONFIG_BRANCH.forum_chat_id` để tạo topic Telegram rồi ghi mapping theo staged operation; không đặt chat ID, thread ID hoặc tên topic trong workflow.

## Checklist cấu hình Google Sheet

1. Tạo bản sao phục hồi của live Google Sheet trước khi thêm tab.
2. Thêm/copy đủ chín tab V2 vào file live; không thay thế, đổi tên hoặc xóa tab V1.
3. Copy header đúng thứ tự từ workbook fixture và điền giá trị thật cho branch, user, chat/thread và message template.
4. Giữ `CONFIG_VERSION.config_version` ở `v1` cho baseline; mỗi thay đổi nội dung phải tăng version.
5. Để `maintenance_mode=YES` trong lúc sửa; `/trangthai` vẫn đọc được nhưng thao tác mới bị chặn.
6. Kiểm tra `CONFIG_SCHEMA` trước khi bật workflow: cột, kiểu, unique, reference `CONFIG_USER.branch_id → CONFIG_BRANCH.branch_id`, allowed values.
7. Bảo vệ ba ledger runtime và kiểm tra các dòng chỉ được xuất hiện ở trạng thái `COMMITTED` khi worker đọc.

## Checklist cấu hình n8n

1. Import theo thứ tự: `WF02_V2_ERROR_HANDLER.json`, `WF01_V2_CONFIG_GATEWAY.json`, sau đó `WF03_V2_TELEGRAM_ROUTER.json` (WF02 là dependency của WF01; WF01 là dependency của WF03).
2. Chọn credential Google Sheets hiện có và đặt tên credential hiển thị là `GOOGLE_SHEETS_KKB_V2`; chọn credential Telegram là `TELEGRAM_KKB_V2`.
3. Bản import-ready đã nhúng live Sheet ID `1wQ76EpIx35Trkx5JZg8GZ0xZsEBcKAFA6eb7nKDvLu4`; không cần điền thủ công. Chỉ cần đảm bảo credential có quyền với file đó.
4. Bản import-ready hiện trỏ WF03 → WF01 `WEL83s9bZeB3ixxF` và WF01 → WF02 `MoG6coBccYkIS0nK`; nếu n8n tạo ID mới khi import, cập nhật Execute Workflow node theo ID mới và ghi lại trong handoff.
5. Để cả ba workflow ở trạng thái inactive cho tới khi smoke test xong.
6. Bật Error Workflow handling để lỗi kỹ thuật đi qua `WF02_V2_ERROR_HANDLER`; không gửi stack trace hoặc token vào Telegram/Sheet.
7. Các Google Sheets node `read` phải giữ node property `executeOnce=true`; không đổi `returnAll` thành `false` để chữa fan-out.

## Smoke test trước khi bật

- Config hợp lệ: `/trangthai` của user ACTIVE trả version, fingerprint/snapshot ID và số chi nhánh; không hiển thị chat ID nội bộ.
- Thiếu cột: xóa thử `timezone` khỏi một bản sao test, xác nhận `CONFIG_COLUMN_MISSING`, write plan rỗng.
- Trùng khóa: tạo hai `CONFIG_USER.user_id` giống nhau, xác nhận `CONFIG_DUPLICATE_KEY`.
- Version/fingerprint: đổi nội dung không tăng version phải bị chặn; tăng version nhưng fingerprint không đổi cũng bị chặn.
- Maintenance: `YES` cho phép `/trangthai`, chặn intent `START_OPERATION`.

Sau khi smoke test đạt, bật WF02, WF01 rồi WF03 và giữ lại bản sao phục hồi cùng log bàn giao.
