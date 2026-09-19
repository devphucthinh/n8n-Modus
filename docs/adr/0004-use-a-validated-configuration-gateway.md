# Use a validated configuration gateway

Mọi workflow của Kiểm kê bia V2 sẽ lấy cấu hình qua một workflow dùng chung thay vì tự đọc và tự diễn giải từng sheet. Gateway đọc các bảng cấu hình trong Google Sheet đang hoạt động, chuẩn hóa kiểu dữ liệu, kiểm tra khóa bắt buộc và quan hệ tham chiếu, rồi trả về một Ảnh chụp cấu hình có mã phiên bản hoặc dấu vân tay.

Cấu hình dạng khóa–giá trị có metadata để người vận hành hiểu và kiểm tra được; lịch nghiệp vụ được tách thành bảng riêng vì một tác vụ có thể lặp theo chi nhánh, múi giờ và ngày trong tuần. Các danh mục có cấu trúc như mặt hàng, người dùng, vai trò và ánh xạ vẫn dùng sheet chuyên biệt.

## Consequences

Workflow nghiệp vụ không được tự đặt giá trị mặc định âm thầm khi cấu hình bắt buộc thiếu hoặc sai. Gateway trả lỗi có vị trí rõ ràng, ghi `ERROR_BIA` và chặn thao tác có nguy cơ tạo dữ liệu sai. Một phiên hoặc giao dịch đang chạy giữ nguyên Ảnh chụp cấu hình của nó; thay đổi hợp lệ trên Google Sheets có hiệu lực với lần bắt đầu kế tiếp.

Cấu hình V2 có hiệu lực trực tiếp sau khi toàn bộ gateway kiểm tra hợp lệ, không cần tạo bản nháp và thao tác công bố riêng. Cờ bảo trì cấu hình trong Google Sheets cho phép admin chủ động chặn các lần bắt đầu mới khi đang sửa nhiều bảng; những phiên đã có Ảnh chụp cấu hình không bị diễn giải lại.

Tên workflow, sheet, cột, trạng thái, quyền và các khóa tham chiếu dùng mã ASCII ổn định, không dấu và không khoảng trắng. Giá trị người dùng nhìn thấy dùng cột nhãn hoặc mô tả tiếng Việt; workflow không dùng nhãn hiển thị làm khóa nghiệp vụ.

`CONFIG_VERSION` ghi phiên bản, ghi chú thay đổi, người thay đổi tự khai báo và thời điểm. Gateway lưu dấu vân tay của mỗi phiên bản đã chấp nhận; nếu nội dung cấu hình đổi nhưng phiên bản chưa tăng, nó báo cấu hình chưa hoàn tất và chặn lần bắt đầu mới. Cờ bảo trì được dùng khi chỉnh nhiều sheet để Gateway không chấp nhận trạng thái trung gian.

Mã mặt hàng và mã chi nhánh là định danh lịch sử, không bị xóa hoặc tái sử dụng. Khi ngừng dùng, admin chuyển `trang_thai=INACTIVE`; mặt hàng hay chi nhánh mới phải có mã mới. Chi nhánh chỉ được chuyển sang `INACTIVE` khi không còn phiên kiểm kê, hóa đơn nháp hoặc bản bán nháp đang mở.

Mỗi cấu hình hợp lệ được lưu cả dấu vân tay và toàn bộ nội dung chuẩn hóa trong `CONFIG_SNAPSHOT`, có `config_snapshot_id` bất biến. Phiên và giao dịch tham chiếu ID này để có thể tái hiện đúng quy tắc đã áp dụng, không chỉ biết rằng cấu hình từng khác.

Người có quyền `DUYET_NHAP` được chọn ánh xạ mặt hàng cho hóa đơn hiện tại. Chỉ ADMIN hoặc người có quyền riêng `CONFIG_MAPPING_EDIT` được ghi ánh xạ đó thành cấu hình dùng tự động cho các lần sau.
