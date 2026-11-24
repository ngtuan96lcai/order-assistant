import Anthropic, { APIConnectionError, APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnthropicClaudeClient,
  DEFAULT_ANTHROPIC_MAX_RETRIES,
  DEFAULT_ANTHROPIC_TIMEOUT_MS,
  createAnthropicSdk,
} from "../src/clients/anthropic-claude.client";
import { ClaudeClientError, getText, type ToolDefinition } from "../src/clients/claude.client";

// Mock the SDK so no real Claude API call is ever made.
const { createMock, constructorMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  constructorMock: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => {
  class MockAPIError extends Error {
    readonly status: number;
    readonly requestID: string | null;

    constructor(status: number, message: string, requestID: string | null) {
      super(message);
      this.name = "APIError";
      this.status = status;
      this.requestID = requestID;
    }
  }

  class MockAPIConnectionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "APIConnectionError";
    }
  }

  class MockAPIConnectionTimeoutError extends MockAPIConnectionError {
    constructor() {
      super("Request timed out.");
      this.name = "APIConnectionTimeoutError";
    }
  }

  class MockAnthropic {
    messages = { create: createMock };

    constructor(options: unknown) {
      constructorMock(options);
    }
  }

  return {
    default: MockAnthropic,
    APIError: MockAPIError,
    APIConnectionError: MockAPIConnectionError,
    APIConnectionTimeoutError: MockAPIConnectionTimeoutError,
  };
});

// Typed constructors for the mocked error classes, so the tests can build instances.
type ApiErrorCtor = new (status: number, message: string, requestID: string | null) => Error & {
  status: number;
  requestID: string | null;
};
type ConnectionErrorCtor = new (message: string) => Error;
const MockAPIError = APIError as unknown as ApiErrorCtor;
const MockConnectionError = APIConnectionError as unknown as ConnectionErrorCtor;
const MockTimeoutError = APIConnectionTimeoutError as unknown as new () => Error;

function sdkMessage(content: unknown[], stopReason: string | null = "end_turn") {
  return { id: "msg_1", type: "message", role: "assistant", content, stop_reason: stopReason };
}

const TOOL: ToolDefinition = {
  name: "get_order",
  description: "Get an order.",
  inputSchema: { type: "object", properties: { order_id: { type: "string" } }, required: ["order_id"] },
};

describe("createAnthropicSdk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the default timeout and retry policy when none is given", () => {
    createAnthropicSdk({ apiKey: "test-key" });

    expect(constructorMock).toHaveBeenCalledWith({
      apiKey: "test-key",
      timeout: DEFAULT_ANTHROPIC_TIMEOUT_MS,
      maxRetries: DEFAULT_ANTHROPIC_MAX_RETRIES,
    });
    expect(DEFAULT_ANTHROPIC_TIMEOUT_MS).toBe(30_000);
    expect(DEFAULT_ANTHROPIC_MAX_RETRIES).toBe(2);
  });

  it("applies a custom timeout and retry policy when given", () => {
    createAnthropicSdk({ apiKey: "test-key", timeoutMs: 5000, maxRetries: 0 });

    expect(constructorMock).toHaveBeenCalledWith({
      apiKey: "test-key",
      timeout: 5000,
      maxRetries: 0,
    });
  });
});

