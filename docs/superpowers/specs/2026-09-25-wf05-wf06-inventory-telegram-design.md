# WF05/WF06: phiên kiểm kê và nhập số qua Telegram

Ngày chốt thiết kế: 2026-09-25. Trạng thái: đã duyệt thiết kế trong hội thoại; chưa triển khai hoặc publish workflow live.

## Mục tiêu và ranh giới

WF05 mở hoặc tiếp tục đúng một phiên kiểm kê cho mỗi chi nhánh; WF06 ghi số đếm, cho sửa có xác nhận, review và chốt phiên. Một phiên có đúng một tin nhắn bot (bubble) trong topic Kiểm Kê. Bot sửa tin nhắn đó để trình bày danh sách, trạng thái đang xử lý, tiến độ, lỗi, review và kết quả; tin nhắn người dùng dùng để nhập số không tính là bubble của bot.

Thiết kế này bổ sung đường nhận Reply/callback cho Router WF03 và điểm mở phiên từ Dispatcher WF04. Nó không triển khai WF07 khóa sổ ngày, WF08 nhập hàng, WF09 nhập bán, WF10 báo cáo, không thay Sheet live và không publish production.

Các quyết định nền: [CONTEXT.md](../../../CONTEXT.md), [ADR-0005](../../adr/0005-use-one-telegram-ingress-router.md), [ADR-0015](../../adr/0015-require-explicit-conflict-safe-inventory-finalization.md), [ADR-0017](../../adr/0017-decompose-v2-into-focused-workflows.md), [ADR-0018](../../adr/0018-enforce-a-versioned-sheet-schema-and-immutable-record-identity.md), [ADR-0019](../../adr/0019-stage-and-commit-multi-sheet-business-writes.md), [ADR-0021](../../adr/0021-configure-permissions-by-role-and-branch.md). Spec V2 hiện có vẫn điều chỉnh phần domain không được thay đổi ở đây.

## Phân chia trách nhiệm

| Thành phần | Trách nhiệm |
| --- | --- |
| Dispatcher WF04 | Đọc `CONFIG_LICH`; đến giờ chi nhánh (mặc định được cấu hình là 23:45), phát yêu cầu mở phiên. Không mở phiên thứ hai khi còn phiên hoạt động. |
| Router WF03 | Là điểm vào Telegram duy nhất; phân loại lệnh, callback và tin nhắn Reply, xác thực chat/topic/bubble/người gửi/trạng thái chờ, chống xử lý lặp, rồi gửi standard envelope cho worker. Tin nhắn số không có `/` phải đi được đến WF06 khi Reply hợp lệ. |
| WF05 | Lấy cấu hình qua Config Gateway, cố định business date và snapshot danh mục, mở/tái sử dụng phiên, tạo hoặc tìm lại bubble, lưu `master_message_id`, cố gắng pin im lặng, dựng màn hình phiên và trả kết quả cho Router. `/kiemke` chỉ tiếp tục phiên đang tồn tại; không mở sớm ngoài lịch. |
| WF06 | Xử lý chọn bia, Reply số lượng, nhập theo STT, xác nhận sửa, hủy nhập, review, chốt, mở lại/hủy phiên; kiểm tra quyền, revision và idempotency; ghi ledger/version/audit theo write plan; trả nội dung/nút mới cho cùng bubble. |
| Google Sheets | Nguồn cấu hình nghiệp vụ và ledger. Chỉ đọc dữ liệu `COMMITTED`; không ghi đè trực tiếp ledger đã chốt. |

Worker không có Telegram Trigger riêng. Standard envelope phải mang `operation_id`/`idempotency_key`, danh tính actor, chi nhánh, chat/topic, `master_message_id`, loại tương tác, các tham số đã chuẩn hóa và tham chiếu session; callback/Reply không được suy ra mặt hàng chỉ từ text khi thiếu trạng thái chờ hợp lệ. WF05/WF06 trả outcome có cấu trúc (trạng thái, thông điệp, bàn phím, thao tác Telegram được phép), không gửi thêm tin nhắn bot độc lập.

## Vòng đời phiên và bubble

