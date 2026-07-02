import type {
  ParsedA5erColumn,
  ParsedA5erRelationship,
  ParsedA5erTable,
} from "@takuyaw-w/a5sql-mcp-parser";
import { maskSensitiveText } from "@takuyaw-w/a5sql-mcp-core";

import type { CliResult } from "../index.js";
import {
  buildA5erIndex,
  findTable,
  isRecognizedA5erParsed,
  primaryKeyColumns,
  unrecognizedA5erResult,
} from "./a5er-output-utils.js";
import {
  limitItems,
  slicePage,
  withUntrustedContentSignal,
} from "./output-utils.js";
import type { A5erCliResult, JsonObject } from "./types.js";
export { compareA5erWithLiveSchema } from "./schema-compare/compare.js";
export {
  generateMigrationPlan,
  generateModelFiles,
  generateSchemaMarkdown,
  generateSqlSelect,
} from "./generation-tools.js";
export { isRecognizedA5erParsed, unrecognizedA5erResult } from "./a5er-output-utils.js";
export type { CompareA5erWithLiveSchemaOptions } from "./schema-compare/types.js";

const DEFAULT_PARSE_SUMMARY_LIMIT = 20;
const DEFAULT_PARSE_FULL_TABLE_LIMIT = 100;
const DEFAULT_PARSE_FULL_RELATIONSHIP_LIMIT = 200;
const DEFAULT_PARSE_FULL_COLUMNS_PER_TABLE_LIMIT = 100;
const DEFAULT_TABLE_LIST_LIMIT = 100;
const DEFAULT_MERMAID_TABLE_LIMIT = 100;
const DEFAULT_JOIN_TABLE_LIMIT = 10;
const DEFAULT_COLUMN_SEARCH_LIMIT = 100;
const DEFAULT_SCHEMA_SUGGESTION_LIMIT = 100;

export function listA5sqlRelationships(
  result: A5erCliResult,
  options: { tableName?: string } = {},
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return withUntrustedContentSignal(
      unrecognizedA5erResult(result, { tableName: options.tableName, relationships: [] }),
    );
  }
  const index = buildA5erIndex(result.parsed);
  const table = options.tableName ? findTable(index, options.tableName) : undefined;
  const sourceRelationships =
    options.tableName && table
      ? (index.relationshipsByTable.get(table.name) ?? [])
      : options.tableName
        ? []
        : result.parsed.relationships;
  const relationships = sourceRelationships.map((relationship) =>
    relationshipSummary(relationship, index),
  );
  return withUntrustedContentSignal({
    filePath: result.filePath,
    kind: result.kind,
    tableName: options.tableName,
    foundTable: options.tableName ? Boolean(table) : undefined,
    relationships,
  });
}

export function listA5sqlTables(
  result: A5erCliResult,
  options: { offset?: number; limit?: number } = {},
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return withUntrustedContentSignal(unrecognizedA5erResult(result, { tables: [] }));
  }
  const page = slicePage(result.parsed.tables, {
    offset: options.offset,
    limit: options.limit ?? DEFAULT_TABLE_LIST_LIMIT,
  });
  return withUntrustedContentSignal({
    filePath: result.filePath,
    kind: result.kind,
    totalTableCount: page.totalCount,
    offset: page.offset,
    limit: page.limit,
    returnedTableCount: page.returnedCount,
    hasMore: page.hasMore,
    truncated: page.truncated,
    tables: page.items.map(tableSummary),
  });
}

export function findA5sqlTables(
  result: A5erCliResult,
  options: { query?: string; limit?: number } = {},
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return withUntrustedContentSignal(
      unrecognizedA5erResult(result, { query: options.query, tables: [] }),
    );
  }
  const query = options.query?.trim();
  const limit = options.limit ?? 20;
  const normalizedQuery = query?.toLocaleLowerCase();
  const tables = result.parsed.tables
    .map((table) => {
      const matches = normalizedQuery ? tableMatches(table, normalizedQuery) : ["all"];
      return {
        table,
        matches,
      };
    })
    .filter((item) => item.matches.length > 0)
    .slice(0, limit)
    .map(({ table, matches }) => ({
      name: table.name,
      logicalName: table.logicalName,
      physicalName: table.physicalName,
      objectType: table.objectType,
      comment: table.comment,
      columnCount: table.columns.length,
      primaryKeyColumns: primaryKeyColumns(table),
      matchedBy: matches,
    }));
  return withUntrustedContentSignal({
    filePath: result.filePath,
    kind: result.kind,
    query,
    limit,
    tables,
  });
}

