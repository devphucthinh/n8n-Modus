# Đặc tả — Kiểm kê bia V2

**Spec ID:** `KKB-V2`

**Trạng thái:** Bản tổng hợp từ các quyết định đã duyệt; chờ rà soát nghiệp vụ cuối trước khi tách ticket triển khai.

**Kiến trúc đã chọn:** Phương án A, 12 workflow độc lập, Dispatcher thức dậy mỗi 10 phút.

**Test seam được xác nhận:** kiểm thử từ hai entry point thực là Telegram Router và Dispatcher; quan sát kết quả bên ngoài qua phản hồi Telegram, Google Sheets và Google Drive. Chỉ kiểm thử worker trực tiếp khi cần kiểm tra contract, idempotency hoặc phục hồi lỗi.

## Problem Statement

Luồng kiểm kê hiện tại đang vận hành được việc mở phiên, nhận số đếm và đối soát, nhưng cấu hình nghiệp vụ còn phân tán trong Code node của WF01–WF03. Nhập hàng và báo cáo bán chưa trở thành các sổ chuẩn độc lập; dữ liệu mock, dữ liệu test và dữ liệu hoạt động dễ bị lẫn. WF04 có nhiều mẫu hành vi hữu ích cho OCR, callback và xử lý lỗi, nhưng nó thuộc nghiệp vụ quỹ/công nợ và không thể là nền tảng dữ liệu của kiểm kê bia.

Người vận hành cần một vòng kiểm soát khép kín theo ngày:

- nhận hóa đơn nhập từ nhiều ảnh Telegram, lưu bằng chứng, OCR và cho con người duyệt;
- nhận báo cáo bán hàng từ nhiều định dạng có thể cấu hình;
- mở một phiên kiểm kê riêng cho từng chi nhánh, nhận số đếm theo topic riêng và chốt có kiểm soát xung đột;
- đối soát từ các sổ chuẩn, khóa sổ có phiên bản và phát hành báo cáo;
- xử lý thiếu nhập/bán bằng thông báo và số `0` theo chính sách đã duyệt;
- lưu audit, backup phục hồi hằng ngày và archive log mỗi tuần;
- cho phép chạy song song, rollback và bàn giao mà không phá V1 hay dữ liệu test.

Nếu không tách các trách nhiệm này, thay đổi lịch/TTL/ngưỡng/mapping sẽ buộc sửa workflow, lỗi retry có thể ghi trùng, sửa sau khóa sổ sẽ làm mất lịch sử, và dữ liệu hoạt động có thể không phục hồi được.

## Solution

Xây Kiểm kê bia V2 độc lập với WF04, dùng Google Sheets live làm nguồn cấu hình nghiệp vụ và kho sổ vận hành, Google Drive làm nơi lưu chứng từ gốc/archive/backup, Gemini làm nhà cung cấp OCR duy nhất giai đoạn đầu.

V2 gồm 12 workflow có một trách nhiệm chính:

1. `WF01_V2_CONFIG_GATEWAY` — đọc, chuẩn hóa, kiểm tra và cache cấu hình.
2. `WF02_V2_ERROR_HANDLER` — chuẩn hóa lỗi, retry, thông báo và resolution.
3. `WF03_V2_TELEGRAM_ROUTER` — Telegram ingress duy nhất, phân quyền, chống lặp và định tuyến.
4. `WF04_V2_DISPATCHER` — tick kỹ thuật 10 phút, đọc lịch trong Sheet và phát lệnh có khóa.
5. `WF05_V2_MO_PHIEN_KIEM_KE` — mở/reuse topic và phiên kiểm kê.
6. `WF06_V2_NHAN_SO_DEM` — nhận, sửa, xem lại và chốt số đếm.
7. `WF07_V2_DOI_SOAT_KHOA_SO` — tính canonical values, khóa sổ và phát hành bản đối soát.
8. `WF08_V2_HOA_DON_NHAP` — gom ảnh, lưu Drive, OCR, review và ghi Sổ nhập bia.
9. `WF09_V2_BAO_CAO_BAN` — nhận file, parse, preview, version và publish Sổ bán bia.
10. `WF10_V2_BAO_CAO` — lệnh và job báo cáo ngày/tuần.
11. `WF11_V2_LUU_TRU_TUAN` — archive log hoàn tất mỗi tuần vào file/folder theo tháng.
12. `WF12_V2_BACKUP_PHUC_HOI` — backup phục hồi hằng ngày và kiểm tra restore.

Các workflow dùng chung contract input/output/error, immutable IDs, `config_snapshot_id`, `operation_id`, idempotency key và staged commit. Cấu hình thay đổi được đặt trong Google Sheets; n8n chỉ giữ credential references và thông tin bootstrap kỹ thuật tối thiểu. Không có business config mới được hard-code trong workflow.

## User Stories

### Cấu hình, quản trị và phân quyền