describe("AnthropicClaudeClient", () => {
  let client: AnthropicClaudeClient;

  beforeEach(() => {
    vi.clearAllMocks();
    // The SDK instance is injected through the constructor.
    client = new AnthropicClaudeClient(new Anthropic({ apiKey: "test-key" }), {
      model: "claude-test-model",
    });
  });

  describe("request mapping", () => {
    it("sends a request with the Messages API structure", async () => {
      createMock.mockResolvedValue(sdkMessage([{ type: "text", text: "ok" }]));

      await client.sendMessage({
        system: "You are helpful.",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(createMock).toHaveBeenCalledTimes(1);
      expect(createMock).toHaveBeenCalledWith({
        model: "claude-test-model",
        max_tokens: 512,
        system: "You are helpful.",
        messages: [{ role: "user", content: "Hello" }],
      });
    });

    it("omits the system and tools fields when they are not given", async () => {
      createMock.mockResolvedValue(sdkMessage([{ type: "text", text: "ok" }]));

      await client.sendMessage({ messages: [{ role: "user", content: "Hello" }] });

      const params = createMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(params).not.toHaveProperty("system");
      expect(params).not.toHaveProperty("tools");
    });

    it("uses a custom maxTokens when configured", async () => {
      const custom = new AnthropicClaudeClient(new Anthropic({ apiKey: "k" }), {
        model: "m",
        maxTokens: 1024,
      });
      createMock.mockResolvedValue(sdkMessage([{ type: "text", text: "ok" }]));

      await custom.sendMessage({ messages: [{ role: "user", content: "Hello" }] });

      expect(createMock.mock.calls[0]![0]).toMatchObject({ max_tokens: 1024 });
    });

    it("maps tool definitions to the SDK's input_schema format", async () => {
      createMock.mockResolvedValue(sdkMessage([{ type: "text", text: "ok" }]));

      await client.sendMessage({ messages: [{ role: "user", content: "Hi" }], tools: [TOOL] });

      expect(createMock.mock.calls[0]![0]).toMatchObject({
        tools: [
          {
            name: "get_order",
            description: "Get an order.",
            input_schema: TOOL.inputSchema,
          },
        ],
      });
    });

    it("maps tool_use and tool_result blocks in a multi-turn history", async () => {
      createMock.mockResolvedValue(sdkMessage([{ type: "text", text: "ok" }]));

      await client.sendMessage({
        messages: [
          { role: "user", content: "Find ORD-1001" },
          {
            role: "assistant",
            content: [{ type: "tool_use", id: "toolu_1", name: "get_order", input: { order_id: "ORD-1001" } }],
          },
          {
            role: "user",
            content: [{ type: "tool_result", toolUseId: "toolu_1", content: "{}", isError: false }],
          },
        ],
      });

      expect(createMock.mock.calls[0]![0].messages).toEqual([
        { role: "user", content: "Find ORD-1001" },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "get_order", input: { order_id: "ORD-1001" } }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "{}", is_error: false }],
        },
      ]);
    });
  });

  describe("response mapping", () => {
    it("returns the stop reason and the text content", async () => {
      createMock.mockResolvedValue(sdkMessage([{ type: "text", text: "Hello" }], "end_turn"));

      const response = await client.sendMessage({ messages: [{ role: "user", content: "Hi" }] });

      expect(response.stopReason).toBe("end_turn");
      expect(getText(response)).toBe("Hello");
    });

    it("returns tool_use blocks with their id, name and input", async () => {
      createMock.mockResolvedValue(
        sdkMessage(
          [{ type: "tool_use", id: "toolu_1", name: "get_order", input: { order_id: "ORD-1001" } }],
          "tool_use",
        ),
      );

      const response = await client.sendMessage({ messages: [{ role: "user", content: "Hi" }], tools: [TOOL] });

      expect(response.stopReason).toBe("tool_use");
      expect(response.content).toEqual([
        { type: "tool_use", id: "toolu_1", name: "get_order", input: { order_id: "ORD-1001" } },
      ]);
    });

    it("allows a tool_use turn with no text", async () => {
      createMock.mockResolvedValue(
        sdkMessage([{ type: "tool_use", id: "t1", name: "get_order", input: {} }], "tool_use"),
      );

      await expect(
        client.sendMessage({ messages: [{ role: "user", content: "Hi" }], tools: [TOOL] }),
      ).resolves.toMatchObject({ stopReason: "tool_use" });
    });

    it("drops unsupported block types such as thinking", async () => {
      createMock.mockResolvedValue(
        sdkMessage([{ type: "thinking", thinking: "...", signature: "x" }, { type: "text", text: "Answer" }]),
      );

      const response = await client.sendMessage({ messages: [{ role: "user", content: "Hi" }] });

      expect(response.content).toEqual([{ type: "text", text: "Answer" }]);
    });

    it.each([
      ["empty content", [], "end_turn"],
      ["end_turn with no text block", [], "end_turn"],
      ["end_turn with whitespace-only text", [{ type: "text", text: "   " }], "end_turn"],
      ["end_turn with only a tool_use block", [{ type: "tool_use", id: "t1", name: "x", input: {} }], "end_turn"],
    ])("throws EMPTY_RESPONSE for %s", async (_label, content, stopReason) => {
      createMock.mockResolvedValue(sdkMessage(content, stopReason));

      const error = await client
        .sendMessage({ messages: [{ role: "user", content: "Hi" }] })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ClaudeClientError);
      expect((error as ClaudeClientError).kind).toBe("EMPTY_RESPONSE");
    });
  });

  describe("error classification", () => {
    it.each([
      [400, "INVALID_REQUEST"],
      [401, "AUTHENTICATION"],
      [403, "PERMISSION"],
      [404, "INVALID_REQUEST"],
      [408, "TIMEOUT"],
      [429, "RATE_LIMIT"],
      [500, "SERVER"],
      [529, "SERVER"],
    ])("classifies HTTP status %i as %s", async (status, kind) => {
      createMock.mockRejectedValue(new MockAPIError(status, "api failure", "req_1"));

      const error = await client
        .sendMessage({ messages: [{ role: "user", content: "Hi" }] })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ClaudeClientError);
      expect((error as ClaudeClientError).kind).toBe(kind);
    });

    it("keeps status, request id and the original error for API errors", async () => {
      const apiError = new MockAPIError(429, "rate limited", "req_123");
      createMock.mockRejectedValue(apiError);

      const error = (await client
        .sendMessage({ messages: [{ role: "user", content: "Hi" }] })
        .catch((e: unknown) => e)) as ClaudeClientError;

      expect(error.message).toContain("429");
      expect(error.message).toContain("rate limited");
      expect(error.status).toBe(429);
      expect(error.requestId).toBe("req_123");
      expect(error.cause).toBe(apiError);
    });

    it("classifies a timeout as TIMEOUT even though it is a connection error subclass", async () => {
      createMock.mockRejectedValue(new MockTimeoutError());

      const error = (await client
        .sendMessage({ messages: [{ role: "user", content: "Hi" }] })
        .catch((e: unknown) => e)) as ClaudeClientError;

      expect(error.kind).toBe("TIMEOUT");
    });

    it("classifies a network failure as CONNECTION", async () => {
      createMock.mockRejectedValue(new MockConnectionError("Connection error."));

      const error = (await client
        .sendMessage({ messages: [{ role: "user", content: "Hi" }] })
        .catch((e: unknown) => e)) as ClaudeClientError;

      expect(error.kind).toBe("CONNECTION");
    });

    it("classifies unexpected errors as UNKNOWN and keeps the cause", async () => {
      const unexpected = new Error("boom");
      createMock.mockRejectedValue(unexpected);

      const error = (await client
        .sendMessage({ messages: [{ role: "user", content: "Hi" }] })
        .catch((e: unknown) => e)) as ClaudeClientError;

      expect(error).toBeInstanceOf(ClaudeClientError);
      expect(error.kind).toBe("UNKNOWN");
      expect(error.cause).toBe(unexpected);
    });
  });
});
