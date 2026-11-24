import { describe, expect, it, vi } from "vitest";
import type { ClaudeClient, ClaudeRequest, ClaudeResponse, ClaudeToolResult } from "../src/clients/claude.client";
import { ClaudeClientError } from "../src/clients/claude.client";
import { OrderAssistantError } from "../src/services/order-assistant.service";
import { MAX_TOOL_ROUNDS, OrderToolAssistantService } from "../src/services/order-tool-assistant.service";

const getOrderCall = (id: string, orderId: string): ClaudeResponse => ({
  stopReason: "tool_use",
  content: [{ type: "tool_use", id, name: "get_order", input: { order_id: orderId } }],
});

const finalText = (text: string): ClaudeResponse => ({
  stopReason: "end_turn",
  content: [{ type: "text", text }],
});

/** A fake client that returns the scripted responses in order. */
function scriptedClaude(responses: Array<ClaudeResponse | Error>) {
  const queue = [...responses];
  const sendMessage = vi.fn<(request: ClaudeRequest) => Promise<ClaudeResponse>>(async () => {
    const next = queue.shift();
    if (!next) throw new Error("No scripted response left");
    if (next instanceof Error) throw next;
    return next;
  });
  const client: ClaudeClient = { sendMessage };
  return { client, sendMessage };
}

describe("OrderToolAssistantService", () => {
  it("lets Claude call get_order, returns the final answer, and sends the tool result back", async () => {
    const { client, sendMessage } = scriptedClaude([
      getOrderCall("toolu_1", "ORD-1001"),
      finalText("Order ORD-1001 is processing."),
    ]);
    const service = new OrderToolAssistantService(client);

    const result = await service.answer({ orderId: "ORD-1001", question: "What is the status?" });

    expect(result).toEqual({ orderId: "ORD-1001", answer: "Order ORD-1001 is processing." });
    expect(sendMessage).toHaveBeenCalledTimes(2);

    // The second request carries Claude's tool_use and the tool_result from our code.
    const secondRequest = sendMessage.mock.calls[1]![0];
    expect(secondRequest.messages).toHaveLength(3);
    expect(secondRequest.messages[1]).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_1", name: "get_order", input: { order_id: "ORD-1001" } }],
    });
    expect(secondRequest.messages[2]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          toolUseId: "toolu_1",
          content: expect.stringContaining('"status":"processing"'),
          isError: false,
        },
      ],
    });
  });

  it("offers the get_order tool and no other tools", async () => {
    const { client, sendMessage } = scriptedClaude([finalText("ok")]);
    const service = new OrderToolAssistantService(client);

    await service.answer({ orderId: "ORD-1001", question: "Status?" });

    const request = sendMessage.mock.calls[0]![0];
    expect(request.tools?.map((tool) => tool.name)).toEqual(["get_order"]);
    expect(request.system).toContain("get_order");
  });

  it("sends the order ID and question in the first user message", async () => {
    const { client, sendMessage } = scriptedClaude([finalText("ok")]);
    const service = new OrderToolAssistantService(client);

    await service.answer({ orderId: " ORD-1002 ", question: " Has it shipped? " });

    expect(sendMessage.mock.calls[0]![0].messages).toEqual([
      { role: "user", content: "Order ID: ORD-1002\nCustomer question: Has it shipped?" },
    ]);
  });

  it("reports a not-found order as an error tool result, and Claude can still answer", async () => {
    const { client, sendMessage } = scriptedClaude([
      getOrderCall("toolu_1", "ORD-9999"),
      finalText("I could not find order ORD-9999."),
    ]);
    const service = new OrderToolAssistantService(client);

    const result = await service.answer({ orderId: "ORD-9999", question: "Status?" });

    expect(result.answer).toBe("I could not find order ORD-9999.");
    const toolResult = (sendMessage.mock.calls[1]![0].messages[2]!.content as ClaudeToolResult[])[0]!;
    expect(toolResult).toMatchObject({ toolUseId: "toolu_1", isError: true });
    expect(toolResult.content).toContain("not found");
  });

  it("answers every tool_use block in one turn", async () => {
    const { client, sendMessage } = scriptedClaude([
      {
        stopReason: "tool_use",
        content: [
          { type: "tool_use", id: "a", name: "get_order", input: { order_id: "ORD-1001" } },
          { type: "tool_use", id: "b", name: "get_order", input: { order_id: "ORD-1002" } },
        ],
      },
      finalText("Both orders checked."),
    ]);
    const service = new OrderToolAssistantService(client);

    await service.answer({ orderId: "ORD-1001", question: "Compare" });

    const results = sendMessage.mock.calls[1]![0].messages[2]!.content as Array<{ toolUseId: string }>;
    expect(results.map((r) => r.toolUseId)).toEqual(["a", "b"]);
  });

  it("stops with TOOL_LOOP_LIMIT when Claude never gives a final answer", async () => {
    const endless = Array.from({ length: MAX_TOOL_ROUNDS }, (_, i) => getOrderCall(`t${i}`, "ORD-1001"));
    const { client, sendMessage } = scriptedClaude(endless);
    const service = new OrderToolAssistantService(client);

    const error = await service.answer({ orderId: "ORD-1001", question: "Status?" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OrderAssistantError);
    expect((error as OrderAssistantError).code).toBe("TOOL_LOOP_LIMIT");
    expect(sendMessage).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
  });

  it("respects a custom round limit", async () => {
    const { client, sendMessage } = scriptedClaude([getOrderCall("t1", "ORD-1001"), getOrderCall("t2", "ORD-1001")]);
    const service = new OrderToolAssistantService(client, 2);

    await expect(service.answer({ orderId: "ORD-1001", question: "Status?" })).rejects.toMatchObject({
      code: "TOOL_LOOP_LIMIT",
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("returns CLAUDE_API_ERROR with the error kind when a request fails", async () => {
    const { client } = scriptedClaude([new ClaudeClientError("RATE_LIMIT", "slow down")]);
    const service = new OrderToolAssistantService(client);

    const error = (await service
      .answer({ orderId: "ORD-1001", question: "Status?" })
      .catch((e: unknown) => e)) as OrderAssistantError;

    expect(error.code).toBe("CLAUDE_API_ERROR");
    expect(error.claudeErrorKind).toBe("RATE_LIMIT");
  });

  it("fails with CLAUDE_API_ERROR when Claude asks for a tool but sends no tool call", async () => {
    const { client } = scriptedClaude([{ stopReason: "tool_use", content: [] }]);
    const service = new OrderToolAssistantService(client);

    await expect(service.answer({ orderId: "ORD-1001", question: "Status?" })).rejects.toMatchObject({
      code: "CLAUDE_API_ERROR",
    });
  });

  it("rejects invalid input without calling Claude", async () => {
    const { client, sendMessage } = scriptedClaude([]);
    const service = new OrderToolAssistantService(client);

    await expect(service.answer({ orderId: "", question: "Status?" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
