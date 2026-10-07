# 12. An toàn và dữ liệu nhạy cảm

flowcheck bấm thật vào app. Trước khi chạy trên môi trường có dữ liệu thật, hiểu rõ nó **không** làm gì và còn rủi ro nào.

## Tool không bao giờ làm

| Hành động | Cách chặn |
| --- | --- |
| Bấm nút phá dữ liệu | Nút có tên chứa delete, remove, erase, wipe, destroy, discard, clear, reset, sign out, log out, unsubscribe, pay, purchase, send, xoá/xóa, đăng xuất… bị bỏ qua ở `live` và `record` |
| Nhấn Enter submit form qua nút nguy hiểm | Ô thuộc form có nút submit nguy hiểm: chỉ gõ, không nhấn Enter |
| Bấm nhầm nút khi tìm lại phần tử | Hai nút khác tên không bao giờ khớp nhau; trước mỗi thao tác, nhãn an toàn được kiểm lại trên chính phần tử tìm được |
| Đi theo link ra site khác | Bỏ qua ở live; ghi thành edge `external:` |
| Mở tab mới | Tab mới bị đóng ngay |

Nhãn an toàn dựa trên **tên nút**. Nút xoá có tên không rõ nghĩa (một icon thùng rác không có `aria-label`) có thể không bị nhận ra. Vì vậy:
- đặt `aria-label` rõ nghĩa cho nút icon (cũng là yêu cầu accessibility);
- chạy trên môi trường test hoặc dùng `--mode replay`, đừng chạy `live` trên production.

## Replay đóng mặc định

Ở `--mode replay`, mọi API call, beacon, form POST ở mọi origin được trả từ bản ghi hoặc bị chặn. Điều hướng ra site khác được thay bằng trang giả; WebSocket sang origin khác bị đóng.

**Còn hở:** điều hướng GET cùng origin vẫn tới server. App server-render có route kiểu "GET /logout" vẫn nhận request đó.

## Dữ liệu ghi xuống đĩa

| File | Chứa gì | Bảo vệ |
| --- | --- | --- |
| `flowcheck/recordings.json` | Response API | Redact: email, token, JWT, bearer, chuỗi dạng secret; key nhạy cảm (password, token, session, cookie, auth, phone, email, address, card…) che **cả giá trị lồng nhau**; body form; body không có content-type; query trong khoá |
| `flowcheck/app.graph.json`, `snapshots/` | Tên hiển thị của nút | Tên được redact ngay khi tạo fingerprint (email, token) |
| `.flowcheck/screens/*.jpg` | Ảnh chụp màn | **Không redact được.** Tắt mặc định trong CI; không upload lên artifact trong workflow mẫu |
| `flowcheck.config.json` | Thông tin đăng nhập của context | Văn bản thường: chỉ dùng tài khoản test |

Trước khi commit:

```sh
git diff flowcheck/recordings.json | less     # xem lại bản ghi
grep -rE "@[a-z0-9-]+\.[a-z]{2,}" flowcheck/  # tìm email còn sót
```

## Chi phí và dịch vụ ngoài

Tool bấm cả các nút gửi yêu cầu tới AI, SMS, email, thanh toán thử nếu chúng không mang tên "nguy hiểm" (ví dụ một câu gợi ý trong chat tự gửi lên model). Luôn chặn:

```json
"block": ["**/api/ai/**", "**/api/sms/**", "https://api.stripe.com/**"]
```

## Khuyến nghị

1. Chạy trên môi trường test với dữ liệu giả.
2. Tài khoản test riêng cho mỗi context.
3. CI dùng `--mode replay`.
4. Không bật `--screenshots` trong CI nếu app hiện dữ liệu cá nhân.
5. Xem lại `recordings.json` trước khi commit.

Tiếp theo: [Xử lý sự cố](13-xu-ly-su-co.md).
