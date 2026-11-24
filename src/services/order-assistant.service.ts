import { ClaudeClientError, getText, type ClaudeClient, type ClaudeErrorKind } from "../clients/claude.client";
import { findOrderById } from "../data/orders";
import type { Order } from "../types/order";

export type OrderAssistantErrorCode =
  | "INVALID_INPUT"
  | "ORDER_NOT_FOUND"
  | "CLAUDE_API_ERROR"
  | "TOOL_LOOP_LIMIT";

export class OrderAssistantError extends Error {
  readonly code: OrderAssistantErrorCode;
  /** Set when code is CLAUDE_API_ERROR: the reason reported by the Claude client. */
  readonly claudeErrorKind?: ClaudeErrorKind;

  constructor(
    code: OrderAssistantErrorCode,
    message: string,
    options: { cause?: unknown; claudeErrorKind?: ClaudeErrorKind } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "OrderAssistantError";
    this.code = code;
    this.claudeErrorKind = options.claudeErrorKind;
  }
}

export interface OrderQuestion {
  orderId: string;
  question: string;
}

export interface OrderAnswer {
  orderId: string;
  answer: string;
}

export const SYSTEM_PROMPT = `You are an AI Order Management Assistant.
Answer order-related questions clearly, using only the order information provided.
Never invent order information. If the answer is not in the order data, say so.`;

/** Trims and validates the input. Throws INVALID_INPUT for empty or non-string values. */
export function normalizeQuestion(input: OrderQuestion): OrderQuestion {
  const orderId = typeof input.orderId === "string" ? input.orderId.trim() : "";
  const question = typeof input.question === "string" ? input.question.trim() : "";

  if (!orderId) {
    throw new OrderAssistantError("INVALID_INPUT", "orderId must be a non-empty string");
  }
  if (!question) {
    throw new OrderAssistantError("INVALID_INPUT", "question must be a non-empty string");
  }
  return { orderId, question };
}

/**
 * Business logic, without tools: look up the order here, put its data in the prompt,
 * ask Claude once, and return the answer. Depends only on the ClaudeClient interface.
 */
export class OrderAssistantService {
  constructor(private readonly claude: ClaudeClient) {}

  async answer(input: OrderQuestion): Promise<OrderAnswer> {
    const { orderId, question } = normalizeQuestion(input);

    const order = findOrderById(orderId);
    if (!order) {
      throw new OrderAssistantError("ORDER_NOT_FOUND", `Order ${orderId} was not found`);
    }

    let answer: string;
    try {
      const response = await this.claude.sendMessage({
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildPrompt(order, question) }],
      });
      answer = getText(response);
    } catch (error) {
      throw new OrderAssistantError("CLAUDE_API_ERROR", "Failed to get an answer from Claude", {
        cause: error,
        claudeErrorKind: error instanceof ClaudeClientError ? error.kind : "UNKNOWN",
      });
    }

    return { orderId: order.orderId, answer };
  }
}

function buildPrompt(order: Order, question: string): string {
  return [
    "Order data (JSON):",
    JSON.stringify(order, null, 2),
    "",
    `Customer question: ${question}`,
  ].join("\n");
}
