import type {
  ParsedA5erColumn,
  ParsedA5erDocument,
  ParsedA5erRelationship,
  ParsedA5erTable,
} from "@takuyaw-w/a5sql-mcp-parser";
import { maskSensitiveText } from "@takuyaw-w/a5sql-mcp-core";

import type { CliResult } from "../index.js";
import type {
  LiveSchemaColumn,
  LiveSchemaDocument,
  LiveSchemaTable,
} from "./schema-compare/types.js";
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
const DEFAULT_COLUMN_SEARCH_LIMIT = 100;
const DEFAULT_SCHEMA_MARKDOWN_TABLE_LIMIT = 100;
const DEFAULT_SCHEMA_MARKDOWN_COLUMNS_PER_TABLE_LIMIT = 100;
const DEFAULT_SCHEMA_SUGGESTION_LIMIT = 100;
const DEFAULT_MIGRATION_OPERATION_LIMIT = 100;

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

export function explainA5sqlTable(
  result: A5erCliResult,
  options: { tableName: string; maxRelatedTables?: number },
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
      nextAction: "find_a5sql_tables で利用可能な tableName を確認してください。",
    };
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

  return {
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
  };
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
    return unrecognizedA5erResult(result, { query: options.query, columns: [] });
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
  const page = matches.slice(offset, offset + limit);

  return {
    filePath: result.filePath,
    kind: result.kind,
    query,
    dataType: options.dataType,
    tableNames: requestedTables,
    totalColumnCount: matches.length,
    offset,
    limit,
    returnedColumnCount: page.length,
    hasMore: offset + page.length < matches.length,
    truncated: offset + page.length < matches.length,
    columns: page.map(({ table, column, matchedBy }) => ({
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

export function suggestSchemaChanges(
  result: A5erCliResult,
  options: { maxSuggestions?: number; includeInfo?: boolean } = {},
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return unrecognizedA5erResult(result, { found: false, suggestions: [] });
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
  const limitedSuggestions = suggestions.slice(0, maxSuggestions);

  return {
    filePath: result.filePath,
    kind: result.kind,
    tableCount: result.parsed.tables.length,
    relationshipCount: result.parsed.relationships.length,
    issueCount: review.issueCount,
    suggestionCount: suggestions.length,
    returnedSuggestionCount: limitedSuggestions.length,
    maxSuggestions,
    truncated: suggestions.length > limitedSuggestions.length,
    summary: review.summary,
    suggestions: limitedSuggestions,
    nextAction: "提案は設計レビュー用です。A5:ER ファイル、DB、生成ファイルには書き込みません。",
  };
}

export function generateMigrationPlan(
  result: A5erCliResult,
  options: {
    liveSchema: LiveSchemaDocument;
    style?: "plain_sql" | "laravel" | "alembic";
    tableNames?: string[];
    includeDestructive?: boolean;
    maxOperations?: number;
  },
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return unrecognizedA5erResult(result, { found: false, operations: [] });
  }
  const style = options.style ?? "plain_sql";
  const includeDestructive = options.includeDestructive ?? false;
  const maxOperations = options.maxOperations ?? DEFAULT_MIGRATION_OPERATION_LIMIT;
  const index = buildA5erIndex(result.parsed);
  const liveIndex = buildLiveSchemaLookup(options.liveSchema);
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

  const operations: MigrationOperation[] = [];
  const matchedLiveTables = new Set<string>();
  const a5erTables = result.parsed.tables.filter((table) => {
    if (requestedTables.length === 0) {
      return true;
    }
    return requestedTableNames.has(table.name);
  });

  for (const table of a5erTables) {
    const liveTable = findLiveSchemaTable(liveIndex, table);
    if (!liveTable) {
      operations.push({
        kind: "create_table",
        destructive: false,
        table: table.name,
        reason: "A5:ER に存在するテーブルが live schema にありません。",
        statements: renderMigrationStatements(style, "create_table", table),
      });
      continue;
    }
    matchedLiveTables.add(liveTable.key);
    const liveColumns = buildLiveColumnLookup(liveTable.table);
    const matchedLiveColumns = new Set<string>();
    for (const column of table.columns) {
      const liveColumn = findLiveColumnByA5erColumn(liveColumns, column);
      if (!liveColumn) {
        operations.push({
          kind: "add_column",
          destructive: false,
          table: table.name,
          column: column.name,
          reason: "A5:ER に存在するカラムが live schema にありません。",
          statements: renderMigrationStatements(style, "add_column", table, column),
        });
        continue;
      }
      matchedLiveColumns.add(normalizeLookupName(liveColumn.name));
      if (
        column.dataType &&
        liveColumn.dataType &&
        !sameDataType(column.dataType, liveColumn.dataType)
      ) {
        operations.push({
          kind: "alter_column_type",
          destructive: false,
          table: table.name,
          column: column.name,
          reason: "A5:ER と live schema の型が一致しません。",
          statements: renderMigrationStatements(style, "alter_column_type", table, column),
        });
      }
      if (liveColumn.nullable !== undefined) {
        const a5erNullable = column.nullable ?? true;
        if (a5erNullable !== liveColumn.nullable) {
          operations.push({
            kind: "alter_column_nullable",
            destructive: false,
            table: table.name,
            column: column.name,
            reason: "A5:ER と live schema の NULL 許容が一致しません。",
            statements: renderMigrationStatements(style, "alter_column_nullable", table, column),
          });
        }
      }
    }

    for (const liveColumn of liveTable.table.columns) {
      if (matchedLiveColumns.has(normalizeLookupName(liveColumn.name))) {
        continue;
      }
      if (includeDestructive) {
        operations.push({
          kind: "drop_column",
          destructive: true,
          table: table.name,
          column: liveColumn.name,
          reason: "live schema にだけ存在するカラムです。",
          statements: renderMigrationStatements(style, "drop_column", table, undefined, liveColumn),
        });
      } else {
        warnings.push(`extra_live_column_skipped:${table.name}.${liveColumn.name}`);
      }
    }
  }

  if (includeDestructive && requestedTables.length === 0) {
    for (const liveTable of liveIndex.tables) {
      if (matchedLiveTables.has(liveTable.key)) {
        continue;
      }
      operations.push({
        kind: "drop_table",
        destructive: true,
        table: liveTable.table.name,
        reason: "live schema にだけ存在するテーブルです。",
        statements: renderMigrationStatements(
          style,
          "drop_table",
          undefined,
          undefined,
          undefined,
          liveTable.table,
        ),
      });
    }
  }

  const limitedOperations = operations.slice(0, maxOperations);
  return {
    found: true,
    filePath: result.filePath,
    kind: result.kind,
    style,
    includeDestructive,
    operationCount: operations.length,
    returnedOperationCount: limitedOperations.length,
    maxOperations,
    truncated: operations.length > limitedOperations.length,
    operations: limitedOperations,
    plan: renderMigrationPlan(style, limitedOperations),
    warnings,
    nextAction:
      "migration plan は案です。実行前に DB 方言、既存データ、制約名、インデックスを確認してください。",
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

export function generateSchemaMarkdown(
  result: A5erCliResult,
  options: {
    tableNames?: string[];
    includeRelationships?: boolean;
    includeViews?: boolean;
    maxTables?: number;
    maxColumnsPerTable?: number;
  } = {},
): JsonObject {
  if (!isRecognizedA5erParsed(result)) {
    return unrecognizedA5erResult(result, { found: false, markdown: "" });
  }
  const index = buildA5erIndex(result.parsed);
  const warnings: string[] = [];
  const includeRelationships = options.includeRelationships ?? true;
  const includeViews = options.includeViews ?? true;
  const maxTables = options.maxTables ?? DEFAULT_SCHEMA_MARKDOWN_TABLE_LIMIT;
  const maxColumnsPerTable =
    options.maxColumnsPerTable ?? DEFAULT_SCHEMA_MARKDOWN_COLUMNS_PER_TABLE_LIMIT;
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
  const tables = matchingTables.slice(0, maxTables);
  if (matchingTables.length > tables.length) {
    warnings.push(`table_output_truncated:${tables.length}/${matchingTables.length}`);
  }
  const tableNameSet = new Set(tables.map((table) => table.name));
  const lines = [
    "# Schema Definition",
    "",
    `- Source: ${result.filePath}`,
    `- Tables: ${tables.length}/${matchingTables.length}`,
    `- Relationships: ${result.parsed.relationships.length}`,
    "",
  ];

  for (const table of tables) {
    lines.push(
      `## ${markdownCell(table.name)}${table.logicalName ? ` (${markdownCell(table.logicalName)})` : ""}`,
    );
    if (table.comment) {
      lines.push("", table.comment, "");
    } else {
      lines.push("");
    }
    lines.push("| Column | Logical Name | Type | PK | Null | Comment |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    const columns = table.columns.slice(0, maxColumnsPerTable);
    for (const column of columns) {
      lines.push(
        `| ${markdownCell(column.name)} | ${markdownCell(column.logicalName)} | ${markdownCell(column.dataType)} | ${column.primaryKey ? "yes" : ""} | ${column.nullable === false ? "no" : "yes"} | ${markdownCell(column.comment)} |`,
      );
    }
    if (table.columns.length > columns.length) {
      lines.push(
        `| ... | ... | ... | ... | ... | ${table.columns.length - columns.length} columns omitted |`,
      );
      warnings.push(
        `column_output_truncated:${table.name}:${columns.length}/${table.columns.length}`,
      );
    }
    lines.push("");
  }

  if (includeRelationships) {
    lines.push("## Relationships", "");
    lines.push("| Source | Columns | Target | Columns | Caption |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const relationship of result.parsed.relationships) {
      if (
        !relationship.entity1 ||
        !relationship.entity2 ||
        !tableNameSet.has(relationship.entity1) ||
        !tableNameSet.has(relationship.entity2)
      ) {
        continue;
      }
      lines.push(
        `| ${markdownCell(relationship.entity1)} | ${markdownCell(relationship.fields1.join(", "))} | ${markdownCell(relationship.entity2)} | ${markdownCell(relationship.fields2.join(", "))} | ${markdownCell(relationship.caption ?? relationship.name)} |`,
      );
    }
    lines.push("");
  }

  return {
    filePath: result.filePath,
    kind: result.kind,
    tableCount: tables.length,
    totalMatchedTableCount: matchingTables.length,
    maxTables,
    maxColumnsPerTable,
    truncated:
      matchingTables.length > tables.length ||
      warnings.some((warning) => warning.startsWith("column_output_truncated:")),
    markdown: lines.join("\n"),
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
    return {
      ...result,
      parsed: maskParsedValue(result.parsed),
    };
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
    const statements = maskParsedValue(result.parsed.statements.slice(0, limit)) as unknown[];
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
    const text = maskSensitiveText(result.parsed.text.slice(0, maxChars));
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
    parsed: maskParsedValue(result.parsed),
  };
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

type MigrationOperation = {
  kind:
    | "create_table"
    | "add_column"
    | "alter_column_type"
    | "alter_column_nullable"
    | "drop_column"
    | "drop_table";
  destructive: boolean;
  table: string;
  column?: string;
  reason: string;
  statements: string[];
};

type A5erLookupIndex = {
  tablesByName: Map<string, ParsedA5erTable>;
  tablesByLookupName: Map<string, ParsedA5erTable>;
  relationshipsByTable: Map<string, ParsedA5erRelationship[]>;
};

type LiveSchemaLookup = {
  tables: Array<{ key: string; table: LiveSchemaTable }>;
  tablesByName: Map<string, { key: string; table: LiveSchemaTable }>;
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

function relatedTableSummary(
  table: ParsedA5erTable,
  relationship: ParsedA5erRelationship,
  index: A5erLookupIndex,
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

function buildLiveSchemaLookup(liveSchema: LiveSchemaDocument): LiveSchemaLookup {
  const tables: Array<{ key: string; table: LiveSchemaTable }> = [];
  const tablesByName = new Map<string, { key: string; table: LiveSchemaTable }>();
  for (const table of liveSchema.tables) {
    const key = table.schema ? `${table.schema}.${table.name}` : table.name;
    const indexed = { key, table };
    tables.push(indexed);
    for (const name of [table.name, key]) {
      const lookupKey = normalizeLookupName(name);
      if (!tablesByName.has(lookupKey)) {
        tablesByName.set(lookupKey, indexed);
      }
    }
  }
  return { tables, tablesByName };
}

function findLiveSchemaTable(
  liveIndex: LiveSchemaLookup,
  table: ParsedA5erTable,
): { key: string; table: LiveSchemaTable } | undefined {
  for (const name of [table.name, table.physicalName, table.logicalName]) {
    if (!name) {
      continue;
    }
    const liveTable = liveIndex.tablesByName.get(normalizeLookupName(name));
    if (liveTable) {
      return liveTable;
    }
  }
  return undefined;
}

function buildLiveColumnLookup(table: LiveSchemaTable): Map<string, LiveSchemaColumn> {
  const columns = new Map<string, LiveSchemaColumn>();
  for (const column of table.columns) {
    const key = normalizeLookupName(column.name);
    if (!columns.has(key)) {
      columns.set(key, column);
    }
  }
  return columns;
}

function findLiveColumnByA5erColumn(
  liveColumns: Map<string, LiveSchemaColumn>,
  column: ParsedA5erColumn,
): LiveSchemaColumn | undefined {
  for (const name of [column.name, column.physicalName, column.logicalName]) {
    if (!name) {
      continue;
    }
    const liveColumn = liveColumns.get(normalizeLookupName(name));
    if (liveColumn) {
      return liveColumn;
    }
  }
  return undefined;
}

function sameDataType(a5erType: string, liveType: string): boolean {
  return normalizeTypeForPlan(a5erType) === normalizeTypeForPlan(liveType);
}

function normalizeTypeForPlan(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[`"[\]]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+not null\b/g, "")
    .trim();
}

function renderMigrationStatements(
  style: "plain_sql" | "laravel" | "alembic",
  kind: MigrationOperation["kind"],
  table?: ParsedA5erTable,
  column?: ParsedA5erColumn,
  liveColumn?: LiveSchemaColumn,
  liveTable?: LiveSchemaTable,
): string[] {
  const tableName = table?.name ?? liveTable?.name ?? "unknown_table";
  const columnName = column?.name ?? liveColumn?.name ?? "unknown_column";
  if (kind === "create_table" && table) {
    if (style === "laravel") {
      return renderLaravelCreateTableStatement(table);
    }
    if (style === "alembic") {
      return renderAlembicCreateTableStatement(table);
    }
    return renderPlainSqlCreateTableStatement(table);
  }
  if (style === "laravel") {
    return renderLaravelMigrationStatement(kind, tableName, columnName, column);
  }
  if (style === "alembic") {
    return renderAlembicMigrationStatement(kind, tableName, columnName, column);
  }
  return renderPlainSqlMigrationStatement(kind, tableName, columnName, column);
}

function renderPlainSqlCreateTableStatement(table: ParsedA5erTable): string[] {
  const columns =
    table.columns.length > 0
      ? table.columns.map((column) => `  ${plainSqlColumnDefinition(column)}`)
      : ["  -- TODO: add columns from A5:ER definition"];
  return [`CREATE TABLE ${quoteIdentifier(table.name)} (`, columns.join(",\n"), ");"];
}

function renderLaravelCreateTableStatement(table: ParsedA5erTable): string[] {
  const lines = [
    `Schema::create('${table.name}', function (Blueprint $table) {`,
    ...(table.columns.length > 0
      ? table.columns.map((column) => `    ${laravelColumnExpression(column)};`)
      : ["    // TODO: add columns from A5:ER definition"]),
    "});",
  ];
  return lines;
}

function renderAlembicCreateTableStatement(table: ParsedA5erTable): string[] {
  const columns =
    table.columns.length > 0
      ? table.columns.map(
          (column) =>
            `    sa.Column("${column.name}", ${alembicColumnType(column)}, nullable=${column.nullable === false || column.primaryKey ? "False" : "True"}${column.primaryKey ? ", primary_key=True" : ""}),`,
        )
      : ["    # TODO: add columns from A5:ER definition"];
  return [`op.create_table("${table.name}",`, ...columns, ")"];
}

function renderPlainSqlMigrationStatement(
  kind: MigrationOperation["kind"],
  tableName: string,
  columnName: string,
  column?: ParsedA5erColumn,
): string[] {
  switch (kind) {
    case "create_table":
      return [
        `CREATE TABLE ${quoteIdentifier(tableName)} (`,
        column
          ? `  ${plainSqlColumnDefinition(column)}`
          : "  -- TODO: add columns from A5:ER definition",
        ");",
      ];
    case "add_column":
      return [
        `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${column ? plainSqlColumnDefinition(column) : quoteIdentifier(columnName)};`,
      ];
    case "alter_column_type":
      return [
        `ALTER TABLE ${quoteIdentifier(tableName)} ALTER COLUMN ${quoteIdentifier(columnName)} TYPE ${column?.dataType ?? "TEXT"};`,
      ];
    case "alter_column_nullable":
      return [
        `ALTER TABLE ${quoteIdentifier(tableName)} ALTER COLUMN ${quoteIdentifier(columnName)} ${column?.nullable === false ? "SET NOT NULL" : "DROP NOT NULL"};`,
      ];
    case "drop_column":
      return [
        `ALTER TABLE ${quoteIdentifier(tableName)} DROP COLUMN ${quoteIdentifier(columnName)};`,
      ];
    case "drop_table":
      return [`DROP TABLE ${quoteIdentifier(tableName)};`];
  }
}

function renderLaravelMigrationStatement(
  kind: MigrationOperation["kind"],
  tableName: string,
  columnName: string,
  column?: ParsedA5erColumn,
): string[] {
  switch (kind) {
    case "create_table":
      return [
        `Schema::create('${tableName}', function (Blueprint $table) {`,
        "    // TODO: add columns from A5:ER definition",
        "});",
      ];
    case "add_column":
      return [
        `Schema::table('${tableName}', function (Blueprint $table) {`,
        `    ${laravelColumnExpression(column ?? ({ name: columnName } as ParsedA5erColumn))};`,
        "});",
      ];
    case "alter_column_type":
    case "alter_column_nullable":
      return [
        `Schema::table('${tableName}', function (Blueprint $table) {`,
        `    ${laravelColumnExpression(column ?? ({ name: columnName } as ParsedA5erColumn))}->change();`,
        "});",
      ];
    case "drop_column":
      return [
        `Schema::table('${tableName}', function (Blueprint $table) {`,
        `    $table->dropColumn('${columnName}');`,
        "});",
      ];
    case "drop_table":
      return [`Schema::dropIfExists('${tableName}');`];
  }
}

function renderAlembicMigrationStatement(
  kind: MigrationOperation["kind"],
  tableName: string,
  columnName: string,
  column?: ParsedA5erColumn,
): string[] {
  switch (kind) {
    case "create_table":
      return [`op.create_table("${tableName}", sa.Column("id", sa.Integer(), primary_key=True))`];
    case "add_column":
      return [
        `op.add_column("${tableName}", sa.Column("${columnName}", ${alembicColumnType(column)}, nullable=${column?.nullable === false ? "False" : "True"}))`,
      ];
    case "alter_column_type":
      return [
        `op.alter_column("${tableName}", "${columnName}", type_=${alembicColumnType(column)})`,
      ];
    case "alter_column_nullable":
      return [
        `op.alter_column("${tableName}", "${columnName}", nullable=${column?.nullable === false ? "False" : "True"})`,
      ];
    case "drop_column":
      return [`op.drop_column("${tableName}", "${columnName}")`];
    case "drop_table":
      return [`op.drop_table("${tableName}")`];
  }
}

function plainSqlColumnDefinition(column: ParsedA5erColumn): string {
  return [
    quoteIdentifier(column.name),
    column.dataType ?? "TEXT",
    column.nullable === false || column.primaryKey ? "NOT NULL" : undefined,
    column.primaryKey ? "PRIMARY KEY" : undefined,
  ]
    .filter((value): value is string => value !== undefined)
    .join(" ");
}

function laravelColumnExpression(column: ParsedA5erColumn): string {
  const type = column.dataType?.toLocaleLowerCase() ?? "";
  const method = /(bigint|bigserial)/.test(type)
    ? "bigInteger"
    : /(int|integer|serial|smallint)/.test(type)
      ? "integer"
      : /(bool|boolean)/.test(type)
        ? "boolean"
        : /(timestamp|datetime)/.test(type)
          ? "dateTime"
          : /(date)/.test(type)
            ? "date"
            : /(text)/.test(type)
              ? "text"
              : "string";
  const suffixes = [
    column.nullable === false || column.primaryKey ? undefined : "->nullable()",
    column.primaryKey ? "->primary()" : undefined,
  ].filter((value): value is string => value !== undefined);
  return `$table->${method}('${column.name}')${suffixes.join("")}`;
}

function alembicColumnType(column: ParsedA5erColumn | undefined): string {
  const mapped = sqlAlchemyType(column?.dataType);
  return `sa.${mapped.sqlalchemyType}()`;
}

function renderMigrationPlan(
  style: "plain_sql" | "laravel" | "alembic",
  operations: MigrationOperation[],
): string {
  if (operations.length === 0) {
    return "No migration operations are suggested.";
  }
  const lines = [`# Migration Plan (${style})`, ""];
  for (const [index, operation] of operations.entries()) {
    lines.push(
      `## ${index + 1}. ${operation.kind}: ${operation.table}${operation.column ? `.${operation.column}` : ""}`,
      "",
      operation.reason,
      "",
      "```",
      ...operation.statements,
      "```",
      "",
    );
  }
  return lines.join("\n");
}

function markdownCell(value: string | undefined): string {
  return (value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
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
