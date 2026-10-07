# 8. Fuzz

`check` đi có hệ thống: mỗi nút một lần, từ mỗi màn. Fuzz đi **ngẫu nhiên nhưng lặp lại được**: chuỗi thao tác dài, thứ tự lạ, để tìm lỗi mà không ai nghĩ tới.

```sh
flowcheck fuzz --url http://localhost:5173/ --seed 7 --runs 10 --length 25
```

| Flag | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `--seed <n>` | ngẫu nhiên | Seed của lượt đầu; lượt thứ k dùng seed + k. Cùng seed, cùng đường đi |
| `--runs <n>` | 5 | Số lượt, mỗi lượt trong một browser context mới |
| `--length <n>` | 25 | Số thao tác tối đa mỗi lượt |
| `--block`, `--allow-4xx`, `--mode`, `--baseline`, `--fast-forward`, `--no-rules`, `--out` | như `check` | |

## Fuzz làm gì

1. Mở app, chọn ngẫu nhiên một phần tử an toàn, thao tác (click hoặc gõ + Enter).
2. Sau mỗi bước: chờ trang ổn định, tua đồng hồ, kiểm **luật** và mọi lỗi mức error của oracle chung.
3. Dừng ở lỗi đầu tiên của lượt đó.
4. **Thu gọn**: lần lượt bỏ từng bước, phát lại; nếu lỗi vẫn xảy ra thì giữ bản ngắn hơn. Lặp tới khi không bỏ được nữa.

## Kết quả

```text
flowcheck fuzz (seed 7): 1 failure

  rule savedToastClears
  seed 7, shrunk from 6 to 1 step:
    1. /cart.html.button:save-draft@main
```

Kết quả cũng ghi vào `.flowcheck/fuzz.json`. Thoát với mã 1 nếu có lỗi.

**Tái hiện lỗi:** chạy lại đúng seed (`--seed 7`), hoặc làm tay theo chuỗi đã thu gọn.

## Khi nào dùng

- Chạy hằng đêm, không dùng để chặn PR (thời gian không cố định, và lỗi có thể nằm ngoài phạm vi PR).
- Hiệu quả nhất khi đã có luật: không có luật thì fuzz chỉ bắt crash và lỗi network.

Tiếp theo: [Widget adapter](09-adapter.md).
