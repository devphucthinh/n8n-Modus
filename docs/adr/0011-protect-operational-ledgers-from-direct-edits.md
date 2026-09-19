# Protect operational ledgers from direct edits

Các sheet cấu hình được admin chỉnh theo quyền đã cấp. Các sổ nghiệp vụ, dữ liệu kiểm kê và lịch sử xử lý được bảo vệ khỏi chỉnh sửa trực tiếp trong vận hành chính thức. Sửa dữ liệu đã ghi nhận phải đi qua workflow có quyền, tạo Điều chỉnh sổ hoặc phiên bản thay thế và giữ được người thực hiện, lý do cùng thời điểm.

## Consequences

Trong giai đoạn thử nghiệm có thể tạm mở quyền để chuẩn bị dữ liệu, nhưng checklist chuyển production phải bật bảo vệ. Không dùng thao tác sửa ô hoặc xóa dòng làm quy trình sửa sai chính thức, vì chúng vượt qua phân quyền và làm mất khả năng kiểm toán.

Hóa đơn nháp, Bản bán hàng nháp và Phiên kiểm kê không bị xóa khi người dùng muốn bỏ thao tác. Người có quyền thực hiện Hủy nghiệp vụ với lý do bắt buộc; bản ghi hủy không tác động vào sổ nhưng vẫn được giữ để kiểm toán.

Sổ nhập, sổ bán, Bản đối soát ngày đã công bố, Điều chỉnh sổ và lịch sử chỉ nhận dòng hoặc phiên bản mới; không cập nhật đè nội dung đã có hiệu lực. Chỉ trạng thái đang xử lý như `STATE_CHO` được cập nhật theo ID cùng số phiên bản. Bảng tổng hợp dẫn xuất có thể được tái tạo; cấu hình được admin sửa nhưng chỉ có hiệu lực sau khi Config Gateway kiểm tra hợp lệ.