export function describeA5sqlTable(
  result: A5erCliResult,
  options: { tableName: string },
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return withUntrustedContentSignal(
      unrecognizedA5erResult(result, { found: false, tableName: options.tableName }),
    );
  }
  const index = buildA5erIndex(result.parsed);
  const table = findTable(index, options.tableName);
  if (!table) {
    return withUntrustedContentSignal({
      found: false,
      filePath: result.filePath,
      tableName: options.tableName,
      nextAction: "list_a5sql_tables で利用可能な tableName を確認してください。",
    });
  }
  return withUntrustedContentSignal({
    found: true,
    filePath: result.filePath,
    table,
  });
}

export function explainA5sqlTable(
  result: A5erCliResult,
  options: { tableName: string; maxRelatedTables?: number },
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return withUntrustedContentSignal(
      unrecognizedA5erResult(result, { found: false, tableName: options.tableName }),
    );
  }
  const index = buildA5erIndex(result.parsed);
  const table = findTable(index, options.tableName);
  if (!table) {
    return withUntrustedContentSignal({
      found: false,
      filePath: result.filePath,
      tableName: options.tableName,
      nextAction: "find_a5sql_tables で利用可能な tableName を確認してください。",
    });
  }

  const maxRelatedTables = options.maxRelatedTables ?? DEFAULT_JOIN_TABLE_LIMIT;
  const relationships = index.relationshipsByTable.get(table.name) ?? [];
  const relatedTables = relationships
    .map((relationship) => relatedTableSummary(table, relationship, index))
    .filter((value): value is JsonObject => value !== undefined);
  const limitedRelatedTables = relatedTables.slice(0, maxRelatedTables);
  const primaryKeys = table.columns.filter((column) => column.primaryKey);
  const requiredColumns = table.columns.filter((column) => column.nullable === false);
  const foreignKeyLikeColumns = table.columns.filter(
    (column) => looksLikeForeignKeyColumn(column.name) && !column.primaryKey,
  );
  const missingDataTypeColumns = table.columns.filter((column) => !column.dataType);
  const descriptionParts = [
    table.logicalName ? `${table.logicalName} (${table.name})` : table.name,
    table.objectType === "view"
      ? "View として定義されています。"
      : "Entity として定義されています。",
    `${table.columns.length} カラム、${relationships.length} リレーションを持ちます。`,
    primaryKeys.length > 0
      ? `主キーは ${primaryKeys.map((column) => column.name).join(", ")} です。`
      : "主キーが見つかりません。",
  ];

  return withUntrustedContentSignal({
    found: true,
    filePath: result.filePath,
    kind: result.kind,
    table: {
      name: table.name,
      logicalName: table.logicalName,
      physicalName: table.physicalName,
      objectType: table.objectType,
      comment: table.comment,
      columnCount: table.columns.length,
      primaryKeyColumns: primaryKeyColumns(table),
    },
    summary: descriptionParts.join(" "),
    columnProfile: {
      primaryKeyColumns: primaryKeys.map(columnProfile),
      requiredColumns: requiredColumns.map(columnProfile),
      foreignKeyLikeColumns: foreignKeyLikeColumns.map(columnProfile),
      missingDataTypeColumns: missingDataTypeColumns.map(columnProfile),
    },
    relationships: {
      totalCount: relatedTables.length,
      returnedCount: limitedRelatedTables.length,
      truncated: relatedTables.length > limitedRelatedTables.length,
      tables: limitedRelatedTables,
    },
    notes: [
      primaryKeys.length === 0
        ? "主キーがないため、モデル生成や差分管理で確認が必要です。"
        : undefined,
      foreignKeyLikeColumns.length > relationships.length
        ? "外部キーらしいカラムの一部は A5:ER リレーションに未接続の可能性があります。"
        : undefined,
      missingDataTypeColumns.length > 0
        ? "データ型が未設定のカラムがあります。migration 生成前に確認してください。"
        : undefined,
    ].filter((value): value is string => value !== undefined),
  });
}

