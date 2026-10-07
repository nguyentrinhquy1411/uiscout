# 2. Lệnh `check` và cách đọc báo cáo

`flowcheck check` là lệnh chính: đi app, phán từng bước, ghi kết quả.

## Tool đi app như thế nào

1. Mở URL gốc trong Chromium (viewport 1280×800, locale en-US, múi giờ Asia/Ho_Chi_Minh, tắt animation).
2. Ở mỗi màn, liệt kê mọi phần tử tương tác đang nhìn thấy. Khi có dialog/menu đang mở, chỉ lấy phần tử bên trong nó.
3. Thao tác từng phần tử:
   - button, link, tab, menu item, checkbox, switch… được **click**;
   - ô nhập được **gõ** chữ `flowcheck` rồi nhấn **Enter**;
   - combobox, slider chưa được thao tác.
4. Sau mỗi bước: chờ không còn request và DOM đứng yên 250 ms, tua đồng hồ trang thêm 5 giây, chờ lần nữa, rồi chạy các oracle.
5. Thao tác dẫn sang màn mới thì màn đó được đi tiếp, tới độ sâu `--depth`.

Mỗi màn chạy trong một **browser context mới** (IndexedDB, localStorage, cookie sạch), 4 màn song song.

## Các flag hay dùng

| Flag | Mặc định | Khi nào dùng |
| --- | --- | --- |
| `--url <url>` | — | Bắt buộc nếu không có config |
| `--depth <n>` | 2 | Số thao tác tối đa tính từ màn gốc. 1 là nhanh, 2–3 là sâu |
| `--max-steps <n>` | 250 | Trần tổng số thao tác; app lớn nên tăng |
| `--block <globs>` | — | Chặn API tốn tiền hoặc thay đổi theo thời gian: `"**/api/ai/**,**/analytics/**"` |
| `--now <iso>` | giờ thật | Cố định thời gian app thấy, để chạy lại ra như cũ |
| `--open` | — | Mở trang graph khi xong |
| `--no-a11y` | bật | Bỏ kiểm tra accessibility (nhanh hơn) |
| `--fast-forward <ms>` | 5000 | Tua đồng hồ sau mỗi bước; `0` để tắt (nhanh hơn, nhưng không thấy chuyển trang muộn) |
| `--headed` | — | Hiện cửa sổ trình duyệt để xem tool đang làm gì |

Toàn bộ flag: [tham chiếu CLI](tham-chieu-cli.md).

## Đọc báo cáo

```text
flowcheck: 1 errors, 2 warnings · 11 nodes, 223 edges, 227 steps

Graph diff (vs flowcheck/app.graph.json)          ← chỉ khi có baseline
  (no change)

Errors (1)
  script       console.error: Error: Base UI: MenuGroupContext is missing.
               at / → click /.button:account@nav · /calendar → click … · +5 more

Warnings (2)
  a11y         button-name: Buttons must have discernible text — #nameless
               at load /broken.html

Changes (3)                                         ← info: nút mới so với baseline

Intent coverage 2 of 6 lines                        ← chỉ khi có *.intent.md

Healed lookups (8): found by similarity, not exact match
Flaky (1): failed, then passed from a fresh context
Never settled (7): DOM kept changing, judged after the timeout
Not walked: 2 destructive, 1 input, 39 repeat
```

### Dòng đầu

Số lỗi và cảnh báo **đếm theo nội dung**: cùng một lỗi xuất hiện trên 7 màn tính là 1. Sau đó là số màn, edge và bước đã đi.

### Errors và Warnings

Mỗi mục có ba dòng:
- **oracle** gây ra (script, network, dead-control, layout, a11y, transition, structure, rule) và thông điệp;
- **at**: nơi xảy ra. `load /x` là lúc vừa vào màn `/x`; `/x → click Y` là sau khi bấm Y trên màn `/x`. Nếu nhiều nơi thì liệt kê 3 nơi đầu và số còn lại;
- **via** (chỉ với vi phạm luật): chuỗi bước từ đầu dẫn tới vi phạm.

