import { stat } from "node:fs/promises";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { parseFile, readTextFile, type CliResult } from "./index.js";

type JsonObject = Record<string, unknown>;

export type McpServerOptions = {
  fileArg: string;
};

export async function runMcpServer({ fileArg }: McpServerOptions): Promise<void> {
  const initialFile = await parseFile(fileArg);
  const server = new McpServer({
    name: "a5sql-mcp",
    version: "0.1.0"
  });

  server.registerTool(
    "describe_a5sql_file",
    {
      title: "Describe configured A5:SQL file",
      description: "MCP サーバー起動時に指定された A5:SQL 関連ファイルのパス、種別、サイズを返します。",
      inputSchema: {}
    },
    async () => {
      const parsed = await parseFile(initialFile.filePath);
      const fileStat = await stat(parsed.filePath);
      return jsonResult({
        filePath: parsed.filePath,
        kind: parsed.kind,
        sizeBytes: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString()
      });
    }
  );

  server.registerTool(
    "parse_a5sql_file",
    {
      title: "Parse configured A5:SQL file",
      description:
        "MCP サーバー起動時に指定された .a5er または .sql ファイルを AI が扱いやすい JSON に変換します。",
      inputSchema: {}
    },
    async () => {
      const parsed = await parseFile(initialFile.filePath);
      return jsonResult(parsed);
    }
  );

  server.registerTool(
    "read_a5sql_file",
    {
      title: "Read configured A5:SQL file",
      description:
        "MCP サーバー起動時に指定されたファイルの本文を読み取ります。大きなファイル向けに最大文字数を指定できます。",
      inputSchema: {
        maxChars: z.number().int().min(1).max(500_000).optional().describe("返す最大文字数。省略時は 100000。")
      }
    },
    async ({ maxChars }) => {
      const limit = maxChars ?? 100_000;
      const text = await readTextFile(initialFile.filePath);
      const truncated = text.length > limit;
      return jsonResult({
        filePath: initialFile.filePath,
        kind: initialFile.kind,
        text: truncated ? text.slice(0, limit) : text,
        truncated,
        totalChars: text.length
      });
    }
  );

  if (initialFile.kind === "a5er") {
    registerA5erTools(server, initialFile);
  }

  const transport = new StdioServerTransport();
  transport.onerror = (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`a5sql-mcp transport error: ${message}`);
  };
  await server.connect(transport);
  process.stdin.resume();

  const keepAlive = setInterval(() => undefined, 2 ** 30);
  const shutdown = () => {
    clearInterval(keepAlive);
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function registerA5erTools(server: McpServer, initialFile: CliResult): void {
  server.registerTool(
    "list_a5sql_tables",
    {
      title: "List tables in configured A5:ER file",
      description: "MCP サーバー起動時に指定された .a5er ファイルからテーブル/ビューの一覧を返します。",
      inputSchema: {}
    },
    async () => {
      const parsed = await parseFile(initialFile.filePath);
      if (!isA5erParsed(parsed)) {
        return jsonResult({
          filePath: parsed.filePath,
          kind: parsed.kind,
          tables: []
        });
      }
      return jsonResult({
        filePath: parsed.filePath,
        kind: parsed.kind,
        tables: parsed.parsed.tables.map((table) => ({
          name: table.name,
          logicalName: table.logicalName,
          physicalName: table.physicalName,
          objectType: table.objectType,
          columnCount: table.columns.length,
          primaryKeyColumns: table.columns
            .filter((column) => column.primaryKey)
            .sort((a, b) => (a.keyOrder ?? 0) - (b.keyOrder ?? 0))
            .map((column) => column.name)
        }))
      });
    }
  );

  server.registerTool(
    "describe_a5sql_table",
    {
      title: "Describe table in configured A5:ER file",
      description: "MCP サーバー起動時に指定された .a5er ファイル内のテーブル/ビュー定義を 1 件返します。",
      inputSchema: {
        tableName: z.string().min(1).describe("物理名または論理名。大文字小文字は区別しません。")
      }
    },
    async ({ tableName }) => {
      const parsed = await parseFile(initialFile.filePath);
      if (!isA5erParsed(parsed)) {
        return jsonResult({
          found: false,
          filePath: parsed.filePath,
          kind: parsed.kind,
          message: "configured_file_is_not_a5er"
        });
      }
      const lowerName = tableName.toLocaleLowerCase();
      const table = parsed.parsed.tables.find((candidate) =>
        [candidate.name, candidate.physicalName, candidate.logicalName]
          .filter((value): value is string => value !== undefined)
          .some((value) => value.toLocaleLowerCase() === lowerName)
      );
      if (!table) {
        return jsonResult({
          found: false,
          filePath: parsed.filePath,
          tableName,
          nextAction: "list_a5sql_tables で利用可能な tableName を確認してください。"
        });
      }
      return jsonResult({
        found: true,
        filePath: parsed.filePath,
        table
      });
    }
  );
}

function isA5erParsed(result: CliResult): result is CliResult & {
  kind: "a5er";
  parsed: {
    tables: Array<{
      name: string;
      logicalName?: string;
      physicalName?: string;
      objectType: "entity" | "view";
      columns: Array<{
        name: string;
        primaryKey?: boolean;
        keyOrder?: number;
      }>;
    }>;
  };
} {
  return result.kind === "a5er" && typeof result.parsed === "object" && result.parsed !== null && "tables" in result.parsed;
}

function jsonResult<T extends JsonObject>(output: T) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(output, null, 2)
      }
    ],
    structuredContent: output
  };
}
