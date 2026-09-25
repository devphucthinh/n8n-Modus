# 06 — Việc cần làm tiếp theo theo Ask Matt

## Kết luận

Đây là dự án nhiều phiên, có thay đổi kiến trúc, dữ liệu, vận hành và cutover. Theo luồng Ask Matt, giai đoạn grill đã hoàn thành qua 137 câu hỏi và Phương án A đã được duyệt. Bước tiếp theo không phải viết ngay 12 JSON n8n, mà là chuyển các quyết định và bộ tài liệu bảo trì này thành một **spec có thể kiểm thử**.

Luồng đề xuất:

```text
Grill + tài liệu nguồn
        ↓
Spec có tiêu chí nghiệm thu
        ↓
Tickets theo dependency và blocker
        ↓
Implement từng ticket bằng test-first + review
        ↓
Shadow test → cutover có xác nhận → bàn giao
```

## Bước 1 — Rà soát và đóng baseline tài liệu

Đầu vào:

- [Sổ đăng ký nguồn](./01-source-register.md).
- [Hiện trạng](./02-current-state.md).
- [Mô hình dữ liệu](./03-current-data-model.md).
- [Thiết kế V2](./04-v2-target-design.md).
- [Runbook](./05-operations-runbook.md).
- [Glossary](../../CONTEXT.md) và [ADR](../adr/).

Gate hoàn tất:

- Không còn mâu thuẫn chưa được ghi rõ thứ tự ưu tiên.
- Danh mục 12 workflow được chấp nhận.
- Blueprint sheet và ranh giới config/credential được chấp nhận.
- Các thuật ngữ `invoice`, `purchase line`, `sales snapshot`, `count session`, `operation`, `archive`, `backup` có một nghĩa duy nhất.

## Bước 2 — Tạo spec V2

Spec phải chuyển quyết định thành yêu cầu kiểm thử được, tối thiểu gồm:

1. Mục tiêu, ngoài phạm vi và giả định.
2. Actor, role, permission và ma trận chi nhánh.
3. Command catalog Telegram, cú pháp, topic và state transition.
4. Schema/data dictionary đầy đủ: type, required, unique, enum, retention, protection.
5. Hợp đồng input/output/error của 12 workflow.
6. Quy tắc OCR nhiều ảnh và lưu bằng chứng Drive.
7. Quy tắc parse/version/publish báo cáo bán.
8. Quy tắc mở phiên, chốt đếm, missing=`0`, khóa sổ và adjustment.
9. Dispatcher, TTL, retry, idempotency và staged commit.
10. Archive tuần, backup hằng ngày và restore verification.
11. Migration, shadow, cutover và rollback.
12. Acceptance criteria và test matrix cho từng luồng.

Các điểm chưa nên để mơ hồ trong spec:

- Giới hạn ảnh mặc định cụ thể trong khoảng 5–10.
- Danh sách role/quyền ban đầu và ai được gán role.
- Data dictionary/ID format chính thức.
- Công thức checksum và tiêu chí archive/restore đạt.
- Số ngày shadow và ngưỡng chênh lệch cho phép.
- Retention cụ thể cho OCR raw, state, error, archive và backup.

## Bước 3 — Tách tickets

Tickets phải đi theo dependency, không đi theo thứ tự tiện viết JSON. Các epic đề xuất:

| Epic | Nội dung | Phụ thuộc chính |
|---|---|---|
| E1 | Schema Google Sheets V2, validator và dữ liệu config mẫu | Spec/data dictionary |
| E2 | Config Gateway + Error Handler + contracts | E1 |
| E3 | Telegram Router + role/permission + `/help` | E1, E2 |
| E4 | Dispatcher + dispatch history + TTL cleanup | E1, E2 |
| E5 | Hóa đơn nhập nhiều ảnh + Drive + Gemini + review | E2, E3 |
| E6 | Báo cáo bán versioned + preview/publish | E2, E3 |
| E7 | Phiên kiểm kê + nhận/chốt số đếm | E2, E3, E4 |
| E8 | Đối soát, khóa sổ, adjustment và báo cáo | E5, E6, E7 |
| E9 | Archive tuần + backup/restore | E1, E2, E4 |
| E10 | Migration, shadow, cutover, handover pack | E1–E9 |

Mỗi ticket cần có: phạm vi, file/workflow/sheet bị tác động, dependency, test cases, expected evidence, rollback và điều kiện hoàn thành.

## Bước 4 — Triển khai và review

- Xây schema và contract trước các workflow nghiệp vụ.
- Với mỗi ticket: viết fixture/test hoặc checklist executable trước, tạo JSON, chạy test, review theo spec, rồi mới merge vào baseline V2.
- Không chỉnh V1 để “giống” V2 trong quá trình này.
- Không dùng dữ liệu test hiện tại làm expected result nếu chưa được chuẩn hóa thành fixture.
- Sau mỗi epic, export JSON sạch và kiểm tra không lộ secret/hard-code nghiệp vụ.

## Bước 5 — Nghiệm thu vận hành

1. Import theo thứ tự và hoàn tất checklist cấu hình.
2. Chạy smoke/integration/negative/idempotency/recovery tests.
3. Chạy shadow tối thiểu theo thời gian được khóa trong spec; baseline hiện đề xuất 7 ngày nghiệp vụ.
4. Chạy trọn một archive tuần và một restore test.
5. Chỉ cutover sau xác nhận rõ ràng của chủ hệ thống.
6. Bàn giao JSON, sheet template/data dictionary, checklist, diagrams, test evidence và runbook.

## Hành động ngay kế tiếp

Đặc tả đã được tạo tại [docs/specs/kiem-ke-bia-v2.md](../specs/kiem-ke-bia-v2.md). Các quyết định sau giai đoạn grill, Phương án A, dispatcher 10 phút, config trên Google Sheets, backup/retention và ranh giới V2/WF04 đã được ghi trong `CONTEXT.md`, các ADR, thiết kế đích và spec; agent mới không cần dựa vào lịch sử chat.

Issue #2 đã được publish thành tracer bullet trên GitHub và có [handoff riêng](./07-issue-2-agent-handoff.md). PR hiện tại là [devphucthinh/n8n-Modus#20](https://github.com/devphucthinh/n8n-Modus/pull/20). Các epic E1–E10 còn lại vẫn phải được tách ticket theo dependency trước khi implement tiếp; không coi issue #2 là đã hoàn tất toàn bộ V2.

Issue #3 đang được triển khai riêng trên nhánh `codex/issue-3-telegram-router`. Handoff/import checklist nằm ở [08-issue-3-router-handoff.md](./08-issue-3-router-handoff.md). Chỉ sau khi PR này được review và smoke test live đạt mới chuyển sang issue #4 Dispatcher.
