# 09 — Runbook smoke Issue #4

Runbook này chuẩn bị smoke cho `WF04_V2_DISPATCHER` và `WF05_V2_MO_PHIEN_KIEM_KE`. Nó không cho phép tự động import, publish, activate workflow, sửa Google Sheet live hoặc gửi Telegram. Trước mọi thao tác live, người vận hành phải duyệt rõ Sheet, workflow, topic, cửa sổ thời gian và phạm vi dòng được phép ghi.

## Ranh giới nghiệm thu

Issue #4 gồm Dispatcher 10 phút, claim/recovery, heartbeat, mở đúng một phiên theo lịch, cố định ngày/snapshot/danh mục/STT và tạo đúng một bubble. WF05 candidate hỗ trợ edit path cho reservation `RUNNING` với row count do worker xác định; end-to-end Telegram `/kiemke` takeover vẫn phụ thuộc WF03 follow-up riêng và ngoài phạm vi import/smoke Issue #4 cho tới khi hai phạm vi được review và target được xác nhận.

Issue #5/WF06 nằm ngoài runbook này: nhập số đếm, callback phân trang, loading state, tính tiến độ thực và cập nhật bubble theo số đếm. Trong smoke Issue #4, bubble mới có thể hiển thị `0/N`; resume chưa có WF06 phải giữ thông báo trung tính, không giả tiến độ.

`/retry` đầy đủ cũng không thuộc Issue #4. Issue #3 đã ghi blocker vì `ERROR_BIA`/`OPERATION` chưa lưu payload nguồn có thể phát lại; regression đúng ở đây là tiếp tục fail-closed với `retry-payload-unavailable`, không gọi worker và không báo đã nhận.

## Kết quả kiểm tra chỉ đọc ngày 2026-09-28

Ảnh chụp `.xlsx` được export chỉ đọc từ Google Sheet authoritative để kiểm tra cấu trúc; file tạm không phải nguồn cấu hình và không được commit.

- Sheet live có các tab core/Router đến `RETRY_CONTEXT`, nhưng chưa có `CONFIG_LICH`, `CONFIG_BIA`, `DISPATCH_HISTORY`, `HEARTBEAT`, `PHIEN_KIEM_KE`.
- `CONFIG_SCHEMA` chưa có khai báo ACTIVE cho 5 tab trên: `0/12`, `0/5`, `0/20`, `0/11`, `0/16` cột.
- Chưa có `DISPATCH_CLAIM_LEASE_MINUTES`, `DISPATCHER_HEARTBEAT_THRESHOLD`, `DISPATCHER_NOTIFICATION_CHAT_ID`, `DISPATCHER_NOTIFICATION_THREAD_ID`, `INVENTORY_PAGE_SIZE` trong `CONFIG_GLOBAL`.
- Mapping `KIEM_KE` ACTIVE hiện đã có `chat_id` và `message_thread_id` dạng số; mapping cũ khác đang INACTIVE. Blocker topic placeholder của lần audit trước đã được gỡ, nhưng vẫn phải xác nhận đúng topic test tại action-time.
- Dòng `/kiemke` ACTIVE còn dùng `worker_workflow=WF05_V2_KIEM_KE_PENDING`, chưa phải workflow ID n8n thật.
- `CONFIG_VERSION` đang ACTIVE với `config_version=v1.2`, `maintenance_mode=NO`. Không được sửa rời rạc trên version này.
- Header bắt buộc của các tab core/Router hiện hữu khớp prefix contract. `ERROR_BIA` có thêm `branch_id`, `idempotency_key` ở cuối; phải bảo toàn, không xóa để ép giống fixture.

Kết luận: môi trường chưa đủ điều kiện smoke. Không chạy candidate workflow cho tới khi toàn bộ preflight dưới đây được duyệt và đạt.

## Preflight Google Sheet

**Hard stop — smoke/import blocker:** do not import, activate, execute, or smoke WF04/WF05 until an operator has directly inspected the physical header row and confirmed the exact header names and order for all five tabs listed below, including empty tabs and any trailing columns. Runtime checks, Gateway validation, local tests, and n8n read nodes cannot prove that a physical header is missing, empty, shifted, or followed by trailing cells. Record the direct inspection; any mismatch or unverified tab blocks import and smoke.

