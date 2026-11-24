import { DEFAULT_ANTHROPIC_MAX_RETRIES, DEFAULT_ANTHROPIC_TIMEOUT_MS } from "./clients/anthropic-claude.client";

export interface AppConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
}

/** Reads and validates configuration from environment variables. */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const apiKey = env.ANTHROPIC_API_KEY;
  const model = env.CLAUDE_MODEL;
  if (!apiKey || !model) {
    throw new Error("Missing ANTHROPIC_API_KEY or CLAUDE_MODEL (see .env.example)");
  }
  return {
    apiKey,
    model,
    timeoutMs: parseIntEnv("ANTHROPIC_TIMEOUT_MS", env.ANTHROPIC_TIMEOUT_MS, DEFAULT_ANTHROPIC_TIMEOUT_MS, 1),
    maxRetries: parseIntEnv("ANTHROPIC_MAX_RETRIES", env.ANTHROPIC_MAX_RETRIES, DEFAULT_ANTHROPIC_MAX_RETRIES, 0),
  };
}

/** Parses an optional integer env var. Empty means "use the default". Rejects values below `min`. */
export function parseIntEnv(name: string, raw: string | undefined, fallback: number, min: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min} (got "${raw}")`);
  }
  return value;
}
