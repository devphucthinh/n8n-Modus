# Kiểm kê bia V2

Kiểm kê bia V2 là vòng kiểm soát tồn kho bia và các mặt hàng được theo dõi, khép kín theo ngày từ nhập hàng, bán hàng, đếm tồn thực tế đến đối soát và báo cáo.

## Language

**Kiểm kê bia V2**:
Luồng đích bao gồm nhập hàng từ hóa đơn nhà cung cấp, nhận báo cáo bán hàng, đếm tồn cuối ngày, đối soát hằng ngày và báo cáo tuần.
_Avoid_: Brief 2 mới, workflow bia mới

**Luồng kiểm kê hiện tại**:
Luồng nền đang vận hành việc tạo phiên, nhận số đếm tồn và đối soát; đây là điểm xuất phát để nâng cấp, không phải trạng thái đích.
_Avoid_: V2, luồng hoàn chỉnh

**Nhập hàng**:
Số lượng hàng vào được trích từ hóa đơn nhà cung cấp, ánh xạ sang mặt hàng của quán, quy đổi về đơn vị quán và được con người xác nhận.
_Avoid_: Mua hàng, nhập kho tự động

**Ngày ghi nhận nhập**:
Ngày địa phương được suy ra từ thời điểm Telegram tiếp nhận ảnh đầu tiên của Hóa đơn nháp và dùng để đưa Nhập hàng vào kỳ đối soát; ảnh gửi sau và ngày in trên hóa đơn không thay đổi kỳ này.
_Avoid_: Ngày hóa đơn, ngày duyệt OCR

**Bán hàng ngày**:
Số lượng bán tổng hợp theo mặt hàng trong một ngày kinh doanh, lấy từ báo cáo của phần mềm bán hàng.
_Avoid_: Đơn hàng, giao dịch bán lẻ

**Tồn thực tế**:
Số lượng được nhân viên đếm tại thời điểm chốt ngày; sau khi chốt, số này trở thành tồn đầu của ngày kế tiếp.
_Avoid_: Tồn hệ thống, tồn lý thuyết

**Giá trị đếm tồn**:
Số lượng được nhập rõ ràng cho một mặt hàng trong phiên kiểm kê. Giá trị `0` là một số đếm hợp lệ, ô trống là chưa đếm và giá trị âm là không hợp lệ.
_Avoid_: Ô trống, số lượng suy đoán, số tự làm tròn

**Tồn lý thuyết**:
Số lượng dự kiến bằng tồn thực tế đã chốt của ngày trước cộng nhập hàng đã xác nhận và trừ bán hàng ngày của cùng kỳ đối soát.
_Avoid_: Tồn thực tế, tồn đầu kỳ

**Ngày kinh doanh**:
Ngày được gắn cố định cho phiên kiểm kê khi phiên mở lúc 23:45; dữ liệu bán và nhập được đối chiếu theo ngày này, kể cả khi phiên hoàn tất sau nửa đêm.
_Avoid_: Ngày nhận file, ngày chạy báo cáo

**Phiên kiểm kê**:
Đợt ghi nhận số đếm của đúng một chi nhánh và một Ngày kinh doanh, sử dụng Ảnh chụp cấu hình tại lúc mở. Một chi nhánh chỉ có một phiên đang hoạt động tại một thời điểm.
_Avoid_: Hội thoại Telegram, bản đối soát ngày

**Mặt hàng theo dõi**:
Mặt hàng đang hoạt động trong danh mục kiểm kê và phải có đủ tồn thực tế, nhập hàng, bán hàng cùng quy tắc quy đổi trước khi đối soát.
_Avoid_: Mọi dòng trong báo cáo bán hàng, hàng chưa ánh xạ

**Mặt hàng không theo dõi**:
Mặt hàng đã biết trong danh mục nhưng không tham gia kiểm kê tồn, chẳng hạn khăn lạnh, món khai vị hoặc thuốc lá. Dòng bán của mặt hàng này được bỏ qua có chủ đích, khác với một mã chưa được cấu hình.
_Avoid_: Mã lạ, mặt hàng bị lỗi

**Mã mặt hàng**:
Khóa ổn định của mặt hàng theo dõi. Khi người dùng chọn, hệ thống hiển thị nhãn dễ đọc theo dạng “mã — tên — đơn vị” thay vì chỉ hiển thị mã kỹ thuật.
_Avoid_: Tên hàng, mã nhà cung cấp, nhãn chọn

