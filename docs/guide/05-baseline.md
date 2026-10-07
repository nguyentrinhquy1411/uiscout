# 5. Baseline: so sánh giữa các lần chạy

Oracle A bắt lỗi "app hỏng". Baseline bắt lỗi "app khác với hôm qua": một nút biến mất, một link đổi đích, một màn không còn tới được.

## Vòng làm việc

```sh
flowcheck check --update        # 1. chấp nhận trạng thái hiện tại làm baseline
git add flowcheck/ && git commit -m "flowcheck baseline"

# ... sửa code ...

flowcheck check                 # 2. so với baseline: lệch là báo
git diff flowcheck/             # 3. nếu thay đổi là cố ý:
flowcheck check --update        #    chấp nhận lại, review diff, commit
```

## Baseline gồm gì

Thư mục `flowcheck/` (đổi bằng `--baseline <dir>` hoặc khoá `baseline` trong config):

| File | Nội dung | Commit |
| --- | --- | --- |
| `app.graph.json` | Toàn bộ màn và edge, sắp xếp cố định | Có |
| `snapshots/<màn>.txt` | Mỗi màn (và mỗi context) một file, mỗi dòng một nút | Có |
| `paths.json` | Đường đi tới từng màn, để chạy riêng một số màn | Có |
| `recordings.json` | Response API khi chạy `--mode record` ([network](06-network.md)) | Có, sau khi xem lại |

`git diff flowcheck/` chính là phần review: dòng mất trong snapshot là nút biến mất, edge mất trong graph là đường đi biến mất.

## Những gì bị báo

| Thay đổi | Mức | Ví dụ thông điệp |
| --- | --- | --- |
| Nút biến mất | Lỗi | `button "Load data" is gone` |
| Nút đổi role hoặc tên | Lỗi | `button "Count 0" became button "Counter 0"` |
| Thao tác dẫn tới màn khác | Lỗi | `now leads to /dialog.html, was /` |
| Graph thêm/bớt màn hoặc edge mà chưa `--update` | Lỗi | `flowcheck/app.graph.json is out of date (3 nodes or edges changed)` |
| Nút dịch chuyển hoặc đổi kích thước > 16 px | Cảnh báo | `button "Save" moved or resized: … → …` |
| Nút mới | Info | `link "Export" is new` |

Phần **Graph diff** ở đầu báo cáo liệt kê màn và edge được thêm (`+`), bị bỏ (`-`) hoặc đổi đích (`~`).

## So hai graph bất kỳ

```sh
flowcheck diff old.graph.json new.graph.json   # thoát 1 nếu khác nhau
```

## Làm baseline ổn định

Baseline chỉ có ích khi hai lần chạy cùng một commit cho cùng kết quả. Cần:

1. **Cố định thời gian:** `"now": "2026-10-07T09:00:00+07:00"`. Không có thì ngày, "hôm nay", vạch giờ hiện tại làm snapshot đổi mỗi ngày.
2. **Dữ liệu giống nhau mỗi lần:** seed cố định, database test, hoặc demo data của app.
3. **Chặn thứ biến động:** API ngoài, quảng cáo, analytics (`block`).
4. **Tạo baseline ở đúng mode CI dùng:** replay đi được nhiều edge hơn live.

Kiểm tra độ ổn định trước khi commit:

```sh
flowcheck check --update
flowcheck check          # phải ra "Graph diff (no change)"
flowcheck check          # và lần nữa
```

Đã đo: app calendar ở depth 2 (31 màn, 352 edge) chạy lại hai lần không lệch.

Nếu vẫn lệch, xem phần [baseline không ổn định](13-xu-ly-su-co.md#baseline-không-ổn-định) trong trang xử lý sự cố.

Tiếp theo: [Network](06-network.md).