1. As an **ADMIN**, I want to quản lý schema/version của các sheet, so that workflow từ chối cấu trúc thiếu hoặc không tương thích trước khi ghi.
2. As an **ADMIN**, I want to cấu hình nghiệp vụ trong Google Sheets, so that đổi lịch, TTL, ngưỡng, topic, mapping và quyền không cần sửa/import n8n.
3. As an **ADMIN**, I want to bật cờ bảo trì cấu hình, so that Gateway không đọc trạng thái trung gian khi tôi sửa nhiều sheet liên quan.
4. As an **ADMIN**, I want to xem `config_version`, người thay đổi, thời điểm và fingerprint, so that mọi phiên/giao dịch có thể tái hiện quy tắc đã dùng.
5. As an **ADMIN**, I want to bật/tắt một chi nhánh bằng mã ổn định, so that chi nhánh inactive không nhận job mới nhưng lịch sử vẫn tra cứu được.
6. As an **ADMIN**, I want to tạo role bằng mã ASCII và nhãn tiếng Việt, so that người dùng chọn được bằng dropdown nhưng workflow không phụ thuộc nhãn hiển thị.
7. As an **ADMIN**, I want to gán nhiều role cho một user theo chi nhánh hoặc phạm vi `*`, so that quyền phản ánh đúng trách nhiệm thực tế.
8. As an **ADMIN**, I want to cấu hình permission độc lập với role, so that thay đổi quyền không cần đổi workflow.
9. As an **ADMIN**, I want to vô hiệu hóa user ngay trong config, so that lệnh/callback mới của user đó bị chặn mà dữ liệu đã nhập vẫn được giữ.
10. As an **ADMIN**, I want to bảo vệ sheet ledger và mở quyền chỉnh config có kiểm soát, so that dữ liệu nghiệp vụ không bị sửa ô trực tiếp trong production.
11. As an **ADMIN**, I want to cấu hình group/topic nhận lỗi, mức severity và template thông báo, so that lỗi kỹ thuật không lộ cho người dùng nghiệp vụ.
12. As an **ADMIN**, I want to cấu hình folder Drive evidence/archive/backup, so that môi trường test và production có thể tách biệt.
13. As an **ADMIN**, I want to cấu hình giới hạn ảnh, TTL, timeout, retry và grace window, so that chính sách vận hành có thể thay đổi theo thực tế.
14. As an **ADMIN**, I want to cấu hình hệ số quy đổi bằng tử số/mẫu số và ngày hiệu lực, so that hệ thống không suy đoán đơn vị từ tên hàng.
15. As an **ADMIN**, I want to cấu hình danh mục bia, mapping OCR và alias mã hàng, so that mã người dùng chọn có nhãn “mã — tên — đơn vị”.
16. As an **ADMIN**, I want to cấu hình từng định dạng nguồn bán và chính sách mặt hàng vắng, so that thêm nguồn bán không cần sửa workflow.
17. As an **ADMIN**, I want to cấu hình command catalog, cú pháp, permission, ví dụ và mô tả, so that `/help` luôn đầy đủ và cập nhật theo Sheet.
18. As an **ADMIN**, I want to điều khiển mode `SHADOW`, `V2_PRIMARY` và rollback bằng công tắc có audit, so that cutover là thao tác có chủ đích.

### Telegram Router và điều phối

19. As a **user**, I want one bot tiếp nhận mọi update, so that tôi không phải biết workflow nào đang xử lý.
20. As a **user**, I want mỗi chức năng có topic riêng, so that số đếm tồn không lẫn với nhập hóa đơn, bán hàng hay báo cáo.
21. As a **user**, I want `/kiemke`, `/nhaphang`, `/nhapban`, `/baocaobia`, `/trangthai` và `/help`, so that tôi có điểm vào ổn định cho các thao tác chính.
22. As a **user**, I want `/help` hiển thị đầy đủ lệnh, cú pháp, tham số, ví dụ và mô tả kết quả, so that tôi có thể tự sử dụng hệ thống.
23. As a **user**, I want bot phản hồi lỗi bằng ngôn ngữ dễ hiểu kèm `error_id`, so that tôi biết cần sửa gì hoặc thử lại thế nào.
24. As an **unauthorized user**, I want thao tác bị từ chối mà không lộ role, branch hay config, so that hệ thống không tiết lộ thông tin truy cập.
25. As an **active user**, I want `/trangthai` xem được trạng thái vận hành của mọi chi nhánh, so that tôi biết dispatcher, phiên, dữ liệu chờ, backup và lỗi đang ở đâu.
26. As a **system**, I want chỉ Telegram Router sở hữu Telegram Trigger của bot, so that update không bị xử lý trùng ở nhiều workflow.
27. As a **system**, I want `update_id`, callback và operation được chống lặp, so that Telegram/n8n retry không tạo thêm dữ liệu nghiệp vụ.
28. As an **ADMIN**, I want `/retry <error_id>` chỉ chạy lỗi retryable với khóa cũ, so that retry không nhân đôi ledger.
29. As an **ADMIN**, I want Dispatcher thức dậy mỗi 10 phút và đọc lịch từ Sheet, so that đổi lịch nghiệp vụ không cần publish workflow.
30. As a **system**, I want mỗi job có `dispatch_key` duy nhất theo chi nhánh/kỳ, so that một job chỉ phát lệnh một lần dù Dispatcher bị gọi lại.
31. As an **ADMIN**, I want heartbeat và số lần thất bại liên tiếp được ghi log, so that ba nhịp lỗi liên tiếp có thể phát cảnh báo nghiêm trọng.
32. As a **system**, I want job trong grace window được chạy bù và job ngoài cửa sổ được cảnh báo, so that hệ thống không chạy nhầm ngày.
33. As an **ADMIN**, I want khi chi nhánh đã có phiên mở thì job mở phiên mới bị bỏ qua có thông báo, so that không tạo hai phiên hoạt động.

### Nhập hóa đơn và Sổ nhập bia