**Đơn vị kiểm kê**:
Đơn vị chuẩn duy nhất dùng để nhập Tồn thực tế và đối soát một mặt hàng; các đơn vị từ hóa đơn hoặc báo cáo bán phải được quy đổi về đơn vị này.
_Avoid_: Đơn vị OCR, chuỗi nhiều đơn vị, đơn vị nhà cung cấp

**Sổ nhập bia**:
Tập các dòng nhập hàng đã được xác nhận, đã ánh xạ về mã mặt hàng và đã quy đổi sang đơn vị kiểm kê; đây là nguồn nhập duy nhất của phép đối soát.
_Avoid_: Kết quả OCR, hóa đơn chờ xác nhận, LOG_MUA thô

**Sổ bán bia**:
Tập số lượng bán đã được nhập hợp lệ theo mặt hàng và ngày kinh doanh; đây là nguồn bán duy nhất của phép đối soát.
_Avoid_: File Excel thô, MOCK_SALES

**Bản bán hàng công bố**:
Phiên bản đầy đủ, hợp lệ và đang có hiệu lực của dữ liệu bán cho một chi nhánh trong một ngày kinh doanh. Bản sửa mới thay thế bản đang hiệu lực nhưng không xóa lịch sử phiên bản cũ.
_Avoid_: File tải lên, dòng bán bổ sung

**Bản bán hàng hệ thống bằng không**:
Bản bán hàng công bố do hệ thống tạo khi đến mốc cấu hình mà không nhận được dữ liệu bán, với toàn bộ số lượng bằng `0` và nguồn `SYSTEM_ZERO`.
_Avoid_: File bán hàng, dữ liệu người dùng xác nhận

**Bản bán hàng nháp**:
Dữ liệu bán đã được tách cho đúng một chi nhánh và một ngày kinh doanh nhưng chưa được người có quyền công bố. Nhiều bản nháp có thể xuất phát từ một tệp nhiều ngày.
_Avoid_: Bản bán hàng công bố, file Excel thô

**Cấu hình nguồn bán**:
Mô tả có tên của một định dạng báo cáo bán, gồm cách nhận ra sheet, dòng tiêu đề và vai trò của từng cột để người vận hành bổ sung định dạng mà không sửa workflow.
_Avoid_: Ánh xạ mã mặt hàng, file bán hàng

**Chính sách mặt hàng vắng**:
Quy tắc thuộc một Cấu hình nguồn bán xác định mặt hàng theo dõi không xuất hiện trong tệp là bán bằng không hay là dữ liệu thiếu phải chặn công bố.
_Avoid_: Mặc định toàn hệ thống, ô trống trong file

**Dòng bán nguồn**:
Dòng dữ liệu đúng như được đọc từ Chứng từ gốc trước khi ánh xạ, quy đổi và cộng gộp thành Bản bán hàng nháp.
_Avoid_: Sổ bán bia, tổng bán theo mặt hàng

**Dòng nhập bia**:
Một mặt hàng trên hóa đơn đã được nhận diện để xét ánh xạ, quy đổi và xác nhận riêng trước khi đi vào Sổ nhập bia.
_Avoid_: Hóa đơn, LOG_MUA

**Hóa đơn nhập hoàn tất**:
Hóa đơn mà mọi Dòng nhập bia đã được xác nhận, bỏ qua có chủ đích, từ chối hoặc điều chỉnh dứt điểm; chỉ các dòng đã xác nhận mới đi vào Sổ nhập bia.
_Avoid_: Hóa đơn đã OCR, Hóa đơn nháp

**Hóa đơn nhập thủ công**:
Hóa đơn có Chứng từ gốc nhưng các trường và dòng hàng được người dùng nhập thay vì lấy từ OCR; hóa đơn này vẫn phải qua cùng quy trình duyệt như hóa đơn OCR.
_Avoid_: Hóa đơn không có ảnh, Điều chỉnh sổ

**Nhà cung cấp ghi nhận**:
Tên nhà cung cấp được giữ như OCR hoặc người duyệt nhập lại để tham khảo trên hóa đơn; đây không phải một danh mục được quản lý. Khi không xác định được, giá trị chuẩn là “NHÀ CUNG CẤP KHÔNG RÕ”.
_Avoid_: Mã nhà cung cấp, danh mục nhà cung cấp

