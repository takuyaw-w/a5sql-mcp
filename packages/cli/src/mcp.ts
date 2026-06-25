import { stat } from "node:fs/promises";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type {
  ParsedA5erColumn,
  ParsedA5erDocument,
  ParsedA5erRelationship,
  ParsedA5erTable,
} from "@takuyaw-w/a5sql-mcp-parser";
import { z } from "zod";

import { parseFile, readTextFile, type CliResult } from "./index.js";

type JsonObject = Record<string, unknown>;

export type A5erCliResult = CliResult & {
  kind: "a5er";
  parsed: ParsedA5erDocument;
};

export type McpServerOptions = {
  fileArg: string;
};

export async function runMcpServer({ fileArg }: McpServerOptions): Promise<void> {
  const initialFile = await parseFile(fileArg);
  const server = new McpServer({
    name: "a5sql-mcp",
    version: "0.2.1",
  });

  server.registerTool(
    "describe_a5sql_file",
    {
      title: "Describe configured A5:SQL file",
      description:
        "MCP サーバー起動時に指定された A5:SQL 関連ファイルのパス、種別、サイズを返します。",
      inputSchema: {},
    },
    async () => {
      const parsed = await parseFile(initialFile.filePath);
      const fileStat = await stat(parsed.filePath);
      return jsonResult({
        filePath: parsed.filePath,
        kind: parsed.kind,
        sizeBytes: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
      });
    },
  );

  server.registerTool(
    "parse_a5sql_file",
    {
      title: "Parse configured A5:SQL file",
      description:
        "MCP サーバー起動時に指定された .a5er または .sql ファイルを AI が扱いやすい JSON に変換します。",
      inputSchema: {},
    },
    async () => {
      const parsed = await parseFile(initialFile.filePath);
      return jsonResult(parsed);
    },
  );

  server.registerTool(
    "read_a5sql_file",
    {
      title: "Read configured A5:SQL file",
      description:
        "MCP サーバー起動時に指定されたファイルの本文を読み取ります。大きなファイル向けに最大文字数を指定できます。",
      inputSchema: {
        maxChars: z
          .number()
          .int()
          .min(1)
          .max(500_000)
          .optional()
          .describe("返す最大文字数。省略時は 100000。"),
      },
    },
    async ({ maxChars }) => {
      const limit = maxChars ?? 100_000;
      const text = await readTextFile(initialFile.filePath);
      const truncated = text.length > limit;
      return jsonResult({
        filePath: initialFile.filePath,
        kind: initialFile.kind,
        text: truncated ? text.slice(0, limit) : text,
        truncated,
        totalChars: text.length,
      });
    },
  );

  if (initialFile.kind === "a5er") {
    registerA5erTools(server, initialFile);
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

function registerA5erTools(server: McpServer, initialFile: CliResult): void {
  server.registerTool(
    "list_a5sql_tables",
    {
      title: "List tables in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルからテーブル/ビューの一覧を返します。",
      inputSchema: {},
    },
    async () => {
      const parsed = await parseFile(initialFile.filePath);
      if (!isA5erParsed(parsed)) {
        return jsonResult({
          filePath: parsed.filePath,
          kind: parsed.kind,
          tables: [],
        });
      }
      return jsonResult({
        filePath: parsed.filePath,
        kind: parsed.kind,
        tables: parsed.parsed.tables.map((table) => ({
          name: table.name,
          logicalName: table.logicalName,
          physicalName: table.physicalName,
          objectType: table.objectType,
          columnCount: table.columns.length,
          primaryKeyColumns: table.columns
            .filter((column) => column.primaryKey)
            .sort((a, b) => (a.keyOrder ?? 0) - (b.keyOrder ?? 0))
            .map((column) => column.name),
        })),
      });
    },
  );

  server.registerTool(
    "describe_a5sql_table",
    {
      title: "Describe table in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイル内のテーブル/ビュー定義を 1 件返します。",
      inputSchema: {
        tableName: z.string().min(1).describe("物理名または論理名。大文字小文字は区別しません。"),
      },
    },
    async ({ tableName }) => {
      const parsed = await parseFile(initialFile.filePath);
      if (!isA5erParsed(parsed)) {
        return jsonResult({
          found: false,
          filePath: parsed.filePath,
          kind: parsed.kind,
          message: "configured_file_is_not_a5er",
        });
      }
      const lowerName = tableName.toLocaleLowerCase();
      const table = parsed.parsed.tables.find((candidate) =>
        [candidate.name, candidate.physicalName, candidate.logicalName]
          .filter((value): value is string => value !== undefined)
          .some((value) => value.toLocaleLowerCase() === lowerName),
      );
      if (!table) {
        return jsonResult({
          found: false,
          filePath: parsed.filePath,
          tableName,
          nextAction: "list_a5sql_tables で利用可能な tableName を確認してください。",
        });
      }
      return jsonResult({
        found: true,
        filePath: parsed.filePath,
        table,
      });
    },
  );

  server.registerTool(
    "list_a5sql_relationships",
    {
      title: "List relationships in configured A5:ER file",
      description: "MCP サーバー起動時に指定された .a5er ファイルからリレーション一覧を返します。",
      inputSchema: {
        tableName: z
          .string()
          .min(1)
          .optional()
          .describe(
            "任意。物理名または論理名で指定すると、そのテーブルに関係するリレーションだけを返します。",
          ),
      },
    },
    async ({ tableName }) => {
      const parsed = await parseFile(initialFile.filePath);
      if (!isA5erParsed(parsed)) {
        return jsonResult({
          filePath: parsed.filePath,
          kind: parsed.kind,
          relationships: [],
        });
      }
      return jsonResult(listA5sqlRelationships(parsed, { tableName }));
    },
  );

  server.registerTool(
    "find_a5sql_tables",
    {
      title: "Find tables in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルから、テーブル名・論理名・コメント・カラム名に一致するテーブルを検索します。",
      inputSchema: {
        query: z.string().min(1).optional().describe("検索語。省略時は全テーブルを返します。"),
        limit: z.number().int().min(1).max(100).optional().describe("最大件数。省略時は 20。"),
      },
    },
    async ({ query, limit }) => {
      const parsed = await parseFile(initialFile.filePath);
      if (!isA5erParsed(parsed)) {
        return jsonResult({
          filePath: parsed.filePath,
          kind: parsed.kind,
          query,
          tables: [],
        });
      }
      return jsonResult(findA5sqlTables(parsed, { query, limit }));
    },
  );

  server.registerTool(
    "generate_sql_select",
    {
      title: "Generate SELECT SQL from configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルの定義から、指定テーブルを起点にした SELECT SQL のたたき台を生成します。DB には接続しません。",
      inputSchema: {
        tableName: z
          .string()
          .min(1)
          .describe("起点テーブルの物理名または論理名。大文字小文字は区別しません。"),
        includeRelations: z
          .boolean()
          .optional()
          .describe("true の場合、直接リレーションしているテーブルを LEFT JOIN します。"),
        relatedTables: z
          .array(z.string().min(1))
          .max(20)
          .optional()
          .describe(
            "任意。includeRelations=true のときに JOIN 対象を物理名または論理名で絞ります。",
          ),
        whereColumns: z
          .array(z.string().min(1))
          .max(20)
          .optional()
          .describe(
            "任意。起点テーブルの WHERE 条件として使うカラム名。各カラムは :column_name パラメータになります。",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10000)
          .optional()
          .describe("任意。LIMIT 句を追加します。"),
      },
    },
    async ({ tableName, includeRelations, relatedTables, whereColumns, limit }) => {
      const parsed = await parseFile(initialFile.filePath);
      if (!isA5erParsed(parsed)) {
        return jsonResult({
          found: false,
          filePath: parsed.filePath,
          kind: parsed.kind,
          message: "configured_file_is_not_a5er",
        });
      }
      return jsonResult(
        generateSqlSelect(parsed, {
          tableName,
          includeRelations,
          relatedTables,
          whereColumns,
          limit,
        }),
      );
    },
  );

  server.registerTool(
    "generate_mermaid_er_diagram",
    {
      title: "Generate Mermaid ER diagram from configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルのテーブルとリレーションから Mermaid ER diagram を生成します。",
      inputSchema: {
        tableNames: z
          .array(z.string().min(1))
          .max(100)
          .optional()
          .describe("任意。物理名または論理名で出力対象テーブルを絞ります。"),
        includeViews: z
          .boolean()
          .optional()
          .describe("true の場合、View も出力します。省略時は true。"),
        includeColumns: z
          .boolean()
          .optional()
          .describe("true の場合、各テーブルのカラムも出力します。省略時は true。"),
      },
    },
    async ({ tableNames, includeViews, includeColumns }) => {
      const parsed = await parseFile(initialFile.filePath);
      if (!isA5erParsed(parsed)) {
        return jsonResult({
          found: false,
          filePath: parsed.filePath,
          kind: parsed.kind,
          message: "configured_file_is_not_a5er",
        });
      }
      return jsonResult(
        generateMermaidErDiagram(parsed, {
          tableNames,
          includeViews,
          includeColumns,
        }),
      );
    },
  );

  server.registerTool(
    "generate_model_files",
    {
      title: "Generate model files from configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルのテーブル定義から、Laravel Eloquent または SQLAlchemy 用のモデルファイル案を生成します。ファイルシステムには書き込みません。",
      inputSchema: {
        framework: z
          .enum(["laravel", "sqlalchemy"])
          .describe("生成するモデル形式。laravel または sqlalchemy。"),
        tableNames: z
          .array(z.string().min(1))
          .max(100)
          .optional()
          .describe("任意。物理名または論理名で生成対象テーブルを絞ります。"),
      },
    },
    async ({ framework, tableNames }) => {
      const parsed = await parseFile(initialFile.filePath);
      if (!isA5erParsed(parsed)) {
        return jsonResult({
          found: false,
          filePath: parsed.filePath,
          kind: parsed.kind,
          message: "configured_file_is_not_a5er",
        });
      }
      return jsonResult(generateModelFiles(parsed, { framework, tableNames }));
    },
  );

  server.registerTool(
    "review_a5sql_schema",
    {
      title: "Review schema quality in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルのスキーマ品質を、主キー・型・コメント・リレーション整合性の観点でレビューします。",
      inputSchema: {
        maxIssues: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("返す issue の最大件数。省略時は 100。"),
        includeInfo: z
          .boolean()
          .optional()
          .describe("true の場合、コメント不足などの info issue も返します。省略時は true。"),
      },
    },
    async ({ maxIssues, includeInfo }) => {
      const parsed = await parseFile(initialFile.filePath);
      if (!isA5erParsed(parsed)) {
        return jsonResult({
          found: false,
          filePath: parsed.filePath,
          kind: parsed.kind,
          message: "configured_file_is_not_a5er",
        });
      }
      return jsonResult(reviewA5sqlSchema(parsed, { maxIssues, includeInfo }));
    },
  );
}

export function listA5sqlRelationships(
  result: A5erCliResult,
  options: { tableName?: string } = {},
): JsonObject {
  const table = options.tableName ? findTable(result.parsed.tables, options.tableName) : undefined;
  const relationships = result.parsed.relationships
    .filter((relationship) => {
      if (!options.tableName) {
        return true;
      }
      if (!table) {
        return false;
      }
      return relationship.entity1 === table.name || relationship.entity2 === table.name;
    })
    .map((relationship) => relationshipSummary(relationship, result.parsed.tables));
  return {
    filePath: result.filePath,
    kind: result.kind,
    tableName: options.tableName,
    foundTable: options.tableName ? Boolean(table) : undefined,
    relationships,
  };
}

export function findA5sqlTables(
  result: A5erCliResult,
  options: { query?: string; limit?: number } = {},
): JsonObject {
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

export function generateSqlSelect(
  result: A5erCliResult,
  options: {
    tableName: string;
    includeRelations?: boolean;
    relatedTables?: string[];
    whereColumns?: string[];
    limit?: number;
  },
): JsonObject {
  const baseTable = findTable(result.parsed.tables, options.tableName);
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
    const table = findTable(result.parsed.tables, tableName);
    if (table) {
      relatedFilter.add(table.name);
      continue;
    }
    warnings.push(`related_table_filter_not_found:${tableName}`);
  }
  const joinCandidates = options.includeRelations
    ? result.parsed.relationships.filter((relationship) => {
        const direct =
          relationship.entity1 === baseTable.name || relationship.entity2 === baseTable.name;
        if (!direct) {
          return false;
        }
        if (!hasRelatedFilter) {
          return true;
        }
        const relatedName =
          relationship.entity1 === baseTable.name ? relationship.entity2 : relationship.entity1;
        return relatedName ? relatedFilter.has(relatedName) : false;
      })
    : [];

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
    const relatedTable = result.parsed.tables.find((table) => table.name === relatedName);
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
  } = {},
): JsonObject {
  const warnings: string[] = [];
  const includeViews = options.includeViews ?? true;
  const includeColumns = options.includeColumns ?? true;
  const requestedTables = options.tableNames ?? [];
  const requestedTableNames = new Set<string>();

  for (const tableName of requestedTables) {
    const table = findTable(result.parsed.tables, tableName);
    if (table) {
      requestedTableNames.add(table.name);
      continue;
    }
    warnings.push(`table_filter_not_found:${tableName}`);
  }

  const filteredTables = result.parsed.tables.filter((table) => {
    if (!includeViews && table.objectType === "view") {
      return false;
    }
    if (requestedTables.length === 0) {
      return true;
    }
    return requestedTableNames.has(table.name);
  });
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
    relationshipCount: result.parsed.relationships.filter(
      (relationship) =>
        relationship.entity1 &&
        relationship.entity2 &&
        tableNameSet.has(relationship.entity1) &&
        tableNameSet.has(relationship.entity2),
    ).length,
    mermaid: lines.join("\n"),
    warnings,
  };
}

