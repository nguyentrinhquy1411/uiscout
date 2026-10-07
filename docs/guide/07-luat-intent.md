# 7. Luật nghiệp vụ và file intent

Oracle chung chỉ biết app "không hỏng". Luật cho biết app "làm đúng nghiệp vụ": giỏ rỗng thì không đặt hàng được, khách không vào được trang thanh toán, toast lỗi tự tắt.

> Luật import `flowcheck/rules`, nên app cần cài flowcheck như dev dependency (cách B ở [cài đặt](01-cai-dat.md)).

## Viết luật

Tạo file bất kỳ tên `*.rules.ts` (hoặc `.js`, `.mjs`) trong app. Mỗi `export` là một luật; tên export là tên luật.

```ts
// src/cart/cart.rules.ts
import { always, eventually, state, when } from 'flowcheck/rules'

// Bất biến đơn giản: luôn đúng ở mọi trạng thái.
export const countNeverNegative = always(() => ((state.read('cart.count') as number) ?? 0) >= 0)

// Kéo theo: khi điều kiện đúng thì hệ quả phải đúng ngay lúc đó.
export const emptyCartDisablesOrder = always(
  when(() => state.read('cart.count') === 0)
    .then(() => state.element('cart.order').disabled),
)

// Kéo theo có thời hạn: khi điều kiện đúng, hệ quả phải xảy ra trong 5 giây.
export const errorToastClears = always(
  when(() => state.element('cart.toast').visible)
    .then(eventually(() => !state.element('cart.toast').visible).within(5, 'seconds')),
)

// Theo persona: khách không bao giờ tới trang thanh toán.
export const guestCannotCheckout = always(
  when(() => state.context.is('guest')).then(() => !state.node.is('/checkout')),
)
```

## `state` đọc được gì

| Biểu thức | Trả về |
| --- | --- |
| `state.context.is('guest')` | Đang ở context đó không |
| `state.node.is('/checkout')` | Màn hiện tại có đúng ID đó không |
| `state.node.is('/products*')` | Màn hiện tại có bắt đầu bằng tiền tố đó không |
| `state.node.id` | ID màn hiện tại |
| `state.url` | Đường dẫn + query |
| `state.element(id).visible` / `.exists` | Phần tử đang hiện không |
| `state.element(id).disabled` | Phần tử có bị disable không |
| `state.element(id).name` | Tên hiển thị |
| `state.read(key)` | Giá trị app tự công bố (xem dưới) |

`id` của `state.element` là:
- `data-testid` của phần tử (khuyên dùng), hoặc `data-fc-id` từ [plugin](10-plugin-affected.md);
- hoặc ID fingerprint như `/cart.button:place-order@main` (xem trong `graph.json` hoặc panel của trang graph).

Phần tử có `data-testid` được thấy **kể cả khi không bấm được** (toast, badge, nhãn số lượng).

## App công bố giá trị cho luật

Trong bản build test (hoặc luôn luôn, vì không tốn gì khi không có runner):

```ts
// Runner tạo window.__flowcheck trước khi app tải; production không có object này.
const hook = (window as { __flowcheck?: { read?: () => Record<string, unknown> } }).__flowcheck
if (hook) hook.read = () => ({ 'cart.count': cart.items.length, 'user.role': session.role })
```

Gọi `read()` mỗi lần tool chụp trạng thái, nên trả giá trị hiện tại, không cache.

## Luật được kiểm khi nào

- `check`: trên mọi đường đi tool đi qua. Mỗi đường là một chuỗi trạng thái: lúc tải trang, sau mỗi bước của đường đi, trước và sau thao tác, và sau khi tua đồng hồ.
- `fuzz`: trên các đường đi ngẫu nhiên ([fuzz](08-fuzz.md)).

Thời gian trong `within()` là đồng hồ của trang, đã tính cả lần tua, nên không phải chờ thật.

## Kết quả

```text
Errors (1)
  rule         emptyCartDisablesOrder: condition held on /cart.html but the consequence did not
               at /cart.html → click /cart.html.button:add-item@main
               via load → click … → (before)
```

- Vi phạm là **lỗi**, kèm chuỗi bước từ đầu dẫn tới (`via`).
- Luật ném exception: báo `threw: …`, không bị nuốt.
- `eventually` mà đường đi kết thúc trước khi hết hạn: không kết luận, không báo lỗi.

## File intent: nghiệp vụ bằng tiếng thường

Tạo `*.intent.md` cạnh module. Mỗi dòng gạch đầu dòng là một câu nghiệp vụ, gắn tên luật trong comment:

```md
# Giỏ hàng

- Giỏ rỗng thì khoá nút "Đặt hàng".     <!-- rule: emptyCartDisablesOrder -->
- Toast lỗi tự tắt.                      <!-- rule: errorToastClears -->
- Số lượng không bao giờ âm.             <!-- rule: countNeverNegative -->
- Thanh toán phải đăng nhập.             <!-- rule: pending -->
- Mã giảm giá chỉ dùng một lần.
```

Báo cáo hiện **Intent coverage**:

```text
Intent coverage 2 of 5 lines
  ✗ failing   src/cart/cart.intent.md:3  Giỏ rỗng thì khoá nút "Đặt hàng".  (emptyCartDisablesOrder)
  ✓ linked    src/cart/cart.intent.md:4  Toast lỗi tự tắt.  (errorToastClears)
  ✓ linked    src/cart/cart.intent.md:5  Số lượng không bao giờ âm.  (countNeverNegative)
  · pending   src/cart/cart.intent.md:6  Thanh toán phải đăng nhập.
  · pending   src/cart/cart.intent.md:7  Mã giảm giá chỉ dùng một lần.
```

| Trạng thái | Nghĩa |
| --- | --- |
| `linked` | Luật đã chạy trên ít nhất một đường đi và pass |
| `failing` | Luật bị vi phạm |
| `pending` | Chưa có luật (comment `rule: pending` hoặc không có comment) |
| `stale` | Trỏ tới luật không file nào export: cảnh báo |
| `unchecked` | Có luật, nhưng chưa đường đi nào chạy tới |

Quy trình gợi ý: người làm sản phẩm viết câu, dev viết luật và gắn tên, review trong PR.

## Lưu ý

- Luật và intent được tìm **trong thư mục hiện tại** (bỏ qua `node_modules`, `.git`, `dist`, `build`, `.flowcheck`, `coverage`). Luôn chạy từ thư mục gốc app.
- Tắt cả luật và intent: `--no-rules`.

Tiếp theo: [Fuzz](08-fuzz.md).
