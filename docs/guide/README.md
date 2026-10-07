# Hướng dẫn sử dụng flowcheck

flowcheck tự đi khắp một web app đang chạy như một người dùng: bấm mọi nút an toàn, gõ vào mọi ô, đi qua mọi màn nó tới được. Sau **mỗi bước** nó phán đúng/sai bằng các bộ kiểm tra xác định (oracle). Kết quả là một bản đồ app (graph) và danh sách lỗi; chạy lại trên cùng commit ra đúng như cũ.

Bộ hướng dẫn này đi theo thứ tự dùng thật: cài, chạy lần đầu, đọc kết quả, rồi tới các tính năng nâng cao.

| # | Trang | Đọc khi |
| --- | --- | --- |
| 1 | [Cài đặt và chạy lần đầu](01-cai-dat.md) | Mới bắt đầu |
| 2 | [Lệnh `check` và cách đọc báo cáo](02-check.md) | Sau lần chạy đầu tiên |
| 3 | [File cấu hình `flowcheck.config.json`](03-cau-hinh.md) | Muốn lưu thiết lập, thêm persona, seed route |
| 4 | [Trang graph và snapshot](04-graph.md) | Muốn *nhìn* app và lỗi |
| 5 | [Baseline: so sánh giữa các lần chạy](05-baseline.md) | Muốn bắt hồi quy (nút biến mất, đổi đích) |
| 6 | [Network: live, record, replay](06-network.md) | App có backend; muốn chạy nhanh, ổn định, đi cả nút nguy hiểm |
| 7 | [Luật nghiệp vụ và file intent](07-luat-intent.md) | Muốn kiểm tra quy tắc nghiệp vụ |
| 8 | [Fuzz](08-fuzz.md) | Muốn tìm chuỗi thao tác hiếm gây lỗi |
| 9 | [Widget adapter](09-adapter.md) | Có widget kéo thả, lịch, gantt, canvas |
| 10 | [Plugin Vite và chạy theo file thay đổi](10-plugin-affected.md) | Muốn PR chạy nhanh |
| 11 | [Chạy trong CI](11-ci.md) | Đưa vào GitHub Actions |
| 12 | [An toàn và dữ liệu nhạy cảm](12-an-toan.md) | Trước khi chạy trên app có dữ liệu thật |
| 13 | [Xử lý sự cố](13-xu-ly-su-co.md) | Khi kết quả lạ, nhiễu, hoặc lệnh lỗi |
| — | [Tham chiếu CLI](tham-chieu-cli.md) | Tra cứu nhanh mọi lệnh và flag |

## Năm phút đầu tiên

```sh
# 1. Cài flowcheck (một lần)
cd ~/Documents/dev/flowcheck && pnpm install && pnpm exec playwright install chromium

# 2. Bật app cần test
cd ~/Documents/dev/my-app && pnpm dev            # ví dụ chạy ở http://localhost:5173

# 3. Quét và mở bản đồ
node ~/Documents/dev/flowcheck/src/cli.ts check --url http://localhost:5173/ --open
```

Lệnh in báo cáo ra terminal, ghi kết quả vào `.flowcheck/` và mở trang graph trên trình duyệt. Có lỗi thì thoát với mã 1.

## Bản đồ khái niệm

| Thuật ngữ | Nghĩa |
| --- | --- |
| **Node (màn)** | Một route cộng lớp phủ đang mở: `/calendar`, `/products [Confirm purchase]`. Đoạn id trong URL gộp thành `:id` |
| **Edge** | Một thao tác (click, gõ chữ, route) và màn nó dẫn tới |
| **Oracle** | Bộ kiểm tra phán một bước đúng hay sai |
| **Context** | Một persona (khách, thành viên…) với các bước setup riêng |
| **Baseline** | Lần chạy đã được chấp nhận, commit trong `flowcheck/`, để so với lần sau |
| **Snapshot** | Danh sách nút trên một màn (role, tên, vị trí), dùng để phát hiện thay đổi |
| **Finding** | Một phát hiện: lỗi (error), cảnh báo (warning) hoặc thông tin (info) |
