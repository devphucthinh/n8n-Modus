# Issue #3 — Telegram Router, phân quyền và `/help`

Tài liệu này là handoff triển khai cho PR của issue #3. Nó không chứa thông tin xác thực, spreadsheet ID hoặc chat ID thật. Google Sheet live là nguồn cấu hình; các file `.xlsx` tải từ Google Sheets chỉ là snapshot/fixture.

## Phạm vi đã triển khai

- WF03 là Telegram ingress duy nhất và nhận `message`, `edited_message`, `callback_query`.
- Mỗi update được chuẩn hóa thành envelope có `request_id=operation_id=tg-<update_id>`; callback, bot suffix, tham số và forum thread được giữ lại. Callback có thêm `payload.idempotency_key=tg-callback-<callback_id>` để chống xử lý lặp khi Telegram phát lại với `update_id` khác.
- Config Gateway đọc thêm sáu tab router khi request không phải `/trangthai`: `CONFIG_ROLE`, `CONFIG_PERMISSION`, `CONFIG_USER_ROLE`, `CONFIG_ROLE_PERMISSION`, `CONFIG_TOPIC`, `CONFIG_LENH`, và đọc `EVENT_LOG` để ghi access-denied audit.
- Router trả quyết định thuần (`STATUS`, `HELP`, `ROUTE`, `RETRY`, `DENY`) trước khi một worker được gọi. Workflow export không chứa danh sách role, permission, topic, worker hoặc command nghiệp vụ.
- `/help` lấy lệnh active từ `CONFIG_LENH`, sắp theo `ordinal`, hiển thị command, cú pháp, mô tả, quyền và ví dụ.
- `/trangthai` vẫn là đường đọc trạng thái cho user active; user unknown/inactive nhận cùng một denial an toàn.
- `/retry <error_id>` chỉ nhận lỗi retryable và giữ lại `operation_id` cùng `request_id`/idempotency key ban đầu.
- Access-denied audit dùng `event_id` xác định theo idempotency key và không append lần hai cho cùng một update/callback.
- WF03 khôi phục `reply_target`/`text` sau khi ghi `EVENT_LOG`; callback query được node `Answer Telegram Callback` xác nhận bằng Telegram `answerQuery`.
- `/trangthai` không đưa write plan ledger của Gateway vào nhánh audit Telegram.

## Google Sheet cần tạo/cấu hình

Tạo sáu tab cấu hình sau, đúng header ASCII và đúng thứ tự cột:

| Tab | Header |
|---|---|
| `CONFIG_ROLE` | `role_code`, `role_name`, `description_vi`, `trang_thai` |
| `CONFIG_PERMISSION` | `permission_code`, `permission_name`, `description_vi`, `trang_thai` |
| `CONFIG_USER_ROLE` | `user_role_id`, `user_id`, `role_code`, `branch_id`, `effective_from`, `effective_to`, `trang_thai` |
| `CONFIG_ROLE_PERMISSION` | `role_permission_id`, `role_code`, `permission_code`, `trang_thai` |
| `CONFIG_TOPIC` | `topic_id`, `branch_id`, `topic_type`, `chat_id`, `message_thread_id`, `trang_thai` |
| `CONFIG_LENH` | `command_code`, `command_text`, `syntax`, `description_vi`, `permission_code`, `topic_type`, `worker_workflow`, `example`, `ordinal`, `trang_thai` |

Tạo thêm tab vận hành `EVENT_LOG` để audit truy cập bị từ chối:

`event_id`, `event_type`, `request_id`, `operation_id`, `actor_user_id`, `branch_id`, `topic_type`, `command`, `outcome`, `error_code`, `created_at`, `trang_thai`.

Quy tắc dữ liệu:

1. Mã máy dùng chữ in hoa ASCII; nhãn tiếng Việt chỉ dùng để hiển thị/dropdown.
2. Chỉ dòng `ACTIVE` được sử dụng. Dòng `INACTIVE` không xuất hiện trong `/help`.
3. `CONFIG_USER_ROLE.branch_id='*'` là phạm vi toàn hệ thống; giá trị khác phải trùng branch của topic.
4. User phải tồn tại và `ACTIVE` trong `CONFIG_USER`; user unknown/inactive bị từ chối cùng một thông báo chung.
5. Mỗi command cần một dòng `CONFIG_LENH`. Lệnh cần quyền phải có mapping qua `CONFIG_ROLE_PERMISSION` tới permission `ACTIVE`.
6. Topic cần khớp `chat_id`, `message_thread_id` và `topic_type`; không suy đoán topic từ tên hiển thị.
7. `/trangthai` và `/help` có thể để `permission_code` trống. `/retry` yêu cầu permission `ADMIN_RETRY` và role admin có branch `*`.
8. Sau khi thêm sáu tab, thêm schema rule tương ứng vào `CONFIG_SCHEMA`; tăng `config_version` (ví dụ `v1.1`) và ghi chú thay đổi trong `CONFIG_VERSION`.
9. Thêm schema rule cho `EVENT_LOG`; không sửa trực tiếp các dòng audit đã commit.

