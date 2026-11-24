import {
  ClaudeClientError,
  getText,
  type ClaudeClient,
  type ClaudeContentBlock,
  type ClaudeMessage,
  type ClaudeToolUse,
} from "../clients/claude.client";
import { executeTool, TOOL_DEFINITIONS } from "../tools/order-tools";
import {
  normalizeQuestion,
  OrderAssistantError,
  SYSTEM_PROMPT,
  type OrderAnswer,
  type OrderQuestion,
} from "./order-assistant.service";

export const MAX_TOOL_ROUNDS = 5;

const TOOL_SYSTEM_PROMPT = `${SYSTEM_PROMPT}
Use the get_order tool to look up order data before you answer. Base your answer only on tool results.
If the tool reports that the order does not exist, tell the user.`;

/**
 * Agentic version of the assistant. Claude decides when to call get_order.
 * The service runs each requested tool, sends the results back, and repeats
 * until Claude returns a final answer or MAX_TOOL_ROUNDS is reached.
 */
export class OrderToolAssistantService {
  constructor(
    private readonly claude: ClaudeClient,
    private readonly maxRounds: number = MAX_TOOL_ROUNDS,
  ) {}

  async answer(input: OrderQuestion): Promise<OrderAnswer> {
    const { orderId, question } = normalizeQuestion(input);

    const messages: ClaudeMessage[] = [
      { role: "user", content: `Order ID: ${orderId}\nCustomer question: ${question}` },
    ];

    for (let round = 1; round <= this.maxRounds; round++) {
      const response = await this.callClaude(messages);

      if (response.stopReason !== "tool_use") {
        return { orderId, answer: getText(response) };
      }

      const toolUses = response.content.filter(isToolUse);
      if (toolUses.length === 0) {
        throw new OrderAssistantError("CLAUDE_API_ERROR", "Claude requested a tool but sent no tool call", {
          claudeErrorKind: "EMPTY_RESPONSE",
        });
      }

      // Keep Claude's turn in the history, then answer every tool_use with a tool_result.
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolUses.map(executeTool) });
    }

    throw new OrderAssistantError(
      "TOOL_LOOP_LIMIT",
      `No final answer after ${this.maxRounds} tool rounds`,
    );
  }

  private async callClaude(messages: ClaudeMessage[]) {
    try {
      return await this.claude.sendMessage({
        system: TOOL_SYSTEM_PROMPT,
        messages,
        tools: TOOL_DEFINITIONS,
      });
    } catch (error) {
      throw new OrderAssistantError("CLAUDE_API_ERROR", "Failed to get an answer from Claude", {
        cause: error,
        claudeErrorKind: error instanceof ClaudeClientError ? error.kind : "UNKNOWN",
      });
    }
  }
}

function isToolUse(block: ClaudeContentBlock): block is ClaudeToolUse {
  return block.type === "tool_use";
}
