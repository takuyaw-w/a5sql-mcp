import { createHmac, randomBytes } from "node:crypto";

import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";

import { jsonResult } from "./tool-handler-utils.js";

export type ObservabilityRecord = {
  event: "tool_call";
  tool: string;
  inputHash: string;
  durationMs: number;
  outputBytes: number;
  outcome: "ok" | "error";
  errorCode?: string;
};

export type ToolObserverOptions = {
  key?: Buffer;
  now?: () => number;
  sink?: (line: string) => void;
};

export class ToolObserver {
  readonly #key: Buffer;
  readonly #now: () => number;
  readonly #sink: (line: string) => void;

  constructor(options: ToolObserverOptions = {}) {
    this.#key = options.key ?? randomBytes(32);
    this.#now = options.now ?? Date.now;
    this.#sink = options.sink ?? ((line) => process.stderr.write(`${line}\n`));
  }

  wrap<InputArgs extends undefined | ZodRawShapeCompat | AnySchema>(
    toolName: string,
    handler: ToolCallback<InputArgs>,
  ): ToolCallback<InputArgs> {
    const wrapped = async (...args: unknown[]) => {
      const startedAt = this.#now();
      const inputHash = this.hashInput(args[0]);
      try {
        const result = await (handler as (...handlerArgs: unknown[]) => unknown)(...args);
        const errorCode = structuredErrorCode(result);
        this.write({
          event: "tool_call",
          tool: toolName,
          inputHash,
          durationMs: Math.max(0, this.#now() - startedAt),
          outputBytes: Buffer.byteLength(JSON.stringify(result)),
          outcome: errorCode ? "error" : "ok",
          ...(errorCode ? { errorCode } : {}),
        });
        return result;
      } catch {
        const result = jsonResult({
          code: "internal_error",
          message: "tool の処理中に予期しないエラーが発生しました。",
          retryable: false,
          warnings: ["internal_error"],
          nextAction:
            "入力範囲を狭めて再試行し、再現する場合は observability の固定 metadata を確認してください。",
        });
        this.write({
          event: "tool_call",
          tool: toolName,
          inputHash,
          durationMs: Math.max(0, this.#now() - startedAt),
          outputBytes: Buffer.byteLength(JSON.stringify(result)),
          outcome: "error",
          errorCode: "internal_error",
        });
        return result;
      }
    };
    return wrapped as ToolCallback<InputArgs>;
  }

  writeTransportError(): void {
    this.#sink(JSON.stringify({ event: "transport_error", errorCode: "transport_error" }));
  }

  private hashInput(input: unknown): string {
    return createHmac("sha256", this.#key)
      .update(JSON.stringify(input ?? {}))
      .digest("hex");
  }

  private write(record: ObservabilityRecord): void {
    this.#sink(JSON.stringify(record));
  }
}

export function createToolObserverFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: ToolObserverOptions = {},
): ToolObserver | undefined {
  return env.A5SQL_MCP_OBSERVABILITY === "stderr" ? new ToolObserver(options) : undefined;
}

function structuredErrorCode(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || !("structuredContent" in result)) {
    return undefined;
  }
  const structuredContent = result.structuredContent;
  if (
    !structuredContent ||
    typeof structuredContent !== "object" ||
    !("code" in structuredContent)
  ) {
    return undefined;
  }
  return typeof structuredContent.code === "string" ? structuredContent.code : undefined;
}
