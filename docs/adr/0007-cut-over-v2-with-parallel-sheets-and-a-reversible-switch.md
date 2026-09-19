# Cut over V2 with parallel sheets and a reversible switch

Kiểm kê bia V2 sẽ được dựng bằng các sheet mới nằm cạnh dữ liệu hiện tại trong cùng Google Sheet, thử trước bằng chi nhánh và topic kiểm thử, rồi chạy đối chiếu không công bố kết quả trước khi chuyển quyền xử lý thật. Trước thời điểm chuyển đổi phải có bản sao lưu/export và kiểm tra cấu hình đạt yêu cầu.

Lịch sử thử nghiệm hiện tại không được nhập vào các sổ V2. Việc khởi tạo chỉ mang sang cấu hình còn đúng, danh mục, người dùng, vai trò và Tồn đầu kỳ khởi tạo đã được admin xác nhận; dữ liệu thử nghiệm được giữ trong bản xuất riêng để tra cứu.

Việc chuyển đổi dùng một cờ hiệu lực có kiểm soát trong cấu hình: tại một thời điểm chỉ V1 hoặc V2 được quyền ghi sổ nghiệp vụ chính thức cho cùng chi nhánh. Các workflow và sheet cũ được giữ nguyên trong giai đoạn nghiệm thu để có thể quay lại, không xóa hoặc đổi cấu trúc tại chỗ.

Tất cả workflow V2 được import thành workflow mới với tên `WFxx_V2_...`; không import đè, đổi tên hay sửa trực tiếp workflow V1. Chỉ sau khi chủ hệ thống chấp thuận chuyển đổi mới tắt entry point V1 và bật Telegram Router cùng Dispatcher V2.

## Consequences

Cần checklist trước và sau chuyển đổi, một khoảng chốt ngắn để tránh dữ liệu ghi đồng thời, tiêu chí so sánh kết quả và thủ tục quay lui. Khi V2 đã được nghiệm thu và ổn định, việc lưu trữ hoặc loại bỏ V1 là một quyết định vận hành riêng.

Điều kiện kỹ thuật tối thiểu là bảy Ngày kinh doanh liên tiếp đối chiếu đạt yêu cầu và đã thử hóa đơn nhiều ảnh, ánh xạ mới, tệp bán nhiều ngày, thay thế bản bán, chênh lệch đỏ có giải trình, sửa sau khóa sổ, gom lỗi lặp cùng một lần lưu trữ tuần. Đạt điều kiện không tự động bật V2: chủ hệ thống phải xác nhận chấp thuận chuyển đổi; nếu chưa xác nhận thì tiếp tục chạy thử.
