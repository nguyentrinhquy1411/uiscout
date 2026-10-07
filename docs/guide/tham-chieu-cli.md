# Tham chiếu CLI

```text
flowcheck check    [--url <url>] [options]
flowcheck graph    [<graph.json>] [--open] [--out <dir>]
flowcheck diff     <before.graph.json> <after.graph.json>
flowcheck fuzz     [--url <url>] [--seed <n>] [--runs <n>] [--length <n>]
flowcheck adapters [--url <url>] [--dir <dir>] [--seed <n>] [--runs <n>] [--length <n>]
flowcheck --help
```

Mọi lệnh đọc `./flowcheck.config.json` nếu có; flag ghi đè giá trị trong file.

## `flowcheck check`

Đi app, chạy mọi oracle, so với baseline nếu có, ghi kết quả.

| Flag | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `--config <file>` | `./flowcheck.config.json` nếu có | File cấu hình |
| `--url <url>` | từ config | URL gốc của app đang chạy |
| `--out <dir>` | `.flowcheck` | Thư mục kết quả |
| `--depth <n>` | 2 | Số thao tác tối đa tính từ màn gốc |
| `--max-steps <n>` | 250 | Tổng số thao tác |
| `--seeds <paths>` | — | Route không link nào dẫn tới, cách nhau bởi dấu phẩy |
| `--now <iso>` | giờ thật | Thời điểm app bắt đầu |
| `--tz <zone>` | `Asia/Ho_Chi_Minh` | Múi giờ trình duyệt |
| `--allow-4xx <list>` | — | 4xx được cho phép: `404`, `GET /api/me` |
| `--block <globs>` | — | URL bị chặn |
| `--allow-overlap <css>` | — | Phần tử được phép chồng nhau |
| `--fast-forward <ms>` | 5000 | Tua đồng hồ sau mỗi bước; 0 = tắt |
| `--no-a11y` | bật | Bỏ kiểm tra axe |
| `--no-rules` | bật | Bỏ luật và intent |
| `--concurrency <n>` | 4 | Số màn chạy song song |
| `--mode <mode>` | `live` | `live`, `record`, `replay` |
| `--baseline <dir>` | `./flowcheck` | Thư mục baseline |
| `--update` | — | Chấp nhận lần chạy làm baseline |
| `--affected <ref>` | — | Chỉ chạy màn dựng từ file đổi so với `<ref>` |
| `--open` | — | Mở trang graph khi xong |
| `--screenshots` | bật (tắt khi có `CI`) | Chụp ảnh từng màn |
| `--no-screenshots` | — | Không chụp ảnh |
| `--headed` | — | Hiện cửa sổ trình duyệt |
| `-h`, `--help` | — | In hướng dẫn |

Ghi vào `--out`: `graph.json`, `findings.json`, `snapshots.json`, `report.txt`, `report.md`, `graph.html`, `screens/`. Với `--update`: ghi baseline vào `--baseline`. Với `--mode record`: ghi `recordings.json` vào `--baseline`.

## `flowcheck graph`

Sinh trang graph từ một graph đã có, không chạy app.

| Tham số / flag | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `<graph.json>` | `.flowcheck/graph.json`, rồi `flowcheck/app.graph.json` | Graph cần xem |
| `--out <dir>` | `.flowcheck` | Nơi ghi `graph.html` |
| `--open` | — | Mở trên trình duyệt |

Findings lấy từ `findings.json` cạnh graph nếu có; snapshot lấy từ `snapshots.json` (lần chạy) hoặc `snapshots/` (baseline); ảnh từ `screens/` cạnh graph.

## `flowcheck diff`

So hai graph: màn và edge thêm, bớt, đổi đích. Thoát 1 nếu khác nhau.

## `flowcheck fuzz`

| Flag | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `--seed <n>` | ngẫu nhiên | Seed lượt đầu; lượt k dùng seed + k |
| `--runs <n>` | 5 | Số lượt |
| `--length <n>` | 25 | Số thao tác mỗi lượt |
| `--url`, `--block`, `--allow-4xx`, `--mode`, `--baseline`, `--fast-forward`, `--no-rules`, `--out` | như `check` | |

Ghi `fuzz.json` vào `--out`.

## `flowcheck adapters`

| Flag | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `--dir <dir>` | `.` | Nơi tìm `*.adapter.ts` |
| `--seed <n>` | ngẫu nhiên | Seed lượt đầu |
| `--runs <n>` | 5 | Số lượt mỗi adapter |
| `--length <n>` | 20 | Số thao tác mỗi lượt |
| `--url`, `--now` | từ config | Như `check` |

## Mã thoát

| Mã | `check` | `diff` | `fuzz` / `adapters` | `graph` |
| --- | --- | --- | --- | --- |
| 0 | Không có lỗi | Giống nhau | Không thất bại | Đã ghi trang |
| 1 | Có lỗi | Khác nhau | Có thất bại | — |
| 2 | Sai cách dùng hoặc sự cố | như trái | như trái | Không tìm thấy graph |

## Import từ code

| Đường dẫn | Dùng cho |
| --- | --- |
| `flowcheck/rules` | `always`, `when`, `eventually`, `state` trong `*.rules.ts` |
| `flowcheck/adapter` | Kiểu `WidgetAdapter` cho `*.adapter.ts` |
| `flowcheck/vite` | Plugin `flowcheckIds()` |
