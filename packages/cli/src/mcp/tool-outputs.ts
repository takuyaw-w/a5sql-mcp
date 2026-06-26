import type {
  ParsedA5erColumn,
  ParsedA5erDocument,
  ParsedA5erRelationship,
  ParsedA5erTable,
} from "@takuyaw-w/a5sql-mcp-parser";

import type { CliResult } from "../index.js";
import type { A5erCliResult, JsonObject } from "./types.js";
export { compareA5erWithLiveSchema } from "./schema-compare/compare.js";
export type { CompareA5erWithLiveSchemaOptions } from "./schema-compare/types.js";

const DEFAULT_PARSE_SUMMARY_LIMIT = 20;
const DEFAULT_PARSE_FULL_TABLE_LIMIT = 100;
const DEFAULT_PARSE_FULL_RELATIONSHIP_LIMIT = 200;
const DEFAULT_PARSE_FULL_COLUMNS_PER_TABLE_LIMIT = 100;
const DEFAULT_TABLE_LIST_LIMIT = 100;
const DEFAULT_MERMAID_TABLE_LIMIT = 100;
const DEFAULT_MODEL_TABLE_LIMIT = 20;
const DEFAULT_JOIN_TABLE_LIMIT = 10;

export function listA5sqlRelationships(
  result: A5erCliResult,
  options: { tableName?: string } = {},
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return unrecognizedA5erResult(result, { tableName: options.tableName, relationships: [] });
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
  return {
    filePath: result.filePath,
    kind: result.kind,
    tableName: options.tableName,
    foundTable: options.tableName ? Boolean(table) : undefined,
    relationships,
  };
}

export function listA5sqlTables(
  result: A5erCliResult,
  options: { offset?: number; limit?: number } = {},
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return unrecognizedA5erResult(result, { tables: [] });
  }
  const start = options.offset ?? 0;
  const count = options.limit ?? DEFAULT_TABLE_LIST_LIMIT;
  const tables = result.parsed.tables.slice(start, start + count);
  const hasMore = start + tables.length < result.parsed.tables.length;
  return {
    filePath: result.filePath,
    kind: result.kind,
    totalTableCount: result.parsed.tables.length,
    offset: start,
    limit: count,
    returnedTableCount: tables.length,
    hasMore,
    truncated: hasMore,
    tables: tables.map(tableSummary),
  };
}

export function findA5sqlTables(
  result: A5erCliResult,
  options: { query?: string; limit?: number } = {},
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return unrecognizedA5erResult(result, { query: options.query, tables: [] });
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
  return {
    filePath: result.filePath,
    kind: result.kind,
    query,
    limit,
    tables,
  };
}

export function describeA5sqlTable(
  result: A5erCliResult,
  options: { tableName: string },
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return unrecognizedA5erResult(result, { found: false, tableName: options.tableName });
  }
  const index = buildA5erIndex(result.parsed);
  const table = findTable(index, options.tableName);
  if (!table) {
    return {
      found: false,
      filePath: result.filePath,
      tableName: options.tableName,
      nextAction: "list_a5sql_tables で利用可能な tableName を確認してください。",
    };
  }
  return {
    found: true,
    filePath: result.filePath,
    table,
  };
}