export function findA5sqlColumns(
  result: A5erCliResult,
  options: {
    query?: string;
    tableNames?: string[];
    dataType?: string;
    onlyPrimaryKeys?: boolean;
    onlyForeignKeyLike?: boolean;
    offset?: number;
    limit?: number;
  } = {},
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return withUntrustedContentSignal(
      unrecognizedA5erResult(result, { query: options.query, columns: [] }),
    );
  }
  const index = buildA5erIndex(result.parsed);
  const warnings: string[] = [];
  const requestedTables = options.tableNames ?? [];
  const requestedTableNames = new Set<string>();
  for (const tableName of requestedTables) {
    const table = findTable(index, tableName);
    if (table) {
      requestedTableNames.add(table.name);
      continue;
    }
    warnings.push(`table_filter_not_found:${tableName}`);
  }

  const query = options.query?.trim();
  const normalizedQuery = query?.toLocaleLowerCase();
  const normalizedDataType = options.dataType?.trim().toLocaleLowerCase();
  const matches = result.parsed.tables.flatMap((table) => {
    if (requestedTables.length > 0 && !requestedTableNames.has(table.name)) {
      return [];
    }
    return table.columns
      .map((column) => {
        const matchedBy = columnMatches(table, column, normalizedQuery, normalizedDataType);
        return { table, column, matchedBy };
      })
      .filter(({ column, matchedBy }) => {
        if (normalizedQuery || normalizedDataType) {
          if (matchedBy.length === 0) {
            return false;
          }
        }
        if (options.onlyPrimaryKeys && !column.primaryKey) {
          return false;
        }
        if (options.onlyForeignKeyLike && !looksLikeForeignKeyColumn(column.name)) {
          return false;
        }
        return true;
      });
  });
  const offset = options.offset ?? 0;
  const limit = options.limit ?? DEFAULT_COLUMN_SEARCH_LIMIT;
  const page = slicePage(matches, { offset, limit });

  return withUntrustedContentSignal({
    filePath: result.filePath,
    kind: result.kind,
    query,
    tableNames: requestedTables,
    dataType: options.dataType,
    filters: {
      onlyPrimaryKeys: options.onlyPrimaryKeys === true,
      onlyForeignKeyLike: options.onlyForeignKeyLike === true,
    },
    totalColumnCount: matches.length,
    offset: page.offset,
    limit: page.limit,
    returnedColumnCount: page.returnedCount,
    hasMore: page.hasMore,
    truncated: page.truncated,
    columns: page.items.map(({ table, column, matchedBy }) => ({
      table: table.name,
      tableLogicalName: table.logicalName,
      name: column.name,
      logicalName: column.logicalName,
      physicalName: column.physicalName,
      dataType: column.dataType,
      nullable: column.nullable,
      primaryKey: column.primaryKey,
      comment: column.comment,
      matchedBy,
    })),
    warnings,
  });
}

export function suggestSchemaChanges(
  result: A5erCliResult,
  options: { maxSuggestions?: number; includeInfo?: boolean } = {},
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return withUntrustedContentSignal(
      unrecognizedA5erResult(result, { found: false, suggestions: [] }),
    );
  }
  const includeInfo = options.includeInfo ?? true;
  const maxSuggestions = options.maxSuggestions ?? DEFAULT_SCHEMA_SUGGESTION_LIMIT;
  const review = reviewA5sqlSchema(result, {
    maxIssues: Math.max(maxSuggestions * 3, maxSuggestions),
    includeInfo,
  }) as {
    issueCount: number;
    summary: Record<string, number>;
    issues: SchemaReviewIssue[];
  };
  const suggestions = review.issues
    .map(schemaReviewIssueToSuggestion)
    .filter((suggestion): suggestion is JsonObject => suggestion !== undefined);
  const limitedSuggestions = limitItems(suggestions, maxSuggestions);

  return withUntrustedContentSignal({
    filePath: result.filePath,
    kind: result.kind,
    tableCount: result.parsed.tables.length,
    relationshipCount: result.parsed.relationships.length,
    issueCount: review.issueCount,
    suggestionCount: suggestions.length,
    returnedSuggestionCount: limitedSuggestions.returnedCount,
    maxSuggestions,
    truncated: limitedSuggestions.truncated,
    summary: review.summary,
    suggestions: limitedSuggestions.items,
    nextAction: "提案は設計レビュー用です。A5:ER ファイル、DB、生成ファイルには書き込みません。",
  });
}

