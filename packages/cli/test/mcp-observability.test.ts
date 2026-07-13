import { describe, expect, it } from "vitest";

import { createToolObserverFromEnvironment, ToolObserver } from "../src/mcp/observability.js";

describe("MCP observability", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(createToolObserverFromEnvironment({})).toBeUndefined();
  });

  it("logs only fixed metadata and an HMAC input hash", async () => {
    const lines: string[] = [];
    const times = [100, 112];
    const observer = new ToolObserver({
      key: Buffer.alloc(32, 7),
      now: () => times.shift() ?? 112,
      sink: (line) => lines.push(line),
    });
    const secret = "raw-secret-value";
    const wrapped = observer.wrap("read_a5sql_asset", (async () => ({
      content: [{ type: "text" as const, text: "ok" }],
      structuredContent: { found: true },
    })) as never);

    await (wrapped as (input: unknown) => Promise<unknown>)({ path: "/private/input.sql", secret });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(secret);
    expect(lines[0]).not.toContain("/private/input.sql");
    expect(JSON.parse(lines[0])).toMatchObject({
      event: "tool_call",
      tool: "read_a5sql_asset",
      durationMs: 12,
      outcome: "ok",
    });
    expect(JSON.parse(lines[0]).inputHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("converts unexpected handler errors to a fixed structured error", async () => {
    const lines: string[] = [];
    const observer = new ToolObserver({
      key: Buffer.alloc(32, 9),
      now: () => 10,
      sink: (line) => lines.push(line),
    });
    const wrapped = observer.wrap("parse_a5sql_asset", (async () => {
      throw new Error("raw database password and /private/path");
    }) as never);

    const result = await (wrapped as (input: unknown) => Promise<any>)({ token: "raw-token" });

    expect(result.structuredContent).toMatchObject({
      code: "internal_error",
      retryable: false,
      warnings: ["internal_error"],
    });
    expect(lines.join("\n")).not.toContain("raw-token");
    expect(lines.join("\n")).not.toContain("raw database password");
    expect(JSON.parse(lines[0])).toMatchObject({
      outcome: "error",
      errorCode: "internal_error",
    });
  });

  it("keeps hashes stable only within the same process key", async () => {
    const firstLines: string[] = [];
    const secondLines: string[] = [];
    const handler = (async () => ({ structuredContent: { found: true }, content: [] })) as never;
    const first = new ToolObserver({
      key: Buffer.alloc(32, 1),
      now: () => 0,
      sink: (line) => firstLines.push(line),
    }).wrap("search_a5sql_assets", handler);
    const second = new ToolObserver({
      key: Buffer.alloc(32, 2),
      now: () => 0,
      sink: (line) => secondLines.push(line),
    }).wrap("search_a5sql_assets", handler);
    const input = { query: "sensitive SQL text" };

    await (first as (value: unknown) => Promise<unknown>)(input);
    await (first as (value: unknown) => Promise<unknown>)(input);
    await (second as (value: unknown) => Promise<unknown>)(input);

    const firstHashes = firstLines.map((line) => JSON.parse(line).inputHash);
    const secondHash = JSON.parse(secondLines[0]).inputHash;
    expect(firstHashes[0]).toBe(firstHashes[1]);
    expect(secondHash).not.toBe(firstHashes[0]);
  });
});