1. Đến lịch, WF05 xác thực cấu hình/chi nhánh, đảm bảo một phiên hoạt động, chốt business date và snapshot danh mục bia đang ACTIVE. Thứ tự hiển thị (`thu_tu_hien_thi`) được chuyển thành STT toàn phiên cố định, không đánh lại theo trang hoặc khi `CONFIG_BIA` đổi giữa phiên.
2. WF05 tạo một bubble trong topic Kiểm Kê và lưu chat ID, thread ID, message ID cùng session ID. Nếu lệnh mở bị gửi lặp, tái sử dụng phiên/bubble; không tạo phiên hoặc bubble thứ hai. Bubble mới được pin im lặng nếu bot có quyền pin. Thiếu quyền pin được ghi cảnh báo cấu hình; phiên vẫn phải có đường tiếp tục an toàn bằng `/kiemke`, không được báo đã pin.
3. `/kiemke` trước giờ mở hoặc khi không có phiên phù hợp trả thông báo từ chối theo cấu hình, không tạo phiên ngầm. Khi có phiên, lệnh chỉ làm mới bubble cũ và đưa người dùng về trang hợp lệ; không phát thêm bubble nghiệp vụ.
4. Sau chốt, bubble cũ hiển thị trạng thái chốt và các điều khiển cũ vô hiệu. Phiên kế tiếp có bubble riêng. Hết TTL của điều khiển chỉ vô hiệu tương tác cũ, không xóa số đếm đã nhận.

Danh sách chia trang, mặc định 8 mặt hàng/trang do Sheet cấu hình. Mỗi dòng có STT cố định, mã/tên, đơn vị và số đã ghi hoặc trạng thái chưa đếm. Callback phân trang/chọn món giữ đúng session và revision; callback cũ không được chuyển sang phiên hoặc trang khác. Nội dung ngắn gọn để vừa giới hạn tin nhắn Telegram.

## Máy trạng thái tương tác

| Trạng thái | Hành động được nhận | Kết quả |
| --- | --- | --- |
| `READY` | Chọn một món, chọn nhập theo STT, đổi trang, review | Chỉ một người nắm quyền nhập/preview tại một thời điểm. |
| `WAIT_SINGLE` | Chính người chọn Reply một số lượng, hoặc bấm Hủy nhập | Số hợp lệ được ghi ngay nếu chưa có số cũ. Nếu là sửa số cũ, chuyển `PREVIEW_CHANGE`. |
| `WAIT_BATCH` | Chính chủ sở hữu Reply nhiều dòng `STT số_lượng`, hoặc Hủy nhập | Kiểm tra cả khối; nếu toàn món mới thì một logical commit, nếu có sửa thì `PREVIEW_CHANGE`. |
| `PREVIEW_CHANGE` | Chính chủ sở hữu Xác nhận hoặc Hủy | Hiển thị toàn bộ thay đổi cũ → mới; xác nhận mới ghi cả khối với kiểm tra revision. |
| `REVIEW` | Xem toàn bộ số đếm, giải trình chênh lệch đỏ, Chốt có xác nhận, hoặc quay lại sửa | Chỉ cho Chốt khi mọi mặt hàng trong snapshot đã có số, kể cả số 0, và giải trình bắt buộc đã đủ. |
| `FINALIZED` | Người có quyền mở lại trước khóa sổ | Không nhận nút nhập cũ; mở lại tạo revision/audit, không ghi đè lịch sử. |
| `CANCELLED` | Không nhận nhập/chốt | Lý do, actor và dấu vết được giữ; phiên không đóng góp vào sổ. |

Mỗi quyền nhập hoặc preview hết hạn sau thời gian cấu hình (mặc định 10 phút). Hết hạn xóa pending/khóa tương tác, không xóa số đã commit; Reply/nút cũ bị từ chối. Khi một người đang sở hữu quyền nhập, người khác được xem nhưng không chen vào nhập hoặc batch. Nếu owner bị vô hiệu hóa hoặc mất quyền, pending được vô hiệu ngay để người khác có quyền tiếp tục. Chủ sở hữu phải gửi/hủy món hiện tại trước khi chọn món khác. Một số đến muộn không bao giờ được gán cho món mới.

