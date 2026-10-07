# 9. Widget adapter

Lưới lịch, gantt, bảng kéo thả, canvas: thao tác ở đó là kéo, đổi kích thước, zoom, và đúng/sai nằm trong dữ liệu, không nằm ở việc "bấm nút có lỗi không". Một **adapter** mô tả widget đó cho flowcheck.

> Adapter import kiểu từ `flowcheck/adapter`: cài flowcheck vào app (cách B ở [cài đặt](01-cai-dat.md)).

## Bốn phần của một adapter

```ts
// src/planning/gantt.adapter.ts
import type { Page } from 'playwright'
import type { WidgetAdapter } from 'flowcheck/adapter'

interface Task { id: string; start: number; end: number }
interface State { tasks: Task[]; boxes: Record<string, { left: number; width: number }> }
type Actions = { move: { id: string; minutes: number } }

export default {
  id: 'planning.Gantt',
  harness: '/planning',                 // trang dựng widget với dữ liệu mẫu

  // 1. Đọc trạng thái: qua debug hook app công bố, cộng đo DOM.
  async read(page) {
    const tasks = await page.evaluate(() => window.__flowcheck.gantt.getState())
    const boxes = await page.evaluate(() => /* đo vị trí từng thanh */ ({}))
    return { tasks, boxes }
  },

  // 2. Thao tác bằng chuột/phím thật.
  actions: {
    async move(page, { id, minutes }) {
      const box = (await page.locator(`[data-task="${id}"]`).boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + minutes, box.y + box.height / 2, { steps: 6 })
      await page.mouse.up()
    },
  },

  // 3. Các thao tác hợp lệ từ trạng thái hiện tại; runner chọn một bằng seed.
  generate: (state, random) =>
    state.tasks.map((t) => ({ action: 'move', args: { id: t.id, minutes: (Math.floor(random() * 9) - 4) * 30 } })),

  // 4. Bất biến sau mỗi thao tác: trả true, hoặc chuỗi mô tả vi phạm.
  invariants: [
    (_, next) => next.tasks.every((t) => t.end > t.start) || 'a task ends before it starts',
    (prev, next, step) => {
      const moved = (step.args as Actions['move']).id
      for (const t of next.tasks) {
        const before = prev.tasks.find((p) => p.id === t.id)!
        if (t.end - t.start !== before.end - before.start) return `moving ${moved} changed the duration of ${t.id}`
      }
      return true
    },
  ],
} satisfies WidgetAdapter<State, Actions>
```

| Phần | Bắt buộc | Ghi chú |
| --- | --- | --- |
| `id` | Có | Tên widget, hiện trong báo cáo |
| `harness` | Có | Đường dẫn trang chứa widget, tính từ `--url` |
| `setup(page)` | Không | Chạy một lần sau khi tải trang, ví dụ chờ dữ liệu sẵn sàng |
| `read(page)` | Có | Trạng thái ngữ nghĩa của widget |
| `actions` | Có | Mỗi thao tác là một hàm nhận `page`, tham số, trạng thái hiện tại |
| `generate(state, random)` | Có | Danh sách thao tác hợp lệ; dùng `random()` chứ không dùng `Math.random()` để seed có tác dụng |
| `invariants` | Có | Mảng hàm `(prev, next, step) => true \| string` |

## Debug hook trong app

Runner tạo `window.__flowcheck` **trước khi app tải**. App chỉ công bố hook khi object này tồn tại, nên production không bị ảnh hưởng:

```ts
useEffect(() => {
  const hook = (window as { __flowcheck?: Record<string, unknown> }).__flowcheck
  if (!hook) return
  hook.gantt = { getState: () => tasksRef.current.map((t) => ({ id: t.id, start: t.start, end: t.end })) }
  return () => { delete hook.gantt }
}, [])
```

Hook là cách bền nhất để đọc trạng thái: không phải đoán pixel, và dùng được cả với widget vẽ bằng canvas.

## Chạy

```sh
flowcheck adapters --url http://localhost:5173/ --seed 11 --runs 6 --length 12
flowcheck adapters --url http://localhost:5173/ --dir src/planning   # chỉ tìm trong thư mục này
```

| Flag | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `--dir <dir>` | `.` | Nơi tìm `*.adapter.ts` |
| `--seed`, `--runs`, `--length` | ngẫu nhiên, 5, 20 | Như fuzz |
| `--now <iso>` | — | Cố định thời gian |

Kết quả:

```text
flowcheck adapters (seed 11)
calendar.TimeGrid: 1 failure
  moving Lunch changed its duration: 60 → 45 min
  seed 12, shrunk from 7 to 1 action:
    1. move {"id":"3","minutes":15}
```

Thao tác không thực hiện được (ví dụ không tìm thấy điểm để kéo) cũng được báo là thất bại, không làm sập lượt chạy.

## Mẹo viết adapter

- **Bấm vào điểm thực sự trúng phần tử.** Phần tử chồng nhau (event xếp cascade) thì tâm của một khối có thể thuộc khối nằm trên. Dùng `document.elementFromPoint` để chọn điểm.
- **`generate` chỉ đề xuất thao tác làm được.** Lọc phần tử ngoài màn hình, bị che, quá nhỏ để kéo.
- **Kéo qua nhiều bước** (`{ steps: 4 }`) để thư viện kéo thả nhận đủ sự kiện dragover; chờ một khung hình trước khi thả.
- **Bất biến nên so `prev` với `next`**, không chỉ nhìn `next`: "các phần tử khác không đổi" bắt được nhiều lỗi nhất.
- **Kiểm tra adapter trên app sạch trước:** chạy vài seed, không được có vi phạm. Có vi phạm thì thường là lỗi thao tác của adapter, không phải của app.

## Ví dụ có sẵn

[`examples/calendar/timegrid.adapter.ts`](../../examples/calendar/timegrid.adapter.ts): lưới giờ của app calendar (kéo, đổi độ dài, zoom; 5 bất biến). App cần hook `window.__flowcheck.calendar`, có trên nhánh `flowcheck-hooks` của repo calendar.

Tiếp theo: [Plugin Vite và chạy theo file thay đổi](10-plugin-affected.md).
