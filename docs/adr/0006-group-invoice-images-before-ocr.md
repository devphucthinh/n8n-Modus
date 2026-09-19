# Group invoice images before OCR

Một hóa đơn nhập có thể gồm nhiều ảnh. Ảnh đầu tiên mở một Hóa đơn nháp; các ảnh tiếp theo được gom vào cùng Bộ ảnh hóa đơn và giữ nguyên thứ tự. OCR chỉ bắt đầu khi người dùng bấm `Đọc hóa đơn`.

## Consequences

Không được coi mỗi ảnh là một hóa đơn độc lập chỉ vì Telegram gửi nhiều update. Workflow phải chống nhận trùng ảnh, cho phép xem danh sách, bỏ ảnh cuối hoặc hủy trước khi xử lý, và lưu quan hệ giữa hóa đơn, từng ảnh và kết quả nhận diện. Hết thời hạn tương tác chỉ nhắc người dùng và đánh dấu Hóa đơn nháp đang dang dở; không tự OCR. Thời hạn này là cấu hình nghiệp vụ trên Google Sheets.

Số ảnh tối đa của một Bộ ảnh hóa đơn được cấu hình bằng `max_images_per_invoice` trên Google Sheets, mặc định `10` và chỉ nhận giá trị từ `5` đến `10`. Từ ảnh thứ sáu bot cảnh báo bộ ảnh lớn nhưng vẫn tiếp tục nhận đến giới hạn; vượt giới hạn không làm mất ảnh đã nhận và người dùng phải hoàn tất hoặc hủy bộ hiện tại trước khi bắt đầu hóa đơn khác.

Mỗi người dùng chỉ có một Hóa đơn nháp đang nhận ảnh cho một chi nhánh. Ảnh tiếp theo đi vào bản đó cho đến khi người dùng bấm `Đọc hóa đơn`, hoàn tất hoặc hủy; `/nhaphang` hiển thị bản đang mở để tiếp tục. Chỉ người tạo được thêm hoặc bỏ ảnh trước OCR. Sau OCR, người có quyền `DUYET_NHAP` được sửa và duyệt dòng; nếu người tạo bị vô hiệu hóa, ADMIN có thể chuyển quyền sở hữu hoặc hủy với lý do.
