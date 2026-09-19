# 01 — Sổ đăng ký nguồn

## Nguyên tắc

Sổ này cho biết tài liệu nào đã được đọc và vai trò của nó. Hash SHA-256 giúp phát hiện file bị thay thế dù tên không đổi. Các file JSON nguồn không được sao chép vào thư mục tài liệu để tránh tạo thêm bản chứa credential hoặc secret.

## Danh sách nguồn

| # | Tên file | Kích thước (byte) | SHA-256 | Vai trò |
|---:|---|---:|---|---|
| 1 | `WF03_FINAL.json` | 90,672 | `125CDAC97104454286BBCBE6869E463992CB07697621F24F77508C3C2A95CFAC` | Đối soát và báo cáo V1 |
| 2 | `WF02___Ki_m_K__Bia___Telegram___Commands.json` | 135,176 | `6CBC0527038F59D5A3678B5C9BDB615A1733581F6BCEC03F04ED61771483280E` | Telegram và nhập số đếm V1 |
| 3 | `WF01___Ki_m_K__Bia___Schedule___REUSE_TOPIC.json` | 41,161 | `B9D4EC989F7D3210B1BA888CD8C09B7405522AF2B96BD33A310904AA99A44669` | Lịch và khởi tạo phiên V1 |
| 4 | `WF04_04_CoCongNo.json` | 10,573 | `1C04E5566431FD79DF3148E9350E8821BE89E1651F3ABDDB70417270B384707F` | Dọn trạng thái WF04, tham khảo |
| 5 | `WF04_03_CoCongNo.json` | 10,219 | `B80BBD245D5B7C9DB122474F2A17EDC0BF5EB682EBE74E82AB7F1AA6D0798D7B` | Cảnh báo không phát sinh mua, tham khảo |
| 6 | `WF04_02_CoCongNo.json` | 51,939 | `F7D2C5A38DF83A4B2B32C629E40B010F7D16CF91DC680EA9DA7A04616284DECC` | Báo cáo quỹ/cảnh báo WF04, tham khảo |
| 7 | `WF04_01_CoCongNo.json` | 918,115 | `ED9E74205E209A636B92814ECB4E98B0C67B8D302C339AC3BC2F8FDD4E645C7B` | Router Telegram, OCR và công nợ WF04, tham khảo |
| 8 | `mã bia và kho lạnh.xls` | 35,328 | `8531A1A7EB673EB6AE447452452166F5008FDAFA7C5B4160BC2F5C52CBA75BA8` | Danh mục/mapping mã hàng cũ |
| 9 | `Báo cáo bán hàng bia nước từ phần mềm.xls` | 28,672 | `40C50C771285D348A9BC9806B3DF90ED85ECE4697F794A55657ABD9660BC8FA5` | Ví dụ file bán hàng nguồn |
| 10 | `Mô tả luồng Brief 3 (1).docx` | 245,902 | `887237C0851D9015D9D2AD9E0FE0194F2320639352B99C4EF02C6125A8F98A2D` | Mô tả WF04, chỉ tham khảo hành vi |
| 11 | `Mô tả luồng Brief 2.docx` | 231,490 | `1A7766A9E081D817CAEBAB290CC5A66EF24CBE8DC4D20E36F51CD26BB99DC527` | Mô tả quy trình kiểm kê V1 |
| 12 | `BRIEF #2 — BẢN CẬP NHẬT (V2)_ LUỒNG KIỂM KÊ BIA.docx` | 222,048 | `1727109DE7022864572D33D6B9B5B6E9CE99DCA373378A210875D0433D8E724F` | Mục tiêu nghiệp vụ V2 |
| 13 | `WF01_WF02_WF03.xlsx` | 54,372 | `94C83C06FDD86927CBF61C05A975C81AE9D731B6EFB9C530BD94274F5933DE07` | Snapshot tải xuống từ Google Sheets của V1 |
| 14 | `WF04.xlsx` | 35,574 | `7F7655212AE8C9792BF7766AA1F66B19215A75C35A325F753F726BFA53289883` | Snapshot tải xuống từ Google Sheets của WF04 |
| 15 | `workflows/WF01_V2_CONFIG_GATEWAY.json` | 47,004 | `5851EF458D875F0B6225043B5D434A46A680ED7649F5A22EFC262A74E93F0322` | Workflow V2 Config Gateway, bất hoạt, issue #2 |
| 16 | `workflows/WF02_V2_ERROR_HANDLER.json` | 12,122 | `63DFB41E13FC06690E8088CC10F5AAA07C28AF9F58D7B77484AE33BD3B58BE7A` | Workflow V2 Error Handler, bất hoạt, issue #2 |
| 17 | `workflows/WF03_V2_TELEGRAM_ROUTER.json` | 11,661 | `0E18FFA71C324DA0653508FE44D0C343DD145BA0AA21A46229DD7A7D105F3E01` | Router `/trangthai`, bất hoạt, issue #2 |
| 18 | `outputs/issue-2/KKB_V2_CONFIG_BASELINE.xlsx` | 15,185 | `AA119FF54B30553C05C97F8A011E40C225705FD8EA55F04D696F78ECE860501B` | Fixture chín tab tải/copy vào live Google Sheet |

