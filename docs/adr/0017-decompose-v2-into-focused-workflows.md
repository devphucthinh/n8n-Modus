# Decompose V2 into focused workflows

Kiểm kê bia V2 được chia thành mười hai workflow có một trách nhiệm chính: Config Gateway, Error Handler, Telegram Router, Dispatcher, mở Phiên kiểm kê, nhận số đếm, đối soát ngày, nhập hóa đơn, nhập báo cáo bán, báo cáo, lưu trữ tuần và backup phục hồi hằng ngày. Cách phân rã này giữ các adapter đầu vào độc lập với sổ nghiệp vụ và cho phép kiểm thử hoặc thay thế từng phần mà không sửa toàn bộ hệ thống.

## Consequences

Config Gateway và Error Handler là dịch vụ dùng chung; các workflow nghiệp vụ là worker có đầu vào và đầu ra chuẩn hóa; Telegram Router cùng Dispatcher chỉ làm nhiệm vụ kích hoạt và định tuyến. Backup phục hồi là workflow riêng vì có lịch, điều kiện chạy, thời hạn giữ và quy trình khôi phục khác Bản lưu trữ tuần. Khi bàn giao, các workflow dùng chung được import trước, worker tiếp theo, rồi Router và Dispatcher cuối cùng; các tham chiếu workflow ID do n8n cấp phải được liên kết và kiểm tra trước khi kích hoạt hai entry point.
