import { stat } from "node:fs/promises";

import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { AnySchema, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";

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
import {
  DEFAULT_TOOL_PROFILE,
  shouldRegisterToolForProfile,
  type A5sqlMcpToolName,
  type ToolProfile,
} from "./tool-profiles.js";
import type { ParsedFileLoader } from "./types.js";
import { createToolObserverFromEnvironment, type ToolObserver } from "./observability.js";

export type McpServerOptions = {
  fileArg: string;
  toolProfile?: ToolProfile;
};

export const A5SQL_MCP_SERVER_VERSION = "0.10.2";

type ToolRegistrationConfig<
  OutputArgs extends ZodRawShapeCompat | AnySchema,
  InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
> = {
  title?: string;
  description?: string;
  inputSchema?: InputArgs;
  outputSchema?: OutputArgs;
};

export async function runMcpServer({
  fileArg,
  toolProfile = DEFAULT_TOOL_PROFILE,
}: McpServerOptions): Promise<void> {
  const server = await createA5sqlMcpServer({ fileArg, toolProfile });
  const transport = new StdioServerTransport();
  const observer = createToolObserverFromEnvironment();
  transport.onerror = () => observer?.writeTransportError();
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

export async function createA5sqlMcpServer({
  fileArg,
  toolProfile = DEFAULT_TOOL_PROFILE,
}: McpServerOptions): Promise<McpServer> {
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
  const observer = createToolObserverFromEnvironment();
  const registerProfiledTool = <
    OutputArgs extends ZodRawShapeCompat | AnySchema,
    InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
  >(
    toolName: A5sqlMcpToolName,
    toolConfig: ToolRegistrationConfig<OutputArgs, InputArgs>,
    handler: ToolCallback<InputArgs>,
  ) => {
    if (shouldRegisterToolForProfile(toolName, toolProfile)) {
      server.registerTool(
        toolName,
        toolConfig,
        observer ? observer.wrap(toolName, handler) : handler,
      );
    }
  };

  registerProfiledTool(
    "describe_a5sql_file",
    {
      title: "Describe configured A5:SQL file",
      description:
        "MCP サーバー起動時に指定された A5:SQL 関連ファイルのパス、種別、サイズを返します。ローカルファイルを読み取るだけで、DB には接続しません。",
      inputSchema: describeA5sqlFileInputSchema,
    },
    createDescribeA5sqlFileHandler(getParsedFile),
  );

  registerProfiledTool(
    "parse_a5sql_file",
    {
      title: "Parse configured A5:SQL file",
      description:
        "MCP サーバー起動時に指定された .a5er または .sql ファイルを、ローカル読み取り専用で AI が扱いやすい JSON に変換します。DB には接続しません。",
      inputSchema: parseA5sqlFileInputSchema,
    },
    createParseA5sqlFileHandler(getParsedFile),
  );

  registerProfiledTool(
    "read_a5sql_file",
    {
      title: "Read configured A5:SQL file",
      description:
        "MCP サーバー起動時に指定されたローカルファイルの本文を読み取ります。大きなファイル向けに最大文字数を指定でき、DB には接続しません。",
      inputSchema: readA5sqlFileInputSchema,
    },
    createReadA5sqlFileHandler(initialFile),
  );

  registerProfiledTool(
    "detect_a5sql_locations",
    {
      title: "Detect A5:SQL locations",
      description:
        "MCP tool として A5:SQL の設定ディレクトリ候補を、存在有無と読み取り可否つきで返します。候補提示だけを行い、DB には接続しません。",
      inputSchema: detectA5sqlLocationsInputSchema,
    },
    createDetectA5sqlLocationsHandler(),
  );

  registerProfiledTool(
    "read_a5sql_asset",
    {
      title: "Read A5:SQL asset by asset ID",
      description:
        "MCP tool として roots または A5SQL_MCP_ROOTS で明示した root 配下だけを読み取り、search_a5sql_assets で見つけた assetId の本文をサイズ制限と秘密情報マスクつきで返します。DB には接続しません。",
      inputSchema: readA5sqlAssetInputSchema,
    },
    createReadA5sqlAssetHandler(),
  );

  registerProfiledTool(
    "list_a5sql_connections",
    {
      title: "List masked A5:SQL connection candidates",
      description:
        "MCP tool として roots または A5SQL_MCP_ROOTS で明示した A5:SQL 設定 root 配下から接続候補を抽出し、秘密情報を返さないマスク済み一覧を返します。DB には接続しません。",
      inputSchema: listA5sqlConnectionsInputSchema,
    },
    createListA5sqlConnectionsHandler(),
  );

  registerProfiledTool(
    "search_a5sql_assets",
    {
      title: "Search A5:SQL assets",
      description:
        "MCP tool として roots または A5SQL_MCP_ROOTS で明示した root 配下から A5:SQL 関連 asset を検索し、parse_a5sql_asset に渡せる assetId とマスク済み抜粋を返します。DB には接続しません。",
      inputSchema: searchA5sqlAssetsInputSchema,
    },
    createSearchA5sqlAssetsHandler(),
  );

  registerProfiledTool(
    "parse_a5sql_asset",
    {
      title: "Parse A5:SQL asset by asset ID",
      description:
        "MCP tool として roots または A5SQL_MCP_ROOTS で明示した root 配下の A5:SQL 関連 asset を assetId で指定し、.a5er または .sql を AI が扱いやすい JSON に変換します。DB には接続しません。",
      inputSchema: parseA5sqlAssetInputSchema,
    },
    createParseA5sqlAssetHandler(),
  );

  if (initialFile.kind === "a5er") {
    registerA5erTools(server, getParsedFile, toolProfile, observer);
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

function registerA5erTools(
  server: McpServer,
  getParsedFile: ParsedFileLoader,
  toolProfile: ToolProfile,
  observer?: ToolObserver,
): void {
  const registerProfiledTool = <
    OutputArgs extends ZodRawShapeCompat | AnySchema,
    InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined,
  >(
    toolName: A5sqlMcpToolName,
    toolConfig: ToolRegistrationConfig<OutputArgs, InputArgs>,
    handler: ToolCallback<InputArgs>,
  ) => {
    if (shouldRegisterToolForProfile(toolName, toolProfile)) {
      server.registerTool(
        toolName,
        toolConfig,
        observer ? observer.wrap(toolName, handler) : handler,
      );
    }
  };

  registerProfiledTool(
    "list_a5sql_tables",
    {
      title: "List tables in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルからテーブル/ビューの一覧を返します。ローカルファイルを読み取るだけで、DB には接続しません。",
      inputSchema: listA5sqlTablesInputSchema,
    },
    createListA5sqlTablesHandler(getParsedFile),
  );

  registerProfiledTool(
    "describe_a5sql_table",
    {
      title: "Describe table in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイル内のテーブル/ビュー定義を 1 件返します。ローカルファイルを読み取るだけで、DB には接続しません。",
      inputSchema: describeA5sqlTableInputSchema,
    },
    createDescribeA5sqlTableHandler(getParsedFile),
  );

  registerProfiledTool(
    "explain_a5sql_table",
    {
      title: "Explain table in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイル内のテーブルを、役割・主キー・関連テーブル・注意点つきで要約します。ローカルファイルを読み取るだけで、DB には接続しません。",
      inputSchema: explainA5sqlTableInputSchema,
    },
    createExplainA5sqlTableHandler(getParsedFile),
  );

  registerProfiledTool(
    "list_a5sql_relationships",
    {
      title: "List relationships in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルからリレーション一覧を返します。ローカルファイルを読み取るだけで、DB には接続しません。",
      inputSchema: listA5sqlRelationshipsInputSchema,
    },
    createListA5sqlRelationshipsHandler(getParsedFile),
  );

  registerProfiledTool(
    "find_a5sql_tables",
    {
      title: "Find tables in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルから、テーブル名・論理名・コメント・カラム名に一致するテーブルを検索します。DB には接続しません。",
      inputSchema: findA5sqlTablesInputSchema,
    },
    createFindA5sqlTablesHandler(getParsedFile),
  );

  registerProfiledTool(
    "find_a5sql_columns",
    {
      title: "Find columns in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルから、カラム名・論理名・コメント・型・テーブル名に一致するカラムを検索します。DB には接続しません。",
      inputSchema: findA5sqlColumnsInputSchema,
    },
    createFindA5sqlColumnsHandler(getParsedFile),
  );

  registerProfiledTool(
    "generate_sql_select",
    {
      title: "Generate SELECT SQL from configured A5:ER file",
      description:
        "experimental draft tool: MCP サーバー起動時に指定された .a5er ファイルの定義から、指定テーブルを起点にした review 用 SELECT SQL draft を生成します。DB には接続しません。生成 SQL は実行しません。",
      inputSchema: generateSqlSelectInputSchema,
    },
    createGenerateSqlSelectHandler(getParsedFile),
  );

  registerProfiledTool(
    "generate_mermaid_er_diagram",
    {
      title: "Generate Mermaid ER diagram from configured A5:ER file",
      description:
        "experimental draft tool: MCP サーバー起動時に指定された .a5er ファイルのテーブルとリレーションから review 用 Mermaid ER diagram draft を生成します。DB には接続しません。",
      inputSchema: generateMermaidErDiagramInputSchema,
    },
    createGenerateMermaidErDiagramHandler(getParsedFile),
  );

  registerProfiledTool(
    "generate_model_files",
    {
      title: "Generate model files from configured A5:ER file",
      description:
        "experimental draft tool: MCP サーバー起動時に指定された .a5er ファイルのテーブル定義から、Laravel Eloquent または SQLAlchemy 用の review 用モデルファイル案を生成します。DB には接続しません。ファイルシステムには書き込みません。",
      inputSchema: generateModelFilesInputSchema,
    },
    createGenerateModelFilesHandler(getParsedFile),
  );

  registerProfiledTool(
    "generate_schema_markdown",
    {
      title: "Generate Markdown schema document from configured A5:ER file",
      description:
        "experimental draft tool: MCP サーバー起動時に指定された .a5er ファイルのテーブル定義とリレーションから review 用 Markdown 定義書案を生成します。DB には接続しません。ファイルシステムには書き込みません。",
      inputSchema: generateSchemaMarkdownInputSchema,
    },
    createGenerateSchemaMarkdownHandler(getParsedFile),
  );

  registerProfiledTool(
    "review_a5sql_schema",
    {
      title: "Review schema quality in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルのスキーマ品質を、主キー・型・コメント・リレーション整合性の観点でレビューします。DB には接続しません。",
      inputSchema: reviewA5sqlSchemaInputSchema,
    },
    createReviewA5sqlSchemaHandler(getParsedFile),
  );

  registerProfiledTool(
    "suggest_schema_changes",
    {
      title: "Suggest schema changes from configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルのレビュー結果から、主キー・型・リレーション・コメントの改善提案を返します。DB には接続しません。",
      inputSchema: suggestSchemaChangesInputSchema,
    },
    createSuggestSchemaChangesHandler(getParsedFile),
  );

  registerProfiledTool(
    "compare_a5er_with_live_schema",
    {
      title: "Compare configured A5:ER file with a live schema snapshot",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルの定義と、別の DB MCP などから渡された live schema JSON を比較します。渡された snapshot だけを使い、DB には接続しません。",
      inputSchema: compareA5erWithLiveSchemaToolInputSchema,
    },
    createCompareA5erWithLiveSchemaHandler(getParsedFile),
  );

  registerProfiledTool(
    "generate_migration_plan",
    {
      title: "Generate migration plan from configured A5:ER file and live schema",
      description:
        "experimental draft tool: MCP サーバー起動時に指定された .a5er ファイルと live schema JSON の差分から review 用 migration 案を生成します。DB には接続しません。migration は実行もしません。",
      inputSchema: generateMigrationPlanInputSchema,
    },
    createGenerateMigrationPlanHandler(getParsedFile),
  );
}

export * from "./tool-outputs.js";
export type { A5erCliResult } from "./types.js";