`Hủy nhập` chỉ bỏ trạng thái chờ hoặc preview. `Hủy phiên` là nghiệp vụ riêng: người quản lý có quyền tại chi nhánh, nêu lý do, xác nhận hai bước, chỉ trước Chốt. Mở lại phiên sau Chốt nhưng trước Khóa sổ ngày cũng yêu cầu quyền theo cấu hình và lý do. Sau Khóa sổ ngày, chỉ đi qua quyền admin và adjustment/version mới, không sửa trực tiếp số đã khóa. “Quản lý chi nhánh” ở đây nghĩa là actor có capability tương ứng trong `CONFIG_ROLE_PERMISSION` và đúng phạm vi chi nhánh; không suy quyền từ tên role hard-code.

## Nhập từng món và nhập theo STT

Người dùng bấm nút một món rồi **Reply thủ công vào chính bubble phiên** bằng số lượng, không thêm đơn vị. Với batch, bấm “Nhập theo STT” rồi Reply vào cùng bubble, mỗi dòng `STT số_lượng`, ví dụ:

```text
1 12
2 0
8 3.5
```

Bot cần dựa trên `reply_to_message_id`, chat/thread, actor và pending state, không dựa vào việc tin nhắn trông như một số. Cách này hoạt động với Telegram privacy mode khi bot được nhận Reply; đường Router xử lý slash command không đủ, nên cần nhánh nhận Reply riêng. Không dùng ForceReply tạo bubble bot thứ hai.

Số `0` hợp lệ; bỏ trống là chưa đếm; số âm không hợp lệ. Độ chính xác, bước nhảy và min/max lấy từ snapshot của mặt hàng, không tự làm tròn. Một batch có STT trùng, STT ngoài snapshot, dòng sai cú pháp, số sai hoặc không đúng owner bị từ chối **toàn bộ** mà không ghi phần hợp lệ. Món không có trong batch giữ nguyên. Batch toàn món chưa đếm commit một logical operation; batch có ít nhất một thay đổi số đã ghi phải preview toàn bộ và xác nhận một lần. Sửa một món đã ghi cũng cần preview cũ → mới, actor, thời gian và audit revision. Preview hết hạn không ghi gì.

Khi xử lý, bot sửa **chính bubble** sang trạng thái “Đang lưu…” rồi sửa lại kết quả. Callback được xác nhận kịp thời để Telegram ngừng spinner; không hứa chỉ riêng một API edit là đã ghi thành công. Nếu lỗi hoặc revision xung đột, bubble hiển thị lỗi an toàn và dữ liệu mới nhất, cho phép thử lại từ trạng thái hợp lệ, không báo thành công giả.

## Dữ liệu, cấu hình và tính nhất quán

- `CONFIG_LICH` điều khiển giờ mở; cấu hình trang/TTL và quyền nằm trong các bảng cấu hình V2 được version hóa; `CONFIG_BIA.thu_tu_hien_thi` cho thứ tự ban đầu. Không hard-code quy tắc nghiệp vụ trong node n8n.
- `PHIEN_KIEM_KE` lưu session/branch/business date, snapshot/config version, trạng thái, revision và bubble identity. `BIA_LOG` lưu số đếm dưới dạng versioned records; `DIEU_CHINH_SO`/`EVENT_LOG` ghi sửa, mở lại, hủy và chốt. Trường vật lý phải đối chiếu `CONFIG_SCHEMA` hiện hành trước migration; thiết kế không giả định Sheet live đã có mọi cột.
- Pending state cần đủ session ID, owner ID, mode, item/STT hoặc batch preview, expected revision, chat/thread/master message ID, expiry và state revision. Tên tab/cột vật lý được quyết định trong migration có kiểm tra schema, sao lưu và bảo trì; không tự tạo cột khi workflow chạy.
- Mỗi thao tác ghi dùng `operation_id` và idempotency key; `PREPARED`/`COMMITTED` theo write plan để reader không thấy nửa batch. Trước commit phải đối chiếu session/pending/revision mới nhất. Bản ghi đã commit không bị ghi đè im lặng.
- Google Sheets không cung cấp transaction/compare-and-swap mạnh cho nhiều writer. Chủ dự án đã chọn **không dùng Apps Script LockService** và chấp nhận rủi ro đua cực hiếm còn lại. Thiết kế dùng pending owner, idempotency, kiểm tra revision trước/sau ghi và reconciliation, nhưng không khẳng định tính nguyên tử vật lý tuyệt đối. Trường hợp không thể xác định commit phải trả trạng thái cần đối soát, không tự phát lại mù.

