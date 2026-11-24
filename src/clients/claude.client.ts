export interface ClaudeToolUse {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeTextBlock {
  type: "text";
  text: string;
}

export type ClaudeContentBlock = ClaudeTextBlock | ClaudeToolUse;

/** Result of running a tool, sent back to Claude in a user turn. */
export interface ClaudeToolResult {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError: boolean;
}

export type ClaudeMessage =
  | { role: "user"; content: string | ClaudeToolResult[] }
  | { role: "assistant"; content: ClaudeContentBlock[] };

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface ClaudeRequest {
  system?: string;
  messages: ClaudeMessage[];
  tools?: ToolDefinition[];
}

export interface ClaudeResponse {
  /** e.g. "end_turn", "tool_use", "max_tokens". */
  stopReason: string | null;
  content: ClaudeContentBlock[];
}

/**
 * Abstraction over a Claude-like model.
 * Business logic depends on this interface only, never on the Anthropic SDK.
 */
export interface ClaudeClient {
  sendMessage(request: ClaudeRequest): Promise<ClaudeResponse>;
}

/** Concatenates the text blocks of a response. */
export function getText(response: ClaudeResponse): string {
  return response.content
    .filter((block): block is ClaudeTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** Category of a failed Claude request, so callers can decide how to react. */
export type ClaudeErrorKind =
  | "AUTHENTICATION" // 401: invalid API key
  | "PERMISSION" // 403
  | "INVALID_REQUEST" // 400, 404, 413, 422: bad request, do not retry
  | "RATE_LIMIT" // 429
  | "TIMEOUT" // request exceeded the configured timeout
  | "CONNECTION" // network failure
  | "SERVER" // 5xx: Anthropic-side failure
  | "EMPTY_RESPONSE" // response contained no text
  | "UNKNOWN";

/** Error raised by any ClaudeClient implementation when a request fails. */
export class ClaudeClientError extends Error {
  readonly kind: ClaudeErrorKind;
  readonly status?: number;
  readonly requestId?: string | null;

  constructor(
    kind: ClaudeErrorKind,
    message: string,
    details: { cause?: unknown; status?: number; requestId?: string | null } = {},
  ) {
    super(message, { cause: details.cause });
    this.name = "ClaudeClientError";
    this.kind = kind;
    this.status = details.status;
    this.requestId = details.requestId;
  }
}
