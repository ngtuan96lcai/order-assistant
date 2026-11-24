import { describe, expect, it } from "vitest";
import { executeTool } from "../src/tools/order-tools";

describe("executeTool", () => {
  it("returns the order as JSON for get_order with a valid ID", () => {
    const result = executeTool({ type: "tool_use", id: "t1", name: "get_order", input: { order_id: "ORD-1002" } });

    expect(result).toEqual({
      type: "tool_result",
      toolUseId: "t1",
      content: JSON.stringify({ orderId: "ORD-1002", status: "shipped", createdAt: "2026-11-19", stockAvailable: 200 }),
      isError: false,
    });
  });

  it("trims whitespace in order_id", () => {
    const result = executeTool({ type: "tool_use", id: "t1", name: "get_order", input: { order_id: "  ORD-1001 " } });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('"orderId":"ORD-1001"');
  });

  it("returns an error result when the order does not exist", () => {
    const result = executeTool({ type: "tool_use", id: "t1", name: "get_order", input: { order_id: "ORD-9999" } });

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toEqual({ error: "Order ORD-9999 not found" });
  });

  it.each([{}, { order_id: "" }, { order_id: 1001 }, { order_id: "   " }])(
    "returns an error result for invalid input %j",
    (input) => {
      const result = executeTool({ type: "tool_use", id: "t1", name: "get_order", input });

      expect(result.isError).toBe(true);
    },
  );

  it("returns an error result for an unknown tool instead of throwing", () => {
    const result = executeTool({ type: "tool_use", id: "t9", name: "delete_order", input: {} });

    expect(result).toEqual({
      type: "tool_result",
      toolUseId: "t9",
      content: JSON.stringify({ error: "Unknown tool: delete_order" }),
      isError: true,
    });
  });
});
