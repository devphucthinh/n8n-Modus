# Build an independent purchase-ingestion workflow

Kiểm kê bia V2 sẽ có một workflow mới cho ảnh hóa đơn, OCR, xác nhận và chuyển đổi thành Dòng nhập bia. WF04 chỉ là nguồn tham khảo về hành vi và các tình huống lỗi; workflow mới không đọc trạng thái, gọi workflow hay phụ thuộc schema vận hành của WF04, vì nghiệp vụ quỹ/công nợ và nghiệp vụ tồn kho cần có vòng đời thay đổi độc lập.

## Consequences

Một hóa đơn có thể được xử lý tương tự WF04 nhưng dữ liệu nhập tồn được lưu trong các sheet riêng của hệ thống bia. Những cải tiến hoặc lỗi của WF04 không tự động ảnh hưởng Kiểm kê bia V2.
