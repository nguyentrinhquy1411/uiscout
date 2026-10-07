# 1. Cài đặt và chạy lần đầu

## Yêu cầu

- **Node 24 trở lên** (flowcheck chạy TypeScript trực tiếp bằng Node khi dev).
- **pnpm** 10.
- Một web app **đang chạy** và mở được bằng trình duyệt (dev server, `vite preview`, staging…).

## Cài flowcheck

```sh
git clone https://github.com/nguyentrinhquy1411/flowcheck.git ~/Documents/dev/flowcheck
cd ~/Documents/dev/flowcheck
pnpm install                          # cài thư viện, tự build dist/
pnpm exec playwright install chromium # trình duyệt dùng để đi app
pnpm test                             # tuỳ chọn: 70 test, khoảng 30 giây
```

## Ba cách gọi flowcheck

### Cách A: gọi thẳng bằng đường dẫn (nhanh nhất, không sửa app)

```sh
cd ~/Documents/dev/my-app
node ~/Documents/dev/flowcheck/src/cli.ts check --url http://localhost:5173/
```

Đặt alias cho gọn (thêm vào `~/.zshrc`):

```sh
alias fc="node ~/Documents/dev/flowcheck/src/cli.ts"
```

Từ đây trở đi, tài liệu viết `flowcheck …`; với cách A hãy đọc là `fc …`.

### Cách B: cài vào app như dev dependency (cần cho luật, adapter, plugin)

File luật (`*.rules.ts`), adapter (`*.adapter.ts`) và plugin Vite import từ `flowcheck/rules`, `flowcheck/adapter`, `flowcheck/vite`. Để các import này tìm thấy package, cài flowcheck vào app:

```sh
cd ~/Documents/dev/my-app
pnpm add -D link:../flowcheck         # trỏ thẳng vào repo bên cạnh; sửa flowcheck là app thấy ngay
pnpm exec flowcheck check --url http://localhost:5173/
```

Với `link:`, sau khi sửa code flowcheck nhớ chạy `pnpm build` trong repo flowcheck để cập nhật `dist/`.

### Cách C: cài từ GitHub

```sh
pnpm add -D github:nguyentrinhquy1411/flowcheck   # repo private: cần quyền truy cập
```

### Thêm script vào app (tuỳ chọn)

```json
{
  "scripts": {
    "fc": "flowcheck check --open",
    "fc:graph": "flowcheck graph --open",
    "fc:update": "flowcheck check --update"
  }
}
```

## Chạy lần đầu

1. Bật app: `pnpm dev`.
2. Đứng ở **thư mục gốc của app** (flowcheck đọc config, luật và intent từ thư mục hiện tại).
3. Chạy:

```sh
flowcheck check --url http://localhost:5173/ --open
```

Nếu app gọi API tốn tiền (AI, SMS, thanh toán thử), chặn chúng ngay từ lần đầu:

```sh
flowcheck check --url http://localhost:5173/ --block "**/api/ai/**" --open
```

## Sau khi chạy

| Kết quả | Ở đâu |
| --- | --- |
| Báo cáo ngắn | In ra terminal, lưu ở `.flowcheck/report.txt` |
| Bản đồ app | `.flowcheck/graph.html` (tự mở với `--open`) |
| Dữ liệu thô | `.flowcheck/graph.json`, `findings.json`, `snapshots.json` |
| Ảnh chụp từng màn | `.flowcheck/screens/*.jpg` |
| Bản markdown cho PR | `.flowcheck/report.md` |

Thêm `.flowcheck/` vào `.gitignore` của app: đó là kết quả mỗi lần chạy, không commit.

Tiếp theo: [Lệnh `check` và cách đọc báo cáo](02-check.md).
