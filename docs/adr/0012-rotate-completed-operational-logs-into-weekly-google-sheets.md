# Rotate completed operational logs into weekly Google Sheets

Kiểm kê bia V2 sẽ luân chuyển dữ liệu vận hành đã hoàn tất mỗi tuần sang một Bản lưu trữ tuần dạng Google Sheets. Phạm vi gồm `EVENT_LOG`, `BIA_LOG`, `ERROR_BIA`, lịch sử dispatcher và các dòng `STATE_CHO` đã hoàn tất, hết hạn hoặc hủy. Cấu hình, ánh xạ, người dùng, vai trò, sổ nhập, sổ bán, hóa đơn đã xác nhận, báo cáo, tồn đầu kỳ, trạng thái đang mở và Chỉ mục lưu trữ vẫn ở file hoạt động.

Mỗi tuần dùng một file chung cho các chi nhánh, với các tab cùng tên nguồn và một tab `MANIFEST`. File nằm trong thư mục `YYYY-MM` theo tháng của ngày kết thúc tuần và mang tên hiển thị kỳ từ thứ Hai đến Chủ nhật. Bản lưu trữ đã xác minh là bất biến và không bị tự động xóa.

## Consequences

Workflow lưu trữ chỉ chạy sau khi mọi ngày cần thiết đã khóa sổ, báo cáo tuần thành công và không còn phiên hoặc thao tác mở lại liên quan. Nếu chưa đủ điều kiện, nó chuyển sang chờ và không xóa dữ liệu.

Quy trình dùng các trạng thái `PREPARING`, `VERIFIED` và `PURGED`. Trước khi xóa nguồn, workflow phải đọc lại file đích và đối chiếu số dòng, tập khóa chính, cột bắt buộc, khoảng thời gian cùng mã băm nội dung. Sau đó nó đọc lại nguồn và chỉ xóa các ID có trong manifest, giữ nguyên tiêu đề, dữ liệu tuần hiện tại, dòng đang mở hoặc chờ và dữ liệu đến muộn. Mọi lỗi trước khi xác minh đều giữ nguyên nguồn.

`ARCHIVE_INDEX` không được luân chuyển. Nó giữ kỳ dữ liệu, file ID, URL, trạng thái, số dòng, mã băm, thời điểm xác minh và thời điểm xóa nguồn. Khi mở lại lịch sử, workflow đọc bản lưu trữ qua chỉ mục nhưng ghi thay đổi thành Điều chỉnh sổ ở file hoạt động; không sửa file lưu trữ.

Workflow vẫn tạo một Bản lưu trữ tuần có `MANIFEST` và trạng thái `EMPTY_VERIFIED` khi tuần không có dòng đủ điều kiện, để phân biệt tuần rỗng với lần chạy bị bỏ lỡ. Log kỹ thuật đến sau khi một tuần đã được lưu trữ nằm trong kỳ nhận thực tế kế tiếp; dữ liệu nghiệp vụ quá khứ chỉ thay đổi qua Điều chỉnh sổ. Không mở lại file đã `VERIFIED` để bổ sung.

Workflow tái sử dụng credential hiện có nếu credential đó có đủ quyền Sheets và Drive. Nếu không, hệ thống thêm một credential Drive chuyên biệt mà không xóa hoặc thay thế credential đang dùng. ID thư mục gốc là cấu hình Google Sheets, không hard-code trong workflow.

Bản lưu trữ tuần không thay thế backup phục hồi của file đang hoạt động. V2 tạo một Bản sao phục hồi toàn bộ file mỗi ngày trong thư mục riêng, mặc định giữ 14 bản gần nhất; lịch chạy, thư mục và số bản giữ lại đều là cấu hình Google Sheets. Việc xóa bản quá hạn chỉ được thực hiện sau khi bản mới đã tạo và kiểm tra thành công.

Khôi phục không được thực hiện bằng cách để Telegram ghi đè file đang hoạt động. Admin sao chép Bản sao phục hồi thành một Google Sheet mới, kiểm tra schema và số liệu, chạy thử các workflow ở chế độ không ghi, rồi chỉ đổi ID file nguồn trong cấu hình n8n sau khi chủ hệ thống phê duyệt; file cũ vẫn được giữ để quay lại.

V2 theo dõi dung lượng và số dòng của file hoạt động, cảnh báo ở hai ngưỡng cấu hình mặc định 70% và 85%. Sổ nhập, sổ bán và dữ liệu nghiệp vụ chính không bị tự động chuyển chỉ vì chạm ngưỡng; ở mức cao, admin phải lập kế hoạch tách file theo năm với migration, backup và kiểm tra đầy đủ.

Backup ngày chỉ bắt đầu khi không còn Thao tác ghi sổ ở trạng thái `PREPARED`. Nếu đang có thao tác, workflow hoãn sang nhịp dispatcher tiếp theo và chạy bù trong cửa sổ cấu hình; quá cửa sổ thì cảnh báo thay vì khóa người dùng lâu để ép backup đúng phút.

Một lần backup thất bại không chặn nhập hàng, bán hàng hay kiểm kê và không xóa bản cũ. Workflow retry theo cấu hình; nếu số lần lỗi liên tiếp hoặc tuổi của backup hợp lệ gần nhất vượt ngưỡng cấu hình, hệ thống phát cảnh báo nghiêm trọng nhưng không tự dừng nghiệp vụ.