export function generateMermaidErDiagram(
  result: A5erCliResult,
  options: {
    tableNames?: string[];
    includeViews?: boolean;
    includeColumns?: boolean;
    maxTables?: number;
  } = {},
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return withUntrustedContentSignal(unrecognizedA5erResult(result, { found: false }));
  }
  const index = buildA5erIndex(result.parsed);
  const warnings: string[] = [];
  const includeViews = options.includeViews ?? true;
  const includeColumns = options.includeColumns ?? true;
  const maxTables = options.maxTables ?? DEFAULT_MERMAID_TABLE_LIMIT;
  const requestedTables = options.tableNames ?? [];
  const requestedTableNames = new Set<string>();

  for (const tableName of requestedTables) {
    const table = findTable(index, tableName);
    if (table) {
      requestedTableNames.add(table.name);
      continue;
    }
    warnings.push(`table_filter_not_found:${tableName}`);
  }

  const matchingTables = result.parsed.tables.filter((table) => {
    if (!includeViews && table.objectType === "view") {
      return false;
    }
    if (requestedTables.length === 0) {
      return true;
    }
    return requestedTableNames.has(table.name);
  });
  const filteredTables = matchingTables.slice(0, maxTables);
  if (matchingTables.length > filteredTables.length) {
    warnings.push(`table_output_truncated:${filteredTables.length}/${matchingTables.length}`);
  }
  const tableNameSet = new Set(filteredTables.map((table) => table.name));
  const entityNames = buildMermaidEntityNameMap(filteredTables);
  const lines = ["erDiagram"];

  for (const relationship of result.parsed.relationships) {
    if (!relationship.entity1 || !relationship.entity2) {
      warnings.push(`relationship_missing_entity:${relationship.name ?? "unnamed"}`);
      continue;
    }
    if (!tableNameSet.has(relationship.entity1) || !tableNameSet.has(relationship.entity2)) {
      continue;
    }
    const sourceName = entityNames.get(relationship.entity1);
    const targetName = entityNames.get(relationship.entity2);
    if (!sourceName || !targetName) {
      continue;
    }
    lines.push(
      `  ${sourceName} ${mermaidCardinality(relationship.relationType1)}--${mermaidCardinality(relationship.relationType2)} ${targetName} : ${mermaidRelationshipLabel(relationship)}`,
    );
  }

  for (const table of filteredTables) {
    const entityName = entityNames.get(table.name);
    if (!entityName) {
      continue;
    }
    lines.push(`  ${entityName} {`);
    if (includeColumns) {
      for (const column of table.columns) {
        lines.push(`    ${mermaidColumnLine(column)}`);
      }
    }
    lines.push("  }");
  }

  return withUntrustedContentSignal({
    filePath: result.filePath,
    kind: result.kind,
    tableCount: filteredTables.length,
    totalMatchedTableCount: matchingTables.length,
    relationshipCount: result.parsed.relationships.filter(
      (relationship) =>
        relationship.entity1 &&
        relationship.entity2 &&
        tableNameSet.has(relationship.entity1) &&
        tableNameSet.has(relationship.entity2),
    ).length,
    maxTables,
    truncated: matchingTables.length > filteredTables.length,
    mermaid: lines.join("\n"),
    warnings,
  });
}

export function reviewA5sqlSchema(
  result: A5erCliResult,
  options: { maxIssues?: number; includeInfo?: boolean } = {},
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return withUntrustedContentSignal(unrecognizedA5erResult(result, { found: false, issues: [] }));
  }
  const maxIssues = options.maxIssues ?? 100;
  const includeInfo = options.includeInfo ?? true;
  const index = buildA5erIndex(result.parsed);
  const tableNames = new Set(result.parsed.tables.map((table) => table.name));
  const relationshipColumnRefs = new Set<string>();
  const issues: SchemaReviewIssue[] = [];

  for (const relationship of result.parsed.relationships) {
    if (!relationship.entity1 || !relationship.entity2) {
      issues.push({
        severity: "warning",
        code: "relationship_missing_entity",
        message: "リレーションの接続元または接続先テーブルが未設定です。",
        relationship: relationship.name,
      });
      continue;
    }
    const sourceTable = index.tablesByName.get(relationship.entity1);
    const targetTable = index.tablesByName.get(relationship.entity2);
    if (!sourceTable || !targetTable) {
      issues.push({
        severity: "error",
        code: "relationship_table_not_found",
        message: "リレーションが存在しないテーブルを参照しています。",
        relationship: relationship.name,
        table: !sourceTable ? relationship.entity1 : relationship.entity2,
      });
      continue;
    }
    if (relationship.fields1.length !== relationship.fields2.length) {
      issues.push({
        severity: "warning",
        code: "relationship_column_count_mismatch",
        message: "リレーションの接続元カラム数と接続先カラム数が一致していません。",
        relationship: relationship.name,
        table: `${relationship.entity1}->${relationship.entity2}`,
      });
    }
    collectRelationshipColumnRefs(relationshipColumnRefs, relationship);
    reviewRelationshipColumns(issues, sourceTable, relationship.fields1, relationship.name);
    reviewRelationshipColumns(issues, targetTable, relationship.fields2, relationship.name);
  }

  for (const table of result.parsed.tables) {
    if (table.objectType === "entity" && primaryKeyColumns(table).length === 0) {
      issues.push({
        severity: "error",
        code: "table_without_primary_key",
        message: "Entity に主キーがありません。",
        table: table.name,
      });
    }
    if (table.columns.length === 0) {
      issues.push({
        severity: "warning",
        code: "table_without_columns",
        message: "テーブルまたはビューにカラムがありません。",
        table: table.name,
      });
    }
    if (includeInfo && !table.comment) {
      issues.push({
        severity: "info",
        code: "table_missing_comment",
        message: "テーブルコメントが未設定です。",
        table: table.name,
      });
    }
    for (const column of table.columns) {
      reviewColumn(issues, table, column, relationshipColumnRefs, tableNames, includeInfo);
    }
  }

  const filteredIssues = includeInfo ? issues : issues.filter((issue) => issue.severity !== "info");
  const limitedIssues = limitItems(filteredIssues, maxIssues);
  return withUntrustedContentSignal({
    filePath: result.filePath,
    kind: result.kind,
    tableCount: result.parsed.tables.length,
    relationshipCount: result.parsed.relationships.length,
    issueCount: filteredIssues.length,
    truncated: limitedIssues.truncated,
    summary: summarizeIssues(filteredIssues),
    issues: limitedIssues.items,
  });
}