34. As a **NHAP_HANG**, I want gửi nhiều ảnh cho cùng một hóa đơn, so that hóa đơn nhiều trang được xử lý như một Bộ ảnh hóa đơn.
35. As a **NHAP_HANG**, I want giới hạn ảnh được cấu hình trong khoảng 5–10, so that album quá lớn không làm OCR và review mất kiểm soát.
36. As a **NHAP_HANG**, I want từ ảnh thứ sáu được cảnh báo nhưng vẫn nhận đến giới hạn, so that tôi có thể hoàn tất hóa đơn nhiều trang.
37. As a **NHAP_HANG**, I want xem thứ tự ảnh, bỏ ảnh cuối hoặc hủy bản nháp, so that tôi sửa album trước khi OCR.
38. As a **system**, I want chỉ người tạo thêm/bỏ ảnh trước OCR, so that album không bị thay đổi ngoài ý muốn.
39. As a **system**, I want ảnh gốc được lưu Drive trước OCR, so that chứng từ không mất khi OCR lỗi.
40. As a **NHAP_HANG**, I want hết TTL chỉ chuyển hóa đơn sang trạng thái cần tiếp tục/hủy, so that hệ thống không tự OCR hoặc tự ghi sổ.
41. As a **NHAP_HANG**, I want bấm `Đọc hóa đơn` để bắt đầu OCR, so that chi phí OCR phát sinh theo chủ ý.
42. As a **system**, I want Gemini chạy OCR chính rồi rescue có kiểm soát, so that nhận diện có cơ hội phục hồi nhưng không đổi nhà cung cấp AI ngầm.
43. As a **NHAP_HANG**, I want OCR thất bại vẫn cho nhập thủ công khi ảnh đã lưu, so that hóa đơn không bị kẹt vì dịch vụ nhận diện.
44. As a **DUYET_NHAP**, I want sửa/thêm/bỏ từng Dòng nhập bia và giữ Kết quả OCR gốc, so that quyết định con người có audit.
45. As a **DUYET_NHAP**, I want chọn mapping mã bia từ dropdown nhãn dễ đọc, so that mã OCR chưa chuẩn vẫn được ánh xạ chính xác.
46. As a **DUYET_NHAP**, I want hệ thống quy đổi mọi đơn vị về Đơn vị kiểm kê, so that đối soát dùng một đơn vị chuẩn.
47. As a **DUYET_NHAP**, I want hóa đơn có Nhà cung cấp ghi nhận không rõ được lưu là `NHÀ CUNG CẤP KHÔNG RÕ`, so that thiếu tên không làm mất bản ghi.
48. As a **DUYET_NHAP**, I want ngày ghi nhận nhập lấy từ thời điểm Telegram nhận ảnh đầu tiên, so that ngày in trên hóa đơn hoặc ngày duyệt không đổi kỳ.
49. As a **DUYET_NHAP**, I want hóa đơn chỉ thuộc topic/chi nhánh tiếp nhận, so that hệ thống không phải phân bổ một hóa đơn cho nhiều chi nhánh.
50. As a **DUYET_NHAP**, I want cảnh báo giá theo cùng mã, đơn vị và nhà cung cấp đã chuẩn hóa, so that so sánh không trộn các nguồn hàng.
51. As a **DUYET_NHAP**, I want cảnh báo giá không chặn xác nhận nhưng bắt buộc xác nhận đã xem, so that vận hành không bị dừng nhưng vẫn có audit.
52. As a **system**, I want hóa đơn nghi trùng vẫn tạo ID mới khi người dùng xác nhận, so that hệ thống không tự quyết định loại bỏ chứng từ.
53. As a **system**, I want chỉ Lặp kỹ thuật bị loại bằng idempotency, so that gửi lại update không thành hóa đơn mới ngoài ý muốn.
54. As a **DUYET_NHAP**, I want mọi dòng kết thúc ở xác nhận, bỏ qua, từ chối hoặc điều chỉnh, so that hóa đơn không hoàn tất khi còn dòng chờ.
55. As a **system**, I want chỉ dòng đã xác nhận đi vào Sổ nhập bia, so that OCR thô và dòng nháp không ảnh hưởng tồn.
56. As an **ADMIN**, I want khi chứng từ có số âm/trả hàng hệ thống yêu cầu Điều chỉnh sổ, so that không tự ghi một lần nhập âm không kiểm soát.

### Bán hàng và Sổ bán bia

57. As a **NHAP_BAN**, I want tải file bán vào topic bán hàng, so that chứng từ gốc được lưu và truy vết.
58. As a **system**, I want nhận dạng nguồn bán theo cấu hình Sheet, so that header/sheet name không bị hard-code trong n8n.
59. As a **NHAP_BAN**, I want khi nhiều cấu hình cùng khớp được chọn nguồn, so that hệ thống không đoán âm thầm.
60. As a **NHAP_BAN**, I want file nhiều ngày được tách thành bản nháp theo chi nhánh/ngày, so that tôi có thể publish từng ngày hoặc tất cả.
61. As a **system**, I want ngày bán lấy từ dữ liệu ngày trong file, so that file tải muộn vẫn vào đúng Ngày kinh doanh.
62. As a **NHAP_BAN**, I want xem preview mapping, quy đổi, tổng và cảnh báo trước publish, so that sai file không vào Sổ bán bia.
63. As a **NHAP_BAN**, I want publish version mới thay thế bản ACTIVE nhưng giữ lịch sử, so that báo cáo có thể tái hiện.
64. As a **system**, I want cùng hash file trả về Trùng tệp bán đã có, so that upload lại không tạo version dư.
65. As a **system**, I want file khác nhưng nội dung chuẩn hóa không đổi được ghi nhận không thay đổi, so that lịch sử phản ánh nghiệp vụ chứ không chỉ tên file.
66. As a **NHAP_BAN**, I want chính sách mặt hàng vắng là `ZERO` hoặc `BLOCK` theo nguồn, so that mỗi định dạng có quy tắc rõ.
67. As a **system**, I want file lỗi hoặc `CHO_SUA_FILE` chặn `SYSTEM_ZERO`, so that dữ liệu hỏng không bị hiểu là bán bằng không.
68. As a **system**, I want khi không có dữ liệu bán thật đến mốc cấu hình thì thông báo và tạo bản `SYSTEM_ZERO`, so that đối soát không bị treo.
69. As a **system**, I want file thật đến sau thay thế `SYSTEM_ZERO` thay vì cộng dồn, so that số bán không bị đếm hai lần.
70. As a **ADMIN**, I want ngày đã khóa sổ khi nhận bản bán mới phải mở lại có audit, so that báo cáo bị ảnh hưởng được phát hành phiên bản mới.
71. As a **system**, I want số lượng âm bị đưa vào Điều chỉnh sổ, so that bán âm không tự làm tăng tồn.
72. As a **NHAP_BAN**, I want publish riêng khi có `require_separate_approver=YES`, so that người tải file không tự duyệt chính mình.

