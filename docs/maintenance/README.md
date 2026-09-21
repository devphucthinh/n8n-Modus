# Bộ tài liệu bảo trì — Kiểm kê bia V1 → V2

## Mục đích

Bộ tài liệu này hợp nhất các workflow n8n, bản xuất Google Sheets, file nghiệp vụ và các quyết định đã duyệt để làm nguồn tham chiếu khi xây dựng, kiểm thử, vận hành và bảo trì Kiểm kê bia V2.

Đây là tài liệu bảo trì, không phải bản sao cấu hình chạy. Các JSON nguồn, credential và dữ liệu test không bị sửa. Những giá trị bí mật vẫn nằm trong nguồn hoặc kho credential hiện hữu; tài liệu chỉ ghi vị trí và tên tham chiếu, không sao chép token/API key.

## Trạng thái

- Phương án kiến trúc đã duyệt: **Phương án A**.
- Nhịp Dispatcher đã duyệt: **10 phút**.
- V2 là hệ thống độc lập; WF04 chỉ là nguồn tham khảo hành vi.
- Hai file `.xlsx` là bản tải xuống từ Google Sheets đang còn hiệu lực. Chúng là ảnh chụp để phân tích, không phải nguồn cấu hình chính thức.
- Dữ liệu lịch sử hiện tại là dữ liệu test và có thể chỉnh sửa trong giai đoạn chuẩn bị.
- Tracer bullet issue #2 đã có ba workflow JSON V2 bất hoạt, workbook core Sheet fixture và bộ test local; chưa import/smoke test trên n8n live.

## Thứ tự ưu tiên khi có mâu thuẫn

1. Các câu trả lời và quyết định người dùng đã duyệt trong phiên phân tích, được ghi lại tại [CONTEXT.md](../../CONTEXT.md) và các [ADR](../adr/).
2. `BRIEF #2 — BẢN CẬP NHẬT (V2)_ LUỒNG KIỂM KÊ BIA.docx` cho mục tiêu nghiệp vụ V2.
3. JSON và bản xuất Google Sheets cho bằng chứng về hệ thống/dữ liệu hiện tại.
4. `Mô tả luồng Brief 2.docx` cho hành vi V1.
5. `Mô tả luồng Brief 3 (1).docx` và WF04 cho mẫu OCR, Telegram, lỗi và lịch chạy; không phải thiết kế đích.
6. Dòng dữ liệu test, mock và lịch sử thử nghiệm không được dùng làm quy tắc nghiệp vụ.

Nếu hai nguồn cùng mức ưu tiên vẫn mâu thuẫn, dừng thay đổi liên quan và tạo một quyết định mới thay vì tự suy đoán.

## Mục lục bảo trì

| Tài liệu | Nội dung |
|---|---|
| [01 — Sổ đăng ký nguồn](./01-source-register.md) | Danh sách file, hash, vai trò và cách kiểm tra thay đổi |
| [02 — Hiện trạng hệ thống](./02-current-state.md) | WF01–WF03 hiện tại, WF04 tham khảo, điểm cứng và khoảng trống |
| [03 — Mô hình dữ liệu hiện tại](./03-current-data-model.md) | Schema các sheet và dữ liệu nguồn cũ |
| [04 — Thiết kế đích V2](./04-v2-target-design.md) | 12 workflow, hợp đồng chung, sheet đích và các diagram |
| [05 — Runbook vận hành](./05-operations-runbook.md) | Cấu hình n8n/Google Sheets, xử lý lỗi, backup, triển khai và rollback |
| [06 — Việc cần làm tiếp theo](./06-next-steps.md) | Lộ trình Ask Matt từ tài liệu này đến spec, ticket và triển khai |
| [07 — Handoff issue #2](./07-issue-2-agent-handoff.md) | Tiến độ, kiểm thử, artifact và việc còn lại cho agent tiếp theo |
| [Đặc tả V2](../specs/kiem-ke-bia-v2.md) | User stories, quyết định triển khai, kiểm thử và tiêu chí nghiệm thu |

## Quy tắc cập nhật bộ tài liệu

- Mỗi thay đổi kiến trúc hoặc quy tắc nghiệp vụ phải cập nhật ADR tương ứng trước hoặc cùng lúc với tài liệu này.
- Khi file nguồn thay đổi, tính lại SHA-256 và cập nhật [sổ đăng ký nguồn](./01-source-register.md).
- Khi schema Google Sheets thay đổi, tăng `schema_version`, cập nhật data dictionary và lập kế hoạch migration; không sửa tiêu đề cột trực tiếp trên hệ đang chạy.
- Khi workflow thay đổi, cập nhật diagram tương ứng và ghi rõ workflow/version chịu ảnh hưởng.
- Sơ đồ `.mmd` hiện đã được kiểm tra và render bằng Mermaid CLI 11.17.0; khi sửa phải render lại file `.png` cùng tên.
- Không đưa token, API key, mật khẩu hoặc nội dung credential vào Markdown, log bảo trì hay ảnh diagram.

## Phạm vi ngoài tài liệu này

- Các worker V2 còn lại ngoài tracer bullet issue #2.
- Kế hoạch cutover đã điền ID thật của môi trường sản xuất.

Các đầu ra trên thuộc giai đoạn đặc tả và triển khai tiếp theo.