| Oracle | Báo khi | Mức |
| --- | --- | --- |
| `script` | Exception không bắt, `console.error` | Lỗi |
| `network` | Request cùng origin trả 5xx, 4xx không được cho phép, hoặc hỏng | Lỗi |
| `dead-control` | Click không trúng (bị che, bị chặn), hoặc không điểm nào bấm được | Lỗi |
| `transition` | Thao tác dẫn tới màn khác với baseline; hoặc setup context hỏng | Lỗi / cảnh báo |
| `structure` | Nút biến mất, đổi tên (lỗi); dịch chuyển > 16 px (cảnh báo); nút mới (info) | Tuỳ |
| `rule` | Luật nghiệp vụ bị vi phạm | Lỗi |
| `layout` | Hai nút chồng nhau ≥ 25%; chữ bị cắt không có "…" | Cảnh báo |
| `a11y` | Luật axe mức serious/critical (trừ độ tương phản màu) | Cảnh báo |

### Các mục bên dưới

| Mục | Nghĩa | Có cần làm gì không |
| --- | --- | --- |
| **Healed lookups** | Tool tìm lại một nút theo độ giống, không khớp hoàn toàn (vị trí hoặc tên hơi khác) | Thường không. Nhiều quá thì cân nhắc thêm `data-testid` |
| **Flaky** | Bước hỏng lần đầu, chạy lại trong context mới thì qua. Không làm fail run | Xem nếu lặp lại nhiều lần |
| **Never settled** | DOM không đứng yên sau 4 giây (đồng hồ chạy, animation vô hạn). Bước vẫn được phán | Không, trừ khi kèm lỗi |
| **Not walked** | Phần tử không được thao tác, kèm lý do | Xem bảng dưới |

| Lý do "Not walked" | Nghĩa |
| --- | --- |
| `destructive` | Tên nút nghe như phá dữ liệu (delete, xoá, clear, send, log out, pay…). Đi được bằng [replay](06-network.md) |
| `disabled` | Nút đang bị disable |
| `input` | Combobox, slider: chưa hỗ trợ |
| `new-tab` | Link mở tab mới |
| `external` | Link ra site khác |
| `repeat` | Nút có sẵn ở màn gốc (thanh rail…): chỉ đi ở màn gốc |
| `not-found` | Không tìm lại được nút sau khi quay về màn |
| `budget` | Hết `--max-steps` |

## Mã thoát

| Mã | Nghĩa |
| --- | --- |
| 0 | Không có lỗi mức error (cảnh báo không làm fail) |
| 1 | Có ít nhất một lỗi |
| 2 | Sai cách dùng, hoặc tool gặp sự cố |

## Giảm nhiễu

| Triệu chứng | Cách xử lý |
| --- | --- |
| Các phần tử chồng nhau theo thiết kế (event lịch xếp chồng) | `--allow-overlap "[data-event-id]"` |
| Một 404 là bình thường (kiểm tra phiên đăng nhập…) | `--allow-4xx "GET /api/me"` hoặc `--allow-4xx 404` |
| `console.error` từ thư viện ngoài, không phải lỗi app | `"ignoreConsole": ["chuỗi con của thông điệp"]` trong config |
| API ngoài làm chậm hoặc tốn tiền | `--block "**/api/ai/**"` |
| Ngày giờ trong UI làm snapshot đổi mỗi ngày | `--now 2026-10-07T09:00:00+07:00` |

## Thời gian chạy

Khoảng 0,4–2 giây mỗi bước. Các màn chạy song song, nhưng các bước trong một màn chạy tuần tự, nên tổng thời gian gần bằng thời gian của màn có nhiều nút nhất. Tham khảo (app calendar, 11 màn):

| Cấu hình | Thời gian |
| --- | --- |
| depth 1, mặc định | khoảng 110 giây |
| depth 1, `--no-a11y --fast-forward 0` | khoảng 70 giây |
| depth 2 (31 màn, 431 bước) | khoảng 4 phút |

Tiếp theo: [File cấu hình](03-cau-hinh.md).