### Bảo vệ và versioning

- [ ] Người dùng duyệt chính xác Sheet live, chi nhánh test, topic test, lịch test, thời gian bắt đầu/kết thúc và các tab có thể nhận dòng runtime.
- [ ] Tạo bản sao phục hồi trước migration; ghi người tạo, thời điểm và config/schema version.
- [ ] Đặt `maintenance_mode=YES` trong lúc migration bằng thay đổi versioned đã duyệt.
- [ ] Không sửa/xóa dòng đã commit trong `CONFIG_SNAPSHOT`, `OPERATION`, `EVENT_LOG`, `ERROR_BIA` hoặc các ledger mới.

### Tab và header phải thêm đúng thứ tự

- [ ] `CONFIG_LICH`: `schedule_id`, `job_code`, `branch_id`, `local_time`, `timezone`, `days_of_week`, `grace_window_minutes`, `retry_limit`, `retry_delay_minutes`, `worker_workflow`, `enabled`, `trang_thai`.
- [ ] `CONFIG_BIA`: `ma_bia`, `ten_bia`, `don_vi_dem`, `thu_tu_hien_thi`, `trang_thai`.
- [ ] `DISPATCH_HISTORY`: `dispatch_key`, `schedule_id`, `job_code`, `branch_id`, `business_date`, `scheduled_at`, `status`, `attempt_count`, `retry_delay_minutes`, `retry_limit`, `worker_workflow`, `claim_token`, `operation_id`, `request_id`, `config_snapshot_id`, `failure_count`, `last_error_code`, `retry_at`, `skip_reason`, `updated_at`.
- [ ] `HEARTBEAT`: `heartbeat_id`, `heartbeat_at`, `status`, `failure_count`, `threshold`, `critical_notified`, `notice`, `alert_chat_id`, `alert_thread_id`, `diagnostic_code`, `dispatch_key`.
- [ ] `PHIEN_KIEM_KE`: `session_id`, `branch_id`, `business_date`, `config_snapshot_id`, `topic_id`, `chat_id`, `message_thread_id`, `dispatch_key`, `catalog_snapshot_json`, `catalog_count`, `page_size`, `master_message_id`, `bubble_state`, `status`, `created_at`, `updated_at`.
- [ ] Trong maintenance mode, cập nhật `schema_version` của mọi rule `CONFIG_SCHEMA` hiện có sang schema version mới, giữ nguyên `schema_rule_id` và nội dung rule còn lại; sau đó thêm đủ 64 dòng ACTIVE với version mới, đúng `ordinal`. Cả 12 cột `CONFIG_LICH` và 5 cột `CONFIG_BIA` phải có `required=YES` để không chấp nhận lịch/danh mục thiếu rồi rơi vào giá trị mặc định âm thầm. Không thay thế hoặc sửa nội dung rule cũ ngoài việc version hóa trong migration đã duyệt.
- [ ] Kiểm tra header vật lý trực tiếp. Read node của n8n không chứng minh được suffix trống hoặc thứ tự header khi Sheet rỗng.
- [ ] Kiểm tra migration version như một đơn vị: `CONFIG_VERSION.schema_version`, toàn bộ rule cũ đã version hóa, 64 rule mới và header vật lý phải cùng bản đã duyệt. Runtime yêu cầu mọi schema rule (kể cả rule INACTIVE) cùng version với `CONFIG_VERSION` và kiểm tra ACTIVE/shape ở phạm vi được dùng, nhưng không tự chứng minh version/order của header vật lý khi Sheet rỗng; không coi Gateway pass là thay thế cho bước kiểm tra này.

### Cấu hình nghiệp vụ phải có giá trị thật

