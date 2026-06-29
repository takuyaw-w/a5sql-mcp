import { stat } from "node:fs/promises";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { parseFile, type CliResult } from "../index.js";
import {
  createCompareA5erWithLiveSchemaHandler,
  createDetectA5sqlLocationsHandler,
  createDescribeA5sqlFileHandler,
  createDescribeA5sqlTableHandler,
  createExplainA5sqlTableHandler,
  createFindA5sqlColumnsHandler,
  createFindA5sqlTablesHandler,
  createGenerateMigrationPlanHandler,
  createGenerateMermaidErDiagramHandler,
  createGenerateModelFilesHandler,
  createGenerateSchemaMarkdownHandler,
  createGenerateSqlSelectHandler,
  createListA5sqlConnectionsHandler,
  createListA5sqlRelationshipsHandler,
  createListA5sqlTablesHandler,
  createParseA5sqlAssetHandler,
  createParseA5sqlFileHandler,
  createReadA5sqlAssetHandler,
  createReadA5sqlFileHandler,
  createReviewA5sqlSchemaHandler,
  createSearchA5sqlAssetsHandler,
  createSuggestSchemaChangesHandler,
} from "./tool-handlers.js";
import {
  compareA5erWithLiveSchemaToolInputSchema,
  detectA5sqlLocationsInputSchema,
  describeA5sqlFileInputSchema,
  describeA5sqlTableInputSchema,
  explainA5sqlTableInputSchema,
  findA5sqlColumnsInputSchema,
  findA5sqlTablesInputSchema,
  generateMigrationPlanInputSchema,
  generateMermaidErDiagramInputSchema,
  generateModelFilesInputSchema,
  generateSchemaMarkdownInputSchema,
  generateSqlSelectInputSchema,
  listA5sqlConnectionsInputSchema,
  listA5sqlRelationshipsInputSchema,
  listA5sqlTablesInputSchema,
  parseA5sqlAssetInputSchema,
  parseA5sqlFileInputSchema,
  readA5sqlAssetInputSchema,
  readA5sqlFileInputSchema,
  reviewA5sqlSchemaInputSchema,
  searchA5sqlAssetsInputSchema,
  suggestSchemaChangesInputSchema,
} from "./tool-schemas.js";
import type { ParsedFileLoader } from "./types.js";

export type McpServerOptions = {
  fileArg: string;
};

export const A5SQL_MCP_SERVER_VERSION = "0.4.0";

export async function runMcpServer({ fileArg }: McpServerOptions): Promise<void> {
  const server = await createA5sqlMcpServer({ fileArg });
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

export async function createA5sqlMcpServer({ fileArg }: McpServerOptions): Promise<McpServer> {
  const initialFile = await parseFile(fileArg);
  const initialFileStat = await stat(initialFile.filePath);
  const getParsedFile = createParsedFileCache(initialFile, {
    size: initialFileStat.size,
    mtimeMs: initialFileStat.mtimeMs,
  });
  const server = new McpServer({
    name: "a5sql-mcp",
    version: A5SQL_MCP_SERVER_VERSION,
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

  server.registerTool(
    "detect_a5sql_locations",
    {
      title: "Detect A5:SQL locations",
      description:
        "A5:SQL の設定ディレクトリ候補を、存在有無と読み取り可否つきで返します。DB には接続しません。",
      inputSchema: detectA5sqlLocationsInputSchema,
    },
    createDetectA5sqlLocationsHandler(),
  );

  server.registerTool(
    "read_a5sql_asset",
    {
      title: "Read A5:SQL asset by asset ID",
      description:
        "search_a5sql_assets で見つけた assetId の本文を、サイズ制限と秘密情報マスクつきで返します。DB には接続しません。",
      inputSchema: readA5sqlAssetInputSchema,
    },
    createReadA5sqlAssetHandler(),
  );

  server.registerTool(
    "list_a5sql_connections",
    {
      title: "List masked A5:SQL connection candidates",
      description:
        "A5:SQL 設定 root 配下から接続候補を抽出し、秘密情報を返さない形で一覧します。DB には接続しません。",
      inputSchema: listA5sqlConnectionsInputSchema,
    },
    createListA5sqlConnectionsHandler(),
  );

  server.registerTool(
    "search_a5sql_assets",
    {
      title: "Search A5:SQL assets",
      description:
        "A5:SQL 関連 asset を root 配下から検索し、parse_a5sql_asset に渡せる assetId と抜粋を返します。DB には接続しません。",
      inputSchema: searchA5sqlAssetsInputSchema,
    },
    createSearchA5sqlAssetsHandler(),
  );

  server.registerTool(
    "parse_a5sql_asset",
    {
      title: "Parse A5:SQL asset by asset ID",
      description:
        "A5:SQL 関連 asset を assetId で指定し、.a5er または .sql を AI が扱いやすい JSON に変換します。DB には接続しません。",
      inputSchema: parseA5sqlAssetInputSchema,
    },
    createParseA5sqlAssetHandler(),
  );

  if (initialFile.kind === "a5er") {
    registerA5erTools(server, getParsedFile);
  }

  return server;
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
    "explain_a5sql_table",
    {
      title: "Explain table in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイル内のテーブルを、役割・主キー・関連テーブル・注意点つきで要約します。",
      inputSchema: explainA5sqlTableInputSchema,
    },
    createExplainA5sqlTableHandler(getParsedFile),
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
    "find_a5sql_columns",
    {
      title: "Find columns in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルから、カラム名・論理名・コメント・型・テーブル名に一致するカラムを検索します。",
      inputSchema: findA5sqlColumnsInputSchema,
    },
    createFindA5sqlColumnsHandler(getParsedFile),
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
    "generate_schema_markdown",
    {
      title: "Generate Markdown schema document from configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルのテーブル定義とリレーションから Markdown の定義書案を生成します。ファイルシステムには書き込みません。",
      inputSchema: generateSchemaMarkdownInputSchema,
    },
    createGenerateSchemaMarkdownHandler(getParsedFile),
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
    "suggest_schema_changes",
    {
      title: "Suggest schema changes from configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルのレビュー結果から、主キー・型・リレーション・コメントの改善提案を返します。",
      inputSchema: suggestSchemaChangesInputSchema,
    },
    createSuggestSchemaChangesHandler(getParsedFile),
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

  server.registerTool(
    "generate_migration_plan",
    {
      title: "Generate migration plan from configured A5:ER file and live schema",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルと live schema JSON の差分から migration 案を生成します。DB には接続せず、実行もしません。",
      inputSchema: generateMigrationPlanInputSchema,
    },
    createGenerateMigrationPlanHandler(getParsedFile),
  );
}

export * from "./tool-outputs.js";
export type { A5erCliResult } from "./types.js";