export function generateSqlSelect(
  result: A5erCliResult,
  options: {
    tableName: string;
    includeRelations?: boolean;
    relatedTables?: string[];
    whereColumns?: string[];
    limit?: number;
    maxRelatedTables?: number;
  },
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return unrecognizedA5erResult(result, { found: false, tableName: options.tableName });
  }
  const index = buildA5erIndex(result.parsed);
  const baseTable = findTable(index, options.tableName);
  if (!baseTable) {
    return {
      found: false,
      filePath: result.filePath,
      tableName: options.tableName,
      nextAction: "find_a5sql_tables で利用可能な tableName を確認してください。",
    };
  }

  const warnings: string[] = [];
  const requestedRelatedTables = options.relatedTables ?? [];
  const hasRelatedFilter = requestedRelatedTables.length > 0;
  const relatedFilter = new Set<string>();
  for (const tableName of requestedRelatedTables) {
    const table = findTable(index, tableName);
    if (table) {
      relatedFilter.add(table.name);
      continue;
    }
    warnings.push(`related_table_filter_not_found:${tableName}`);
  }
  const allJoinCandidates = options.includeRelations
    ? (index.relationshipsByTable.get(baseTable.name) ?? []).filter((relationship) => {
        if (!hasRelatedFilter) {
          return true;
        }
        const relatedName =
          relationship.entity1 === baseTable.name ? relationship.entity2 : relationship.entity1;
        return relatedName ? relatedFilter.has(relatedName) : false;
      })
    : [];
  const maxRelatedTables = options.maxRelatedTables ?? DEFAULT_JOIN_TABLE_LIMIT;
  const joinCandidates = allJoinCandidates.slice(0, maxRelatedTables);
  if (allJoinCandidates.length > joinCandidates.length) {
    warnings.push(
      `related_table_output_truncated:${joinCandidates.length}/${allJoinCandidates.length}`,
    );
  }

  const aliases = new Map<string, string>([[baseTable.name, "t0"]]);
  const joinedTables: ParsedA5erTable[] = [];
  const joinClauses: string[] = [];
  let aliasIndex = 1;

  for (const relationship of joinCandidates) {
    const relatedName =
      relationship.entity1 === baseTable.name ? relationship.entity2 : relationship.entity1;
    if (!relatedName || aliases.has(relatedName)) {
      continue;
    }
    const relatedTable = relatedName ? index.tablesByName.get(relatedName) : undefined;
    if (!relatedTable) {
      warnings.push(`related_table_not_found:${relatedName}`);
      continue;
    }
    const alias = `t${aliasIndex}`;
    aliasIndex += 1;
    aliases.set(relatedTable.name, alias);
    joinedTables.push(relatedTable);
    joinClauses.push(buildJoinClause(baseTable, relatedTable, relationship, aliases));
  }

  const selectedTables = [baseTable, ...joinedTables];
  const selectLines = selectedTables.flatMap((table) => {
    const alias = aliases.get(table.name) ?? "t0";
    return table.columns.map(
      (column) =>
        `    ${quoteIdentifier(alias)}.${quoteIdentifier(column.name)} AS ${quoteIdentifier(`${table.name}_${column.name}`)}`,
    );
  });
  const whereColumns = options.whereColumns ?? primaryKeyColumns(baseTable);
  const validWhereColumns = whereColumns.filter((columnName) =>
    baseTable.columns.some((column) => column.name === columnName),
  );
  const invalidWhereColumns = whereColumns.filter(
    (columnName) => !validWhereColumns.includes(columnName),
  );
  for (const columnName of invalidWhereColumns) {
    warnings.push(`where_column_not_found:${baseTable.name}.${columnName}`);
  }

  const sqlLines = [
    "SELECT",
    selectLines.join(",\n"),
    `FROM ${quoteIdentifier(baseTable.name)} AS ${quoteIdentifier("t0")}`,
    ...joinClauses,
  ];
  if (validWhereColumns.length > 0) {
    sqlLines.push(
      "WHERE " +
        validWhereColumns
          .map(
            (columnName) =>
              `${quoteIdentifier("t0")}.${quoteIdentifier(columnName)} = :${columnName}`,
          )
          .join("\n  AND "),
    );
  }
  const orderByColumns = primaryKeyColumns(baseTable);
  if (orderByColumns.length > 0) {
    sqlLines.push(
      `ORDER BY ${orderByColumns.map((columnName) => `${quoteIdentifier("t0")}.${quoteIdentifier(columnName)}`).join(", ")}`,
    );
  }
  if (options.limit !== undefined) {
    sqlLines.push(`LIMIT ${options.limit}`);
  }

  return {
    found: true,
    filePath: result.filePath,
    baseTable: {
      name: baseTable.name,
      logicalName: baseTable.logicalName,
      physicalName: baseTable.physicalName,
    },
    includeRelations: Boolean(options.includeRelations),
    maxRelatedTables,
    relatedRelationshipCount: allJoinCandidates.length,
    truncated: allJoinCandidates.length > joinCandidates.length,
    includedTables: selectedTables.map((table) => table.name),
    parameters: validWhereColumns.map((columnName) => `:${columnName}`),
    sql: `${sqlLines.join("\n")};`,
    warnings,
  };
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
    return unrecognizedA5erResult(result, { found: false });
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

  return {
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
  };
}