### Kiểm kê, đối soát và báo cáo

73. As a **KIEM_KE**, I want phiên kiểm kê mở theo đúng một chi nhánh và Ngày kinh doanh, so that số đếm không lẫn kỳ.
74. As a **KIEM_KE**, I want phiên giữ Ảnh chụp cấu hình lúc mở, so that đổi config giữa phiên không diễn giải lại số đã nhập.
75. As a **KIEM_KE**, I want mỗi mặt hàng hiển thị mã — tên — đơn vị, so that chọn hàng không cần nhớ mã kỹ thuật.
76. As a **KIEM_KE**, I want giá trị `0` hợp lệ, ô trống là chưa đếm và số âm bị từ chối, so that dữ liệu đếm có ý nghĩa rõ ràng.
77. As a **KIEM_KE**, I want quy tắc thập phân/bước/cận theo mặt hàng, so that hệ thống không tự làm tròn số tôi nhập.
78. As a **system**, I want optimistic revision check cho từng mặt hàng, so that hai người sửa cùng lúc không ghi đè âm thầm.
79. As a **KIEM_KE**, I want xem bảng tổng hợp rồi bấm Chốt kiểm kê, so that điền đủ dòng không tự chốt.
80. As an **ADMIN**, I want mở lại phiên hết hạn hoặc sau khóa sổ có lý do, so that sửa sai vẫn có audit và version.
81. As a **system**, I want một chi nhánh chỉ có một phiên active, so that Dispatcher không tạo phiên song song.
82. As a **KIEM_KE**, I want chênh lệch đỏ yêu cầu Giải trình chênh lệch từng mặt hàng, so that kết quả vẫn có thể chốt nhưng nguyên nhân được kiểm toán.
83. As a **system**, I want `Tồn lý thuyết = tồn thực tế đã khóa trước + nhập đã xác nhận - bán đã publish`, so that mọi báo cáo dùng cùng một công thức canonical.
84. As an **ADMIN**, I want Tồn đầu kỳ khởi tạo phải xác nhận trước ngày V2 đầu tiên, so that hệ thống không tự dùng `0` hay dữ liệu test.
85. As a **system**, I want thiếu nhập đến mốc cấu hình được thông báo rồi dùng tổng nhập `0`, so that ngày không phát sinh không bị treo.
86. As a **system**, I want thiếu bán đến mốc cấu hình được thông báo rồi tạo `SYSTEM_ZERO`, so that ngày không phát sinh bán vẫn đối soát được.
87. As a **system**, I want hóa đơn nháp và file `CHO_SUA_FILE` chặn zero tự động, so that dữ liệu đang chờ xử lý không bị kết luận là không phát sinh.
88. As a **system**, I want khóa sổ chỉ xảy ra khi số đếm đủ, bản bán ACTIVE và dòng nhập liên quan đã kết thúc, so that báo cáo cuối ngày không dùng dữ liệu dang dở.
89. As a **user**, I want báo cáo hiển thị đầy đủ mọi dòng, so that phân quyền quyết định hành động chứ không che dữ liệu báo cáo.
90. As a **BAO_CAO**, I want báo cáo ngày có version, trạng thái, người chốt, tổng bình thường/vàng/đỏ và chi tiết cảnh báo, so that kết quả có thể giải thích.
91. As a **BAO_CAO**, I want báo cáo tuần nêu ngày dùng SYSTEM_ZERO, nhập/bán/chênh lệch và cảnh báo giá, so that chất lượng dữ liệu vận hành được nhìn thấy.
92. As an **ADMIN**, I want sửa sau khóa sổ tạo bản đối soát và adjustment mới, so that lịch sử cũ không bị ghi đè.
93. As a **system**, I want thay đổi input sau chốt tự đánh thức đối soát có khóa phát lệnh, so that báo cáo mới được phát hành khi đủ điều kiện mà không cần lệnh chạy tay.

### Lỗi, backup, archive và bàn giao