**Lặp kỹ thuật**:
Cùng một update, callback hoặc Thao tác ghi sổ bị Telegram hay n8n giao lại; đây vẫn là một thao tác duy nhất và không được tạo thêm dữ liệu nghiệp vụ.
_Avoid_: Hóa đơn giống nội dung, người dùng chủ động gửi lại

**Trùng tệp bán**:
Tệp báo cáo bán có cùng định danh nội dung với tệp đã nhận và được tái sử dụng thay vì tạo một phiên bản bán mới.
_Avoid_: Hóa đơn giống nhau, file bán thay thế

**Khóa sổ ngày**:
Việc phát hành kết quả đối soát cuối cùng sau khi số đếm tồn đã đủ, Bản bán hàng đã được công bố và mọi Dòng nhập bia liên quan đã được xử lý dứt điểm.
_Avoid_: Chạy báo cáo, báo cáo tạm

**Chốt kiểm kê**:
Xác nhận có chủ đích của người kiểm kê sau khi đã xem lại toàn bộ số đếm hợp lệ; thao tác này kết thúc việc nhập số đếm nhưng chưa đồng nghĩa với Khóa sổ ngày.
_Avoid_: Tự động chốt, khóa sổ ngày

**Giải trình chênh lệch**:
Lý do có thể kiểm toán được gắn với một mặt hàng có chênh lệch đỏ trước khi kết quả ngày được chốt với cảnh báo.
_Avoid_: Ghi chú chung, bỏ qua cảnh báo

**Bản đối soát ngày**:
Kết quả có phiên bản của một chi nhánh và Ngày kinh doanh, gồm tồn lý thuyết, tồn thực tế, chênh lệch và trạng thái dữ liệu. Bản sửa sau mở lại thay thế bản cũ nhưng không xóa lịch sử.
_Avoid_: Tin nhắn Telegram, báo cáo tạm, tồn đầu ngày kế tiếp

**Tồn đầu kỳ khởi tạo**:
Bộ Tồn thực tế được admin xác nhận làm điểm bắt đầu cho ngày V2 đầu tiên của từng chi nhánh và mặt hàng khi chưa có ngày V2 liền trước đã khóa sổ.
_Avoid_: Tồn mặc định bằng không, tồn lý thuyết suy ra

**Hủy nghiệp vụ**:
Kết thúc một bản nháp hoặc Phiên kiểm kê mà không cho nó tác động vào sổ nghiệp vụ, đồng thời vẫn giữ bản ghi, người thực hiện, thời điểm và lý do.
_Avoid_: Xóa dữ liệu, sửa ô trạng thái

**Giá nhập quy đổi**:
Đơn giá của Dòng nhập bia sau chiết khấu dòng, trước VAT và sau khi đưa về đơn vị kiểm kê để có thể so sánh với lần mua đã xác nhận gần nhất. Nếu chứng từ không tách được cơ sở giá này, trạng thái cơ sở giá phải được nêu rõ và con người xác nhận.
_Avoid_: Tổng hóa đơn, đơn giá OCR thô

**Cảnh báo giá nhập**:
Thông báo rằng Giá nhập quy đổi lệch quá ngưỡng cấu hình so với lần mua đủ điều kiện gần nhất; cảnh báo cần được người duyệt xác nhận đã xem nhưng không chặn nhập hàng.
_Avoid_: Lỗi hóa đơn, từ chối nhập hàng

**Quyền thao tác**:
Một khả năng nghiệp vụ độc lập như đếm tồn, tải hóa đơn, tải báo cáo bán, xác nhận nhập hoặc chạy báo cáo.
_Avoid_: Vai trò, quyền Telegram chung

**Vai trò**:
Nhóm quyền thao tác có tên để gán lại cho nhiều người dùng; một người dùng có thể có nhiều vai trò đang hoạt động.
_Avoid_: Quyền thao tác, chức danh

**Cấu hình nghiệp vụ**:
Giá trị mà người vận hành được phép thay đổi để điều chỉnh cách kiểm kê hoạt động, gồm lịch, thời hạn nhập, ngưỡng, phạm vi mặt hàng, quyền, ánh xạ và nơi nhận thông báo.
_Avoid_: Logic đối soát, trạng thái giao thức, thông tin kết nối