export function reviewA5sqlSchema(
  result: A5erCliResult,
  options: { maxIssues?: number; includeInfo?: boolean } = {},
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return unrecognizedA5erResult(result, { found: false, issues: [] });
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
  const limitedIssues = filteredIssues.slice(0, maxIssues);
  return {
    filePath: result.filePath,
    kind: result.kind,
    tableCount: result.parsed.tables.length,
    relationshipCount: result.parsed.relationships.length,
    issueCount: filteredIssues.length,
    truncated: filteredIssues.length > limitedIssues.length,
    summary: summarizeIssues(filteredIssues),
    issues: limitedIssues,
  };
}

export function generateModelFiles(
  result: A5erCliResult,
  options: {
    framework: "laravel" | "sqlalchemy";
    tableNames?: string[];
    maxTables?: number;
  },
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return unrecognizedA5erResult(result, { found: false, framework: options.framework });
  }
  const index = buildA5erIndex(result.parsed);
  const warnings: string[] = [];
  const requestedTables = options.tableNames ?? [];
  const requestedTableNames = new Set<string>();
  const maxTables = options.maxTables ?? DEFAULT_MODEL_TABLE_LIMIT;

  for (const tableName of requestedTables) {
    const table = findTable(index, tableName);
    if (table) {
      requestedTableNames.add(table.name);
      continue;
    }
    warnings.push(`table_filter_not_found:${tableName}`);
  }

  const matchingTables = result.parsed.tables.filter((table) => {
    if (table.objectType !== "entity") {
      return false;
    }
    if (requestedTables.length === 0) {
      return true;
    }
    return requestedTableNames.has(table.name);
  });
  const tables = matchingTables.slice(0, maxTables);
  if (matchingTables.length > tables.length) {
    warnings.push(`table_output_truncated:${tables.length}/${matchingTables.length}`);
  }

  const files =
    options.framework === "laravel"
      ? tables.map((table) => generateLaravelModelFile(table, result.parsed.relationships))
      : [generateSqlAlchemyModelsFile(tables, result.parsed.relationships)];

  return {
    filePath: result.filePath,
    kind: result.kind,
    framework: options.framework,
    tableCount: tables.length,
    totalMatchedTableCount: matchingTables.length,
    maxTables,
    truncated: matchingTables.length > tables.length,
    files,
    warnings,
  };
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
    return result;
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

  return {
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
  };
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
    return {
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
    };
  }

  if (
    result.kind === "sql" &&
    typeof result.parsed === "object" &&
    result.parsed !== null &&
    "statements" in result.parsed &&
    Array.isArray(result.parsed.statements)
  ) {
    const statements = result.parsed.statements.slice(0, limit);
    return {
      filePath: result.filePath,
      kind: result.kind,
      mode: "summary",
      fileEncoding: result.encoding,
      statementCount: result.parsed.statements.length,
      summaryLimit: limit,
      statements,
      truncated: result.parsed.statements.length > statements.length,
      nextAction: "全量が必要な場合は mode=full を指定してください。",
    };
  }

  if (
    result.kind === "text" &&
    typeof result.parsed === "object" &&
    result.parsed !== null &&
    "text" in result.parsed &&
    typeof result.parsed.text === "string"
  ) {
    const maxChars = Math.min(limit * 100, 10_000);
    const text = result.parsed.text.slice(0, maxChars);
    return {
      filePath: result.filePath,
      kind: result.kind,
      mode: "summary",
      fileEncoding: result.encoding,
      totalChars: result.parsed.text.length,
      previewChars: text.length,
      text,
      truncated: result.parsed.text.length > text.length,
      nextAction: "read_a5sql_file で必要な範囲を指定するか、mode=full を指定してください。",
    };
  }

  return {
    filePath: result.filePath,
    kind: result.kind,
    mode: "summary",
    fileEncoding: result.encoding,
    parsed: result.parsed,
  };
}

export function isRecognizedA5erParsed(result: A5erCliResult): boolean {
  return result.parsed.parseStatus === "ok";
}