94. As a **system**, I want mọi lỗi có `error_code`, `retryable`, `operation_id`, workflow/node và thông điệp an toàn, so that vận hành có thể điều tra mà không lộ secret.
95. As an **ADMIN**, I want lỗi retryable có thể retry và lỗi dữ liệu bị chặn đến khi sửa nguồn/config, so that retry không che lỗi gốc.
96. As a **system**, I want lỗi lặp cùng fingerprint chỉ gửi một cảnh báo và một thông báo phục hồi, so that group lỗi không bị spam.
97. As a **ADMIN**, I want backup phục hồi hằng ngày chỉ chạy khi không còn operation `PREPARED`, so that ảnh chụp không chứa giao dịch dở dang.
98. As a **system**, I want backup mới được mở lại, kiểm schema, count và checksum trước khi xóa bản quá hạn, so that luôn có bản gần nhất hợp lệ.
99. As a **ADMIN**, I want mỗi tuần tạo một file archive mới trong folder tháng `YYYY-MM`, so that log đã hoàn tất được tách khỏi file hoạt động.
100. As a **system**, I want archive có MANIFEST và `ARCHIVE_INDEX` với trạng thái `PREPARING`, `VERIFIED`, `PURGED`, so that xóa nguồn chỉ xảy ra sau xác minh.
101. As a **system**, I want rotate `EVENT_LOG`, `BIA_LOG`, `ERROR_BIA`, lịch sử Dispatcher và state đã hoàn tất/hết hạn/hủy, so that log gốc không phình vô hạn.
102. As a **system**, I want giữ nguyên config, mapping, ledger chính, hóa đơn đã xác nhận, báo cáo và state đang mở, so that archive không làm mất dữ liệu cần vận hành.
103. As a **system**, I want archive tuần rỗng vẫn có `EMPTY_VERIFIED`, so that phân biệt tuần không có log với job bị bỏ lỡ.
104. As an **ADMIN**, I want restore vào Google Sheet mới rồi chạy workflow read-only trước khi đổi nguồn, so that phục hồi không ghi đè file đang chạy.
105. As a **system**, I want bản gốc ảnh hóa đơn và file bán không tự xóa, so that bằng chứng nghiệp vụ vẫn truy nguyên được.
106. As a **maintainer**, I want export JSON V2 có thứ tự import, credential checklist và sheet checklist, so that bàn giao có thể lặp lại.
107. As a **maintainer**, I want mọi sơ đồ có cả nguồn Mermaid và ảnh render, so that tài liệu bảo trì đọc được trong GitHub/Codex.
108. As an **ADMIN**, I want chạy shadow với sheet/topic riêng rồi rollback bằng công tắc, so that cutover không ảnh hưởng V1.
109. As a **system owner**, I want chỉ bật V2 sau tối thiểu bảy Ngày kinh doanh đối chiếu đạt, gồm archive tuần và restore test, so that quyết định cutover dựa trên bằng chứng.

## Implementation Decisions

### Kiến trúc và ranh giới

- V2 là hệ thống độc lập; WF04 chỉ cung cấp mẫu hành vi, không được gọi, đọc state hoặc dùng schema của WF04.
- Phương án A dùng một Telegram ingress duy nhất, một Config Gateway, một Error Handler và một Dispatcher polling theo tick 10 phút.
- Các worker không tự đăng ký Telegram Trigger; Router gửi standard input envelope.
- Import workflow theo dependency: Config Gateway và Error Handler trước; sau đó các worker `WF05`–`WF12`; Router `WF03` và Dispatcher `WF04` import/liên kết sau cùng. Chỉ active entry points sau smoke test.
- V1 và V2 chạy song song trên sheet/state riêng. Một chi nhánh tại một thời điểm chỉ có một hệ thống được quyền ghi ledger chính thức.

### Cấu hình và schema

- Google Sheets live là nguồn cấu hình; `.xlsx` đã gửi chỉ là snapshot tải xuống từ Google Sheets.
- `CONFIG_SCHEMA` mô tả sheet bắt buộc, cột, kiểu dữ liệu, key duy nhất và version. Workflow đọc theo tên cột, không theo vị trí.
- `CONFIG_VERSION`/`CONFIG_SNAPSHOT` ghi version, fingerprint và toàn bộ nội dung chuẩn hóa. Phiên/giao dịch lưu `config_snapshot_id` bất biến.
- Tên mã máy dùng ASCII, không dấu, không khoảng trắng; nhãn tiếng Việt nằm riêng cho người dùng.
- Danh sách config gồm tối thiểu: `CONFIG_GLOBAL`, `CONFIG_BRANCH`, `CONFIG_TOPIC`, `CONFIG_LICH`, `CONFIG_USER`, `CONFIG_ROLE`, `CONFIG_PERMISSION`, `CONFIG_USER_ROLE`, `CONFIG_ROLE_PERMISSION`, `CONFIG_BIA`, `CONFIG_QUY_DOI`, `CONFIG_MAPPING_NHAP`, `CONFIG_NGUON_BAN`, `CONFIG_NGUON_BAN_COT`, `CONFIG_LENH`, `CONFIG_THONG_BAO`, `CONFIG_DRIVE`, `CONFIG_BACKUP`, `CONFIG_CUTOVER`.
- Nhóm ledger/state gồm tối thiểu: `OPERATION`, `DISPATCH_HISTORY`, `STATE_CHO`, `HOA_DON_NHAP`, `ANH_HOA_DON`, `DONG_NHAP`, `OCR_RAW`, `LOG_NHAP`, `DOT_NHAP_BAN`, `DONG_BAN_NGUON`, `LOG_BAN`, `PHIEN_KIEM_KE`, `BIA_LOG`, `BAO_CAO_NGAY`, `BAO_CAO_TUAN`, `DIEU_CHINH_SO`, `EVENT_LOG`, `ERROR_BIA`, `ARCHIVE_INDEX`, `BACKUP_INDEX`.
- Record IDs do V2 tạo là immutable; row number, Telegram message ID và n8n execution ID chỉ là metadata.
- Thời điểm kỹ thuật lưu ISO 8601 UTC; Ngày kinh doanh và timezone chi nhánh lưu riêng. Mặc định vận hành là `Asia/Ho_Chi_Minh`, định dạng `vi-VN`, tiền `VND`; không tự quy đổi ngoại tệ.

### Roles và permissions

