import { stat } from "node:fs/promises";

import {
  detectA5sqlLocations,
  listA5sqlConnections,
  maskSensitiveText,
  parseA5sqlAsset,
  readA5sqlAsset,
  searchA5sqlAssetsWithMetadata,
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

function hasExplicitRoots(roots: string[] | undefined): boolean {
  return Boolean(roots?.length) || Boolean(process.env.A5SQL_MCP_ROOTS?.trim());
}

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
      return jsonResult({
        ...formatFullParsedFile(parsed, {
          maxTables,
          maxRelationships,
          maxColumnsPerTable,
        }),
        contentIsUntrusted: true,
      });
    }
    return jsonResult({
      ...summarizeParsedFile(parsed, { limit: summaryLimit }),
      contentIsUntrusted: true,
    });
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
    const decoded = await readTextFileWithMetadata(
      initialFile.filePath,
      initialFile.fileRead.maxBytes,
    );
    const maskedText = maskForPublicConsumption(decoded.text);
    const sliced = sliceFileText(maskedText, {
      filePath: initialFile.filePath,
      kind: initialFile.kind,
      encoding: decoded.encoding,
      maxChars: limit,
      offsetChars,
      startLine,
      maxLines,
    });
    return jsonResult({
      ...sliced,
      contentIsUntrusted: true,
      code: decoded.truncated ? "file_too_large" : undefined,
      sizeBytes: decoded.sizeBytes,
      bytesRead: decoded.bytesRead,
      maxBytes: initialFile.fileRead.maxBytes,
      truncated: Boolean(sliced.truncated) || decoded.truncated,
      hasMore: Boolean(sliced.hasMore) || decoded.truncated,
      warnings: decoded.truncated ? ["file_too_large"] : [],
      nextAction: decoded.truncated
        ? "起動時ファイルが上限を超えています。より小さいファイルを指定するか、必要な asset root を絞って read_a5sql_asset を使ってください。"
        : sliced.nextAction,
    });
  };
}

export function createDetectA5sqlLocationsHandler() {
  return async ({ roots, includeDefaults }: { roots?: string[]; includeDefaults?: boolean }) => {
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
    path,
    maxBytes,
    maxChars,
    offsetChars,
  }: {
    roots?: string[];
    assetId?: string;
    path?: string;
    maxBytes?: number;
    maxChars?: number;
    offsetChars?: number;
  }) => {
    if ((assetId ? 1 : 0) + (path ? 1 : 0) !== 1) {
      return jsonResult({
        found: false,
        code: "invalid_asset_selector",
        message: "assetId または path のどちらか一方だけを指定してください。",
        warnings: [],
        nextAction:
          "search_a5sql_assets で得た assetId、または roots 内の明示的な path を指定してください。",
      });
    }

    if (path && (!roots || roots.length === 0)) {
      return jsonResult({
        found: false,
        code: "asset_path_requires_roots",
        message: "path で読み取る場合は、読み取りを許可する roots を明示してください。",
        warnings: [],
        nextAction:
          "roots に読み取りを許可するディレクトリを指定するか、search_a5sql_assets で得た assetId を指定してください。",
      });
    }

    if (assetId && !hasExplicitRoots(roots)) {
      return jsonResult({
        found: false,
        assetId,
        code: "roots_required",
        message:
          "assetId で読み取る場合は、roots または A5SQL_MCP_ROOTS で探索 root を明示してください。",
        warnings: ["roots_required"],
        nextAction:
          "detect_a5sql_locations で候補を確認し、必要最小限の root を roots または A5SQL_MCP_ROOTS に指定してください。",
      });
    }

    const result = await readA5sqlAsset({ roots, assetId, path, maxBytes });
    if (!result) {
      return jsonResult({
        found: false,
        assetId: assetId ?? null,
        code: "asset_not_found",
        message: "指定された assetId に一致する A5:SQL asset が見つかりません。",
        warnings: [],
        nextAction:
          "同じ roots で search_a5sql_assets を実行し、返された assetId を指定してください。",
      });
    }

    const sourceForMasking =
      result.encoding === "binary_or_unsupported"
        ? result.content
        : (await readTextFileWithMetadata(result.asset.path)).text;
    const sliced = sliceTextByChars(maskForPublicConsumption(result.content, sourceForMasking), {
      offsetChars,
      maxChars,
      alreadyTruncated: result.truncated,
    });
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
      content: sliced.content,
      encoding: normalizeEncodingName(result.encoding),
      truncated: sliced.truncated,
      bytesRead: result.bytesRead,
      offsetChars: sliced.offsetChars,
      maxChars: sliced.maxChars,
      returnedChars: sliced.returnedChars,
      totalChars: sliced.totalChars,
      warnings: result.warnings,
      contentIsUntrusted: true,
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
    if (!hasExplicitRoots(roots)) {
      return jsonResult({
        connections: [],
        totalConnectionCount: 0,
        returnedConnectionCount: 0,
        truncated: false,
        code: "roots_required",
        warnings: ["roots_required"],
        nextAction:
          "detect_a5sql_locations で候補を確認し、必要最小限の root を roots または A5SQL_MCP_ROOTS に指定してください。",
      });
    }
    const effectiveLimit = limit ?? 50;
    const requestedLimit = effectiveLimit < 200 ? effectiveLimit + 1 : effectiveLimit;
    const connections = await listA5sqlConnections({
      roots,
      limit: requestedLimit,
      revealNonSecret,
    });
    const truncated = connections.length > effectiveLimit;
    const publicConnections = connections.slice(0, effectiveLimit).map(toPublicConnectionCandidate);
    return jsonResult({
      connections: publicConnections,
      totalConnectionCount: publicConnections.length,
      returnedConnectionCount: publicConnections.length,
      truncated,
      warnings: revealNonSecret === true ? [] : ["non_secret_connection_fields_masked_by_default"],
      nextAction:
        "接続候補は存在確認用です。パスワード、トークン、接続文字列、DB への接続実行は返しません。",
    });
  };
}