export function unrecognizedA5erResult(result: A5erCliResult, extra: JsonObject = {}): JsonObject {
  return {
    ...extra,
    filePath: result.filePath,
    kind: result.kind,
    encoding: result.encoding,
    parseStatus: result.parsed.parseStatus,
    warnings: result.parsed.warnings,
    message: "configured_a5er_file_is_not_recognized",
    nextAction:
      "parse_a5sql_file の summary と read_a5sql_file で、ファイル形式と文字コードを確認してください。",
  };
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
    return {
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
    };
  }

  const offset = options.offsetChars ?? 0;
  const outputText = text.slice(offset, offset + options.maxChars);
  const nextOffset = offset + outputText.length;
  const hasMore = nextOffset < text.length;
  return {
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
  };
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

type A5erLookupIndex = {
  tablesByName: Map<string, ParsedA5erTable>;
  tablesByLookupName: Map<string, ParsedA5erTable>;
  relationshipsByTable: Map<string, ParsedA5erRelationship[]>;
};

function buildA5erIndex(document: ParsedA5erDocument): A5erLookupIndex {
  const tablesByName = new Map<string, ParsedA5erTable>();
  const tablesByLookupName = new Map<string, ParsedA5erTable>();
  const relationshipsByTable = new Map<string, ParsedA5erRelationship[]>();

  for (const table of document.tables) {
    tablesByName.set(table.name, table);
    for (const name of [table.name, table.physicalName, table.logicalName]) {
      if (!name) {
        continue;
      }
      const key = normalizeLookupName(name);
      if (!tablesByLookupName.has(key)) {
        tablesByLookupName.set(key, table);
      }
    }
  }

  for (const relationship of document.relationships) {
    for (const tableName of [relationship.entity1, relationship.entity2]) {
      if (!tableName) {
        continue;
      }
      const relationships = relationshipsByTable.get(tableName) ?? [];
      relationships.push(relationship);
      relationshipsByTable.set(tableName, relationships);
    }
  }

  return {
    tablesByName,
    tablesByLookupName,
    relationshipsByTable,
  };
}