- Sáu role baseline: `KIEM_KE`, `NHAP_HANG`, `DUYET_NHAP`, `NHAP_BAN`, `BAO_CAO`, `ADMIN`.
- Khả năng chi tiết nằm trong `CONFIG_ROLE_PERMISSION`; `CONFIG_USER_ROLE` gán theo `branch_id`, `*` là toàn hệ thống.
- Baseline: `KIEM_KE` nhập/giải trình/chốt; `NHAP_HANG` tạo/sửa nháp; `DUYET_NHAP` duyệt dòng/điều chỉnh nhập; `NHAP_BAN` tải/kiểm tra/publish; `BAO_CAO` xem trạng thái/báo cáo; `ADMIN` config, phân quyền, mở lại, hủy, retry và cutover.
- `/trangthai` chỉ đọc được mở cho mọi user đang active theo ADR; các thao tác khác yêu cầu permission tương ứng.

### Contract, idempotency và staged commit

Mọi workflow nhận envelope chứa `request_id`, `operation_id`, `event_type`, `branch_id`, `actor_user_id`, `business_date`, `config_version` và `payload`. Kết quả chứa `ok`, IDs, `status`, `data`, `warnings`; lỗi chứa `error_code`, `error_class`, `retryable`, `message_safe`, workflow/node và context không có secret.

Ghi nhiều sheet theo giao thức:

```text
PREPARED → COMMITTED
         ↘ FAILED → RETRYING → COMMITTED | MANUAL_REVIEW
```

Workflow đọc ledger bỏ qua bản ghi chưa `COMMITTED`. Retry dùng cùng `operation_id` và idempotency key; không tạo operation mới cho cùng thao tác kỹ thuật.

### Nhập hàng

- Ảnh đầu tiên mở Hóa đơn nháp; ảnh tiếp theo cùng người/chi nhánh được gom theo thứ tự. `max_images_per_invoice` mặc định 10, chỉ nhận 5–10.
- Lưu Chứng từ gốc Drive trước OCR; giữ file ID, tên gốc, người gửi, thời điểm nhận và checksum. Không tạo liên kết công khai.
- Gemini là provider OCR duy nhất; model, timeout, số lần thử và ngưỡng đọc nằm trong Sheet; credential/secret nằm trong n8n.
- OCR raw giữ tách biệt với phiên bản người dùng sửa. Manual no-OCR vẫn qua mapping, quy đổi, cảnh báo giá và duyệt.
- Ngày ghi nhận nhập lấy từ Telegram nhận ảnh đầu tiên; ngày in trên hóa đơn chỉ là tham khảo.
- Một hóa đơn thuộc một chi nhánh theo topic. Nhà cung cấp chỉ ghi nhận văn bản; không có supplier master. Giá trị không rõ là `NHÀ CUNG CẤP KHÔNG RÕ`.
- Không tự chặn hóa đơn nghi trùng; xác nhận của người dùng tạo hóa đơn mới. Chỉ lặp kỹ thuật bị dedupe.
- Dòng nhập phải kết thúc ở confirmed/ignored/rejected/adjusted; chỉ confirmed vào `LOG_NHAP`.
- Giá nhập quy đổi sau chiết khấu dòng, trước VAT, theo đơn vị kiểm kê. Cảnh báo giá không chặn nhưng cần acknowledged; supplier không rõ không có baseline so sánh.

### Bán hàng

- Cấu hình nguồn bán chứa mẫu sheet, header, cột ngày/mã/tên/số lượng/đơn vị và chính sách mặt hàng vắng `ZERO`/`BLOCK`.
- File gốc lưu Drive trước parse. Tệp nhiều ngày tách thành bản nháp theo chi nhánh/ngày trong file.
- Người có quyền xem preview và publish tất cả hoặc từng ngày. Publish tạo version ACTIVE, supersede bản cũ, không xóa lịch sử.
- Hash tệp trùng trả về version hiện có; file khác nhưng normalized content không đổi không tạo thay đổi nghiệp vụ.
- Tệp lỗi/`CHO_SUA_FILE` chặn `SYSTEM_ZERO`. Không có dữ liệu chờ đến mốc mới tạo `SYSTEM_ZERO` và gửi thông báo, không cần xác nhận.
- Tệp thật đến sau thay thế SYSTEM_ZERO. Tệp có số âm chuyển sang adjustment/manual review.
- Ngày bán lấy từ dữ liệu ngày trong file, không lấy ngày upload Telegram.

### Kiểm kê, đối soát và correction

- Một chi nhánh chỉ có một Phiên kiểm kê active; phiên có `config_snapshot_id`.
- `0` là giá trị đếm hợp lệ; blank là chưa đếm; âm bị từ chối; không tự làm tròn.
- Chốt kiểm kê là hành động rõ ràng sau review; không tự chốt vì đã đủ dòng.
- Revision check giữ cả giá trị hiện tại và giá trị vừa gửi khi xung đột.
- Ngày kinh doanh được gắn khi phiên mở theo `CONFIG_LICH` (baseline mốc mở cuối ngày 23:45); nếu hoàn tất sau nửa đêm vẫn giữ ngày đã gắn.
- Canonical formula: tồn lý thuyết = tồn thực tế ngày đã khóa trước + nhập confirmed − bán ACTIVE/published. Ngày V2 đầu tiên cần Tồn đầu kỳ khởi tạo admin xác nhận.
- Đến mốc mà không có nhập/bán thật thì thông báo và dùng `0`; nháp nhập hoặc file bán lỗi đang chờ không được coi là vắng dữ liệu.
- Chênh lệch đỏ cần giải trình; đủ giải trình vẫn có thể khóa sổ với cảnh báo.
- Sửa sau khóa sổ tạo adjustment/version mới, đánh dấu bản cũ superseded, không sửa ô/ghi đè.
- Mọi giá trị canonical, quy đổi, cảnh báo và báo cáo được tính trong workflow với `calculation_version`; công thức Sheet chỉ dùng trình bày/kiểm tra.

### Archive, backup và cutover

