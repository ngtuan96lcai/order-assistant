import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeClient, ClaudeRequest, ClaudeResponse } from "../src/clients/claude.client";
import { ClaudeClientError } from "../src/clients/claude.client";
import { OrderAssistantError, OrderAssistantService } from "../src/services/order-assistant.service";

function textResponse(text: string): ClaudeResponse {
  return { stopReason: "end_turn", content: [{ type: "text", text }] };
}

function createFakeClaude() {
  const sendMessage = vi.fn<(request: ClaudeRequest) => Promise<ClaudeResponse>>();
  const client: ClaudeClient = { sendMessage };
  return { client, sendMessage };
}

describe("OrderAssistantService", () => {
  let fake: ReturnType<typeof createFakeClaude>;
  let service: OrderAssistantService;

  beforeEach(() => {
    fake = createFakeClaude();
    service = new OrderAssistantService(fake.client);
  });

  it("returns Claude's answer for a valid order", async () => {
    fake.sendMessage.mockResolvedValue(textResponse("Order ORD-1001 is currently being processed."));

    const result = await service.answer({ orderId: "ORD-1001", question: "What is the status?" });

    expect(result).toEqual({
      orderId: "ORD-1001",
      answer: "Order ORD-1001 is currently being processed.",
    });
    expect(fake.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("sends no tools, so Claude is not asked to call functions", async () => {
    fake.sendMessage.mockResolvedValue(textResponse("ok"));

    await service.answer({ orderId: "ORD-1001", question: "Status?" });

    expect(fake.sendMessage.mock.calls[0]![0].tools).toBeUndefined();
  });

  it("builds a prompt containing the order data and the user's question", async () => {
    fake.sendMessage.mockResolvedValue(textResponse("ok"));

    await service.answer({ orderId: "ORD-1002", question: "Has it shipped?" });

    const request = fake.sendMessage.mock.calls[0]![0];
    const prompt = request.messages[0]!.content as string;
    expect(request.system).toContain("Order Management Assistant");
    expect(prompt).toContain('"orderId": "ORD-1002"');
    expect(prompt).toContain('"status": "shipped"');
    expect(prompt).toContain("Customer question: Has it shipped?");
  });

  it("trims whitespace around orderId and question", async () => {
    fake.sendMessage.mockResolvedValue(textResponse("ok"));

    const result = await service.answer({ orderId: "  ORD-1001  ", question: "  Status?  " });

    expect(result.orderId).toBe("ORD-1001");
    expect(fake.sendMessage.mock.calls[0]![0].messages[0]!.content).toContain("Customer question: Status?");
  });

  it.each(["", "   "])("rejects an empty orderId (%j) without calling Claude", async (orderId) => {
    const error = await service.answer({ orderId, question: "Status?" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OrderAssistantError);
    expect((error as OrderAssistantError).code).toBe("INVALID_INPUT");
    expect(fake.sendMessage).not.toHaveBeenCalled();
  });

  it.each(["", "   "])("rejects an empty question (%j) without calling Claude", async (question) => {
    const error = await service.answer({ orderId: "ORD-1001", question }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OrderAssistantError);
    expect((error as OrderAssistantError).code).toBe("INVALID_INPUT");
    expect(fake.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects non-string input without calling Claude", async () => {
    const input = { orderId: 1001, question: "Status?" } as unknown as { orderId: string; question: string };

    await expect(service.answer(input)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fake.sendMessage).not.toHaveBeenCalled();
  });

  it("returns ORDER_NOT_FOUND for an unknown order without calling Claude", async () => {
    await expect(
      service.answer({ orderId: "ORD-9999", question: "Status?" }),
    ).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    expect(fake.sendMessage).not.toHaveBeenCalled();
  });

  it("wraps Claude failures in OrderAssistantError and keeps the original cause", async () => {
    const original = new ClaudeClientError("SERVER", "Anthropic API error (status 500): boom");
    fake.sendMessage.mockRejectedValue(original);

    const error = await service
      .answer({ orderId: "ORD-1001", question: "Status?" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OrderAssistantError);
    expect((error as OrderAssistantError).code).toBe("CLAUDE_API_ERROR");
    expect((error as OrderAssistantError).cause).toBe(original);
  });

  it("passes the Claude error kind up to OrderAssistantError", async () => {
    fake.sendMessage.mockRejectedValue(new ClaudeClientError("RATE_LIMIT", "slow down"));

    const error = (await service
      .answer({ orderId: "ORD-1001", question: "Status?" })
      .catch((e: unknown) => e)) as OrderAssistantError;

    expect(error.claudeErrorKind).toBe("RATE_LIMIT");
  });

  it("uses UNKNOWN as the Claude error kind when the failure is not a ClaudeClientError", async () => {
    fake.sendMessage.mockRejectedValue(new Error("unexpected"));

    const error = (await service
      .answer({ orderId: "ORD-1001", question: "Status?" })
      .catch((e: unknown) => e)) as OrderAssistantError;

    expect(error.claudeErrorKind).toBe("UNKNOWN");
  });
});
