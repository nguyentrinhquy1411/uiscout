# 3. File cấu hình `flowcheck.config.json`

Đặt file ở thư mục gốc của app; `flowcheck check` tự đọc. Flag trên dòng lệnh luôn **ghi đè** giá trị trong file. Dùng file khác: `--config path/to/file.json`.

## Ví dụ đầy đủ

```json
{
  "url": "http://localhost:5173/",
  "depth": 2,
  "maxSteps": 600,
  "concurrency": 4,
  "now": "2026-10-07T09:00:00+07:00",
  "timezone": "Asia/Ho_Chi_Minh",
  "seeds": ["/legacy", "/no-such-page", "/account"],
  "contexts": [
    { "name": "guest" },
    { "name": "member", "setup": [
      { "route": "/login" },
      { "fill": "Email", "text": "demo@example.com" },
      { "fill": "Password", "text": "demo-password" },
      { "click": "Log in" }
    ] }
  ],
  "block": ["**/api/ai/**"],
  "allow4xx": ["GET /api/me"],
  "allowOverlap": "[data-event-id]",
  "ignoreConsole": ["Download the React DevTools"],
  "fillText": "flowcheck",
  "fastForwardMs": 5000,
  "a11y": true,
  "network": "live",
  "baseline": "flowcheck"
}
```

## Các khoá

| Khoá | Kiểu | Mặc định | Ý nghĩa |
| --- | --- | --- | --- |
| `url` | string | — | URL gốc của app |
| `depth` | number | 2 | Số thao tác tối đa tính từ màn gốc |
| `maxSteps` | number | 250 | Tổng số thao tác |
| `concurrency` | number | 4 | Số màn khám phá song song |
| `now` | string (ISO) | giờ thật | Thời điểm app bắt đầu; cố định để chạy lại ra như cũ |
| `timezone` | string | `Asia/Ho_Chi_Minh` | Múi giờ trình duyệt |
| `seeds` | string[] | — | Route không link nào dẫn tới (xem dưới) |
| `contexts` | object[] | một context `default` | Persona và bước setup (xem dưới). **Chỉ cấu hình được trong file** |
| `block` | string[] | — | URL glob bị chặn trước khi rời trình duyệt |
| `allow4xx` | string[] | — | 4xx được cho phép: `"404"` hoặc `"GET /api/me"` |
| `allowOverlap` | string | — | Selector CSS các phần tử được phép chồng nhau |
| `ignoreConsole` | string[] | — | Bỏ qua `console.error` chứa chuỗi này |
| `fillText` | string | `flowcheck` | Chữ gõ vào ô nhập |
| `fastForwardMs` | number | 5000 | Tua đồng hồ sau mỗi bước; 0 để tắt |
| `a11y` | boolean | true | Bật/tắt kiểm tra axe |
| `network` | string | `live` | `live`, `record` hoặc `replay` ([network](06-network.md)) |
| `baseline` | string | `flowcheck` | Thư mục baseline ([baseline](05-baseline.md)) |

## Contexts (persona)

Mỗi context có tên và danh sách bước setup. Các bước chạy lại sau **mỗi** lần tool tải trang, nên dùng được cả với app chỉ giữ đăng nhập trong bộ nhớ.

| Bước | Ví dụ | Làm gì |
| --- | --- | --- |
| `goto` | `{ "goto": "/login" }` | Tải trang đầy đủ (mất trạng thái trong bộ nhớ) |
| `route` | `{ "route": "/login" }` | Điều hướng trong app qua history API, không reload. Ưu tiên dùng cái này cho SPA |
| `fill` | `{ "fill": "Email", "text": "a@b.c" }` | Gõ vào ô có label hoặc placeholder đó |
| `click` | `{ "click": "Log in" }` | Bấm button/link có tên đó; không có thì tìm theo chữ |
| `press` | `{ "press": "Enter" }` | Nhấn phím |
| `eval` | `{ "eval": "localStorage.setItem('token','x')" }` | Chạy JavaScript trong trang |

Khi có từ 2 context trở lên:
- báo cáo ghi `[guest]`, `[member]` trước vị trí xảy ra;
- graph ghi context nào thấy màn và edge nào; trang graph có bộ lọc theo context;
- setup hỏng thì tool báo lỗi `transition` kèm số thứ tự bước, không đi tiếp trong trạng thái sai.

**Mẹo:** dùng tài khoản demo riêng cho test, không dùng tài khoản thật. Mật khẩu trong config là văn bản thường; nếu cần giấu, đặt nó trong localStorage qua `eval` từ biến môi trường, hoặc chạy ở môi trường test.

## Seed route

Route không có link nào dẫn tới (trang 404, URL cũ được redirect, trang ẩn) mà vẫn cần kiểm:

```json
"seeds": ["/legacy", "/no-such-page", "/account"]
```

Tool vào chúng qua history API từ màn gốc (có fallback tải trang). Seed bị redirect sẽ được ghi thành edge `route`, ví dụ `/legacy → /pricing` hoặc với khách `/account → /login`.

Tiếp theo: [Trang graph và snapshot](04-graph.md).
