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

Dispatcher dùng các khóa `CONFIG_GLOBAL` `DISPATCHER_NOTIFICATION_CHAT_ID`, `DISPATCHER_NOTIFICATION_THREAD_ID` và `DISPATCHER_HEARTBEAT_THRESHOLD`. Theo quyết định chốt ngày 2026-09-28, topic `KIEM_KE` phải được tạo sẵn và có mapping `ACTIVE` trong `CONFIG_TOPIC` cho đúng chi nhánh (`chat_id`, `message_thread_id`). Nếu thiếu, WF05 dừng an toàn với `INVENTORY_TOPIC_NOT_CONFIGURED`; workflow không tự tạo topic và không ghi `CONFIG_TOPIC`. Bản migration Issue #4 chỉ là mẫu cấu trúc, không thay thế cấu hình trong Sheet live.

Khi Google Sheets đọc lỗi, WF01 xét mã kỹ thuật trên item lỗi trước khi diễn giải dòng dữ liệu: 429/5xx hoặc mã mạng đã biết trả `CONFIG_READ_UNAVAILABLE`, 404 trả `CONFIG_SHEET_MISSING`, còn lỗi không xác định trả `CONFIG_SHEET_READ_FAILED` để dừng ghi an toàn. Các Gateway failure thông thường vẫn được ghi qua WF02/`ERROR_BIA`. WF04 gọi một entry Gateway chuyên dụng có `callerPolicy=workflowsFromAList`; chỉ native caller ID của WF04 sau khi được bind mới được phép gọi. Entry này không gọi WF02 khi Gateway từ chối. Payload không thể chọn chính sách lỗi. Nhánh WF04 không dispatch và chỉ đọc ledger `HEARTBEAT`; nó không đọc ledger nghiệp vụ cho nhánh này. Chỉ khi HEARTBEAT tương thích schema và có ít nhất một heartbeat đã lưu hợp lệ về mặt ngữ nghĩa, WF04 mới append một heartbeat `FAILED` dựa trên hàng gần nhất, giữ nguyên ngưỡng/đích đã lưu và `critical_notified`. Nhánh này không phát notice, không gọi WF02, không ghi `ERROR_BIA`, kể cả khi Gateway lỗi lặp lại. Nếu HEARTBEAT thiếu, không đọc được, rỗng, sai schema hoặc sai ngữ nghĩa, WF04 fail-closed và không ghi; một sheet rỗng không cung cấp cấu hình persisted để phục hồi.

Trên đường Gateway thành công, trước khi đọc ledger nghiệp vụ hoặc lập dispatch, WF04 phải xác thực đúng một dòng `ACTIVE` cho từng khóa `DISPATCHER_HEARTBEAT_THRESHOLD`, `DISPATCHER_NOTIFICATION_CHAT_ID` và `DISPATCHER_NOTIFICATION_THREAD_ID`; ngưỡng phải là số nguyên dương an toàn và cặp chat/thread phải là ID số hợp lệ. Thiếu, trùng, inactive hoặc sai định dạng trả `HEARTBEAT_CONFIG_INVALID`, không lập dispatch và không ghi heartbeat. Không dùng cấu hình cũ đã lưu hoặc ngưỡng 0 để thay thế cấu hình hiện hành; cấu hình persisted chỉ được dùng cho nhánh Gateway lỗi nêu trên. Các đường Gateway hợp lệ với đủ cấu hình vẫn giữ nguyên cảnh báo worker/critical/recovery hiện có. Chặn import cho tới khi bind hai workflow ID thực và kiểm tra caller allowlist.

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
6. Bật Error Workflow handling cho lỗi kỹ thuật đã xác minh đích ghi tương thích; không gửi stack trace hoặc token vào Telegram/Sheet. Gateway failure thông thường được ghi qua WF02 khi WF01 đọc được yêu cầu. WF04 chỉ gọi entry Gateway chuyên dụng có native caller allowlist, không qua trường payload. Chỉ sau khi bind hai workflow ID thật và kiểm tra caller allowlist mới được import. Nhánh Gateway lỗi không dispatch, phát notice, gọi WF02 hoặc ghi `ERROR_BIA`; nếu HEARTBEAT cục bộ đọc được, tương thích schema và có heartbeat gần nhất hợp lệ về mặt ngữ nghĩa, workflow chỉ append một heartbeat `FAILED`, giữ nguyên `critical_notified` và cấu hình đã lưu. HEARTBEAT thiếu, không đọc được, rỗng hoặc không hợp lệ thì fail-closed, không ghi. Quy tắc này cũng áp dụng cho lỗi Gateway lặp lại; các đường chạy bình thường giữ nguyên hành vi alert hiện có.
7. Các Google Sheets node `read` phải giữ node property `executeOnce=true`; không đổi `returnAll` thành `false` để chữa fan-out.

## Smoke test trước khi bật

- Config hợp lệ: `/trangthai` của user ACTIVE trả version, fingerprint/snapshot ID và số chi nhánh; không hiển thị chat ID nội bộ.
- Thiếu cột: xóa thử `timezone` khỏi một bản sao test, xác nhận `CONFIG_COLUMN_MISSING`, write plan rỗng.
- Trùng khóa: tạo hai `CONFIG_USER.user_id` giống nhau, xác nhận `CONFIG_DUPLICATE_KEY`.
- Version/fingerprint: đổi nội dung không tăng version phải bị chặn; tăng version nhưng fingerprint không đổi cũng bị chặn.
- Maintenance: `YES` cho phép `/trangthai`, chặn intent `START_OPERATION`.

Sau khi smoke test đạt, bật WF02, WF01 rồi WF03 và giữ lại bản sao phục hồi cùng log bàn giao.