export function formatFullParsedFile(
  result: CliResult,
  options: {
    maxTables?: number;
    maxRelationships?: number;
    maxColumnsPerTable?: number;
  } = {},
): JsonObject {
  if (!isA5erParsed(result)) {
    return withUntrustedContentSignal({
      ...result,
      parsed: maskParsedValue(result.parsed),
    });
  }

  const maxTables = options.maxTables ?? DEFAULT_PARSE_FULL_TABLE_LIMIT;
  const maxRelationships = options.maxRelationships ?? DEFAULT_PARSE_FULL_RELATIONSHIP_LIMIT;
  const maxColumnsPerTable =
    options.maxColumnsPerTable ?? DEFAULT_PARSE_FULL_COLUMNS_PER_TABLE_LIMIT;
  const limitedTables = result.parsed.tables.slice(0, maxTables).map((table) => ({
    ...table,
    columns: table.columns.slice(0, maxColumnsPerTable),
    columnCount: table.columns.length,
    columnsTruncated: table.columns.length > maxColumnsPerTable,
  }));
  const limitedRelationships = result.parsed.relationships.slice(0, maxRelationships);
  const truncated = {
    tables: result.parsed.tables.length > limitedTables.length,
    relationships: result.parsed.relationships.length > limitedRelationships.length,
    columns: limitedTables.some((table) => table.columnsTruncated),
  };

  return withUntrustedContentSignal({
    filePath: result.filePath,
    kind: result.kind,
    encoding: result.encoding,
    mode: "full",
    parseStatus: result.parsed.parseStatus,
    formatVersion: result.parsed.formatVersion,
    a5erEncoding: result.parsed.encoding,
    fileEncoding: result.parsed.fileEncoding,
    manager: result.parsed.manager,
    totalTableCount: result.parsed.tables.length,
    totalRelationshipCount: result.parsed.relationships.length,
    maxTables,
    maxRelationships,
    maxColumnsPerTable,
    truncated,
    warnings: result.parsed.warnings,
    tables: limitedTables,
    relationships: limitedRelationships,
    nextAction:
      truncated.tables || truncated.relationships || truncated.columns
        ? "list_a5sql_tables, describe_a5sql_table, list_a5sql_relationships で必要な範囲を絞ってください。"
        : undefined,
  });
}

export function summarizeParsedFile(
  result: CliResult,
  options: { limit?: number } = {},
): JsonObject {
  const limit = options.limit ?? DEFAULT_PARSE_SUMMARY_LIMIT;
  if (isA5erParsed(result)) {
    const index = buildA5erIndex(result.parsed);
    const tableSummaries = result.parsed.tables.slice(0, limit).map(tableSummary);
    const relationshipSummaries = result.parsed.relationships
      .slice(0, limit)
      .map((relationship) => relationshipSummary(relationship, index));
    return withUntrustedContentSignal({
      filePath: result.filePath,
      kind: result.kind,
      mode: "summary",
      fileEncoding: result.encoding,
      parseStatus: result.parsed.parseStatus,
      formatVersion: result.parsed.formatVersion,
      encoding: result.parsed.encoding,
      tableCount: result.parsed.tables.length,
      relationshipCount: result.parsed.relationships.length,
      warningCount: result.parsed.warnings.length,
      warnings: result.parsed.warnings,
      summaryLimit: limit,
      tables: tableSummaries,
      relationships: relationshipSummaries,
      truncated: {
        tables: result.parsed.tables.length > tableSummaries.length,
        relationships: result.parsed.relationships.length > relationshipSummaries.length,
      },
      nextAction:
        "list_a5sql_tables, find_a5sql_tables, describe_a5sql_table で必要な範囲を絞ってください。全量が必要な場合は mode=full を指定してください。",
    });
  }

  if (
    result.kind === "sql" &&
    typeof result.parsed === "object" &&
    result.parsed !== null &&
    "statements" in result.parsed &&
    Array.isArray(result.parsed.statements)
  ) {
    const statements = maskParsedValue(result.parsed.statements.slice(0, limit)) as unknown[];
    return withUntrustedContentSignal({
      filePath: result.filePath,
      kind: result.kind,
      mode: "summary",
      fileEncoding: result.encoding,
      statementCount: result.parsed.statements.length,
      summaryLimit: limit,
      statements,
      truncated: result.parsed.statements.length > statements.length,
      nextAction: "全量が必要な場合は mode=full を指定してください。",
    });
  }

  if (
    result.kind === "text" &&
    typeof result.parsed === "object" &&
    result.parsed !== null &&
    "text" in result.parsed &&
    typeof result.parsed.text === "string"
  ) {
    const maxChars = Math.min(limit * 100, 10_000);
    const text = maskSensitiveText(result.parsed.text.slice(0, maxChars));
    return withUntrustedContentSignal({
      filePath: result.filePath,
      kind: result.kind,
      mode: "summary",
      fileEncoding: result.encoding,
      totalChars: result.parsed.text.length,
      previewChars: text.length,
      text,
      truncated: result.parsed.text.length > text.length,
      nextAction: "read_a5sql_file で必要な範囲を指定するか、mode=full を指定してください。",
    });
  }

  return withUntrustedContentSignal({
    filePath: result.filePath,
    kind: result.kind,
    mode: "summary",
    fileEncoding: result.encoding,
    parsed: maskParsedValue(result.parsed),
  });
}

