# Stage and commit multi-sheet business writes

Mỗi thay đổi trải trên nhiều Google Sheets được xem là một Thao tác ghi sổ có `operation_id` bất biến. Các dòng liên quan được ghi ở trạng thái chuẩn bị và chỉ trở thành dữ liệu nghiệp vụ có hiệu lực sau khi thao tác chuyển sang `COMMITTED`; các workflow đọc sổ phải bỏ qua dữ liệu chưa commit.

## Consequences

Nếu n8n dừng giữa chừng, lần chạy lại dùng đúng `operation_id` để kiểm tra và hoàn tất phần còn thiếu thay vì tạo giao dịch mới. Thao tác không thể hoàn tất chuyển sang `FAILED`, giữ dấu vết để retry hoặc xử lý; không công bố một phần. Giao thức này bù cho việc các lần ghi vào nhiều sheet hoặc nhiều API request không có một transaction chung.
