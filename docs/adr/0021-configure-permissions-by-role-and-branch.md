# Configure permissions by role and branch

V2 khởi tạo sáu vai trò: `KIEM_KE`, `NHAP_HANG`, `DUYET_NHAP`, `NHAP_BAN`, `BAO_CAO` và `ADMIN`. Khả năng cụ thể của từng vai trò nằm trong `CONFIG_ROLE_PERMISSION`, không hard-code theo tên; `CONFIG_USER_ROLE` gán vai trò theo `branch_id`, còn `*` biểu thị phạm vi toàn hệ thống.

## Consequences

Ma trận mặc định cho phép `KIEM_KE` nhập, giải trình và chốt số đếm; `NHAP_HANG` tạo và sửa hóa đơn nháp; `DUYET_NHAP` duyệt dòng và điều chỉnh nhập; `NHAP_BAN` tải, kiểm tra và công bố dữ liệu bán; `BAO_CAO` xem trạng thái và báo cáo; `ADMIN` cấu hình, phân quyền, mở lại, hủy, retry và điều khiển chuyển đổi V2. Admin cũng có thể bị giới hạn theo chi nhánh, ngoại trừ gán `*`.

Khi người dùng bị vô hiệu hóa, mọi lệnh và callback mới của họ bị chặn ngay. Dữ liệu đã nhập không bị xóa và phiên thuộc chi nhánh, nên người khác có quyền phù hợp có thể tiếp tục. `/trangthai` là ngoại lệ chỉ đọc được mở cho mọi người dùng đang hoạt động như ADR về Telegram Router quy định.
