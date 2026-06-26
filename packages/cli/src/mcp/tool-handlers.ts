import { stat } from "node:fs/promises";

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
    return jsonResult(
      sliceFileText(decoded.text, {
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
