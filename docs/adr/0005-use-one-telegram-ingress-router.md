# Use one Telegram ingress router

Kiểm kê bia V2 sẽ có một workflow nhận toàn bộ update từ bot Telegram rồi định tuyến theo `chat_id`, `message_thread_id`, loại update, lệnh và trạng thái hội thoại. Các workflow nghiệp vụ nhận một phong bì đầu vào chuẩn hóa từ router và không tự đăng ký Telegram Trigger riêng cho cùng bot.

## Consequences

Bốn topic nghiệp vụ vẫn tách biệt với người dùng: kiểm kê tồn, hóa đơn nhập, báo cáo bán và báo cáo. Mỗi cặp `chat_id` và `message_thread_id` đang hoạt động ánh xạ duy nhất tới một chi nhánh và một chức năng, nên người dùng không phải chọn lại chi nhánh trong hội thoại. Router là nơi duy nhất kiểm tra quyền đầu vào, chống xử lý lặp theo `update_id` và phân luồng callback. Nếu router không nhận được update thì mọi chức năng Telegram của bot cùng bị ảnh hưởng, vì vậy router phải nhỏ, có log lỗi và có đường kiểm thử thủ công.

Lỗi thao tác được trả bằng ngôn ngữ dễ hiểu ngay trong topic nghiệp vụ, kèm `error_id` và hướng dẫn thử lại. Chi tiết kỹ thuật đã làm sạch được gửi tới một group hoặc topic lỗi riêng cho admin theo cấu hình Google Sheets, đồng thời ghi đầy đủ vào `ERROR_BIA`; không tạo topic lỗi công khai thứ năm. Các lỗi lặp cùng dấu vân tay trong cửa sổ cấu hình chỉ phát một cảnh báo và một thông báo phục hồi khi hệ thống hoạt động lại.

Mỗi topic cung cấp `/menu` và các nút đúng với chức năng cùng quyền của người đang thao tác. Các lệnh ổn định gồm `/kiemke`, `/nhaphang`, `/nhapban`, `/baocaobia`, `/trangthai` và `/help`; `/help` phải liệt kê đầy đủ mọi lệnh người dùng được phép thấy, cú pháp, tham số, ví dụ ngắn và mô tả kết quả của từng lệnh.

Đích gửi lỗi vận hành được cấu hình trong Google Sheets theo group, topic, mức nghiêm trọng tối thiểu và nhóm người nhận. Thiếu đích Telegram Error không chặn nghiệp vụ, nhưng bản ghi `ERROR_BIA` vẫn là bắt buộc; lỗi nghiêm trọng gửi ngay, lỗi lặp được gom và hệ thống chỉ gửi một thông báo khi phục hồi.

Mỗi lỗi được phân loại có thể thử lại hoặc không. Admin có thể dùng `/retry <error_id>` với lỗi có thể thử lại; lần chạy lại giữ nguyên khóa chống trùng và nối vào lịch sử lỗi cũ. Lỗi dữ liệu không hợp lệ chỉ được tiếp tục sau khi dữ liệu nguồn hoặc cấu hình đã được sửa, không retry mù.

`/trangthai` là ngoại lệ chỉ đọc so với phân quyền chi nhánh: mọi người dùng đang hoạt động trong `CONFIG_USER` đều được xem trạng thái vận hành của tất cả chi nhánh, gồm cấu hình, dispatcher, phiên mở, dữ liệu chờ, khóa sổ, backup, lưu trữ và số lỗi. Lệnh không bao giờ hiển thị credential, token, nội dung lỗi kỹ thuật chưa làm sạch hoặc dữ liệu bí mật.

Người không có bản ghi đang hoạt động trong `CONFIG_USER` không được thực hiện lệnh hoặc callback nào, kể cả `/trangthai`. Bot chỉ trả lời rằng người đó chưa được cấp quyền và ghi sự kiện truy cập bị từ chối; phản hồi không tiết lộ người dùng, vai trò, chi nhánh hay cấu hình hiện có.