function relationshipSummary(
  relationship: ParsedA5erRelationship,
  index: A5erLookupIndex,
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

function findTable(index: A5erLookupIndex, tableName: string): ParsedA5erTable | undefined {
  return index.tablesByLookupName.get(normalizeLookupName(tableName));
}

function normalizeLookupName(value: string): string {
  return value.toLocaleLowerCase();
}

function primaryKeyColumns(table: ParsedA5erTable): string[] {
  return table.columns
    .filter((column) => column.primaryKey)
    .sort((a, b) => (a.keyOrder ?? 0) - (b.keyOrder ?? 0))
    .map((column) => column.name);
}

function buildJoinClause(
  baseTable: ParsedA5erTable,
  relatedTable: ParsedA5erTable,
  relationship: ParsedA5erRelationship,
  aliases: Map<string, string>,
): string {
  const baseAlias = aliases.get(baseTable.name) ?? "t0";
  const relatedAlias = aliases.get(relatedTable.name) ?? "t1";
  const pairs =
    relationship.entity1 === baseTable.name
      ? relationship.fields1.map((sourceColumn, index) => ({
          baseColumn: sourceColumn,
          relatedColumn: relationship.fields2[index] ?? relationship.fields2[0] ?? "id",
        }))
      : relationship.fields2.map((sourceColumn, index) => ({
          baseColumn: sourceColumn,
          relatedColumn: relationship.fields1[index] ?? relationship.fields1[0] ?? "id",
        }));
  const condition = pairs
    .map(
      (pair) =>
        `${quoteIdentifier(relatedAlias)}.${quoteIdentifier(pair.relatedColumn)} = ${quoteIdentifier(baseAlias)}.${quoteIdentifier(pair.baseColumn)}`,
    )
    .join(" AND ");
  return `LEFT JOIN ${quoteIdentifier(relatedTable.name)} AS ${quoteIdentifier(relatedAlias)} ON ${condition}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
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

function generateLaravelModelFile(
  table: ParsedA5erTable,
  relationships: ParsedA5erRelationship[],
): JsonObject {
  const className = modelClassName(table.name);
  const fillableColumns = table.columns
    .filter((column) => !column.primaryKey)
    .map((column) => column.name);
  const casts = table.columns
    .map((column) => [column.name, laravelCast(column)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined);
  const relationMethods = laravelRelationMethods(table, relationships);
  const lines = [
    "<?php",
    "",
    "namespace App\\Models;",
    "",
    "use Illuminate\\Database\\Eloquent\\Model;",
    "",
    `class ${className} extends Model`,
    "{",
    `    protected $table = '${table.name}';`,
    "",
    "    public $timestamps = false;",
    "",
    ...phpArrayProperty("fillable", fillableColumns),
    "",
    ...phpAssocArrayProperty("casts", casts),
    ...relationMethods,
    "}",
    "",
  ];
  return {
    path: `app/Models/${className}.php`,
    tableName: table.name,
    content: lines.join("\n"),
  };
}

function generateSqlAlchemyModelsFile(
  tables: ParsedA5erTable[],
  relationships: ParsedA5erRelationship[],
): JsonObject {
  const relationshipForeignKeys = sqlAlchemyForeignKeyMap(relationships);
  const imports = new Set<string>(["DeclarativeBase", "Mapped", "mapped_column"]);
  const typeImports = new Set<string>();
  const lines = [
    "from __future__ import annotations",
    "",
    "from sqlalchemy import ForeignKey",
    "from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column",
    "",
    "",
    "class Base(DeclarativeBase):",
    "    pass",
    "",
  ];

  for (const table of tables) {
    lines.push(
      "",
      `class ${modelClassName(table.name)}(Base):`,
      `    __tablename__ = "${table.name}"`,
    );
    if (table.columns.length === 0) {
      lines.push("    pass", "");
      continue;
    }
    for (const column of table.columns) {
      const mappedType = sqlAlchemyType(column.dataType);
      imports.add(mappedType.sqlalchemyType);
      typeImports.add(mappedType.pythonType);
      const args = [`${mappedType.sqlalchemyType}()`];
      const foreignKey = relationshipForeignKeys.get(`${table.name}.${column.name}`);
      if (foreignKey) {
        args.push(`ForeignKey("${foreignKey}")`);
      }
      const options = [
        column.primaryKey ? "primary_key=True" : undefined,
        column.nullable === false ? "nullable=False" : undefined,
      ].filter((value): value is string => value !== undefined);
      lines.push(
        `    ${column.name}: Mapped[${mappedType.pythonType}] = mapped_column(${[...args, ...options].join(", ")})`,
      );
    }
    lines.push("");
  }

  const importLine = `from sqlalchemy import ${["ForeignKey", ...[...imports].filter((item) => !["DeclarativeBase", "Mapped", "mapped_column"].includes(item)).sort()].join(", ")}`;
  lines[2] = importLine;
  if (typeImports.has("datetime")) {
    lines.splice(2, 0, "from datetime import datetime");
  }
  return {
    path: "models.py",
    tableName: undefined,
    content: lines.join("\n"),
  };
}

function phpArrayProperty(propertyName: string, values: string[]): string[] {
  if (values.length === 0) {
    return [`    protected $${propertyName} = [];`];
  }
  return [
    `    protected $${propertyName} = [`,
    ...values.map((value) => `        '${value}',`),
    "    ];",
  ];
}

function phpAssocArrayProperty(
  propertyName: string,
  values: readonly (readonly [string, string])[],
): string[] {
  if (values.length === 0) {
    return [`    protected $${propertyName} = [];`];
  }
  return [
    `    protected $${propertyName} = [`,
    ...values.map(([key, value]) => `        '${key}' => '${value}',`),
    "    ];",
  ];
}

function laravelRelationMethods(
  table: ParsedA5erTable,
  relationships: ParsedA5erRelationship[],
): string[] {
  const methods: string[] = [];
  for (const relationship of relationships) {
    if (!relationship.entity1 || !relationship.entity2) {
      continue;
    }
    if (relationship.entity1 === table.name) {
      const methodType = relationship.relationType2 === 3 ? "hasMany" : "hasOne";
      const relatedClass = modelClassName(relationship.entity2);
      const methodName =
        methodType === "hasMany"
          ? pluralCamelCase(relationship.entity2)
          : camelCase(relationship.entity2);
      methods.push(
        "",
        `    public function ${methodName}()`,
        "    {",
        `        return $this->${methodType}(${relatedClass}::class, '${relationship.fields2[0] ?? "id"}', '${relationship.fields1[0] ?? "id"}');`,
        "    }",
      );
    }
    if (relationship.entity2 === table.name) {
      const relatedClass = modelClassName(relationship.entity1);
      const methodName = camelCase(relationship.entity1);
      methods.push(
        "",
        `    public function ${methodName}()`,
        "    {",
        `        return $this->belongsTo(${relatedClass}::class, '${relationship.fields2[0] ?? "id"}', '${relationship.fields1[0] ?? "id"}');`,
        "    }",
      );
    }
  }
  return methods;
}

function laravelCast(column: ParsedA5erColumn): string | undefined {
  const dataType = column.dataType?.toLocaleLowerCase() ?? "";
  if (/(bigint|bigserial|int|integer|serial|smallint)/.test(dataType)) {
    return "integer";
  }
  if (/(decimal|numeric|float|double|real)/.test(dataType)) {
    return "decimal:2";
  }
  if (/(bool|boolean)/.test(dataType)) {
    return "boolean";
  }
  if (/(timestamp|datetime|date)/.test(dataType)) {
    return "datetime";
  }
  return undefined;
}

function sqlAlchemyType(dataType: string | undefined): {
  sqlalchemyType: string;
  pythonType: string;
} {
  const normalized = dataType?.toLocaleLowerCase() ?? "";
  if (/(bigint|bigserial)/.test(normalized)) {
    return { sqlalchemyType: "BigInteger", pythonType: "int" };
  }
  if (/(int|integer|serial|smallint)/.test(normalized)) {
    return { sqlalchemyType: "Integer", pythonType: "int" };
  }
  if (/(decimal|numeric)/.test(normalized)) {
    return { sqlalchemyType: "Numeric", pythonType: "float" };
  }
  if (/(float|double|real)/.test(normalized)) {
    return { sqlalchemyType: "Float", pythonType: "float" };
  }
  if (/(bool|boolean)/.test(normalized)) {
    return { sqlalchemyType: "Boolean", pythonType: "bool" };
  }
  if (/(timestamp|datetime)/.test(normalized)) {
    return { sqlalchemyType: "DateTime", pythonType: "datetime" };
  }
  if (/(date)/.test(normalized)) {
    return { sqlalchemyType: "Date", pythonType: "datetime" };
  }
  if (/(text)/.test(normalized)) {
    return { sqlalchemyType: "Text", pythonType: "str" };
  }
  return { sqlalchemyType: "String", pythonType: "str" };
}

function sqlAlchemyForeignKeyMap(relationships: ParsedA5erRelationship[]): Map<string, string> {
  const foreignKeys = new Map<string, string>();
  for (const relationship of relationships) {
    if (!relationship.entity1 || !relationship.entity2) {
      continue;
    }
    for (const [index, columnName] of relationship.fields2.entries()) {
      const sourceColumn = relationship.fields1[index] ?? relationship.fields1[0];
      if (sourceColumn) {
        foreignKeys.set(
          `${relationship.entity2}.${columnName}`,
          `${relationship.entity1}.${sourceColumn}`,
        );
      }
    }
  }
  return foreignKeys;
}

function modelClassName(tableName: string): string {
  return toWords(singularize(tableName))
    .map((word) => word[0]!.toLocaleUpperCase() + word.slice(1))
    .join("");
}

function camelCase(tableName: string): string {
  const className = modelClassName(tableName);
  return className[0]!.toLocaleLowerCase() + className.slice(1);
}

function pluralCamelCase(tableName: string): string {
  const words = toWords(tableName);
  const className = words.map((word) => word[0]!.toLocaleUpperCase() + word.slice(1)).join("");
  return className[0]!.toLocaleLowerCase() + className.slice(1);
}

function toWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLocaleLowerCase());
}

function singularize(value: string): string {
  if (value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith("s") && !value.endsWith("ss")) {
    return value.slice(0, -1);
  }
  return value;
}
