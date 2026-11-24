# Order Assistant

Ứng dụng nhỏ dùng Claude API để trả lời câu hỏi về đơn hàng. Dữ liệu là mock data trong code, không kết nối database.

## Công nghệ

Node.js, TypeScript (strict), `@anthropic-ai/sdk`, Vitest, dotenv.

## Cấu trúc

```
src/
├── clients/
│   ├── claude.client.ts              # Interface ClaudeClient, kiểu message/tool, ClaudeClientError
│   └── anthropic-claude.client.ts    # Triển khai bằng Anthropic SDK, phân loại lỗi
├── services/
│   ├── order-assistant.service.ts    # Luồng không dùng tool
│   └── order-tool-assistant.service.ts  # Luồng tool use (vòng lặp)
├── tools/
│   └── order-tools.ts                # Tool get_order và hàm thực thi
├── types/order.ts                    # Kiểu Order
├── data/orders.ts                    # Mock data + findOrderById
├── config.ts                         # Đọc và kiểm tra biến môi trường
└── index.ts                          # Composition Root
tests/                                # Vitest, mock SDK, không gọi API thật
```

## Biến môi trường

| Biến | Bắt buộc | Mặc định | Ý nghĩa |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Có | — | API key |
| `CLAUDE_MODEL` | Có | — | Ví dụ `claude-haiku-5-5` |
| `ANTHROPIC_TIMEOUT_MS` | Không | `30000` | Timeout mỗi request (ms, số nguyên dương) |
| `ANTHROPIC_MAX_RETRIES` | Không | `2` | Số lần SDK retry lỗi tạm thời (số nguyên ≥ 0) |

Giá trị không hợp lệ làm ứng dụng dừng ngay với thông báo lỗi.

## Cài đặt và chạy

```bash
npm install
cp .env.example .env    # điền ANTHROPIC_API_KEY và CLAUDE_MODEL

npm start -- ORD-1002 "Has this order shipped?"           # không tool
npm start -- ORD-1002 "Has this order shipped?" --tools   # Claude tự gọi get_order
```

Không truyền tham số thì mặc định là `ORD-1001` và câu hỏi "What is the status of this order?".

Mock orders: `ORD-1001` (processing), `ORD-1002` (shipped).

| | Không tool (mặc định) | Tool (`--tools`) |
|---|---|---|
| Service | `OrderAssistantService` | `OrderToolAssistantService` |
| Ai tra cứu đơn | Service, trước khi gọi Claude | Claude, qua tool `get_order` |
| Số lần gọi Claude | 1 | Tối đa 5 vòng (`MAX_TOOL_ROUNDS`) |
| Đơn không tồn tại | Trả `ORDER_NOT_FOUND` | Tool báo lỗi, Claude giải thích |

## Xử lý lỗi

Lỗi gọi Claude có code `CLAUDE_API_ERROR`, kèm `claudeErrorKind`: `AUTHENTICATION`, `PERMISSION`, `INVALID_REQUEST`, `RATE_LIMIT`, `TIMEOUT`, `CONNECTION`, `SERVER`, `EMPTY_RESPONSE`, `UNKNOWN`. Tool use có thêm `TOOL_LOOP_LIMIT` khi quá số vòng cho phép.

## Kiểm thử

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
```

## Ghi chú

- Service chỉ phụ thuộc vào interface `ClaudeClient`. Để đổi provider, viết class mới implement interface và đổi dòng khởi tạo trong `index.ts`.
- Không commit `.env` (đã có trong `.gitignore`).