export function reviewA5sqlSchema(
  result: A5erCliResult,
  options: { maxIssues?: number; includeInfo?: boolean } = {},
): JsonObject {
  const maxIssues = options.maxIssues ?? 100;
  const includeInfo = options.includeInfo ?? true;
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
    const sourceTable = result.parsed.tables.find((table) => table.name === relationship.entity1);
    const targetTable = result.parsed.tables.find((table) => table.name === relationship.entity2);
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
  },
): JsonObject {
  const warnings: string[] = [];
  const requestedTables = options.tableNames ?? [];
  const requestedTableNames = new Set<string>();

  for (const tableName of requestedTables) {
    const table = findTable(result.parsed.tables, tableName);
    if (table) {
      requestedTableNames.add(table.name);
      continue;
    }
    warnings.push(`table_filter_not_found:${tableName}`);
  }

  const tables = result.parsed.tables.filter((table) => {
    if (table.objectType !== "entity") {
      return false;
    }
    if (requestedTables.length === 0) {
      return true;
    }
    return requestedTableNames.has(table.name);
  });

  const files =
    options.framework === "laravel"
      ? tables.map((table) => generateLaravelModelFile(table, result.parsed.relationships))
      : [generateSqlAlchemyModelsFile(tables, result.parsed.relationships)];

  return {
    filePath: result.filePath,
    kind: result.kind,
    framework: options.framework,
    tableCount: tables.length,
    files,
    warnings,
  };
}

function isA5erParsed(result: CliResult): result is A5erCliResult {
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
  tables: ParsedA5erTable[],
): JsonObject {
  const source = relationship.entity1
    ? tables.find((table) => table.name === relationship.entity1)
    : undefined;
  const target = relationship.entity2
    ? tables.find((table) => table.name === relationship.entity2)
    : undefined;
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

function findTable(tables: ParsedA5erTable[], tableName: string): ParsedA5erTable | undefined {
  const lowerName = tableName.toLocaleLowerCase();
  return tables.find((candidate) =>
    [candidate.name, candidate.physicalName, candidate.logicalName]
      .filter((value): value is string => value !== undefined)
      .some((value) => value.toLocaleLowerCase() === lowerName),
  );
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
