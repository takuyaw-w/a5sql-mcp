import { stat } from "node:fs/promises";

import {
  detectA5sqlLocations,
  listA5sqlConnections,
  maskSensitiveText,
  parseA5sqlAsset,
  readA5sqlAsset,
  searchA5sqlAssets,
  type ParsedAssetResult,
} from "@takuyaw-w/a5sql-mcp-core";

import { readTextFileWithMetadata, type CliResult } from "../index.js";
import {
  compareA5erWithLiveSchema,
  describeA5sqlTable,
  explainA5sqlTable,
  findA5sqlTables,
  findA5sqlColumns,
  formatFullParsedFile,
  generateMigrationPlan,
  generateMermaidErDiagram,
  generateModelFiles,
  generateSchemaMarkdown,
  generateSqlSelect,
  isA5erParsed,
  isRecognizedA5erParsed,
  listA5sqlRelationships,
  listA5sqlTables,
  reviewA5sqlSchema,
  sliceFileText,
  suggestSchemaChanges,
  summarizeParsedFile,
  type CompareA5erWithLiveSchemaOptions,
  unrecognizedA5erResult,
} from "./tool-outputs.js";
import type { JsonObject, ParsedFileLoader } from "./types.js";

const DEFAULT_FILE_READ_MAX_CHARS = 100_000;
const DEFAULT_ASSET_MAX_TABLES = 100;
const DEFAULT_ASSET_MAX_RELATIONSHIPS = 200;
const DEFAULT_ASSET_MAX_COLUMNS_PER_TABLE = 100;
const DEFAULT_ASSET_MAX_STATEMENTS = 100;

export function createDescribeA5sqlFileHandler(getParsedFile: ParsedFileLoader) {
  return async () => {
    const parsed = await getParsedFile();
    const fileStat = await stat(parsed.filePath);
    return jsonResult({
      filePath: parsed.filePath,
      kind: parsed.kind,
      encoding: parsed.encoding,
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
    });
  };
}

export function createParseA5sqlFileHandler(getParsedFile: ParsedFileLoader) {
  return async ({
    mode,
    summaryLimit,
    maxTables,
    maxRelationships,
    maxColumnsPerTable,
  }: {
    mode?: "summary" | "full";
    summaryLimit?: number;
    maxTables?: number;
    maxRelationships?: number;
    maxColumnsPerTable?: number;
  }) => {
    const parsed = await getParsedFile();
    if (mode === "full") {
      return jsonResult(
        formatFullParsedFile(parsed, {
          maxTables,
          maxRelationships,
          maxColumnsPerTable,
        }),
      );
    }
    return jsonResult(summarizeParsedFile(parsed, { limit: summaryLimit }));
  };
}

export function createReadA5sqlFileHandler(initialFile: CliResult) {
  return async ({
    maxChars,
    offsetChars,
    startLine,
    maxLines,
  }: {
    maxChars?: number;
    offsetChars?: number;
    startLine?: number;
    maxLines?: number;
  }) => {
    const limit = maxChars ?? DEFAULT_FILE_READ_MAX_CHARS;
    const decoded = await readTextFileWithMetadata(initialFile.filePath);
    const maskedText = maskSensitiveText(decoded.text);
    return jsonResult(
      sliceFileText(maskedText, {
        filePath: initialFile.filePath,
        kind: initialFile.kind,
        encoding: decoded.encoding,
        maxChars: limit,
        offsetChars,
        startLine,
        maxLines,
      }),
    );
  };
}

export function createDetectA5sqlLocationsHandler() {
  return async ({
    roots,
    includeDefaults,
  }: {
    roots?: string[];
    includeDefaults?: boolean;
  }) => {
    const candidates = await detectA5sqlLocations({
      extraRoots: roots,
      includeDefaults,
    });
    return jsonResult({
      candidates,
      totalCandidateCount: candidates.length,
      returnedCandidateCount: candidates.length,
      warnings: [],
      nextAction:
        "readable な path を roots または A5SQL_MCP_ROOTS に指定すると、search_a5sql_assets や list_a5sql_connections の探索対象にできます。",
    });
  };
}

