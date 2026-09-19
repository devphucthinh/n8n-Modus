# Publish configurable versioned daily sales snapshots

Mỗi định dạng báo cáo bán được mô tả bằng Cấu hình nguồn bán trên Google Sheets, gồm mẫu tên sheet, dòng tiêu đề và các cột ngày, mã, tên, số lượng, đơn vị. Workflow nhận dạng theo cấu trúc; nếu nhiều cấu hình cùng khớp thì người dùng chọn, không đoán âm thầm và không hard-code tên cột trong n8n.

Một tệp nhiều ngày được tách thành các Bản bán hàng nháp riêng cho từng chi nhánh và ngày kinh doanh. Người có quyền xem danh sách ngày rồi công bố tất cả hoặc từng ngày.

Ngày của Bản bán hàng nháp luôn lấy từ dữ liệu ngày trong tệp theo Cấu hình nguồn bán, không lấy từ thời điểm tải tệp lên Telegram. Vì vậy tệp được gửi muộn vẫn thay thế đúng Ngày kinh doanh mà nó mô tả.

## Consequences

Cùng mã băm tệp là Trùng tệp bán và trả về phiên bản đã có. Tệp khác cho cùng chi nhánh và ngày tạo bản nháp thay thế; sau xác nhận, bản mới thành bản đang hoạt động và bản cũ được giữ ở trạng thái bị thay thế. Nếu nội dung chuẩn hóa không đổi dù tệp khác mã băm, hệ thống ghi nhận không có thay đổi thay vì tạo phiên bản nghiệp vụ mới.

Nếu bản đang hoạt động là `SYSTEM_ZERO`, tệp thật tạo bản nháp thay thế. Khi ngày chưa khóa sổ, `NHAP_BAN` kiểm tra và công bố; khi ngày đã khóa sổ, ADMIN phải mở lại và hệ thống phát hành các phiên bản báo cáo bị ảnh hưởng. Dữ liệu mới không được cộng dồn lên bản zero.

Mỗi Cấu hình nguồn bán bắt buộc chọn Chính sách mặt hàng vắng: `ZERO` chỉ dùng khi nguồn được biết là không liệt kê mặt hàng không phát sinh, còn `BLOCK` yêu cầu đủ danh mục. Workflow giữ các Dòng bán nguồn để kiểm toán, sau đó ánh xạ, quy đổi và cộng theo chi nhánh, Ngày kinh doanh cùng mã mặt hàng; đơn vị hoặc ánh xạ mâu thuẫn sẽ chặn công bố.

Dòng số lượng âm không tự động làm tăng tồn mà chuyển sang chờ Điều chỉnh sổ có tham chiếu dữ liệu gốc. Cấu hình `require_separate_approver` theo chi nhánh mặc định là `NO`; khi đặt `YES`, người tải tệp không được công bố Bản bán hàng nháp do mình tạo.

Khi đã nhận được Chứng từ gốc nhưng không nhận dạng được cấu trúc hoặc đọc dữ liệu thất bại, tệp ở trạng thái `CHO_SUA_FILE` và chặn khóa sổ; nó không được coi là không có dữ liệu để tạo `SYSTEM_ZERO`. Người dùng phải tải lại, chọn đúng Cấu hình nguồn bán hoặc ADMIN hủy có lý do. V2 ban đầu không cho nhập thủ công toàn bộ bảng bán qua Telegram.