- [ ] `DISPATCH_CLAIM_LEASE_MINUTES`: số nguyên dương được vận hành duyệt.
- [ ] `DISPATCHER_HEARTBEAT_THRESHOLD`: số nguyên dương; giá trị mẫu là `3`, không tự coi mẫu là phê duyệt production.
- [ ] `DISPATCHER_NOTIFICATION_CHAT_ID` và `DISPATCHER_NOTIFICATION_THREAD_ID`: ID số của đích đã duyệt.
- [ ] `INVENTORY_PAGE_SIZE`: số nguyên dương; giá trị mẫu là `8`.
- [ ] `CONFIG_TOPIC` có đúng một mapping `KIEM_KE` ACTIVE cho chi nhánh test, với `chat_id`/`message_thread_id` số và topic đã tồn tại. Không tạo topic, không sửa mapping tự động trong workflow.
- [ ] `CONFIG_LENH./kiemke.worker_workflow` là workflow ID thật của WF05 vừa import, không phải tên hoặc placeholder.
- [ ] `CONFIG_LICH` có lịch test ACTIVE/enable với timezone, ngày trong tuần, grace/retry và workflow ID thật của WF05.
- [ ] `CONFIG_BIA` có danh mục test ACTIVE, mã duy nhất và `thu_tu_hien_thi` số hợp lệ.
- [ ] Có đủ message key: `DISPATCH_OUTSIDE_GRACE_WINDOW`, `DISPATCH_BRANCH_INACTIVE`, `DISPATCH_ACTIVE_SESSION_EXISTS`, `DISPATCH_RECONCILIATION_REQUIRED`, `DISPATCHER_CRITICAL`, `DISPATCHER_RECOVERY`.
- [ ] Tăng schema/config version theo một thay đổi thống nhất; Gateway tạo snapshot COMMITTED mới trước khi mở lại thao tác.
- [ ] Chỉ chuyển `maintenance_mode=NO` cho cửa sổ smoke sau khi Gateway validation đạt.

Workbook [Issue-4-Sheet-Migration.xlsx](../../outputs/issue-4/Issue-4-Sheet-Migration.xlsx) chỉ cung cấp tab/header, 64 schema rows và placeholder. Builder đã đánh dấu bắt buộc toàn bộ trường lịch/danh mục; mọi placeholder vẫn phải được thay bằng giá trị đã duyệt. Không import workbook để ghi đè Sheet live.

## Preflight n8n

Tất cả JSON candidate hiện `active=false`. Trước khi import bất kỳ candidate nào, phải có ID workflow thật trên n8n đích cho cả `WF01_V2_HEARTBEAT_GATEWAY` và `WF04_V2_DISPATCHER`, bind cả hai chiều (WF04 gọi đúng entry; entry giới hạn caller đúng WF04), rồi kiểm tra artifact không còn `BIND_WF01_HEARTBEAT_GATEWAY_WORKFLOW_ID_BEFORE_IMPORT` hoặc `BIND_WF04_WORKFLOW_ID_BEFORE_IMPORT`. Còn một trong hai placeholder thì chặn import và smoke; không suy đoán ID. Import theo thứ tự phụ thuộc và giữ các workflow inactive trong suốt bước kiểm tra binding:

1. `WF02_V2_ERROR_HANDLER`.
2. `WF01_V2_CONFIG_GATEWAY`, bind mọi lời gọi Error Handler tới ID thật của WF02.
3. `WF01_V2_HEARTBEAT_GATEWAY`, bind native n8n Execute Workflow caller allowlist (`callerPolicy=workflowsFromAList`, `callerIds`) chỉ tới ID thật của WF04; giữ inactive.
4. `WF05_V2_MO_PHIEN_KIEM_KE`, bind WF01/WF02 và credential.
5. Không import hoặc cập nhật WF03 từ scope Issue #4; giữ Router thuộc follow-up riêng từ `master`. WF05 candidate đã nhận đúng reservation `RUNNING` có `expected_row_count` trống và vẫn giữ đường tương thích `PREPARED` 1/2. `/kiemke` takeover vẫn chưa được smoke cho tới khi cả hai scope đạt review và target cụ thể được xác nhận. Không tạo Telegram Trigger thứ hai.
6. `WF04_V2_DISPATCHER`, bind `Call Config Gateway` tới ID thật của `WF01_V2_HEARTBEAT_GATEWAY` và các Error Handler tới WF02. Worker vẫn lấy động từ `CONFIG_LICH`.

