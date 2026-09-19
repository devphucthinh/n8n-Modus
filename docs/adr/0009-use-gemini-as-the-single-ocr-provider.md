# Use Gemini as the single OCR provider

Workflow nhập hóa đơn V2 sẽ dùng tích hợp Gemini hiện có làm nhà cung cấp OCR duy nhất trong giai đoạn đầu. Luồng thực hiện một lượt nhận diện chính và một lượt cứu hộ có kiểm soát khi kết quả không đạt yêu cầu. Model, thời gian chờ, số lần thử và ngưỡng nghiệp vụ được lấy từ Google Sheets; secret hoặc credential vẫn nằm trong n8n và không bị thay thế.

## Consequences

Không tự chuyển sang một nhà cung cấp AI khác khi Gemini lỗi, vì điều đó làm khó kiểm soát kết quả, chi phí và credential. Sau khi hết số lần thử, hóa đơn chuyển sang trạng thái chờ xử lý thủ công, giữ nguyên ảnh và lỗi để người có quyền tiếp tục.

Khi Chứng từ gốc đã được lưu thành công, người dùng có thể bỏ qua OCR lỗi và nhập toàn bộ thông tin cùng dòng hàng thủ công. Hóa đơn mang nguồn `MANUAL_NO_OCR`, nhưng vẫn áp dụng ánh xạ, quy đổi, cảnh báo giá, phân quyền và vòng duyệt giống hóa đơn OCR.
