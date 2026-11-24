import "dotenv/config";
import { AnthropicClaudeClient, createAnthropicSdk } from "./clients/anthropic-claude.client";
import { loadConfig } from "./config";
import { OrderAssistantError, OrderAssistantService } from "./services/order-assistant.service";
import { OrderToolAssistantService } from "./services/order-tool-assistant.service";

async function main(): Promise<void> {
  // Usage: npm start -- <orderId> "<question>" [--tools]
  const args = process.argv.slice(2);
  const useTools = args.includes("--tools");
  const [orderId = "ORD-1001", question = "What is the status of this order?"] = args.filter(
    (arg) => arg !== "--tools",
  );

  // Composition Root: create concrete implementations and inject them.
  const config = loadConfig(process.env);
  const sdk = createAnthropicSdk({
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  });
  const claude = new AnthropicClaudeClient(sdk, { model: config.model });
  const assistant = useTools
    ? new OrderToolAssistantService(claude)
    : new OrderAssistantService(claude);

  const result = await assistant.answer({ orderId, question });
  console.log(`[${result.orderId}] ${result.answer}`);
}

main().catch((error: unknown) => {
  if (error instanceof OrderAssistantError) {
    const reason = error.claudeErrorKind ? ` (${error.claudeErrorKind})` : "";
    console.error(`Error [${error.code}]${reason}: ${error.message}`);
  } else if (error instanceof Error) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
