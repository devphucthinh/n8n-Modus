# Require explicit, conflict-safe inventory finalization

Phiên kiểm kê chỉ nhận Giá trị đếm tồn hợp lệ: `0` là số đếm có chủ đích, ô trống là chưa hoàn tất và số âm bị từ chối. Quy tắc số thập phân, bước nhập, cận dưới và cận trên được cấu hình theo mặt hàng; workflow không tự làm tròn dữ liệu người dùng.

Mỗi mặt hàng chỉ nhận Tồn thực tế theo một Đơn vị kiểm kê đã cấu hình. V2 không phân tích chuỗi tự do gồm nhiều đơn vị như “2 két 5 chai”; đơn vị từ hóa đơn và báo cáo bán phải được ánh xạ và quy đổi trước khi vào sổ.

Mỗi mặt hàng có số phiên bản để phát hiện hai người cùng sửa. Workflow không ghi đè âm thầm: khi phiên bản đã thay đổi, nó hiển thị giá trị hiện tại và giá trị vừa gửi để người có quyền chọn kết quả, đồng thời giữ vết cả hai thao tác. Callback Telegram và lần gửi lại cùng một yêu cầu phải có tính lặp an toàn.

## Consequences

Điền đủ dòng không tự động Chốt kiểm kê. Người có quyền kiểm kê phải xem bảng tổng hợp rồi nhấn xác nhận chốt; chỉ admin được mở lại sau khi ngày đã khóa sổ. Hết Thời hạn nhập kiểm kê vô hiệu hóa nút cũ và chuyển phiên sang hết hạn thao tác nhưng không xóa dữ liệu; người kiểm kê có thể tiếp tục nếu ngày chưa khóa sổ.

Mỗi chi nhánh chỉ có một Phiên kiểm kê đang hoạt động. Phiên giữ nguyên danh mục, quy đổi, giới hạn nhập và các giá trị nghiệp vụ trong Ảnh chụp cấu hình lúc mở; thay đổi cấu hình chỉ áp dụng từ phiên kế tiếp. Muốn áp dụng thay đổi ngay, admin phải hủy phiên cũ có lý do rồi mở phiên mới.

Chênh lệch đỏ không làm hệ thống chờ vô hạn, nhưng từng mặt hàng đỏ phải có Giải trình chênh lệch. Khi đủ giải trình, ngày có thể chốt ở trạng thái có cảnh báo và admin được thông báo; nếu thiếu, phiên ở trạng thái chờ giải trình cho đến khi được bổ sung hoặc admin xử lý.
