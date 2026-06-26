import { stat } from "node:fs/promises";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { parseFile, type CliResult } from "../index.js";
import {
  createCompareA5erWithLiveSchemaHandler,
  createDescribeA5sqlFileHandler,
  createDescribeA5sqlTableHandler,
  createFindA5sqlTablesHandler,
  createGenerateMermaidErDiagramHandler,
  createGenerateModelFilesHandler,
  createGenerateSqlSelectHandler,
  createListA5sqlRelationshipsHandler,
  createListA5sqlTablesHandler,
  createParseA5sqlFileHandler,
  createReadA5sqlFileHandler,
  createReviewA5sqlSchemaHandler,
} from "./tool-handlers.js";
import {
  compareA5erWithLiveSchemaToolInputSchema,
  describeA5sqlFileInputSchema,
  describeA5sqlTableInputSchema,
  findA5sqlTablesInputSchema,
  generateMermaidErDiagramInputSchema,
  generateModelFilesInputSchema,
  generateSqlSelectInputSchema,
  listA5sqlRelationshipsInputSchema,
  listA5sqlTablesInputSchema,
  parseA5sqlFileInputSchema,
  readA5sqlFileInputSchema,
  reviewA5sqlSchemaInputSchema,
} from "./tool-schemas.js";
import type { ParsedFileLoader } from "./types.js";

export type McpServerOptions = {
  fileArg: string;
};

export async function runMcpServer({ fileArg }: McpServerOptions): Promise<void> {
  const initialFile = await parseFile(fileArg);
  const initialFileStat = await stat(initialFile.filePath);
  const getParsedFile = createParsedFileCache(initialFile, {
    size: initialFileStat.size,
    mtimeMs: initialFileStat.mtimeMs,
  });
  const server = new McpServer({
    name: "a5sql-mcp",
    version: "0.3.0",
  });

  server.registerTool(
    "describe_a5sql_file",
    {
      title: "Describe configured A5:SQL file",
      description:
        "MCP サーバー起動時に指定された A5:SQL 関連ファイルのパス、種別、サイズを返します。",
      inputSchema: describeA5sqlFileInputSchema,
    },
    createDescribeA5sqlFileHandler(getParsedFile),
  );

  server.registerTool(
    "parse_a5sql_file",
    {
      title: "Parse configured A5:SQL file",
      description:
        "MCP サーバー起動時に指定された .a5er または .sql ファイルを AI が扱いやすい JSON に変換します。",
      inputSchema: parseA5sqlFileInputSchema,
    },
    createParseA5sqlFileHandler(getParsedFile),
  );

  server.registerTool(
    "read_a5sql_file",
    {
      title: "Read configured A5:SQL file",
      description:
        "MCP サーバー起動時に指定されたファイルの本文を読み取ります。大きなファイル向けに最大文字数を指定できます。",
      inputSchema: readA5sqlFileInputSchema,
    },
    createReadA5sqlFileHandler(initialFile),
  );

  if (initialFile.kind === "a5er") {
    registerA5erTools(server, getParsedFile);
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

function createParsedFileCache(
  initialFile: CliResult,
  initialMetadata: { size: number; mtimeMs: number },
): ParsedFileLoader {
  let cached = initialFile;
  let cachedSize = initialMetadata.size;
  let cachedMtimeMs = initialMetadata.mtimeMs;

  return async () => {
    const fileStat = await stat(cached.filePath);
    if (cachedSize === fileStat.size && cachedMtimeMs === fileStat.mtimeMs) {
      return cached;
    }
    cached = await parseFile(cached.filePath);
    cachedSize = fileStat.size;
    cachedMtimeMs = fileStat.mtimeMs;
    return cached;
  };
}

function registerA5erTools(server: McpServer, getParsedFile: ParsedFileLoader): void {
  server.registerTool(
    "list_a5sql_tables",
    {
      title: "List tables in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルからテーブル/ビューの一覧を返します。",
      inputSchema: listA5sqlTablesInputSchema,
    },
    createListA5sqlTablesHandler(getParsedFile),
  );

  server.registerTool(
    "describe_a5sql_table",
    {
      title: "Describe table in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイル内のテーブル/ビュー定義を 1 件返します。",
      inputSchema: describeA5sqlTableInputSchema,
    },
    createDescribeA5sqlTableHandler(getParsedFile),
  );

  server.registerTool(
    "list_a5sql_relationships",
    {
      title: "List relationships in configured A5:ER file",
      description: "MCP サーバー起動時に指定された .a5er ファイルからリレーション一覧を返します。",
      inputSchema: listA5sqlRelationshipsInputSchema,
    },
    createListA5sqlRelationshipsHandler(getParsedFile),
  );

  server.registerTool(
    "find_a5sql_tables",
    {
      title: "Find tables in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルから、テーブル名・論理名・コメント・カラム名に一致するテーブルを検索します。",
      inputSchema: findA5sqlTablesInputSchema,
    },
    createFindA5sqlTablesHandler(getParsedFile),
  );

  server.registerTool(
    "generate_sql_select",
    {
      title: "Generate SELECT SQL from configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルの定義から、指定テーブルを起点にした SELECT SQL のたたき台を生成します。DB には接続しません。",
      inputSchema: generateSqlSelectInputSchema,
    },
    createGenerateSqlSelectHandler(getParsedFile),
  );

  server.registerTool(
    "generate_mermaid_er_diagram",
    {
      title: "Generate Mermaid ER diagram from configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルのテーブルとリレーションから Mermaid ER diagram を生成します。",
      inputSchema: generateMermaidErDiagramInputSchema,
    },
    createGenerateMermaidErDiagramHandler(getParsedFile),
  );

  server.registerTool(
    "generate_model_files",
    {
      title: "Generate model files from configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルのテーブル定義から、Laravel Eloquent または SQLAlchemy 用のモデルファイル案を生成します。ファイルシステムには書き込みません。",
      inputSchema: generateModelFilesInputSchema,
    },
    createGenerateModelFilesHandler(getParsedFile),
  );

  server.registerTool(
    "review_a5sql_schema",
    {
      title: "Review schema quality in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルのスキーマ品質を、主キー・型・コメント・リレーション整合性の観点でレビューします。",
      inputSchema: reviewA5sqlSchemaInputSchema,
    },
    createReviewA5sqlSchemaHandler(getParsedFile),
  );

  server.registerTool(
    "compare_a5er_with_live_schema",
    {
      title: "Compare configured A5:ER file with a live schema snapshot",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルの定義と、別の DB MCP などから渡された live schema JSON を比較します。DB には接続しません。",
      inputSchema: compareA5erWithLiveSchemaToolInputSchema,
    },
    createCompareA5erWithLiveSchemaHandler(getParsedFile),
  );
}

export * from "./tool-outputs.js";
export type { A5erCliResult } from "./types.js";