- Archive tuần tạo một Google Spreadsheet mới cho cả các chi nhánh, có tab cùng tên nguồn và `MANIFEST`, đặt vào folder `YYYY-MM` và tên theo tuần.
- Phạm vi rotate tối thiểu: `EVENT_LOG`, `BIA_LOG`, `ERROR_BIA`, dispatcher history và `STATE_CHO` đã completed/expired/cancelled. `ARCHIVE_INDEX` không rotate.
- Trạng thái archive: `PREPARING` → `VERIFIED` → `PURGED`; verify tập key, cột, khoảng thời gian, count và hash trước khi xóa đúng ID trong manifest.
- Tuần rỗng tạo `EMPTY_VERIFIED`; log đến muộn vào kỳ nhận thực tế kế tiếp.
- Backup phục hồi hằng ngày là bản chụp toàn bộ file hoạt động, mặc định giữ 14 bản gần nhất. Backup mới phải restore/check trước khi xóa bản cũ; backup lỗi không chặn nghiệp vụ.
- Restore tạo file mới, chạy read-only, kiểm schema/count trước khi admin phê duyệt đổi source ID. File cũ được giữ để quay lại.
- Evidence gốc không tự xóa trong V2 ban đầu.
- Shadow tối thiểu bảy Ngày kinh doanh liên tiếp, gồm thử album nhiều ảnh, mapping mới, file bán nhiều ngày, replacement, red variance, correction sau close, archive và restore. Đạt tiêu chí không tự bật V2; chủ hệ thống phải xác nhận cutover.

## Testing Decisions

### Nguyên tắc

- Test hành vi bên ngoài và contract, không test tên node, vị trí node, expression nội bộ hoặc cách Google Sheets được gọi.
- Test từ seam cao nhất có thể: Telegram Router và Dispatcher. Worker test trực tiếp chỉ dùng khi kiểm tra contract hoặc failure/recovery mà seam cao hơn không tạo được deterministic fixture.
- Mọi test ghi vào Google Sheets/Drive dùng test spreadsheet, test bot/topic và test folder riêng; không ghi vào Google Sheet live production.
- Gemini dùng fixture OCR đã lưu để test lặp lại; smoke test thật kiểm tra credential/format nhưng không làm expected result phụ thuộc model ngẫu nhiên.
- Test mọi thay đổi bằng dữ liệu fixture versioned, không dùng dòng test/history hiện tại làm sự thật nghiệp vụ.

### Test contract và Config Gateway

- Schema thiếu sheet/cột, sai type, duplicate key, tham chiếu branch/role/mapping không tồn tại đều bị từ chối trước ghi.
- Version đổi nhưng fingerprint không đổi, hoặc nội dung đổi mà version không tăng, đều bị Gateway chặn.
- Config snapshot giữ nguyên khi phiên/giao dịch đang chạy dù Sheet đã đổi.
- Config maintenance chặn start mới nhưng không diễn giải lại phiên đã có snapshot.
- Dropdown/label command/role hiển thị đúng nhãn tiếng Việt và dùng mã ASCII trong ledger.

### Test Telegram Router

- Phân tuyến đúng theo chat/thread, command, callback, trạng thái và quyền.
- User inactive/unknown bị từ chối không lộ thông tin.
- `/help` chứa đủ command, syntax, mô tả, permission và ví dụ từ `CONFIG_LENH`.
- `/trangthai` đọc được toàn bộ trạng thái mà không lộ token/secret.
- Cùng `update_id`, callback và retry tạo đúng một hiệu ứng nghiệp vụ.
- Lỗi thao tác phản hồi trong topic; lỗi kỹ thuật đã làm sạch vào `ERROR_BIA` và group lỗi theo config; lỗi lặp chỉ thông báo một lần và có recovery notice.

### Test Dispatcher

- Nhịp kỹ thuật 10 phút không chứa lịch nghiệp vụ; lịch được đọc từ `CONFIG_LICH`.
- Job đến hạn được claim bằng `dispatch_key`, job đã claim/completed bị skip.
- Job trong grace window chạy bù; ngoài window tạo cảnh báo.
- Ba heartbeat thất bại liên tiếp phát critical alert theo threshold config và chỉ gửi recovery một lần.
- Chi nhánh inactive không nhận job mới; chi nhánh có phiên active không tạo phiên thứ hai.
- Worker failure ghi failed/failure_count và chuyển error envelope; retry cùng key không tạo duplicate.

### Test nhập hàng

- Album 1–10 ảnh, cảnh báo từ ảnh thứ sáu và chặn ảnh thứ mười một theo config.
- Duplicate Telegram media/update không nhân đôi ảnh; thứ tự ảnh được giữ.
- Drive thất bại không OCR/ghi sổ; retry sau khi Drive thành công dùng cùng file ID/checksum policy.
- OCR chính/rescue, manual fallback, raw OCR và phiên bản đã sửa tách biệt.
- Mapping, quy đổi, supplier unknown, ngày upload đầu tiên và một-chi-nhánh được kiểm tra.
- Dòng chưa kết thúc chặn hoàn tất; chỉ confirmed đi vào Sổ nhập.
- Cảnh báo giá cùng supplier chuẩn hóa; supplier unknown không tạo baseline; acknowledge được audit.
- Hóa đơn nghi trùng được lưu như ID mới khi người dùng xác nhận; lặp kỹ thuật không tạo mới.
- `require_separate_approver=YES` chặn người tạo tự duyệt.

### Test bán hàng