export function createReadA5sqlAssetHandler() {
  return async ({
    roots,
    assetId,
    maxBytes,
  }: {
    roots?: string[];
    assetId: string;
    maxBytes?: number;
  }) => {
    const result = await readA5sqlAsset({ roots, assetId, maxBytes });
    if (!result) {
      return jsonResult({
        found: false,
        assetId,
        code: "asset_not_found",
        message: "指定された assetId に一致する A5:SQL asset が見つかりません。",
        warnings: [],
        nextAction:
          "同じ roots で search_a5sql_assets を実行し、返された assetId を指定してください。",
      });
    }

    return jsonResult({
      found: true,
      asset: {
        assetId: result.asset.id,
        kind: result.asset.kind,
        fileName: result.asset.fileName,
        path: result.asset.path,
        size: result.asset.size,
        modifiedAt: result.asset.modifiedAt,
      },
      content: result.content,
      encoding: normalizeEncodingName(result.encoding),
      truncated: result.truncated,
      bytesRead: result.bytesRead,
      warnings: result.warnings,
      nextAction:
        result.asset.kind === "er" || result.asset.kind === "sql"
          ? "parse_a5sql_asset に同じ assetId を渡すと構造化できます。"
          : "必要な範囲だけ maxBytes を増やして読み取ってください。",
    });
  };
}

export function createListA5sqlConnectionsHandler() {
  return async ({
    roots,
    limit,
    revealNonSecret,
  }: {
    roots?: string[];
    limit?: number;
    revealNonSecret?: boolean;
  }) => {
    const effectiveLimit = limit ?? 50;
    const connections = await listA5sqlConnections({
      roots,
      limit,
      revealNonSecret,
    });
    return jsonResult({
      connections,
      totalConnectionCount: connections.length,
      returnedConnectionCount: connections.length,
      truncated: connections.length >= effectiveLimit,
      warnings:
        revealNonSecret === true ? [] : ["non_secret_connection_fields_masked_by_default"],
      nextAction:
        "接続候補は存在確認用です。パスワード、トークン、接続文字列、DB への接続実行は返しません。",
    });
  };
}

function normalizeEncodingName(encoding: string): string {
  return encoding === "utf-8" ? "utf8" : encoding;
}

export function createSearchA5sqlAssetsHandler() {
  return async ({
    roots,
    query,
    kinds,
    limit,
    includeHidden,
    maxDepth,
    maxFiles,
    maxFileBytes,
  }: {
    roots?: string[];
    query?: string;
    kinds?: ("sql" | "er" | "config" | "text" | "database" | "unknown")[];
    limit?: number;
    includeHidden?: boolean;
    maxDepth?: number;
    maxFiles?: number;
    maxFileBytes?: number;
  }) => {
    const effectiveLimit = limit ?? 50;
    const assets = await searchA5sqlAssets({
      roots,
      query,
      kinds,
      limit,
      includeHidden,
      maxDepth,
      maxFiles,
      maxFileBytes,
    });

    return jsonResult({
      query: query ?? null,
      roots: roots ?? null,
      count: assets.length,
      truncated: assets.length >= effectiveLimit,
      nextAction: "parse_a5sql_asset に assetId を渡すと内容を解析できます。",
      assets: assets.map((asset) => ({
        assetId: asset.id,
        kind: asset.kind,
        fileName: asset.fileName,
        path: asset.path,
        size: asset.size,
        modifiedAt: asset.modifiedAt,
        snippet: asset.snippet ?? null,
        warning: asset.warning ?? null,
      })),
    });
  };
}

export function createParseA5sqlAssetHandler() {
  return async ({
    roots,
    assetId,
    maxBytes,
    maxTables,
    maxRelationships,
    maxColumnsPerTable,
    maxStatements,
  }: {
    roots?: string[];
    assetId: string;
    maxBytes?: number;
    maxTables?: number;
    maxRelationships?: number;
    maxColumnsPerTable?: number;
    maxStatements?: number;
  }) => {
    const parsed = await parseA5sqlAsset({ roots, assetId, maxBytes });
    if (!parsed) {
      return jsonResult({
        found: false,
        assetId,
        code: "asset_not_found",
        message: "指定された assetId に一致する A5:SQL asset が見つかりません。",
        nextAction:
          "同じ roots で search_a5sql_assets を実行し、返された assetId を指定してください。",
      });
    }

    return jsonResult(
      formatParsedAsset(parsed, {
        maxTables,
        maxRelationships,
        maxColumnsPerTable,
        maxStatements,
      }),
    );
  };
}

export function createListA5sqlTablesHandler(getParsedFile: ParsedFileLoader) {
  return async ({ offset, limit }: { offset?: number; limit?: number }) => {
    const parsed = await getParsedFile();
    if (!isA5erParsed(parsed)) {
      return jsonResult({
        filePath: parsed.filePath,
        kind: parsed.kind,
        tables: [],
      });
    }
    if (!isRecognizedA5erParsed(parsed)) {
      return jsonResult(unrecognizedA5erResult(parsed));
    }
    return jsonResult(listA5sqlTables(parsed, { offset, limit }));
  };
}

