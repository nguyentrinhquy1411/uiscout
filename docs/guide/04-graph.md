# 4. Trang graph và snapshot

Mỗi lần `check` sinh `.flowcheck/graph.html`: một trang mở được bằng trình duyệt, không cần mạng, cho thấy toàn bộ app tool đã đi qua.

## Mở trang

```sh
flowcheck check --open                              # chạy xong tự mở
flowcheck graph --open                              # mở lại graph của lần chạy gần nhất, không chạy app
flowcheck graph flowcheck/app.graph.json --open     # xem baseline đã commit
flowcheck graph path/to/graph.json --out out/ --open  # graph bất kỳ, ghi trang vào out/
open .flowcheck/graph.html                          # hoặc mở file trực tiếp (macOS)
```

`flowcheck graph` không có tham số sẽ tìm theo thứ tự: `.flowcheck/graph.json`, rồi `flowcheck/app.graph.json`. Nếu cạnh file graph có `findings.json`, trang hiện cả lỗi.

## Đọc trang

```
┌──────────────────────────────────────────────┬─────────────────────┐
│ ENTRY   1 STEP        2 STEPS                │ /cards/stats        │
│ ┌───┐   ┌────────┐    ┌──────────────┐       │ 6 findings          │
│ │ / │──▶│ /cards │──▶ │/cards/stats ⑥│       │ Snapshot [Both|…]   │
│ └───┘   └────────┘    └──────────────┘       │ How to get here     │
│         ┌╌╌╌╌╌╌╌╌╌╌┐                         │ Actions from here   │
│         ╎/ [Search]╎  (viền đứt = overlay)   │ Ways in             │
└──────────────────────────────────────────────┴─────────────────────┘
```

- **Cột** là số bước tính từ màn gốc. Cột cuối "Not linked" là các màn chỉ tới được qua seed.
- **Ô viền liền** là màn (route); **ô viền đứt** là overlay (dialog, menu); **viền đỏ** là màn có lỗi.
- **Huy hiệu số** ở góc ô: số lỗi (đỏ) và cảnh báo (cam) trên màn đó.
- Dòng nhỏ trong ô: "N out · M in place", nghĩa là N thao tác chuyển màn và M thao tác ở lại màn (chọn tab, gõ chữ, bật công tắc).
- **Đường nối** là các thao tác chuyển màn; càng đậm thì càng nhiều nút dẫn giữa hai màn đó.

Bấm một màn để: tô sáng các màn nối với nó (đi ra màu xanh, đi vào màu tím), và mở panel bên phải.

## Panel của một màn

| Mục | Nội dung |
| --- | --- |
| Findings | Lỗi và cảnh báo trên màn, kèm vị trí |
| Snapshot | Ảnh chụp và wireframe (xem dưới) |
| How to get here | Chuỗi thao tác từ màn gốc tới màn này |
| Actions from here | Mọi thao tác, nhóm theo màn đích; nhãn `delayed` (chuyển trang sau khi tua đồng hồ) và `destructive`; các API mà thao tác gọi |
| Ways in | Các màn có thao tác dẫn vào đây; bấm để nhảy sang |

## Snapshot

- **Both** (mặc định): ảnh chụp màn lúc tool vừa tới, phủ lên là khung của từng nút. Xanh là button, tím là link, cam là ô nhập, xám là loại khác. Rê chuột lên khung để xem tên.
- **Screenshot**: chỉ ảnh. **Wireframe**: chỉ khung.
- **Bấm vào ảnh** để phóng to; Esc để đóng.
- **"N controls"**: snapshot dạng text, đúng định dạng file baseline:

```text
button "Save" @main 640,96 80x32
link "Docs" @nav 12,180 36x36 #shell.Rail.docs
```

Mỗi dòng: role, tên, landmark cha (`@main`), vị trí `x,y` và kích thước `wxh` (làm tròn 4 px), test ID nếu có (`#…`).

## Ảnh chụp

- Chụp mặc định khi chạy trên máy; **tắt mặc định trong CI** (khi có biến `CI`). Bật bằng `--screenshots`, tắt bằng `--no-screenshots`.
- Lưu ở `.flowcheck/screens/*.jpg`, khoảng 30–40 KB mỗi màn.
- Baseline chỉ giữ cấu trúc, nên khi xem baseline sẽ chỉ có wireframe.
- Ảnh chứa đúng những gì app hiển thị, kể cả dữ liệu cá nhân: xem [an toàn](12-an-toan.md).

## Chia sẻ trang

`graph.html` cùng thư mục `screens/` bên cạnh là đủ để xem ở máy khác. Chỉ chia sẻ `graph.html` thì vẫn xem được graph, nhưng không có ảnh.

Tiếp theo: [Baseline](05-baseline.md).