- Nhận dạng một/nhiều/không nguồn; nhiều nguồn yêu cầu người dùng chọn.
- Header alias, dòng nhóm, mã lạ, unit/mapping lỗi và policy `ZERO`/`BLOCK` cho kết quả đúng.
- File nhiều ngày tách đúng, preview đúng tổng và publish từng ngày/all.
- Trùng hash reuse; normalized content không đổi không tạo version; file mới thay thế ACTIVE/SYSTEM_ZERO đúng lifecycle.
- File lỗi/CHO_SUA_FILE chặn SYSTEM_ZERO và khóa sổ; thiếu file hoàn toàn tạo SYSTEM_ZERO sau notify.
- Số âm đi adjustment; separate approver và correction sau close được kiểm tra.

### Test kiểm kê và đối soát

- `0`, blank, âm, thập phân, bước nhập và giới hạn theo mặt hàng.
- Hai người sửa cùng revision tạo conflict an toàn, không ghi đè.
- Chốt kiểm kê rõ ràng; TTL vô hiệu hóa nút cũ nhưng không xóa dữ liệu.
- One-active-session per branch, snapshot config và ngày 23:45 được giữ khi qua nửa đêm.
- Formula canonical, initial opening balance bắt buộc, missing input zero sau notify, draft/block conditions.
- Red variance bắt buộc explanation; đủ explanation cho phép close với cảnh báo.
- Input đổi sau close tạo bản đối soát/adjustment mới và báo cáo tuần mới.

### Test archive, backup và recovery

- Archive chỉ chạy khi tuần đủ điều kiện; tuần rỗng tạo EMPTY_VERIFIED.
- Verify count/key/column/date/hash thất bại thì không purge.
- Purge chỉ xóa IDs trong manifest, giữ header, current period, open/pending/late data.
- Backup hoãn khi có PREPARED; backup fail giữ bản cũ và không chặn nghiệp vụ.
- Restore vào file mới tái tạo schema/count/checksum; read-only smoke pass trước đổi source.
- Test bảo mật bảo đảm không có credential/token/API key trong error, `/trangthai`, export JSON hoặc tài liệu.

### Test seam và tiêu chí nghiệm thu

Một scenario end-to-end bắt đầu bằng Telegram update hoặc Dispatcher tick, sau đó chỉ quan sát:

- phản hồi Telegram/topic;
- dòng/phiên bản/trạng thái trong Google Sheets;
- chứng từ, archive, backup và manifest trong Drive;
- error/retry/recovery audit.

Mỗi acceptance criterion phải có fixture, expected external behavior, operation/request ID và evidence link. V2 chỉ được coi là sẵn sàng shadow khi toàn bộ contract/negative/idempotency/recovery suite đạt; chỉ được cutover sau bảy ngày đối chiếu đạt và chủ hệ thống xác nhận.

## Out of Scope

- Sửa, refactor hoặc import đè WF04; WF04 chỉ là tài liệu tham khảo hành vi.
- Di chuyển lịch sử test hiện tại vào ledger V2 như dữ liệu production.
- Quản lý danh mục nhà cung cấp, mã nhà cung cấp hoặc tự động chuẩn hóa supplier ngoài giá trị `NHÀ CUNG CẤP KHÔNG RÕ` và tên ghi nhận.
- Phân bổ một hóa đơn cho nhiều chi nhánh.
- Tự động loại bỏ hóa đơn nghi trùng về nghiệp vụ.
- Tự động suy đoán hệ số quy đổi, đơn vị hoặc mapping chưa cấu hình.
- Tự động chuyển sang OCR provider khác ngoài Gemini trong giai đoạn đầu.
- Nhập thủ công toàn bộ bảng bán qua Telegram như một đường thay thế cho file bán.
- Quy đổi ngoại tệ tự động.
- Xóa Chứng từ gốc khỏi Drive theo retention tự động trong phiên bản đầu.
- Xuất PDF/Excel báo cáo mặc định; báo cáo là dữ liệu versioned trong Sheet và thông báo Telegram có phân trang.
- Sửa trực tiếp ledger bằng Google Sheets, xóa dòng để sửa sai hoặc ghi đè bản đã công bố.
- Khôi phục bằng cách để Telegram ghi đè file hoạt động.
- Tự động bật V2 khi shadow đạt; cutover vẫn cần chủ hệ thống xác nhận.
- Đăng issue ra tracker bên ngoài khi repo chưa có tracker/remote được cấu hình.

## Further Notes

- Thứ tự nguồn khi có mâu thuẫn: quyết định người dùng và ADR/CONTEXT; brief V2; JSON/Google Sheets snapshot; brief V1; WF04/Brief 3; cuối cùng là dữ liệu test/mock.
- Google Sheets live vẫn là nguồn có hiệu lực; hai `.xlsx` đã cung cấp chỉ dùng để hình dung schema và fixture.
- Credential hiện hữu được giữ nguyên; spec chỉ yêu cầu gắn credential đúng môi trường và không đưa secret vào Sheet, error, docs hoặc export.
- Default vận hành cần được điền rõ trong config trước khi chạy: `Asia/Ho_Chi_Minh`, max ảnh 10, backup giữ 14 bản, cảnh báo dung lượng 70%/85%, critical sau ba heartbeat thất bại, cùng mọi TTL/ngưỡng còn lại.
- Mọi thay đổi sau spec phải cập nhật ADR, data dictionary, diagram, acceptance criteria và rollback plan trước khi tạo ticket.
- Bước tiếp theo sau khi spec được rà soát là tách tickets theo dependency: schema/config → Gateway/Error → Router → Dispatcher → nhập hàng → bán hàng → kiểm kê/đối soát → archive/backup → migration/cutover.
- Repo hiện chưa có remote hoặc issue tracker/triage labels được cấu hình, nên bản này được lưu local; cần chạy setup tracker trước khi publish `ready-for-agent`.

Tài liệu liên quan: [bộ tài liệu bảo trì](../maintenance/README.md), [glossary](../../CONTEXT.md), và [ADRs](../adr/).