function maskParsedValue(value: unknown): unknown {
  if (typeof value === "string") {
    return maskSensitiveText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskParsedValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, maskParsedValue(item)]),
    );
  }
  return value;
}

export function sliceFileText(
  text: string,
  options: {
    filePath: string;
    kind: CliResult["kind"];
    encoding?: string;
    maxChars: number;
    offsetChars?: number;
    startLine?: number;
    maxLines?: number;
  },
): JsonObject {
  if (options.startLine !== undefined) {
    const lines = text.split(/\r?\n/);
    const startIndex = Math.max(options.startLine - 1, 0);
    const endIndex =
      options.maxLines === undefined
        ? lines.length
        : Math.min(startIndex + options.maxLines, lines.length);
    const selectedText = lines.slice(startIndex, endIndex).join("\n");
    const outputText = selectedText.slice(0, options.maxChars);
    const charTruncated = selectedText.length > outputText.length;
    const lineTruncated = endIndex < lines.length;
    return withUntrustedContentSignal({
      filePath: options.filePath,
      kind: options.kind,
      encoding: options.encoding,
      text: outputText,
      totalChars: text.length,
      totalLines: lines.length,
      startLine: options.startLine,
      maxLines: options.maxLines,
      returnedLineCount: Math.max(endIndex - startIndex, 0),
      maxChars: options.maxChars,
      truncated: charTruncated || lineTruncated,
      hasMore: charTruncated || lineTruncated,
      nextStartLine: lineTruncated ? endIndex + 1 : undefined,
    });
  }

  const offset = options.offsetChars ?? 0;
  const outputText = text.slice(offset, offset + options.maxChars);
  const nextOffset = offset + outputText.length;
  const hasMore = nextOffset < text.length;
  return withUntrustedContentSignal({
    filePath: options.filePath,
    kind: options.kind,
    encoding: options.encoding,
    text: outputText,
    totalChars: text.length,
    offsetChars: offset,
    maxChars: options.maxChars,
    returnedChars: outputText.length,
    truncated: hasMore,
    hasMore,
    nextOffsetChars: hasMore ? nextOffset : undefined,
  });
}

function tableSummary(table: ParsedA5erTable): JsonObject {
  return {
    name: table.name,
    logicalName: table.logicalName,
    physicalName: table.physicalName,
    objectType: table.objectType,
    columnCount: table.columns.length,
    primaryKeyColumns: primaryKeyColumns(table),
  };
}

export function isA5erParsed(result: CliResult): result is A5erCliResult {
  return (
    result.kind === "a5er" &&
    typeof result.parsed === "object" &&
    result.parsed !== null &&
    "tables" in result.parsed
  );
}

type SchemaReviewIssue = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  table?: string;
  column?: string;
  relationship?: string;
};

function relationshipSummary(
  relationship: ParsedA5erRelationship,
  index: ReturnType<typeof buildA5erIndex>,
): JsonObject {
  const source = relationship.entity1 ? index.tablesByName.get(relationship.entity1) : undefined;
  const target = relationship.entity2 ? index.tablesByName.get(relationship.entity2) : undefined;
  return {
    name: relationship.name,
    caption: relationship.caption,
    sourceTable: relationship.entity1,
    sourceLogicalName: source?.logicalName,
    sourceColumns: relationship.fields1,
    targetTable: relationship.entity2,
    targetLogicalName: target?.logicalName,
    targetColumns: relationship.fields2,
    sourceRelationType: relationship.relationType1,
    targetRelationType: relationship.relationType2,
  };
}

function relatedTableSummary(
  table: ParsedA5erTable,
  relationship: ParsedA5erRelationship,
  index: ReturnType<typeof buildA5erIndex>,
): JsonObject | undefined {
  const relatedName =
    relationship.entity1 === table.name ? relationship.entity2 : relationship.entity1;
  if (!relatedName) {
    return undefined;
  }
  const relatedTable = index.tablesByName.get(relatedName);
  return {
    table: relatedName,
    logicalName: relatedTable?.logicalName,
    direction: relationship.entity1 === table.name ? "outgoing" : "incoming",
    sourceColumns:
      relationship.entity1 === table.name ? relationship.fields1 : relationship.fields2,
    targetColumns:
      relationship.entity1 === table.name ? relationship.fields2 : relationship.fields1,
    caption: relationship.caption,
    relationship: relationship.name,
  };
}

