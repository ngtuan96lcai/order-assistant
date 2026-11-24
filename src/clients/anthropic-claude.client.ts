import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from "@anthropic-ai/sdk";
import {
  ClaudeClient,
  ClaudeClientError,
  ClaudeContentBlock,
  ClaudeErrorKind,
  ClaudeMessage,
  ClaudeRequest,
  ClaudeResponse,
} from "./claude.client";

/** Default per-request timeout. The SDK default is 10 minutes, which is too long for a web request. */
export const DEFAULT_ANTHROPIC_TIMEOUT_MS = 30_000;
/** Default SDK retries for 408/409/429/5xx and connection errors, with exponential backoff. */
export const DEFAULT_ANTHROPIC_MAX_RETRIES = 2;

export interface AnthropicSdkOptions {
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
}

/** Creates the Anthropic SDK instance with the project's timeout and retry policy. */
export function createAnthropicSdk(options: AnthropicSdkOptions): Anthropic {
  return new Anthropic({
    apiKey: options.apiKey,
    timeout: options.timeoutMs ?? DEFAULT_ANTHROPIC_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? DEFAULT_ANTHROPIC_MAX_RETRIES,
  });
}

export interface AnthropicClaudeClientOptions {
  model: string;
  maxTokens?: number;
}

/** ClaudeClient implementation backed by the Anthropic Messages API. */
export class AnthropicClaudeClient implements ClaudeClient {
  private readonly sdk: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  /** The SDK instance is injected, so tests can pass a mock and the composition root controls its config. */
  constructor(sdk: Anthropic, options: AnthropicClaudeClientOptions) {
    this.sdk = sdk;
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? 512;
  }

  async sendMessage(request: ClaudeRequest): Promise<ClaudeResponse> {
    let response: Anthropic.Message;
    try {
      response = await this.sdk.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        ...(request.system ? { system: request.system } : {}),
        messages: request.messages.map(toSdkMessage),
        ...(request.tools && request.tools.length > 0
          ? {
              tools: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema,
              })),
            }
          : {}),
      });
    } catch (error) {
      throw toClaudeClientError(error);
    }

    const content = response.content.flatMap(fromSdkBlock);
    const result: ClaudeResponse = { stopReason: response.stop_reason, content };

    // A tool_use turn may legitimately have no text. Any other turn must produce text.
    const hasText = content.some((block) => block.type === "text" && block.text.trim() !== "");
    if (content.length === 0 || (result.stopReason !== "tool_use" && !hasText)) {
      throw new ClaudeClientError("EMPTY_RESPONSE", "Claude API returned an empty response (no text content)");
    }
    return result;
  }
}

function toSdkMessage(message: ClaudeMessage): Anthropic.MessageParam {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return { role: "user", content: message.content };
    }
    return {
      role: "user",
      content: message.content.map((result) => ({
        type: "tool_result" as const,
        tool_use_id: result.toolUseId,
        content: result.content,
        is_error: result.isError,
      })),
    };
  }
  return {
    role: "assistant",
    content: message.content.map((block) =>
      block.type === "text"
        ? { type: "text" as const, text: block.text }
        : { type: "tool_use" as const, id: block.id, name: block.name, input: block.input },
    ),
  };
}

/** Keeps only the block types the app understands. Other types (thinking, etc.) are dropped. */
function fromSdkBlock(block: Anthropic.ContentBlock): ClaudeContentBlock[] {
  if (block.type === "text") {
    return [{ type: "text", text: block.text }];
  }
  if (block.type === "tool_use") {
    return [{ type: "tool_use", id: block.id, name: block.name, input: block.input as Record<string, unknown> }];
  }
  return [];
}

/** Maps any error thrown by the SDK to a ClaudeClientError with a specific kind. */
export function toClaudeClientError(error: unknown): ClaudeClientError {
  // Check the timeout subclass before its parent, APIConnectionError.
  if (error instanceof APIConnectionTimeoutError) {
    return new ClaudeClientError("TIMEOUT", "Claude API request timed out", { cause: error });
  }
  if (error instanceof APIConnectionError) {
    return new ClaudeClientError("CONNECTION", "Could not connect to the Claude API", { cause: error });
  }
  if (error instanceof APIError) {
    return new ClaudeClientError(
      kindFromStatus(error.status),
      `Anthropic API error (status ${error.status}): ${error.message}`,
      { cause: error, status: error.status, requestId: error.requestID },
    );
  }
  return new ClaudeClientError("UNKNOWN", "Unexpected error while calling the Claude API", { cause: error });
}

function kindFromStatus(status: number | undefined): ClaudeErrorKind {
  if (status === undefined) return "UNKNOWN";
  if (status === 401) return "AUTHENTICATION";
  if (status === 403) return "PERMISSION";
  if (status === 408) return "TIMEOUT";
  if (status === 429) return "RATE_LIMIT";
  if (status >= 500) return "SERVER";
  if (status >= 400) return "INVALID_REQUEST";
  return "UNKNOWN";
}
