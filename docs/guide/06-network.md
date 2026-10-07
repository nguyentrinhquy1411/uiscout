# 6. Network: live, record, replay

| `--mode` | Backend | Dùng khi |
| --- | --- | --- |
| `live` (mặc định) | Thật | Chạy trên máy, lần đầu. Không bao giờ bấm nút nguy hiểm |
| `record` | Thật | Đi như live, đồng thời lưu mọi response API |
| `replay` | Không có | Trả response từ bản ghi. Nhanh, ổn định, và **đi được cả nút nguy hiểm** |

## Ghi lại

```sh
flowcheck check --mode record
```

- Mọi API call (fetch, XHR, EventSource, beacon, form POST) ở **mọi origin** được lưu vào `flowcheck/recordings.json`.
- Khoá của mỗi bản ghi: phương thức, đường dẫn, query (đã sắp xếp); call khác origin ghi kèm origin. Hai POST cùng đường dẫn khác body được phân biệt bằng hash của body.
- Trước khi ghi, body được **redact**: email, token, JWT, key nhạy cảm (password, token, session, phone, address…) kể cả giá trị lồng nhau; query trong khoá cũng được redact.
- Tool nhắc xem lại file trước khi commit.

## Phát lại

```sh
flowcheck check --mode replay
```

- Mọi API call và form POST được trả lời từ bản ghi, **dù nhắm tới origin nào**.
- Điều hướng sang site khác được thay bằng một trang giả, để vẫn ghi được edge `external:…`.
- WebSocket sang origin khác bị đóng. WebSocket cùng origin (thường là hot reload của dev server) vẫn chạy.
- Chỉ có trang của app và file tĩnh (script, CSS, ảnh, font) được tải thật.
- Call không có bản ghi: trả 599 và báo **cảnh báo** `GET /api/x has no recording (re-record with --mode record)`.

Vì không gì tới được server, replay **đi qua cả nút nguy hiểm** (delete, log out, pay…) và nhấn Enter cả trong form có nút submit nguy hiểm.

## Quy trình đề xuất

```sh
flowcheck check --mode record --update   # ghi và chấp nhận một lần, với backend test
flowcheck check --mode replay --update   # baseline ở mode CI sẽ dùng
git add flowcheck/ && git commit         # sau khi xem lại recordings.json

flowcheck check --mode replay            # mỗi lần sau: nhanh, không cần backend
```

Khi API đổi, chạy lại `--mode record`. Các call báo "has no recording" cho biết bản ghi nào đã cũ.

## Giới hạn

- Replay vẫn cho đi các **điều hướng GET cùng origin**. App server-render có route kiểu "GET /logout" vẫn nhận được request đó.
- Bản ghi là response tĩnh: app phụ thuộc vào thứ tự request (ví dụ tạo rồi đọc lại) có thể thấy dữ liệu khác lúc ghi.

Tiếp theo: [Luật nghiệp vụ và intent](07-luat-intent.md).