export function createDescribeA5sqlTableHandler(getParsedFile: ParsedFileLoader) {
  return async ({ tableName }: { tableName: string }) => {
    const parsed = await getParsedFile();
    if (!isA5erParsed(parsed)) {
      return jsonResult({
        found: false,
        filePath: parsed.filePath,
        kind: parsed.kind,
        message: "configured_file_is_not_a5er",
      });
    }
    if (!isRecognizedA5erParsed(parsed)) {
      return jsonResult(unrecognizedA5erResult(parsed, { found: false, tableName }));
    }
    return jsonResult(describeA5sqlTable(parsed, { tableName }));
  };
}

export function createExplainA5sqlTableHandler(getParsedFile: ParsedFileLoader) {
  return async ({
    tableName,
    maxRelatedTables,
  }: {
    tableName: string;
    maxRelatedTables?: number;
  }) => {
    const parsed = await getParsedFile();
    if (!isA5erParsed(parsed)) {
      return jsonResult({
        found: false,
        filePath: parsed.filePath,
        kind: parsed.kind,
        message: "configured_file_is_not_a5er",
      });
    }
    if (!isRecognizedA5erParsed(parsed)) {
      return jsonResult(unrecognizedA5erResult(parsed, { found: false, tableName }));
    }
    return jsonResult(explainA5sqlTable(parsed, { tableName, maxRelatedTables }));
  };
}

export function createListA5sqlRelationshipsHandler(getParsedFile: ParsedFileLoader) {
  return async ({ tableName }: { tableName?: string }) => {
    const parsed = await getParsedFile();
    if (!isA5erParsed(parsed)) {
      return jsonResult({
        filePath: parsed.filePath,
        kind: parsed.kind,
        relationships: [],
      });
    }
    if (!isRecognizedA5erParsed(parsed)) {
      return jsonResult(unrecognizedA5erResult(parsed, { tableName, relationships: [] }));
    }
    return jsonResult(listA5sqlRelationships(parsed, { tableName }));
  };
}

export function createFindA5sqlTablesHandler(getParsedFile: ParsedFileLoader) {
  return async ({ query, limit }: { query?: string; limit?: number }) => {
    const parsed = await getParsedFile();
    if (!isA5erParsed(parsed)) {
      return jsonResult({
        filePath: parsed.filePath,
        kind: parsed.kind,
        query,
        tables: [],
      });
    }
    if (!isRecognizedA5erParsed(parsed)) {
      return jsonResult(unrecognizedA5erResult(parsed, { query, tables: [] }));
    }
    return jsonResult(findA5sqlTables(parsed, { query, limit }));
  };
}

export function createFindA5sqlColumnsHandler(getParsedFile: ParsedFileLoader) {
  return async ({
    query,
    tableNames,
    dataType,
    onlyPrimaryKeys,
    onlyForeignKeyLike,
    offset,
    limit,
  }: {
    query?: string;
    tableNames?: string[];
    dataType?: string;
    onlyPrimaryKeys?: boolean;
    onlyForeignKeyLike?: boolean;
    offset?: number;
    limit?: number;
  }) => {
    const parsed = await getParsedFile();
    if (!isA5erParsed(parsed)) {
      return jsonResult({
        filePath: parsed.filePath,
        kind: parsed.kind,
        query,
        columns: [],
      });
    }
    if (!isRecognizedA5erParsed(parsed)) {
      return jsonResult(unrecognizedA5erResult(parsed, { query, columns: [] }));
    }
    return jsonResult(
      findA5sqlColumns(parsed, {
        query,
        tableNames,
        dataType,
        onlyPrimaryKeys,
        onlyForeignKeyLike,
        offset,
        limit,
      }),
    );
  };
}

export function createGenerateSqlSelectHandler(getParsedFile: ParsedFileLoader) {
  return async ({
    tableName,
    includeRelations,
    relatedTables,
    whereColumns,
    limit,
    maxRelatedTables,
  }: {
    tableName: string;
    includeRelations?: boolean;
    relatedTables?: string[];
    whereColumns?: string[];
    limit?: number;
    maxRelatedTables?: number;
  }) => {
    const parsed = await getParsedFile();
    if (!isA5erParsed(parsed)) {
      return jsonResult({
        found: false,
        filePath: parsed.filePath,
        kind: parsed.kind,
        message: "configured_file_is_not_a5er",
      });
    }
    if (!isRecognizedA5erParsed(parsed)) {
      return jsonResult(unrecognizedA5erResult(parsed, { found: false, tableName }));
    }
    return jsonResult(
      generateSqlSelect(parsed, {
        tableName,
        includeRelations,
        relatedTables,
        whereColumns,
        limit,
        maxRelatedTables,
      }),
    );
  };
}

