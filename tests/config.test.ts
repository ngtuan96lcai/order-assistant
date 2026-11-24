import { describe, expect, it } from "vitest";
import { loadConfig, parseIntEnv } from "../src/config";

const baseEnv = { ANTHROPIC_API_KEY: "key", CLAUDE_MODEL: "claude-haiku-5-5" };

describe("loadConfig", () => {
  it("uses default timeout and retries when they are not set", () => {
    expect(loadConfig(baseEnv)).toEqual({
      apiKey: "key",
      model: "claude-haiku-5-5",
      timeoutMs: 30_000,
      maxRetries: 2,
    });
  });

  it("reads timeout and retries from env", () => {
    const config = loadConfig({ ...baseEnv, ANTHROPIC_TIMEOUT_MS: "5000", ANTHROPIC_MAX_RETRIES: "0" });

    expect(config.timeoutMs).toBe(5000);
    expect(config.maxRetries).toBe(0);
  });

  it("throws when the API key or model is missing", () => {
    expect(() => loadConfig({ CLAUDE_MODEL: "m" })).toThrow("Missing ANTHROPIC_API_KEY");
    expect(() => loadConfig({ ANTHROPIC_API_KEY: "k" })).toThrow("Missing ANTHROPIC_API_KEY");
  });
});

describe("parseIntEnv", () => {
  it("returns the fallback for undefined or blank values", () => {
    expect(parseIntEnv("X", undefined, 7, 0)).toBe(7);
    expect(parseIntEnv("X", "   ", 7, 0)).toBe(7);
  });

  it("accepts integers at or above the minimum, including 0 when allowed", () => {
    expect(parseIntEnv("X", "0", 7, 0)).toBe(0);
    expect(parseIntEnv("X", "10", 7, 1)).toBe(10);
  });

  it.each(["abc", "1.5", "-1", "0"])("rejects invalid value %j", (raw) => {
    expect(() => parseIntEnv("X", raw, 7, 1)).toThrow("X must be an integer >= 1");
  });
});
