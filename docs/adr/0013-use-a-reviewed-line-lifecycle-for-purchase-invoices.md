# Use a reviewed line lifecycle for purchase invoices

Workflow nhập hóa đơn V2 không xác định hay chặn hóa đơn trùng về nghiệp vụ. Mỗi Hóa đơn nháp được người dùng xác nhận lưu sẽ tạo một hóa đơn mới, kể cả khi ảnh hoặc nội dung giống hóa đơn đã lưu; hệ thống không tự tái sử dụng bản cũ. Chỉ Lặp kỹ thuật của cùng update, callback hoặc `operation_id` bị loại để một thao tác không tự ghi hai lần.

Mỗi Dòng nhập bia phải kết thúc ở một trong các trạng thái đã xác nhận, bỏ qua do không theo dõi, từ chối hoặc đã điều chỉnh. Hóa đơn chỉ hoàn tất khi không còn dòng chờ ánh xạ, chờ sửa hoặc chờ xác nhận; chỉ dòng đã xác nhận được ghi vào Sổ nhập bia.

## Consequences

Giá dùng để cảnh báo là thành tiền sau chiết khấu dòng, trước VAT, chia cho số lượng đã quy đổi. Hệ thống lưu riêng giá OCR thô, VAT, chiết khấu, tổng tiền và cơ sở giá. Khi chỉ có giá gồm VAT hoặc chiết khấu toàn hóa đơn không phân bổ được, người duyệt phải xác nhận; workflow không tự bịa phép phân bổ.

Dòng âm hoặc chứng từ trả hàng không đi thẳng vào Sổ nhập bia như một lần nhập âm. Nó chuyển sang chờ điều chỉnh và chỉ người có quyền duyệt nhập hoặc admin mới được tạo Điều chỉnh sổ tham chiếu giao dịch gốc.

Trước khi duyệt, người có quyền được sửa, thêm hoặc bỏ dòng và sửa nhà cung cấp, ngày, đơn vị, số lượng cùng giá; mọi thay đổi được ghi thành phiên bản đã duyệt bên cạnh Kết quả OCR gốc. Cấu hình `require_separate_approver` theo chi nhánh mặc định là `NO`; khi đặt `YES`, người tạo Hóa đơn nháp không được duyệt chính hóa đơn đó dù có cả hai quyền.

Nhập hàng được phân kỳ theo Ngày ghi nhận nhập lấy từ thời điểm Telegram nhận ảnh đầu tiên của Hóa đơn nháp, không theo ngày in trên hóa đơn và không chuyển về ngày cũ khi tải muộn. Ngày hóa đơn nếu OCR đọc được chỉ được giữ như dữ liệu tham khảo. Tên nhà cung cấp cũng chỉ được ghi nhận như văn bản OCR hoặc người dùng sửa, không có danh mục hay ánh xạ bí danh; nếu không rõ thì lưu “NHÀ CUNG CẤP KHÔNG RÕ”.

Cảnh báo giá chỉ tìm lịch sử có cùng mã mặt hàng, đơn vị và tên Nhà cung cấp ghi nhận sau khi bỏ khoảng trắng thừa và không phân biệt hoa thường. Hóa đơn có nhà cung cấp “NHÀ CUNG CẤP KHÔNG RÕ” không tạo cảnh báo so sánh lịch sử để tránh trộn nhiều nguồn hàng.

Cảnh báo giá nhập không chặn xác nhận dòng, nhưng người duyệt phải bấm xác nhận đã xem. Hệ thống lưu giá tham chiếu, mức chênh, ngưỡng áp dụng, người xác nhận và thời điểm; cảnh báo xuất hiện trong topic nhập hàng cùng báo cáo tuần.

Mỗi Hóa đơn nháp thuộc đúng một chi nhánh được xác định bởi topic tiếp nhận. V2 không hỗ trợ phân bổ một hóa đơn cho nhiều chi nhánh; trường hợp ngoài quy tắc phải được người dùng xử lý thành chứng từ riêng trước khi gửi.