function normalizeEncodingName(encoding: string): string {
  return encoding === "utf-8" ? "utf8" : encoding;
}

function sliceTextByChars(
  text: string,
  options: { offsetChars?: number; maxChars?: number; alreadyTruncated: boolean },
): {
  content: string;
  offsetChars: number;
  maxChars: number;
  returnedChars: number;
  totalChars: number;
  truncated: boolean;
} {
  const totalChars = text.length;
  const offsetChars = Math.max(0, options.offsetChars ?? 0);
  const maxChars = Math.max(1, (options.maxChars ?? totalChars) || 1);
  const start = Math.min(offsetChars, totalChars);
  const end = Math.min(start + maxChars, totalChars);
  const content = text.slice(start, end);

  return {
    content,
    offsetChars,
    maxChars,
    returnedChars: content.length,
    totalChars,
    truncated: options.alreadyTruncated || start > 0 || end < totalChars,
  };
}

function toPublicConnectionCandidate<T extends { sourcePath?: string }>(
  connection: T,
): Omit<T, "sourcePath"> {
  const { sourcePath: _sourcePath, ...publicConnection } = connection;
  return publicConnection;
}

function maskForPublicConsumption(input: string, sourceText?: string): string {
  const quotedJsonMasked = input.replace(
    /(["'])(password|passwd|pass|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key)\1(\s*:\s*)(["'])([^"'"\r\n]+)\4/gi,
    (_match, quote, key, separator, valueQuote) =>
      `${quote}${key}${quote}${separator}${valueQuote}***${valueQuote}`,
  );
  const masked = maskSensitiveText(quotedJsonMasked);
  const queryRecovered = recoverQuerySecretMasks(sourceText ?? input, masked);
  return queryRecovered
    .replace(
      /(authorization)(\s*:\s*)(bearer|basic)(\s+)[^\r\n]+/gi,
      (_match, key, separator, scheme) => `${key}${separator}${scheme} ***`,
    )
    .replace(
      /\b(password|passwd|pwd|pass|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key)\s*=\s*[^;"'\r\n<> &]+/gi,
      (_match, key) => `${key}=***`,
    );
}

function recoverQuerySecretMasks(originalText: string, maskedText: string): string {
  const sourceLines = originalText.split(/\r?\n/);
  const targetLines = maskedText.split(/\r?\n/);

  for (let i = 0; i < sourceLines.length; i += 1) {
    const sourceLine = sourceLines[i];
    const matches = [
      ...sourceLine.matchAll(
        /([?&;])((?:password|passwd|pwd|pass|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key)=[^&\s"'<>;]+)/gi,
      ),
    ];
    if (matches.length === 0) {
      continue;
    }
    const secretKeys = new Set(matches.map((match) => match[2].split("=")[0].toLowerCase()));
    const targetLine = targetLines[i];
    if (!targetLine) {
      continue;
    }

    const presentKeys = new Set<string>();
    for (const key of secretKeys) {
      if (new RegExp(`\\b${key}=`, "i").test(targetLine)) {
        presentKeys.add(key);
      }
    }

    const missingKeys = [...secretKeys].filter((key) => !presentKeys.has(key));
    if (missingKeys.length === 0) {
      continue;
    }

    let rebuilt = targetLine;
    for (const key of missingKeys) {
      const prefix = rebuilt.includes("?") ? "&" : rebuilt.includes(";") ? ";" : "?";
      rebuilt = `${rebuilt}${prefix}${key}=***`;
    }
    targetLines[i] = rebuilt;
  }

  return targetLines.join("\n");
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
    if (!hasExplicitRoots(roots)) {
      return jsonResult({
        query: query ?? null,
        roots: null,
        effectiveLimit: limit ?? 50,
        count: 0,
        returnedAssetCount: 0,
        visitedFileCount: 0,
        truncated: false,
        cutoffReason: null,
        code: "roots_required",
        warnings: ["roots_required"],
        nextAction:
          "detect_a5sql_locations で候補を確認し、必要最小限の root を roots または A5SQL_MCP_ROOTS に指定してください。",
        assets: [],
      });
    }
    const searchResult = await searchA5sqlAssetsWithMetadata({
      roots,
      query,
      kinds,
      limit,
      includeHidden,
      maxDepth,
      maxFiles,
      maxFileBytes,
    });
    const { assets } = searchResult;

    return jsonResult({
      query: query ?? null,
      roots: roots ?? null,
      effectiveLimit: searchResult.effectiveLimit,
      count: assets.length,
      returnedAssetCount: assets.length,
      visitedFileCount: searchResult.visitedFileCount,
      truncated: searchResult.truncated,
      cutoffReason: searchResult.cutoffReason,
      warnings: [],
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
    if (!hasExplicitRoots(roots)) {
      return jsonResult({
        found: false,
        assetId,
        code: "roots_required",
        message:
          "assetId で解析する場合は、roots または A5SQL_MCP_ROOTS で探索 root を明示してください。",
        warnings: ["roots_required"],
        nextAction:
          "detect_a5sql_locations で候補を確認し、必要最小限の root を roots または A5SQL_MCP_ROOTS に指定してください。",
      });
    }
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
    contentIsUntrusted: true,
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
