# Issue #2 — bằng chứng triển khai Config Gateway → `/trangthai`

Phạm vi này là tracer bullet chạy local, chưa tuyên bố đã smoke test trên n8n/live Google Sheet. Nguồn cấu hình nghiệp vụ vẫn là Google Sheet live; workbook chỉ là fixture an toàn.

## Lệnh tái hiện

```powershell
npm test
npm run build:workflows
npm run validate:workflows
npm run build:config-workbook
npm run verify:config-workbook
git diff --check
```

Trong môi trường hiện tại, `npm test` dùng `node --test --test-isolation=none` vì Node worker spawn bị Windows sandbox trả `EPERM`; isolation none vẫn chạy toàn bộ test tuần tự.

## Acceptance mapping

| Acceptance của issue #2 | Bằng chứng |
| --- | --- |
| `CONFIG_SCHEMA` validate cột/kiểu/unique/ref trước write | `test/config-gateway/schema-validation.test.mjs`; `src/config-gateway/evaluate-config.mjs`; workbook tab `CONFIG_SCHEMA` |
| Version và fingerprint không được lệch | `test/config-gateway/versioning.test.mjs` (same-version changed-content, empty-change, ignore PREPARED) |
| Maintenance và immutable snapshot | `test/config-gateway/maintenance.test.mjs`; write plan đúng PREPARED → COMMITTED; chỉ snapshot COMMITTED được reuse |
| `/trangthai` hiển thị safe status | `test/e2e/status-flow.test.mjs`; `src/telegram-router/format-status.mjs`; `workflows/WF03_V2_TELEGRAM_ROUTER.json` |
| Error normalized, không lộ secret | `test/error-handler/normalize-error.test.mjs`; `src/error-handler/normalize-error.mjs`; workflow WF02 |
| Fixture valid/missing-column/duplicate/version/maintenance | `test/fixtures/config/*`; các test config-gateway tương ứng |

## Artifact đã sinh

- [WF01_V2_CONFIG_GATEWAY.json](../../workflows/WF01_V2_CONFIG_GATEWAY.json)
- [WF02_V2_ERROR_HANDLER.json](../../workflows/WF02_V2_ERROR_HANDLER.json)
- [WF03_V2_TELEGRAM_ROUTER.json](../../workflows/WF03_V2_TELEGRAM_ROUTER.json)
- [KKB_V2_CONFIG_BASELINE.xlsx](../../outputs/issue-2/KKB_V2_CONFIG_BASELINE.xlsx)
- [verification.json](../../outputs/issue-2/verification.json)

`verify-config-workbook.mjs` đã import lại workbook, xác nhận đủ 9 tab/đúng header và không có token lỗi công thức. Preview được render tại `outputs/issue-2/CONFIG_VERSION_preview.png`.

## Việc người dùng cần làm khi bàn giao live

1. Tạo recovery copy của live Google Sheet, thêm chín tab V2 và điền giá trị thật.
2. Bảo vệ `CONFIG_SNAPSHOT`, `OPERATION`, `ERROR_BIA`; xác nhận `CONFIG_SCHEMA` và version/fingerprint.
3. Import WF02 → WF01 → WF03; chọn credential hiển thị `GOOGLE_SHEETS_KKB_V2` và `TELEGRAM_KKB_V2`.
4. Điền `PASTE_GOOGLE_SHEET_ID`, `PASTE_WF01_WORKFLOW_ID`, `PASTE_WF02_WORKFLOW_ID`; giữ inactive.
5. Chạy smoke test hợp lệ, thiếu cột, trùng khóa, version mismatch và maintenance; chỉ bật workflow sau khi đạt.
