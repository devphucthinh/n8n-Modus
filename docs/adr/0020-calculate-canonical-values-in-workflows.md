# Calculate canonical values in workflows

Các phép tính tồn, quy đổi, chênh lệch, cảnh báo và báo cáo chuẩn được thực hiện trong workflow, rồi lưu cả giá trị cùng `calculation_version`. Công thức Google Sheets chỉ phục vụ trình bày hoặc kiểm tra và không phải nguồn chính để khóa sổ, vì công thức có thể bị sửa, chưa tính lại hoặc sao chép sai.

## Consequences

Độ chính xác, bước nhập và số chữ số thập phân được cấu hình theo mặt hàng. Hệ số quy đổi được biểu diễn bằng tử số và mẫu số khi có thể; workflow giữ giá trị chuẩn trước làm tròn và chỉ làm tròn tại điểm công bố. Tiền VND mặc định lưu dưới dạng số nguyên để tránh sai số nhị phân và làm tròn lặp.