## Khôi phục và an toàn

- Khi gửi bubble thành công nhưng mất kết quả API trước khi lưu message ID, có thể chưa biết đã gửi hay chưa. Đánh dấu trạng thái cần đối soát và cho operator kiểm tra topic trước khi thử gửi lại; không tự tạo bubble thứ hai.
- Mất quyền pin/edit, sai topic, actor không có quyền, pending hết hạn và callback cũ phải trả thông báo đã làm sạch; không rò raw payload, token hay dữ liệu nhạy cảm. Lỗi pin không được làm mất phiên đã mở.
- Sau lỗi ghi, đọc lại ledger/operation theo idempotency key rồi mới quyết định retry hay báo cần can thiệp. Một Reply hoặc callback Telegram phát lại không được nhân đôi số đếm hay audit.
- Không sửa trực tiếp ledger đã chốt. Khóa sổ ngày là ranh giới riêng do WF07 quản lý; WF05/WF06 chỉ kiểm tra cờ/trạng thái khóa có thẩm quyền khi mở lại hoặc điều chỉnh.

## Tiêu chí nghiệm thu

1. Dispatcher mở một phiên/chi nhánh/ngày theo lịch; yêu cầu lặp trả cùng session/bubble. `/kiemke` trước lịch không mở sớm.
2. Telegram chỉ có một bubble bot cho mỗi phiên qua chọn món, loading, lỗi, phân trang, batch, review và chốt; pin im lặng khi có quyền.
3. Reply số không có `/` từ đúng người, đúng topic và đúng bubble được WF03 gửi đến WF06; người khác, Reply sai bubble, stale callback hoặc hết TTL không ghi số.
4. `0` được ghi; blank/âm/sai precision/step/min/max bị từ chối; STT vẫn ổn định qua trang và đổi cấu hình.
5. Batch có một dòng sai hoặc trùng STT không ghi dòng nào; batch mới ghi một logical operation; batch sửa có preview toàn bộ, xác nhận owner và audit version.
6. Hai thao tác cạnh tranh hoặc phát lại không được âm thầm ghi đè. Lỗi không rõ trạng thái commit được gắn cần đối soát; chỉ đọc rows `COMMITTED`.
7. Không Chốt khi còn bia chưa đếm hoặc chênh lệch đỏ chưa giải trình; Chốt có review và xác nhận; nút cũ không còn tác dụng. Mở lại/hủy đúng quyền, đúng thời điểm, có lý do/audit; sau khóa sổ chỉ adjustment.
8. Tests tự động bao phủ trạng thái/validation/idempotency/Router Reply và workflow export; smoke trên n8n test ghi execution IDs, Telegram result và bản ghi Sheet đã lược nhạy cảm trước khi publish production.

## Nền hiện có và phần phải làm tiếp

Nhánh `codex/issue-2-inventory-session-counts` đã có logic thuần cho mở/tái dùng phiên, count revision và review/finalize, cùng export WF05/WF06 **inactive**. Export hiện chưa có luồng Telegram một bubble, nhận Reply số qua Router, pin, pending owner/TTL, các node Google Sheets thực tế và orchestration batch/preview. Logic mở lại hiện cho phép cả status `LOCKED`/`CLOSED`; khi triển khai phải chặn theo ranh giới Khóa sổ ngày ở trên, không đưa logic hiện tại lên production nguyên trạng. Cần lập kế hoạch triển khai những phần này sau khi duyệt spec, kiểm tra schema Sheet live theo ADR-0018 và giữ WF05/WF06 inactive cho đến khi smoke đạt. Không dùng mock history hoặc workflow V1 làm nguồn quyết định nghiệp vụ.
