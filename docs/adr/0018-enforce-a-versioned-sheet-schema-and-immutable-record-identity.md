# Enforce a versioned Sheet schema and immutable record identity

Google Sheet hoạt động có một `CONFIG_SCHEMA` khai báo phiên bản cấu trúc, các sheet bắt buộc, tên cột, kiểu dữ liệu và khóa duy nhất. Workflow đọc theo tên cột thay vì vị trí; cấu trúc thiếu hoặc không tương thích bị chặn trước khi ghi để việc người dùng sắp xếp lại cột không làm đổi nghĩa dữ liệu.

Mọi phiên, chứng từ, dòng nghiệp vụ, bản bán, báo cáo, điều chỉnh và lỗi có ID bất biến do V2 tạo. Số dòng Google Sheets, Telegram message ID và n8n execution ID chỉ là metadata, không phải khóa chính.

## Consequences

Thời điểm kỹ thuật được lưu theo ISO 8601 UTC; dữ liệu nghiệp vụ lưu riêng Ngày kinh doanh, múi giờ chi nhánh và người thực hiện. Mặc định vận hành là `Asia/Ho_Chi_Minh`, định dạng `vi-VN` và `VND`, với múi giờ có thể ghi đè theo chi nhánh. V2 không tự quy đổi ngoại tệ; chứng từ khác VND phải được xác nhận thủ công.

Thay đổi cấu trúc được thực hiện như một migration có phiên bản: bật chế độ bảo trì, tạo Bản sao phục hồi, chạy checklist chuyển đổi, kiểm tra lại `CONFIG_SCHEMA`, rồi mới mở thao tác mới. Workflow không tương thích phải từ chối ghi vào schema cũ thay vì tự thêm hoặc đổi cột âm thầm.