**Thời hạn nhập kiểm kê**:
Khoảng thời gian nhân viên được phép nhập hoặc sửa số đếm trong một phiên; hết thời hạn này không làm mất bản đối soát đang chờ dữ liệu khác.
_Avoid_: Thời hạn khóa sổ, thời gian chờ bán hàng

**Ảnh chụp cấu hình**:
Bộ nội dung cấu hình chuẩn hóa đã được kiểm tra và cố định cho một phiên hoặc giao dịch tại thời điểm nó bắt đầu. Thay đổi cấu hình sau đó chỉ áp dụng cho phiên hoặc giao dịch mới, không diễn giải lại lịch sử đã ghi nhận.
_Avoid_: Bản sao Google Sheet, cấu hình hiện tại

**Bộ ảnh hóa đơn**:
Một hoặc nhiều ảnh được người dùng gửi và xác nhận là cùng thuộc một hóa đơn nhập hàng; toàn bộ bộ ảnh được nhận diện và đối chiếu như một giao dịch duy nhất.
_Avoid_: Album Telegram, từng ảnh hóa đơn độc lập

**Hóa đơn nháp**:
Hóa đơn nhập đang nhận thêm ảnh và chưa được người dùng ra lệnh nhận diện. Hết thời hạn tương tác chỉ làm hóa đơn nháp chuyển sang trạng thái cần tiếp tục hoặc hủy, không tự biến nó thành hóa đơn đã nhận diện.
_Avoid_: Hóa đơn đã OCR, hóa đơn nhập đã xác nhận

**Chứng từ gốc**:
Ảnh hóa đơn hoặc tệp báo cáo bán đúng như hệ thống nhận được, được giữ để kiểm tra lại nguồn của dữ liệu đã công bố.
_Avoid_: Kết quả OCR, dòng sổ nhập, bản bán hàng công bố

**Kết quả OCR gốc**:
Dữ liệu có cấu trúc do dịch vụ nhận diện tạo ra trước khi con người sửa hoặc xác nhận; đây là bằng chứng xử lý, không phải Sổ nhập bia.
_Avoid_: Chứng từ gốc, hóa đơn đã duyệt

**Điều chỉnh sổ**:
Giao dịch có danh tính riêng dùng để sửa tác động của một dữ liệu nghiệp vụ đã ghi nhận mà không xóa hoặc ghi đè lịch sử gốc.
_Avoid_: Sửa ô, xóa dòng, thay dữ liệu cũ

**Thao tác ghi sổ**:
Một thay đổi nghiệp vụ có danh tính chung cho mọi dòng liên quan và chỉ có hiệu lực khi toàn bộ thay đổi đã được cam kết thành công.
_Avoid_: Lần chạy n8n, từng thao tác ghi ô

**Bản lưu trữ tuần**:
Tập dữ liệu vận hành đã hoàn tất của một tuần được chuyển khỏi file hoạt động sau khi kiểm chứng đầy đủ. Bản này bất biến và là nguồn tra cứu lịch sử cho những dòng đã được chuyển.
_Avoid_: Bản nháp, bản sao tạm, backup có thể ghi đè

**Bản sao phục hồi**:
Bản chụp toàn bộ Google Sheet hoạt động tại một thời điểm để khôi phục sau sự cố; bản này có thời hạn lưu giữ và không thay thế Bản lưu trữ tuần.
_Avoid_: Bản lưu trữ tuần, chứng từ gốc

**Chỉ mục lưu trữ**:
Danh mục còn lại trong hệ thống hoạt động dùng để tìm đúng Bản lưu trữ tuần theo kỳ dữ liệu, trạng thái xác minh và định danh tệp.
_Avoid_: Danh sách thư mục thủ công, lịch sử thực thi n8n

**Bộ điều phối lịch nghiệp vụ**:
Luồng kiểm tra lịch hiệu lực trong Google Sheets theo một nhịp kỹ thuật cố định, xác định tác vụ nào đến hạn và chỉ phát lệnh một lần cho mỗi kỳ chạy nghiệp vụ.
_Avoid_: Cron nghiệp vụ, workflow báo cáo

**Khóa phát lệnh**:
Khóa duy nhất đại diện cho một tác vụ lịch của một chi nhánh trong một kỳ nghiệp vụ; khóa này ngăn việc chạy trùng khi bộ điều phối được gọi lại hoặc n8n khởi động lại.
_Avoid_: Execution ID, session ID
