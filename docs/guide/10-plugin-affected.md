# 10. Plugin Vite và chạy theo file thay đổi

Không cần sửa app, flowcheck nhận diện nút bằng fingerprint (role, tên, landmark, vị trí). Plugin Vite thêm hai thứ: ID ổn định hơn, và biết mỗi màn được dựng từ file nào. Thứ hai cho phép PR chỉ chạy những màn bị ảnh hưởng.

## Cài plugin

```ts
// vite.config.ts
import { flowcheckIds } from 'flowcheck/vite'

export default defineConfig(({ mode }) => ({
  plugins: [mode === 'test' && flowcheckIds(), react()],
}))
```

Chạy app ở mode test để plugin có tác dụng, ví dụ `vite --mode test` hoặc `vite build --mode test && vite preview`.

Tuỳ chọn:

| Tuỳ chọn | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `include` | file `.jsx`/`.tsx` trong `src/` | Regex chọn file được gắn |
| `root` | gốc Vite | Đường dẫn trong `data-fc-src` tính từ đây |

## Plugin gắn gì

Vào mọi phần tử tương tác trong JSX (button, a, input, select, textarea, phần tử có `onClick`/`onKeyDown`/`role`/`tabIndex`, component tên kiểu `…Button`, `Link`, `…Trigger`, `…Item`…):

```html
<button data-fc-src="src/features/cart/CartSummary.tsx:48"
        data-fc-id="cart.CartSummary.submitOrder">Place order</button>
```

| Thuộc tính | Cách tạo | Dùng để |
| --- | --- | --- |
| `data-fc-src` | Đường dẫn file và dòng | Biết màn nào dựng từ file nào |
| `data-fc-id` | `<module>.<Component>.<gợi ý>` | ID ổn định; đổi chữ trên nút không đổi ID |

Gợi ý lấy theo thứ tự: tên handler (`onClick={submitOrder}` → `submitOrder`; `() => navigate('/checkout')` → `navigateCheckout`), `aria-label`, rồi chữ trên nút. Setter kiểu `setZoom` nhường cho nhãn. Không bao giờ dựa vào vị trí. Phần tử đã có `data-testid` giữ nguyên test ID đó.

## Chạy theo file thay đổi

1. Tạo baseline với app **đã bật plugin**: `flowcheck check --update`. Mỗi màn trong `app.graph.json` có danh sách `sources`.
2. Trên nhánh tính năng:

```sh
flowcheck check --affected origin/main
```

Tool lấy các file đổi so với `origin/main` (kể cả chưa commit), chọn các màn dựng từ những file đó **cộng các màn đứng ngay trước** chúng, phát lại đường đi tới từng màn, và chỉ so phần đó của baseline.

```text
  affected: 5 of 10 screens, from 1 changed file
```

Tool **chạy toàn bộ** và nói lý do khi không chắc:

| Thông điệp | Nguyên nhân |
| --- | --- |
| `full run: src/store.ts not tied to any screen` | File đổi là code dùng chung (store, hook, CSS chung, config): có thể ảnh hưởng mọi màn |
| `full run: the baseline has no source witnesses` | Baseline tạo khi chưa có plugin |
| `full run: no recorded path to /x` | Thiếu đường đi trong `paths.json` |
| `full run: no baseline to select from` | Chưa có baseline |
| `nothing to walk` | Không file mã nguồn nào đổi (chỉ docs): thoát 0 |

Đo trên app mẫu: sửa một file thì chạy 5/10 màn, 25 giây thay vì 42, bắt đủ lỗi.

Đường dẫn file được tính từ thư mục hiện tại, nên chạy từ gốc app (kể cả khi app nằm trong monorepo).

Tiếp theo: [Chạy trong CI](11-ci.md).