## Chỉ mục workflow JSON

| File | Tên workflow | Active | Node | Connection | Trigger/chức năng chính |
|---|---|---:|---:|---:|---|
| WF01 | `WF01 - Kiểm Kê Bia - Schedule + REUSE_TOPIC` | Có | 29 | 38 | Manual, 08:00, execute-subworkflow; tạo/reuse topic và phiên |
| WF02 | `WF02 - Kiểm Kê Bia - Telegram + Commands` | Có | 68 | 94 | Telegram; command, callback, chống trùng, nhập số đếm |
| WF03 | `WF03_FINAL` | Có | 41 | 57 | Manual, execute-subworkflow, 08:30; nhập/bán, đối soát, báo cáo |
| WF04_01 | `WF04_01_CoCongNo` | Có | 269 | 363 | Telegram, OCR ảnh, quỹ/công nợ, sửa/xóa/phân loại |
| WF04_02 | `WF04_02_CoCongNo` | Có | 20 | 19 | 16:00; báo cáo quỹ và cảnh báo |
| WF04_03 | `WF04_03_CoCongNo` | Có | 6 | 5 | 15:00; cảnh báo không có giao dịch mua |
| WF04_04 | `WF04_04_CoCongNo` | Không | 6 | 5 | Mỗi 5 phút; dọn trạng thái quá 10 phút |

## Tham chiếu credential hiện hữu

| Nhóm | Credential name | Credential ID | Ghi chú |
|---|---|---|---|
| WF01–WF03 | `GS_KiemKeBia` | `L6dSINQdEA8UZP1r` | Google Sheets OAuth2 |
| WF02 | `TG_BotKiemKe` | `5OI3kAf3RsOgT33u` | Telegram bot |
| WF04 | `GS_QuyKhoLanh` | `hFhKGMDT66qjhL3e` | Google Sheets OAuth2 |
| WF04 | `TG_BotQuyKhoLanh` | `aYCrWtBwJac78emC` | Telegram bot |

Các tham chiếu trên được ghi để bảo trì và đối chiếu import. Không đổi hoặc xóa credential trong giai đoạn tài liệu hóa. API key/tokens đặt trực tiếp trong node nguồn không được chép sang tài liệu.

## Kết quả đọc tài liệu Word

| File | Paragraph | Table | Ảnh nhúng | Nhận xét |
|---|---:|---:|---:|---|
| Brief 3 | 75 | 8 | 1 | Luồng quỹ/kho lạnh và OCR tham khảo |
| Brief 2 | 84 | 9 | 3 | Luồng V1 từ mở phiên đến báo cáo |
| Brief 2 V2 | 65 | 2 | 0 | Chu trình nhập–bán–đếm–đối soát V2 |

## Mâu thuẫn đã được giải quyết bằng quyết định mới hơn

- V2 độc lập, không mở rộng trực tiếp WF04 dù brief có đề xuất tái sử dụng luồng.
- So sánh giá nhập dùng nhà cung cấp đã chuẩn hóa; `Nhà cung cấp không rõ` không có baseline để cảnh báo giá.
- Báo cáo bán hàng dùng bản nháp/preview và quyền xuất bản, không nhập thẳng không kiểm soát.
- Thiếu dữ liệu nhập hoặc bán trong ngày sẽ được thông báo rồi quy về `0`; không yêu cầu xác nhận.
- Ngày nhập hàng là ngày ảnh được tải lên Telegram, không lấy ngày trên hóa đơn.

## Cách kiểm tra lại nguồn

1. Tính SHA-256 cho đúng file tại nguồn.
2. So sánh với bảng trên.
3. Nếu hash khác, đọc lại cấu trúc và nội dung; không chỉ thay hash.
4. Ghi nhận tác động vào tài liệu hiện trạng, data dictionary, ADR và spec V2.
5. Không đưa file nguồn chứa secret vào Git hoặc thư mục tài liệu.

PowerShell tham khảo:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '<đường-dẫn-file>'
```
