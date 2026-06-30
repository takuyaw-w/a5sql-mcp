import type {
  ParsedA5erColumn,
  ParsedA5erRelationship,
  ParsedA5erTable,
} from "@takuyaw-w/a5sql-mcp-parser";

import {
  buildA5erIndex,
  findTable,
  isRecognizedA5erParsed,
  normalizeLookupName,
  primaryKeyColumns,
  unrecognizedA5erResult,
} from "./a5er-output-utils.js";
import type {
  LiveSchemaColumn,
  LiveSchemaDocument,
  LiveSchemaTable,
} from "./schema-compare/types.js";
import type { A5erCliResult, JsonObject } from "./types.js";

const DEFAULT_MODEL_TABLE_LIMIT = 20;
const DEFAULT_JOIN_TABLE_LIMIT = 10;
const DEFAULT_SCHEMA_MARKDOWN_TABLE_LIMIT = 100;
const DEFAULT_SCHEMA_MARKDOWN_COLUMNS_PER_TABLE_LIMIT = 100;
const DEFAULT_MIGRATION_OPERATION_LIMIT = 100;

const GENERATION_DRAFT_DISCLOSURE = {
  outputKind: "draft",
  readOnly: true,
  writesToFileSystem: false,
  connectsToDatabase: false,
  executesSql: false,
} as const;

function withGenerationDraftDisclosure(output: JsonObject): JsonObject {
  return {
    ...GENERATION_DRAFT_DISCLOSURE,
    ...output,
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

  return withGenerationDraftDisclosure({
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
  });
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
  return withGenerationDraftDisclosure({
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
  });
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

  return withGenerationDraftDisclosure({
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
  });
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

  return withGenerationDraftDisclosure({
    filePath: result.filePath,
    kind: result.kind,
    framework: options.framework,
    tableCount: tables.length,
    totalMatchedTableCount: matchingTables.length,
    maxTables,
    truncated: matchingTables.length > tables.length,
    files,
    warnings,
  });
}

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

type LiveSchemaLookup = {
  tables: Array<{ key: string; table: LiveSchemaTable }>;
  tablesByName: Map<string, { key: string; table: LiveSchemaTable }>;
};
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