function columnProfile(column: ParsedA5erColumn): JsonObject {
  return {
    name: column.name,
    logicalName: column.logicalName,
    dataType: column.dataType,
    nullable: column.nullable,
    primaryKey: column.primaryKey,
    comment: column.comment,
  };
}

function tableMatches(table: ParsedA5erTable, normalizedQuery: string): string[] {
  const matches: string[] = [];
  const tableFields = [
    ["name", table.name],
    ["physicalName", table.physicalName],
    ["logicalName", table.logicalName],
    ["comment", table.comment],
  ] as const;
  for (const [fieldName, value] of tableFields) {
    if (value?.toLocaleLowerCase().includes(normalizedQuery)) {
      matches.push(fieldName);
    }
  }
  for (const column of table.columns) {
    const columnMatched = [
      column.name,
      column.physicalName,
      column.logicalName,
      column.comment,
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
    if (columnMatched) {
      matches.push(`column:${column.name}`);
    }
  }
  return matches;
}

function columnMatches(
  table: ParsedA5erTable,
  column: ParsedA5erColumn,
  normalizedQuery: string | undefined,
  normalizedDataType: string | undefined,
): string[] {
  const matches: string[] = [];
  if (normalizedQuery) {
    const fields = [
      ["tableName", table.name],
      ["tableLogicalName", table.logicalName],
      ["columnName", column.name],
      ["columnPhysicalName", column.physicalName],
      ["columnLogicalName", column.logicalName],
      ["comment", column.comment],
      ["dataType", column.dataType],
    ] as const;
    for (const [field, value] of fields) {
      if (value?.toLocaleLowerCase().includes(normalizedQuery)) {
        matches.push(field);
      }
    }
  }
  if (normalizedDataType && column.dataType?.toLocaleLowerCase().includes(normalizedDataType)) {
    matches.push("dataType");
  }
  return [...new Set(matches)];
}

function buildMermaidEntityNameMap(tables: ParsedA5erTable[]): Map<string, string> {
  const usedNames = new Set<string>();
  const names = new Map<string, string>();
  for (const table of tables) {
    const baseName = mermaidIdentifier(table.name);
    let nextName = baseName;
    let suffix = 2;
    while (usedNames.has(nextName)) {
      nextName = `${baseName}_${suffix}`;
      suffix += 1;
    }
    usedNames.add(nextName);
    names.set(table.name, nextName);
  }
  return names;
}

function mermaidIdentifier(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_");
  const trimmed = normalized.replace(/^_+|_+$/g, "");
  const fallback = trimmed || "table";
  return /^[A-Za-z_]/.test(fallback) ? fallback : `_${fallback}`;
}

function mermaidCardinality(relationType: number | undefined): string {
  switch (relationType) {
    case 1:
      return "|o";
    case 2:
      return "||";
    case 3:
      return "o{";
    case 4:
      return "|{";
    default:
      return "||";
  }
}

function mermaidRelationshipLabel(relationship: ParsedA5erRelationship): string {
  const label = relationship.caption || relationship.name || "relates";
  return label.replace(/[\r\n]+/g, " ").replace(/"/g, '\\"');
}

function mermaidColumnLine(column: ParsedA5erColumn): string {
  const type = mermaidIdentifier(column.dataType ?? "unknown");
  const name = mermaidIdentifier(column.name);
  const constraints = [
    column.primaryKey ? "PK" : undefined,
    column.nullable === false ? "NOT_NULL" : undefined,
  ].filter((value): value is string => value !== undefined);
  const comment = column.logicalName || column.comment;
  return [type, name, ...constraints, comment ? `"${comment.replace(/"/g, '\\"')}"` : undefined]
    .filter((value): value is string => value !== undefined)
    .join(" ");
}

function collectRelationshipColumnRefs(
  refs: Set<string>,
  relationship: ParsedA5erRelationship,
): void {
  if (relationship.entity1) {
    for (const column of relationship.fields1) {
      refs.add(`${relationship.entity1}.${column}`);
    }
  }
  if (relationship.entity2) {
    for (const column of relationship.fields2) {
      refs.add(`${relationship.entity2}.${column}`);
    }
  }
}

function reviewRelationshipColumns(
  issues: SchemaReviewIssue[],
  table: ParsedA5erTable,
  columns: string[],
  relationshipName: string | undefined,
): void {
  for (const columnName of columns) {
    if (!table.columns.some((column) => column.name === columnName)) {
      issues.push({
        severity: "error",
        code: "relationship_column_not_found",
        message: "リレーションが存在しないカラムを参照しています。",
        table: table.name,
        column: columnName,
        relationship: relationshipName,
      });
    }
  }
}

function reviewColumn(
  issues: SchemaReviewIssue[],
  table: ParsedA5erTable,
  column: ParsedA5erColumn,
  relationshipColumnRefs: Set<string>,
  tableNames: Set<string>,
  includeInfo: boolean,
): void {
  if (!column.dataType) {
    issues.push({
      severity: "warning",
      code: "column_missing_data_type",
      message: "カラムのデータ型が未設定です。",
      table: table.name,
      column: column.name,
    });
  }
  if (column.primaryKey && column.nullable !== false) {
    issues.push({
      severity: "warning",
      code: "primary_key_nullable_unknown",
      message: "主キーが NOT NULL として明示されていません。",
      table: table.name,
      column: column.name,
    });
  }
  if (includeInfo && !column.comment && !column.logicalName) {
    issues.push({
      severity: "info",
      code: "column_missing_description",
      message: "カラムの論理名またはコメントが未設定です。",
      table: table.name,
      column: column.name,
    });
  }
  if (
    looksLikeForeignKeyColumn(column.name) &&
    !column.primaryKey &&
    !relationshipColumnRefs.has(`${table.name}.${column.name}`)
  ) {
    const expectedTable = inferForeignKeyTableName(column.name);
    issues.push({
      severity: tableNames.has(expectedTable) ? "warning" : "info",
      code: "foreign_key_like_column_without_relationship",
      message: "外部キーらしいカラムですが、A5:ER のリレーションに接続されていません。",
      table: table.name,
      column: column.name,
    });
  }
}

function schemaReviewIssueToSuggestion(issue: SchemaReviewIssue): JsonObject | undefined {
  switch (issue.code) {
    case "table_without_primary_key":
      return {
        priority: "high",
        category: "primary_key",
        table: issue.table,
        title: "主キーを追加する",
        reason: issue.message,
        action: "業務キーまたは surrogate key を確認し、A5:ER 上で主キーを設定してください。",
      };
    case "column_missing_data_type":
      return {
        priority: "high",
        category: "data_type",
        table: issue.table,
        column: issue.column,
        title: "カラム型を設定する",
        reason: issue.message,
        action: "実DBの型または想定する値域に合わせて dataType を設定してください。",
      };
    case "relationship_table_not_found":
    case "relationship_column_not_found":
    case "relationship_column_count_mismatch":
      return {
        priority: "high",
        category: "relationship",
        table: issue.table,
        column: issue.column,
        relationship: issue.relationship,
        title: "リレーション定義を確認する",
        reason: issue.message,
        action:
          "接続元/接続先テーブルとカラム数を確認し、A5:ER の relationship を修正してください。",
      };
    case "foreign_key_like_column_without_relationship":
      return {
        priority: issue.severity === "warning" ? "medium" : "low",
        category: "relationship",
        table: issue.table,
        column: issue.column,
        title: "外部キー候補にリレーションを追加する",
        reason: issue.message,
        action: "参照先テーブルを確認し、A5:ER relationship として接続してください。",
      };
    case "primary_key_nullable_unknown":
      return {
        priority: "medium",
        category: "nullability",
        table: issue.table,
        column: issue.column,
        title: "主キーを NOT NULL として明示する",
        reason: issue.message,
        action: "主キー列に NOT NULL を設定してください。",
      };
    case "table_missing_comment":
      return {
        priority: "low",
        category: "documentation",
        table: issue.table,
        title: "テーブルコメントを追加する",
        reason: issue.message,
        action: "テーブルの責務が分かるコメントを追加してください。",
      };
    case "column_missing_description":
      return {
        priority: "low",
        category: "documentation",
        table: issue.table,
        column: issue.column,
        title: "カラム説明を追加する",
        reason: issue.message,
        action: "論理名またはコメントを追加してください。",
      };
    default:
      return {
        priority:
          issue.severity === "error" ? "high" : issue.severity === "warning" ? "medium" : "low",
        category: "schema",
        table: issue.table,
        column: issue.column,
        relationship: issue.relationship,
        title: "スキーマ定義を確認する",
        reason: issue.message,
        action: "A5:ER 定義と実DBの期待値を確認してください。",
      };
  }
}

function looksLikeForeignKeyColumn(columnName: string): boolean {
  return /(^|_)id$/i.test(columnName) && columnName.toLocaleLowerCase() !== "id";
}

function inferForeignKeyTableName(columnName: string): string {
  const baseName = columnName.replace(/_id$/i, "");
  return `${baseName}s`;
}

function summarizeIssues(issues: SchemaReviewIssue[]): Record<string, number> {
  const summary = {
    error: 0,
    warning: 0,
    info: 0,
  };
  for (const issue of issues) {
    summary[issue.severity] += 1;
  }
  return summary;
}
