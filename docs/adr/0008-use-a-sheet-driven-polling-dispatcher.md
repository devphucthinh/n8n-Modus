# Use a sheet-driven polling dispatcher

Kiểm kê bia V2 sẽ dùng một workflow điều phối lịch chạy theo nhịp kỹ thuật cố định 10 phút. Mỗi lần thức dậy, dispatcher lấy cấu hình đã kiểm tra từ gateway, tính các tác vụ nghiệp vụ đang đến hạn hoặc còn trong cửa sổ chạy bù, tạo Khóa phát lệnh và gọi workflow nghiệp vụ tương ứng.

Lịch, múi giờ, chi nhánh, trạng thái bật/tắt, cửa sổ chạy bù và chính sách thử lại nằm trong Google Sheets. Nhịp 10 phút chỉ là cơ chế đánh thức n8n; nó không chứa lịch nghiệp vụ. Một giờ cấu hình bất kỳ có thể được thực thi ở nhịp kế tiếp, nên độ trễ tối đa thông thường nhỏ hơn 10 phút.

## Consequences

Dispatcher chạy tối đa 144 nhịp mỗi ngày và phần lớn nhịp không phát tác vụ. Mỗi tác vụ dùng Khóa phát lệnh ổn định, được ghi vết trước và sau khi gọi workflow con; workflow con vẫn phải bảo đảm cùng một khóa không tạo hiệu ứng nghiệp vụ lần thứ hai. Các workflow nghiệp vụ được import trước dispatcher rồi được liên kết lại bằng ID do n8n cấp trên hệ thống đích.

Không dùng Schedule Trigger riêng cho từng lịch nghiệp vụ vì thay đổi lịch sẽ buộc sửa hoặc publish lại workflow. Không dùng chuỗi Wait tự lập lịch vì cấu hình mới khó tác động tới các lượt đang chờ và việc phục hồi phức tạp hơn.

Khi tác vụ mở kiểm kê đến hạn nhưng chi nhánh còn Phiên kiểm kê đang hoạt động, dispatcher không tạo phiên thứ hai. Nó ghi kết quả bỏ qua do phiên đang mở và thông báo người kiểm kê cùng admin để phiên cũ được tiếp tục, chốt hoặc hủy có lý do.

Mỗi nhịp dispatcher ghi heartbeat có thời điểm và kết quả. Nếu ba nhịp liên tiếp không thành công, mặc định tương đương khoảng 30 phút, hệ thống gửi cảnh báo nghiêm trọng tới kênh Error; số nhịp ngưỡng được cấu hình trên Google Sheets. Khi heartbeat khỏe lại, chỉ gửi một thông báo phục hồi.

Chi nhánh `INACTIVE` không nhận tác vụ lịch mới nhưng lịch sử và báo cáo vẫn tra cứu được. Gateway không chấp nhận chuyển chi nhánh sang `INACTIVE` khi còn trạng thái nghiệp vụ mở; các trạng thái đó phải được chốt hoặc hủy có lý do trước.
