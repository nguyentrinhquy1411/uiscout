# 13. Xử lý sự cố

## Lệnh không chạy

| Triệu chứng | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| `Executable doesn't exist … chromium` | Chưa cài trình duyệt Playwright | `pnpm exec playwright install chromium` (CI: thêm `--with-deps`) |
| `SyntaxError` hoặc `ERR_UNKNOWN_FILE_EXTENSION` với file `.ts` | Node cũ hơn 24 | Nâng Node lên 24 |
| `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` | Chạy bản TypeScript từ trong `node_modules` | Dùng `pnpm exec flowcheck` (bản build `dist/`), hoặc chạy `pnpm build` trong repo flowcheck |
| `Cannot find package 'flowcheck'` trong file luật/adapter | App chưa cài flowcheck | `pnpm add -D link:../flowcheck` |
| In ra hướng dẫn rồi thoát 2 | Thiếu `--url` và không có config, hoặc sai tên lệnh | Thêm `--url`, hoặc tạo `flowcheck.config.json` |
| `net::ERR_CONNECTION_REFUSED` | App chưa chạy, hoặc sai cổng | Bật app, kiểm tra URL |

## Kết quả lạ

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| Chỉ 1 màn, 0 edge | Màn gốc có một overlay chặn (banner cookie, onboarding, toast modal) | Đóng nó trong `setup` của context (`{ "click": "Accept" }`), hoặc kiểm tra app |
| Nhiều `Click failed: … intercepts pointer events` | Một lớp phủ trong suốt che giao diện | Xem phần tử được nêu trong thông điệp; thường là lỗi thật |
| Nhiều `not-found` | Bước trước đổi trạng thái lâu dài (thu sidebar, đổi tab trong localStorage) | Tool đã mở context mới khi reset; nếu vẫn còn, báo kèm `findings.json` |
| Nhiều `layout … overlaps` ở widget xếp chồng theo thiết kế | Chồng nhau là có chủ đích | `--allow-overlap "<selector>"` |
| `console.error` từ thư viện ngoài | Không phải lỗi app | `"ignoreConsole": ["chuỗi"]` |
| `GET /api/x returned 401/404` ở lần đầu tải | Kiểm tra phiên đăng nhập là bình thường | `--allow-4xx "GET /api/x"` |
| Lỗi 429 từ API ngoài | Tool gọi dịch vụ thật quá nhiều | `--block` URL đó |
| `Never settled` dài | Đồng hồ đếm giây, animation vô hạn | Bình thường; chỉ làm chậm |
| Lỗi chỉ xuất hiện trong `Flaky` | Phụ thuộc thứ tự thao tác trước đó | Không chặn run; xem nếu lặp lại |
| Luật của project khác bị nạp | Chạy từ sai thư mục | Luôn chạy từ thư mục gốc app |
| `intent line links to rule "x", which no rules file exports` | Đổi tên hoặc xoá luật | Sửa comment trong `*.intent.md` |

## Baseline không ổn định

Lần chạy lại báo `Graph diff` dù code không đổi:

| Dấu hiệu | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Snapshot đổi ngày giờ | Thời gian thật | `"now": "…"` |
| Phần tử danh sách đổi thứ tự | App sắp xếp không ổn định (hai mục trùng khoá) | Thêm tiêu chí phụ khi sắp xếp trong app |
| Edge `~` đổi đích qua lại giữa các lần | Thao tác phụ thuộc thời điểm (dialog đóng/mở chưa xong) | Chạy lại 2–3 lần để xác nhận; nếu là lỗi thật của app, sửa app |
| Nhiều edge `-` biến mất | Hết `--max-steps` | Tăng `maxSteps` |
| Dữ liệu khác mỗi lần | Backend thật thay đổi | Dùng `--mode replay` |

Cách kiểm: `flowcheck check --update`, rồi `flowcheck check` hai lần; cả hai phải ra "(no change)".

## Chậm

| Cách | Hiệu quả |
| --- | --- |
| `--no-a11y --fast-forward 0` | Bớt khoảng 40% |
| `--affected origin/main` | Chỉ chạy màn bị ảnh hưởng |
| `--mode replay` | Không chờ backend |
| Giảm `--depth` | Bớt màn sâu |
| Chạy trên bản build | Nhanh hơn dev server |

Tăng `--concurrency` ít tác dụng khi một màn có rất nhiều nút, vì các bước trong một màn chạy tuần tự.

## Xem tool đang làm gì

```sh
flowcheck check --url … --headed --concurrency 1   # hiện cửa sổ trình duyệt, một màn một lúc
```

Các dòng tiến độ (`node /x (depth 1)`) được in ra stderr. Chi tiết mọi finding, phần tử bỏ qua, healed, flaky nằm trong `.flowcheck/findings.json`.
