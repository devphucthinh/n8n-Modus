# Version reconciliation corrections after daily close

Khi dữ liệu nhập, bán hoặc kiểm kê cần sửa sau Khóa sổ ngày, admin phải mở lại đúng ngày và tạo dữ liệu hoặc điều chỉnh có phiên bản. Hệ thống phát hành Bản đối soát ngày mới, đánh dấu bản cũ đã bị thay thế và gửi thông báo sửa báo cáo; không sửa ô hay ghi đè lịch sử đã công bố.

## Consequences

Tồn đầu của ngày kế tiếp vẫn là Tồn thực tế đã chốt của ngày trước, không bị tính lại theo chênh lệch lý thuyết. Báo cáo tuần chịu ảnh hưởng phải được tạo lại thành phiên bản mới có liên kết tới bản bị thay thế.

Thông báo ngày trong topic báo cáo nêu trạng thái dữ liệu, phiên bản, người chốt, tổng số mặt hàng bình thường/vàng/đỏ và chỉ bung chi tiết cho mặt hàng vàng hoặc đỏ, kèm liên kết Google Sheet. Báo cáo tuần nêu tình trạng khóa sổ, tổng hợp nhập-bán-chênh lệch, cảnh báo giá và các chênh lệch nổi bật, kèm liên kết Google Sheet. Không tạo PDF hoặc Excel đính kèm mặc định; nội dung dài được phân trang.

Sau khi Chốt kiểm kê, workflow đối soát được đánh thức lại bởi mỗi thay đổi dữ liệu liên quan và tự phát hành Bản đối soát ngày ngay khi đủ mọi điều kiện khóa sổ. Người dùng không phải bấm thêm lệnh chạy báo cáo; Khóa phát lệnh và phiên bản báo cáo ngăn việc phát hành trùng.

Báo cáo tuần phải nêu số ngày dùng Bản bán hàng hệ thống bằng không, theo chi nhánh và loại dữ liệu nhập hoặc bán được hệ thống coi là `0`. Đây là thông tin vận hành, không tự bị phân loại là lỗi, nhưng phải phân biệt được với ngày có chứng từ hoặc tệp thật.
