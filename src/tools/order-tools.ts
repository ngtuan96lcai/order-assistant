import type { ClaudeToolResult, ClaudeToolUse, ToolDefinition } from "../clients/claude.client";
import { findOrderById } from "../data/orders";

export const GET_ORDER_TOOL: ToolDefinition = {
  name: "get_order",
  description:
    "Retrieve an order by its ID. Returns the order's status, creation date and stock availability, or an error if no order matches.",
  inputSchema: {
    type: "object",
    properties: {
      order_id: {
        type: "string",
        description: "The unique order ID, for example ORD-1001.",
      },
    },
    required: ["order_id"],
  },
};

/** All tools offered to Claude. */
export const TOOL_DEFINITIONS: ToolDefinition[] = [GET_ORDER_TOOL];

/** Runs a tool requested by Claude. Unknown tools and bad input become error results, not exceptions. */
export function executeTool(toolUse: ClaudeToolUse): ClaudeToolResult {
  const output = runTool(toolUse.name, toolUse.input);
  return {
    type: "tool_result",
    toolUseId: toolUse.id,
    content: JSON.stringify(output.body),
    isError: output.isError,
  };
}

function runTool(name: string, input: Record<string, unknown>): { body: unknown; isError: boolean } {
  if (name !== GET_ORDER_TOOL.name) {
    return { body: { error: `Unknown tool: ${name}` }, isError: true };
  }

  const orderId = typeof input.order_id === "string" ? input.order_id.trim() : "";
  if (!orderId) {
    return { body: { error: "order_id is required and must be a non-empty string" }, isError: true };
  }

  const order = findOrderById(orderId);
  if (!order) {
    return { body: { error: `Order ${orderId} not found` }, isError: true };
  }
  return { body: order, isError: false };
}
