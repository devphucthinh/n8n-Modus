# Externalize business configuration to the live Google Sheet

Mọi cấu hình nghiệp vụ có thể thay đổi của Kiểm kê bia V2 sẽ được lưu trong các sheet cấu hình của Google Sheet nguồn đang hoạt động và được đọc khi workflow chạy. Workflow n8n chỉ giữ thông tin kết nối tối thiểu cần để mở nguồn cấu hình cùng các quy tắc giao thức bất biến; cách này cho phép vận hành thay đổi lịch, TTL, ngưỡng, topic, quyền và ánh xạ mà không sửa hoặc import lại workflow.

## Consequences

Các workflow phải dùng chung một lớp đọc và kiểm tra cấu hình, từ chối chạy khi giá trị bắt buộc thiếu hoặc sai kiểu. Những lịch nghiệp vụ thay đổi được sẽ cần một bộ điều phối chạy theo nhịp kỹ thuật cố định rồi quyết định tác vụ nào đến hạn từ Google Sheets.
