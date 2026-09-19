# Handoff — Issue #2 Config Gateway → `/trangthai`

## Trạng thái bàn giao

- Repository: `devphucthinh/n8n-Modus`
- Base branch: `master`
- Implementation branch: `codex/issue-2-config-gateway`
- Implementation commit: `26b5b7e` (`fix: harden V2 config gateway status flow`)
- Scope: tracer bullet cho GitHub issue #2, dùng inline execution trong n8n.
- V2 vẫn độc lập với WF04; WF04 chỉ là tài liệu tham khảo hành vi.
- Google Sheet live là nguồn cấu hình nghiệp vụ. Workbook trong repo chỉ là fixture an toàn được sinh từ mẫu chín tab.
- Ba workflow V2 được xuất ở trạng thái `active: false`; chưa import hoặc smoke test trên n8n/Google Sheet live.

## Đã hoàn tất

1. Config Gateway đọc tuần tự chín tab core, kiểm tra header, `CONFIG_SCHEMA`, kiểu dữ liệu, unique, reference, user active, version/fingerprint và maintenance mode.
2. Snapshot cấu hình bất biến với staged write `PREPARED → COMMITTED`; `OPERATION.actual_row_count` chỉ được ghi khi commit thành công.
3. `/trangthai` trả version, snapshot, fingerprint, health, maintenance state và chi nhánh hoạt động; không lộ credential/token/private payload.
4. Lỗi được chuẩn hóa với `error_id`, `error_code`, `retryable`, `operation_id` và hàng `ERROR_BIA` đã lọc trường an toàn.
5. Router không đọc Google Sheet trực tiếp; mọi config read đi qua WF01. Lệnh chưa bật được xử lý read-only, không tạo business write plan.
6. Validator kiểm tra workflow inactive, credential reference, placeholder, secret scan, JavaScript trong Code node và đúng một Telegram Trigger.

## Artifact chính

- `workflows/WF01_V2_CONFIG_GATEWAY.json`
- `workflows/WF02_V2_ERROR_HANDLER.json`
- `workflows/WF03_V2_TELEGRAM_ROUTER.json`
- `outputs/issue-2/KKB_V2_CONFIG_BASELINE.xlsx`
- `outputs/issue-2/verification.json`
- `docs/configuration/config-gateway-v2.md`
- `docs/testing/issue-2-evidence.md`

## Kiểm thử đã chạy

```powershell
npm run verify
npm run verify:config-workbook
git diff --check
```

Kết quả tại thời điểm handoff: **39/39 test pass**, ba workflow validate pass, workbook xác nhận đủ **9 sheet** và không có lỗi công thức.

`npm test` dùng `node --test --test-isolation=none` vì Node worker spawn bị Windows sandbox trả `EPERM`; đây là chế độ tuần tự tương đương về assertion.

## Việc tiếp theo cho agent nhận bàn giao

1. Xác nhận push/PR của branch này vào `master`; không tự đổi sang branch `production` khi chưa có quy ước từ repository.
2. Import theo thứ tự: `WF02_V2_ERROR_HANDLER` → `WF01_V2_CONFIG_GATEWAY` → `WF03_V2_TELEGRAM_ROUTER`.
3. Chọn credential hiển thị `GOOGLE_SHEETS_KKB_V2` và `TELEGRAM_KKB_V2`; điền Google Sheet ID và workflow IDs vào các placeholder, không ghi token vào JSON.
4. Chuẩn bị chín tab V2 trên bản sao phục hồi của live Sheet, bảo vệ `CONFIG_SNAPSHOT`, `OPERATION`, `ERROR_BIA`, rồi chạy smoke/negative/idempotency/maintenance tests.
5. Chỉ bật workflow sau khi smoke test live đạt. Các worker V2 còn lại, dispatcher 10 phút, backup/retention và cutover chưa thuộc tracer bullet này.

## Bảo toàn dữ liệu hiện có

Các file legacy untracked trong workspace (`WF01_DEV_*`, `WF02_*`, `WF03_DEV_*`, thư mục render tạm và output WF04 test) được giữ nguyên và không nằm trong commit issue #2. Không stage hoặc xóa chúng nếu chưa có chỉ đạo riêng.

## Quy tắc an toàn

- Không hard-code business config mới vào n8n; thay đổi config phải nằm trong Google Sheet.
- Không sửa/xóa ledger đã commit trực tiếp; dùng adjustment/versioned record.
- Không đưa credential, token, API key hoặc dữ liệu riêng tư vào docs, issue, log hay workflow export.
