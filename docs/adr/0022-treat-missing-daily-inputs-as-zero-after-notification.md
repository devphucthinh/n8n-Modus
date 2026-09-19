# Treat missing daily inputs as zero after notification

Nếu đến mốc cấu hình mà một chi nhánh không có hóa đơn nhập, V2 thông báo “không phát sinh nhập hàng” và dùng tổng nhập bằng `0` mà không yêu cầu người dùng xác nhận. Nếu không có dữ liệu bán, V2 thông báo bán hàng bằng `0` và tự tạo một Bản bán hàng công bố loại `SYSTEM_ZERO`, cũng không yêu cầu xác nhận.

## Consequences

Mốc kiểm tra theo chi nhánh và nơi nhận thông báo nằm trong `CONFIG_LICH`. Thông báo nhập bằng `0` gửi topic nhập hàng, thông báo bán bằng `0` gửi topic bán hàng, và cả hai được tóm tắt ở topic báo cáo; cùng một loại không gửi lặp trong một Ngày kinh doanh. Bản `SYSTEM_ZERO` có ID, Ngày kinh doanh, thời điểm tạo và nguồn hệ thống như các phiên bản khác để phép đối soát vẫn có một Bản bán hàng công bố rõ ràng.

Lựa chọn này ưu tiên vận hành không bị treo khi không phát sinh. Tệp bán thật đến sau phải thay thế bản `SYSTEM_ZERO`; nếu ngày đã khóa sổ thì cần mở lại và phát hành phiên bản báo cáo mới, thay vì coi sự im lặng ban đầu là trạng thái chưa hoàn tất.

Quy tắc zero chỉ áp dụng khi hoàn toàn không có dữ liệu chờ. Hóa đơn nháp có Ngày ghi nhận nhập tương ứng làm ngày ở `WAITING_DATA` cho đến khi được đọc hoặc hủy. Tệp bán đã nhận nhưng ở `CHO_SUA_FILE` cũng chặn `SYSTEM_ZERO` và khóa sổ cho đến khi được sửa hoặc ADMIN hủy có lý do.