Checklist binding:

- [ ] Credential hiển thị `GOOGLE_SHEETS_KKB_V2` trỏ đúng Sheet authoritative và có quyền cần thiết.
- [ ] Credential `TELEGRAM_KKB_V2` là bot V2; chỉ Router hiện hữu sở hữu Telegram Trigger.
- [ ] WF01 `Call Error Handler` → WF02 thật.
- [ ] Giữ nguyên WF03 hiện hữu trong smoke Issue #4; không bind/import artifact WF03 từ nhánh Issue #4. Chỉ xác minh ID/bindings của Router nếu một phạm vi smoke sau này được duyệt rõ.
- [ ] (Chỉ cho follow-up WF03 smoke; không phải gate/target Issue #4) Nhánh thành công WF03 chỉ kết thúc sớm khi worker trả đồng thời `reply_handled=true`, `operation_committed=true`, và `operation_id`/`idempotency_key` khớp chính xác Router reservation; với `/kiemke` resume, WF05 phải edit bubble đã commit và không được phát sinh ACK/bubble thứ hai từ Router. Worker chung không đủ bốn bằng chứng này vẫn đi qua commit/ACK của Router.
- [ ] ID thật của `WF01_V2_HEARTBEAT_GATEWAY` và WF04 đã được xác nhận trên n8n đích; cả hai placeholder import ở trên đã được thay đúng trước khi import candidate.
- [ ] WF04 `Call Config Gateway` → ID thật của `WF01_V2_HEARTBEAT_GATEWAY` (không trỏ sang `WF01_V2_CONFIG_GATEWAY`); native caller allowlist của entry này có `callerPolicy=workflowsFromAList` và `callerIds` chỉ gồm ID thật của WF04. Các Error Handler của WF04 → WF02 thật; worker → ID trong `CONFIG_LICH`.
- [ ] WF05 `Call Config Gateway` → WF01 thật; `Record Inventory Pin Warning` → WF02 thật.
- [ ] Mọi Google Sheets read node giữ `executeOnce=true`, `returnAll=true` khi cần toàn bảng và đúng Sheet ID.
- [ ] Xác nhận timezone n8n khớp cách tính lịch; chỉ tick kỹ thuật 10 phút nằm trong workflow.
- [ ] Khi tất cả workflow còn inactive, kiểm tra trực tiếp trên n8n đích cả hai ID đã bind đúng, native caller allowlist chỉ cho WF04 thật, không còn placeholder; ghi lại workflow ID và execution mode. ID lịch sử trong JSON không phải bằng chứng binding live. Chỉ sau bước này mới xem xét smoke đã được duyệt; nếu sai, tiếp tục chặn import/smoke.

## Phạm vi ghi khi smoke

Sau khi người dùng duyệt ở action-time, smoke có thể tạo dòng versioned/runtime trong `CONFIG_SNAPSHOT`, `OPERATION`, `DISPATCH_HISTORY`, `HEARTBEAT`, `PHIEN_KIEM_KE`, `EVENT_LOG`, và `ERROR_BIA` khi có cảnh báo/lỗi. Telegram có thể tạo một bubble, pin bubble hoặc edit đúng bubble trong topic test đã cấu hình.

Không được ghi trực tiếp để “dọn” ledger, không sửa `CONFIG_TOPIC` trong workflow, không tạo topic, không đụng V1/WF04 và không chạy fault injection trên production. Các case cần schema hỏng, mất quyền, network fault hoặc trạng thái ledger nhân tạo phải dùng bản sao test/n8n test riêng.

## Ma trận smoke và expected evidence

P3 — validator chỉ chấp nhận UTC chuẩn cho `HEARTBEAT.heartbeat_at` vẫn được hoãn. Kiểm tra khả năng parse hiện tại giữ nguyên và không xác nhận định dạng UTC chuẩn.

| Case | Cách chạy an toàn | Kết quả bắt buộc | Evidence cần giữ | Dừng/rollback khi sai |
| --- | --- | --- | --- | --- |
| Gateway preflight | Gọi WF01 với config đã migration | Snapshot COMMITTED đúng version/fingerprint; không lỗi schema | Execution ID, version, snapshot ID, mã kết quả | Đặt maintenance YES; không chạy WF04/WF05 |
| Gateway từ chối schema hoặc không sẵn sàng, kể cả lỗi lặp lại | Chỉ fault-injection trên bản sao Sheet và n8n test | WF04 không dispatch và chỉ đọc HEARTBEAT. Nếu có heartbeat trước tương thích schema, hợp lệ ngữ nghĩa, ghi đúng một heartbeat FAILED từ cấu hình đã lưu; không notice, không gọi WF02, không ghi `ERROR_BIA`, giữ nguyên `critical_notified`. HEARTBEAT thiếu/không đọc được/rỗng/sai schema/sai ngữ nghĩa thì không ghi gì. | Gateway code đã sanitize; danh sách sheet được đọc; heartbeat trước/sau hoặc kết quả fail-closed; xác nhận không có notice/ERROR_BIA | Dừng WF04 nếu có dispatch, notice, WF02/`ERROR_BIA` side effect hoặc write khi không có heartbeat hợp lệ |
| Đến hạn mở phiên | Cho một lịch test đến hạn trong cửa sổ đã duyệt | Một dispatch SUCCESS, một operation mở COMMITTED, một session ACTIVE và một bubble/pin | Parent/child execution IDs; dispatch/session/operation IDs; message ID đã redacted | Deactivate WF04; không replay nếu send outcome chưa rõ |
| Tick/replay lặp | Chạy lại cùng window/key | Không có session, audit hoặc bubble thứ hai | Row counts trước/sau; cùng dispatch/operation/session/message identity | Dừng lịch; đối soát duplicate trước lần chạy khác |
| `/kiemke` resume | **Deferred:** chưa chạy trong smoke Issue #4; worker-side contract compatibility có test cục bộ nhưng integration/review/target chưa được phê duyệt | Không claim pass trong Issue #4; WF05 candidate nhận `RUNNING` với count trống và worker tự đặt count commit | Chỉ thu evidence trong một follow-up smoke được duyệt sau review và xác nhận target | Không import WF03 follow-up hoặc gọi `/kiemke` takeover trong smoke Issue #4 |
| `/kiemke` trước lịch | **Deferred:** thuộc kiểm thử Router/WF05 tích hợp sau follow-up; không chạy trong smoke Issue #4 | Không claim pass trong Issue #4; không tạo session/topic | Chỉ thu evidence trong phạm vi smoke riêng đã duyệt | Không gọi `/kiemke` từ smoke Issue #4 |
| Active session skip | Tick khi session ACTIVE hợp lệ đã tồn tại | Không mở session thứ hai; có dispatch notice theo config | Dispatch outcome, notice/error ID, session count | Dừng lịch nếu worker vẫn được gọi |
| Ngoài grace | Chạy lịch đã quá grace trên test copy | Không mở sai business date; có cảnh báo | dispatch_key, scheduled/business date, warning | Không chạy lại bằng key/ngày mới tự phát |
| Hai job, một fail | Chỉ trên n8n test/test copy | Hai claim riêng; tick heartbeat FAILED dù job sau thành công | Hai worker execution IDs, heartbeat row, dispatch statuses | Deactivate WF04; giữ rows để phân tích |
| Stale CLAIMED/RUNNING | Chỉ với ledger nhân tạo trên test copy | CLAIMED hết lease chỉ retry cùng key; RUNNING không chắc chắn yêu cầu reconciliation | Trước/sau rows và claim token đã redacted | Không gọi worker cho RUNNING không chắc chắn |
| Threshold/recovery khi Gateway hợp lệ | Chỉ trên test copy với đích cảnh báo test | Với lỗi worker trên đường Gateway hợp lệ, critical đúng một lần khi đạt ngưỡng; recovery đúng một lần; mỗi attempt có `heartbeat_id` V2 UTC-plus-entropy riêng kể cả cùng millisecond, không dùng n8n execution ID làm khóa. Không áp dụng alert cho Gateway-failure fallback. | Chuỗi heartbeat, attempt identity đã redacted và Telegram outcomes | Tắt schedule; không sửa failure_count bằng tay |
| Topic thiếu/inactive | Config version test riêng | `INVENTORY_TOPIC_NOT_CONFIGURED`; không ghi session/topic | WF05 result, row counts | Khôi phục bằng config version mới, không auto-create |
| Pin denied | Topic test với quyền pin chủ động giới hạn | Session vẫn COMMITTED; một bubble; `INVENTORY_PIN_FAILED` được ghi an toàn | Telegram result, session/message ID, error ID | Không resend bubble; sửa quyền rồi resume |
| Unknown send outcome | Chỉ fault injection trên test instance | Giữ `SEND_REQUESTED`/PREPARED và yêu cầu reconciliation; không resend | Execution/operation/session states và Telegram lookup | Không retry cho tới khi xác định message có tồn tại |
| Router regressions | **Deferred/out of Issue #4:** `/help`, `/trangthai`, sai quyền, `/retry`, callback test thuộc Router scope riêng | Không claim pass từ smoke Issue #4; giữ Router hiện hữu nguyên trạng | Evidence chỉ trong phạm vi Router/follow-up smoke được duyệt | Không import/update WF03 từ worktree Issue #4 |

## Mẫu evidence

Mỗi case ghi tối thiểu:

- Thời gian, người phê duyệt, môi trường, workflow version/hash và config/schema version.
- Parent/child execution IDs; không lưu URL có token.
- `request_id`, `operation_id`, `dispatch_key`, `session_id`, `config_snapshot_id` và quan hệ giữa chúng.
- Trạng thái trước/sau và số dòng cho từng ledger liên quan.
- Telegram outcome, `master_message_id` và pin/edit/send outcome ở dạng redacted.
- Expected so với actual, verdict và hành động tiếp theo.

Không commit chat/user/topic ID thật, nội dung danh mục riêng, token, raw stack trace hoặc payload Telegram đầy đủ.

## Rollback

1. Deactivate WF04 trước để ngừng tick mới; nếu Router có regression, khôi phục đúng Router đã publish trước smoke và giữ duy nhất một Telegram Trigger.
2. Đặt config vào maintenance bằng version mới đã duyệt. Không sửa snapshot hoặc config version lịch sử.
3. Không xóa/sửa ledger đã ghi. Operation PREPARED/FAILED hoặc send outcome chưa rõ phải đi qua recovery/reconciliation cùng identity.
4. Khôi phục binding `CONFIG_LENH`/`CONFIG_LICH` bằng config version mới; không thay worker ID trong snapshot cũ.
5. Giữ bubble test làm evidence mặc định. Việc xóa tin nhắn/topic là thao tác phá hủy và cần người dùng duyệt riêng ngay trước khi làm.
6. Nếu migration cấu trúc sai, giữ maintenance, restore từ bản sao theo quy trình được duyệt rồi chạy lại header/schema check trước khi active bất kỳ candidate nào.
7. Ghi incident với khoảng thời gian, execution IDs, operation/dispatch/session IDs và trạng thái Telegram không chắc chắn.

## Điều kiện kết thúc Issue #4

- [ ] Review Standards và Spec sau merge không còn finding Critical/Important chưa xử lý.
- [ ] Preflight Sheet và n8n đạt, với binding/workflow ID thật được ghi lại an toàn.
- [ ] Các case smoke áp dụng cho Issue #4 đạt và có evidence đã redacted.
- [ ] Rollback path đã được kiểm tra hoặc diễn tập trên test instance.
- [ ] Issue #4 chỉ được đóng sau live smoke theo phạm vi người dùng duyệt.

WF06/Issue #5 không cần hoàn tất để xác nhận tính duy nhất của session/bubble Issue #4, nhưng mọi claim về nhập số đếm, callback pagination hoặc tiến độ đầy đủ phải chờ Issue #5.
