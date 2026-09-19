# Retain original business evidence in Google Drive

Ảnh hóa đơn và tệp báo cáo bán nhận được sẽ được giữ nguyên dưới dạng Chứng từ gốc trong Google Drive, tổ chức theo chi nhánh, năm và tháng. Sổ nghiệp vụ lưu mã tệp Drive, mã băm chống trùng, tên tệp gốc, người gửi và thời gian nhận để có thể truy ngược dữ liệu đã công bố.

## Consequences

Thư mục gốc và các quy tắc không phải bí mật được cấu hình trong Google Sheets; credential Drive vẫn nằm trong n8n. V2 ban đầu không tự xóa Chứng từ gốc. Nếu sau này cần chính sách lưu giữ, đó phải là quyết định riêng có kiểm tra yêu cầu kế toán và khả năng khôi phục.

Kết quả OCR gốc cũng được giữ tách biệt với phiên bản người dùng đã sửa và duyệt. Việc sửa nhà cung cấp, ngày, đơn vị, số lượng, giá hoặc dòng hàng không được ghi đè kết quả nhận diện ban đầu.

Execution history của n8n chỉ phục vụ chẩn đoán kỹ thuật và có thể được dọn theo chính sách vận hành n8n. Nó không phải bằng chứng hay lịch sử nghiệp vụ; việc dọn execution không được làm mất khả năng truy vết trong Google Sheets và Google Drive.

Workflow phải lưu Chứng từ gốc lên Drive trước khi OCR hóa đơn hoặc phân tích file bán. Nếu lưu thất bại, nó giữ định danh file Telegram để retry nhưng không OCR, công bố hoặc ghi sổ cho đến khi Drive xác nhận thành công.

Tệp kế thừa quyền riêng tư của thư mục gốc; workflow không tạo liên kết công khai hoặc chế độ “ai có link cũng xem được”. Quyền xem được quản lý trực tiếp trên Google Drive. Sau khi tiếp nhận, việc người dùng sửa hoặc xóa tin nhắn Telegram không thay đổi Chứng từ gốc hay dữ liệu nghiệp vụ; sửa sai phải đi qua hủy, sửa nháp hoặc Điều chỉnh sổ.