export function createGenerateMermaidErDiagramHandler(getParsedFile: ParsedFileLoader) {
  return async ({
    tableNames,
    includeViews,
    includeColumns,
    maxTables,
  }: {
    tableNames?: string[];
    includeViews?: boolean;
    includeColumns?: boolean;
    maxTables?: number;
  }) => {
    const parsed = await getParsedFile();
    if (!isA5erParsed(parsed)) {
      return jsonResult({
        found: false,
        filePath: parsed.filePath,
        kind: parsed.kind,
        message: "configured_file_is_not_a5er",
      });
    }
    if (!isRecognizedA5erParsed(parsed)) {
      return jsonResult(unrecognizedA5erResult(parsed, { found: false }));
    }
    return jsonResult(
      generateMermaidErDiagram(parsed, {
        tableNames,
        includeViews,
        includeColumns,
        maxTables,
      }),
    );
  };
}

export function createGenerateModelFilesHandler(getParsedFile: ParsedFileLoader) {
  return async ({
    framework,
    tableNames,
    maxTables,
  }: {
    framework: "laravel" | "sqlalchemy";
    tableNames?: string[];
    maxTables?: number;
  }) => {
    const parsed = await getParsedFile();
    if (!isA5erParsed(parsed)) {
      return jsonResult({
        found: false,
        filePath: parsed.filePath,
        kind: parsed.kind,
        message: "configured_file_is_not_a5er",
      });
    }
    if (!isRecognizedA5erParsed(parsed)) {
      return jsonResult(unrecognizedA5erResult(parsed, { found: false }));
    }
    return jsonResult(generateModelFiles(parsed, { framework, tableNames, maxTables }));
  };
}

export function createReviewA5sqlSchemaHandler(getParsedFile: ParsedFileLoader) {
  return async ({ maxIssues, includeInfo }: { maxIssues?: number; includeInfo?: boolean }) => {
    const parsed = await getParsedFile();
    if (!isA5erParsed(parsed)) {
      return jsonResult({
        found: false,
        filePath: parsed.filePath,
        kind: parsed.kind,
        message: "configured_file_is_not_a5er",
      });
    }
    if (!isRecognizedA5erParsed(parsed)) {
      return jsonResult(unrecognizedA5erResult(parsed, { found: false, issues: [] }));
    }
    return jsonResult(reviewA5sqlSchema(parsed, { maxIssues, includeInfo }));
  };
}

export function createSuggestSchemaChangesHandler(getParsedFile: ParsedFileLoader) {
  return async ({
    maxSuggestions,
    includeInfo,
  }: {
    maxSuggestions?: number;
    includeInfo?: boolean;
  }) => {
    const parsed = await getParsedFile();
    if (!isA5erParsed(parsed)) {
      return jsonResult({
        found: false,
        filePath: parsed.filePath,
        kind: parsed.kind,
        message: "configured_file_is_not_a5er",
      });
    }
    if (!isRecognizedA5erParsed(parsed)) {
      return jsonResult(unrecognizedA5erResult(parsed, { found: false, suggestions: [] }));
    }
    return jsonResult(suggestSchemaChanges(parsed, { maxSuggestions, includeInfo }));
  };
}

export function createCompareA5erWithLiveSchemaHandler(getParsedFile: ParsedFileLoader) {
  return async ({
    liveSchema,
    tableNames,
    compareDataTypes,
    compareNullable,
    comparePrimaryKeys,
    includeExtraLiveTables,
    maxIssues,
  }: CompareA5erWithLiveSchemaOptions) => {
    const parsed = await getParsedFile();
    if (!isA5erParsed(parsed)) {
      return jsonResult({
        found: false,
        filePath: parsed.filePath,
        kind: parsed.kind,
        message: "configured_file_is_not_a5er",
      });
    }
    if (!isRecognizedA5erParsed(parsed)) {
      return jsonResult(unrecognizedA5erResult(parsed, { found: false, issues: [] }));
    }
    return jsonResult(
      compareA5erWithLiveSchema(parsed, {
        liveSchema,
        tableNames,
        compareDataTypes,
        compareNullable,
        comparePrimaryKeys,
        includeExtraLiveTables,
        maxIssues,
      }),
    );
  };
}

