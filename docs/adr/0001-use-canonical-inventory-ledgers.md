# Use canonical inventory ledgers between input workflows and reconciliation

Kiểm kê bia V2 giữ WF01–WF03 làm lõi phiên, nhập số đếm và đối soát, còn OCR hóa đơn, nhập báo cáo bán và báo cáo tuần là các workflow riêng. Mọi nguồn đầu vào phải chuẩn hóa thành Sổ nhập bia hoặc Sổ bán bia trước khi WF03 đọc, để logic đối soát không phụ thuộc trực tiếp vào cấu trúc Excel, API, dữ liệu mô phỏng hay kết quả OCR thô.

## Consequences

Các nguồn nhập mới có thể thay đổi độc lập, nhưng chỉ dữ liệu đã qua ánh xạ, quy đổi và xác nhận mới được phép ảnh hưởng tồn lý thuyết. `MOCK_SALES` và `MOCK_PURCHASE` chỉ còn là adapter phục vụ kiểm thử, không phải nguồn dữ liệu song song của WF03.

Ngày V2 đầu tiên của mỗi chi nhánh phải có Tồn đầu kỳ khởi tạo do admin xác nhận theo mặt hàng và ngày hiệu lực. Khi chưa có ngày V2 liền trước đã khóa sổ, workflow không được âm thầm dùng `0` hoặc suy ra tồn đầu từ dữ liệu thử nghiệm.