Dữ liệu mẫu an toàn để bắt đầu:

- Role: `KIEM_KE`, `ADMIN`.
- Permission: `KIEM_KE_WRITE`, `ADMIN_RETRY`.
- Topic: một dòng `KIEM_KE` cho chat/thread kiểm thử.
- Command: `/kiemke`, `/help`, `/trangthai`, `/retry`; chỉ bật worker workflow sau khi workflow đích đã import và kiểm thử.

## n8n import và liên kết

1. Tạo hoặc chọn test copy của Google Sheet và hoàn thành sáu tab cấu hình cùng `EVENT_LOG` trước khi import WF01.
2. Import theo thứ tự: `WF01_V2_CONFIG_GATEWAY.json` → `WF02_V2_ERROR_HANDLER.json` → `WF03_V2_TELEGRAM_ROUTER.json`.
3. Chọn credential đúng tên `GOOGLE_SHEETS_KKB_V2` cho Google Sheets và `TELEGRAM_KKB_V2` cho Telegram.
4. Trong hai node `Call Config Gateway` của WF03, thay `PASTE_WF01_WORKFLOW_ID` bằng workflow ID thật của WF01. Không thay đổi logic bằng cách nhập command/permission trực tiếp vào Code node.
5. Kiểm tra Spreadsheet ID placeholder ở các node Google Sheets của WF01; chỉ điền ID của file config đã được cấp quyền.
6. Giữ cả ba workflow inactive trong lúc kiểm tra. Publish WF01 trước, sau đó publish WF03; chỉ active Telegram Router sau khi smoke test đạt.
7. Chỉ một workflow được sở hữu Telegram Trigger của bot. WF02 chỉ là error handler và không được nhận Telegram Trigger.

## Smoke test và bằng chứng cần ghi

Ghi execution ID và Telegram message ID, không ghi giá trị bí mật:

| Case | Kết quả đạt |
|---|---|
| `/help` trong topic hợp lệ | Hiện toàn bộ dòng `CONFIG_LENH` active, đủ cú pháp, mô tả, quyền, ví dụ; không hiện dòng inactive |
| `/trangthai` từ user active | Có reply trong đúng chat/thread và không lộ config nội bộ |
| User unknown hoặc inactive | Không thực hiện worker/write plan; reply denial giống nhau |
| `/kiemke` có role + topic hợp lệ | `decision.kind=ROUTE`, đúng `topic_type`, `branch_id`, `worker_workflow`, operation/idempotency key |
| `/kiemke` sai topic/quyền | `decision.kind=DENY`, không gọi worker |
| Gửi lại cùng `update_id` | Cùng operation/idempotency key, không tạo business effect thứ hai |
| Gửi lại cùng callback ID nhưng `update_id` khác | Không route lần hai; cùng `payload.idempotency_key` |
| `/retry <error_id>` retryable bởi ADMIN | Giữ operation/idempotency key gốc |
| `/retry` non-retryable hoặc không phải ADMIN | Denial an toàn, không retry |

Các node đọc router/audit chỉ chạy khi request có `required_sheet_names`; vì vậy `/trangthai` vẫn chạy với chín tab core. Với command khác, nếu các tab router hoặc `EVENT_LOG` chưa tồn tại, không active bản export mới: hãy tạo tab trên bản test trước, chạy smoke, rồi mới promote cấu hình live bằng một `config_version` mới.

## Rollback và điều kiện đóng issue

- Rollback bằng cách deactivate WF03 mới và giữ nguyên các ledger/config snapshot đã commit; không sửa trực tiếp ledger.
- Không đóng issue #3 khi chưa có bằng chứng cả đường no-`reply_target` của WF02 và đường Telegram có `reply_target` của WF03 trên môi trường test.
- Issue #4 Dispatcher chỉ bắt đầu sau khi PR issue #3 được review, smoke test và merge riêng.