export function createGenerateMigrationPlanHandler(getParsedFile: ParsedFileLoader) {
  return async ({
    liveSchema,
    tableNames,
    style,
    includeDestructive,
    maxOperations,
  }: CompareA5erWithLiveSchemaOptions & {
    style?: "plain_sql" | "laravel" | "alembic";
    includeDestructive?: boolean;
    maxOperations?: number;
  }) => {
    const parsed = await getParsedFile();
    if (!isA5erParsed(parsed)) {
      return jsonResult({
        found: false,
        filePath: parsed.filePath,
        kind: parsed.kind,
        message: "configured_file_is_not_a5er",
      });
    }
    if (!isRecognizedA5erParsed(parsed)) {
      return jsonResult(unrecognizedA5erResult(parsed, { found: false, operations: [] }));
    }
    return jsonResult(
      generateMigrationPlan(parsed, {
        liveSchema,
        tableNames,
        style,
        includeDestructive,
        maxOperations,
      }),
    );
  };
}

export function createGenerateSchemaMarkdownHandler(getParsedFile: ParsedFileLoader) {
  return async ({
    tableNames,
    includeRelationships,
    includeViews,
    maxTables,
    maxColumnsPerTable,
  }: {
    tableNames?: string[];
    includeRelationships?: boolean;
    includeViews?: boolean;
    maxTables?: number;
    maxColumnsPerTable?: number;
  }) => {
    const parsed = await getParsedFile();
    if (!isA5erParsed(parsed)) {
      return jsonResult({
        found: false,
        filePath: parsed.filePath,
        kind: parsed.kind,
        message: "configured_file_is_not_a5er",
      });
    }
    if (!isRecognizedA5erParsed(parsed)) {
      return jsonResult(unrecognizedA5erResult(parsed, { found: false, markdown: "" }));
    }
    return jsonResult(
      generateSchemaMarkdown(parsed, {
        tableNames,
        includeRelationships,
        includeViews,
        maxTables,
        maxColumnsPerTable,
      }),
    );
  };
}

function jsonResult<T extends JsonObject>(output: T) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(output, null, 2),
      },
    ],
    structuredContent: output,
  };
}

function formatParsedAsset(
  result: ParsedAssetResult,
  options: {
    maxTables?: number;
    maxRelationships?: number;
    maxColumnsPerTable?: number;
    maxStatements?: number;
  },
): JsonObject {
  const output: JsonObject = {
    found: true,
    asset: result.asset,
    parser: result.parser,
    summary: result.summary,
    warnings: result.warnings,
  };

  if (result.manager) {
    output.manager = result.manager;
  }

  if (result.tables) {
    const tableLimit = options.maxTables ?? DEFAULT_ASSET_MAX_TABLES;
    const columnLimit = options.maxColumnsPerTable ?? DEFAULT_ASSET_MAX_COLUMNS_PER_TABLE;
    const returnedTables = result.tables.slice(0, tableLimit).map((table) => ({
      ...table,
      columns: table.columns.slice(0, columnLimit),
      totalColumnCount: table.columns.length,
      returnedColumnCount: Math.min(table.columns.length, columnLimit),
      columnsTruncated: table.columns.length > columnLimit,
    }));
    output.tables = returnedTables;
    output.totalTableCount = result.tables.length;
    output.returnedTableCount = returnedTables.length;
    output.tablesTruncated = result.tables.length > returnedTables.length;
    output.columnsTruncated = returnedTables.some((table) => table.columnsTruncated);
  }

  if (result.relationships) {
    const relationshipLimit = options.maxRelationships ?? DEFAULT_ASSET_MAX_RELATIONSHIPS;
    const relationships = result.relationships.slice(0, relationshipLimit);
    output.relationships = relationships;
    output.totalRelationshipCount = result.relationships.length;
    output.returnedRelationshipCount = relationships.length;
    output.relationshipsTruncated = result.relationships.length > relationships.length;
  }

  if (result.statements) {
    const statementLimit = options.maxStatements ?? DEFAULT_ASSET_MAX_STATEMENTS;
    const statements = result.statements.slice(0, statementLimit);
    output.statements = statements;
    output.totalStatementCount = result.statements.length;
    output.returnedStatementCount = statements.length;
    output.statementsTruncated = result.statements.length > statements.length;
  }

  return output;
}
