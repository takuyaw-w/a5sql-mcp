import { stat } from "node:fs/promises";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ParsedA5erDocument, ParsedA5erRelationship, ParsedA5erTable } from "@a5sql-mcp/parser";
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
    version: "0.1.0"
  });

  server.registerTool(
    "describe_a5sql_file",
    {
      title: "Describe configured A5:SQL file",
      description: "MCP サーバー起動時に指定された A5:SQL 関連ファイルのパス、種別、サイズを返します。",
      inputSchema: {}
    },
    async () => {
      const parsed = await parseFile(initialFile.filePath);
      const fileStat = await stat(parsed.filePath);
      return jsonResult({
        filePath: parsed.filePath,
        kind: parsed.kind,
        sizeBytes: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString()
      });
    }
  );

  server.registerTool(
    "parse_a5sql_file",
    {
      title: "Parse configured A5:SQL file",
      description:
        "MCP サーバー起動時に指定された .a5er または .sql ファイルを AI が扱いやすい JSON に変換します。",
      inputSchema: {}
    },
    async () => {
      const parsed = await parseFile(initialFile.filePath);
      return jsonResult(parsed);
    }
  );

  server.registerTool(
    "read_a5sql_file",
    {
      title: "Read configured A5:SQL file",
      description:
        "MCP サーバー起動時に指定されたファイルの本文を読み取ります。大きなファイル向けに最大文字数を指定できます。",
      inputSchema: {
        maxChars: z.number().int().min(1).max(500_000).optional().describe("返す最大文字数。省略時は 100000。")
      }
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
        totalChars: text.length
      });
    }
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
      description: "MCP サーバー起動時に指定された .a5er ファイルからテーブル/ビューの一覧を返します。",
      inputSchema: {}
    },
    async () => {
      const parsed = await parseFile(initialFile.filePath);
      if (!isA5erParsed(parsed)) {
        return jsonResult({
          filePath: parsed.filePath,
          kind: parsed.kind,
          tables: []
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
            .map((column) => column.name)
        }))
      });
    }
  );

  server.registerTool(
    "describe_a5sql_table",
    {
      title: "Describe table in configured A5:ER file",
      description: "MCP サーバー起動時に指定された .a5er ファイル内のテーブル/ビュー定義を 1 件返します。",
      inputSchema: {
        tableName: z.string().min(1).describe("物理名または論理名。大文字小文字は区別しません。")
      }
    },
    async ({ tableName }) => {
      const parsed = await parseFile(initialFile.filePath);
      if (!isA5erParsed(parsed)) {
        return jsonResult({
          found: false,
          filePath: parsed.filePath,
          kind: parsed.kind,
          message: "configured_file_is_not_a5er"
        });
      }
      const lowerName = tableName.toLocaleLowerCase();
      const table = parsed.parsed.tables.find((candidate) =>
        [candidate.name, candidate.physicalName, candidate.logicalName]
          .filter((value): value is string => value !== undefined)
          .some((value) => value.toLocaleLowerCase() === lowerName)
      );
      if (!table) {
        return jsonResult({
          found: false,
          filePath: parsed.filePath,
          tableName,
          nextAction: "list_a5sql_tables で利用可能な tableName を確認してください。"
        });
      }
      return jsonResult({
        found: true,
        filePath: parsed.filePath,
        table
      });
    }
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
          .describe("任意。物理名または論理名で指定すると、そのテーブルに関係するリレーションだけを返します。")
      }
    },
    async ({ tableName }) => {
      const parsed = await parseFile(initialFile.filePath);
      if (!isA5erParsed(parsed)) {
        return jsonResult({
          filePath: parsed.filePath,
          kind: parsed.kind,
          relationships: []
        });
      }
      return jsonResult(listA5sqlRelationships(parsed, { tableName }));
    }
  );

  server.registerTool(
    "find_a5sql_tables",
    {
      title: "Find tables in configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルから、テーブル名・論理名・コメント・カラム名に一致するテーブルを検索します。",
      inputSchema: {
        query: z.string().min(1).optional().describe("検索語。省略時は全テーブルを返します。"),
        limit: z.number().int().min(1).max(100).optional().describe("最大件数。省略時は 20。")
      }
    },
    async ({ query, limit }) => {
      const parsed = await parseFile(initialFile.filePath);
      if (!isA5erParsed(parsed)) {
        return jsonResult({
          filePath: parsed.filePath,
          kind: parsed.kind,
          query,
          tables: []
        });
      }
      return jsonResult(findA5sqlTables(parsed, { query, limit }));
    }
  );

  server.registerTool(
    "generate_sql_select",
    {
      title: "Generate SELECT SQL from configured A5:ER file",
      description:
        "MCP サーバー起動時に指定された .a5er ファイルの定義から、指定テーブルを起点にした SELECT SQL のたたき台を生成します。DB には接続しません。",
      inputSchema: {
        tableName: z.string().min(1).describe("起点テーブルの物理名または論理名。大文字小文字は区別しません。"),
        includeRelations: z.boolean().optional().describe("true の場合、直接リレーションしているテーブルを LEFT JOIN します。"),
        relatedTables: z
          .array(z.string().min(1))
          .max(20)
          .optional()
          .describe("任意。includeRelations=true のときに JOIN 対象を物理名または論理名で絞ります。"),
        whereColumns: z
          .array(z.string().min(1))
          .max(20)
          .optional()
          .describe("任意。起点テーブルの WHERE 条件として使うカラム名。各カラムは :column_name パラメータになります。"),
        limit: z.number().int().min(1).max(10000).optional().describe("任意。LIMIT 句を追加します。")
      }
    },
    async ({ tableName, includeRelations, relatedTables, whereColumns, limit }) => {
      const parsed = await parseFile(initialFile.filePath);
      if (!isA5erParsed(parsed)) {
        return jsonResult({
          found: false,
          filePath: parsed.filePath,
          kind: parsed.kind,
          message: "configured_file_is_not_a5er"
        });
      }
      return jsonResult(generateSqlSelect(parsed, { tableName, includeRelations, relatedTables, whereColumns, limit }));
    }
  );
}

export function listA5sqlRelationships(result: A5erCliResult, options: { tableName?: string } = {}): JsonObject {
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
    relationships
  };
}

export function findA5sqlTables(result: A5erCliResult, options: { query?: string; limit?: number } = {}): JsonObject {
  const query = options.query?.trim();
  const limit = options.limit ?? 20;
  const normalizedQuery = query?.toLocaleLowerCase();
  const tables = result.parsed.tables
    .map((table) => {
      const matches = normalizedQuery ? tableMatches(table, normalizedQuery) : ["all"];
      return {
        table,
        matches
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
      matchedBy: matches
    }));
  return {
    filePath: result.filePath,
    kind: result.kind,
    query,
    limit,
    tables
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
  }
): JsonObject {
  const baseTable = findTable(result.parsed.tables, options.tableName);
  if (!baseTable) {
    return {
      found: false,
      filePath: result.filePath,
      tableName: options.tableName,
      nextAction: "find_a5sql_tables で利用可能な tableName を確認してください。"
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
        const direct = relationship.entity1 === baseTable.name || relationship.entity2 === baseTable.name;
        if (!direct) {
          return false;
        }
        if (!hasRelatedFilter) {
          return true;
        }
        const relatedName = relationship.entity1 === baseTable.name ? relationship.entity2 : relationship.entity1;
        return relatedName ? relatedFilter.has(relatedName) : false;
      })
    : [];

  const aliases = new Map<string, string>([[baseTable.name, "t0"]]);
  const joinedTables: ParsedA5erTable[] = [];
  const joinClauses: string[] = [];
  let aliasIndex = 1;

  for (const relationship of joinCandidates) {
    const relatedName = relationship.entity1 === baseTable.name ? relationship.entity2 : relationship.entity1;
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
    return table.columns.map((column) => `    ${quoteIdentifier(alias)}.${quoteIdentifier(column.name)} AS ${quoteIdentifier(`${table.name}_${column.name}`)}`);
  });
  const whereColumns = options.whereColumns ?? primaryKeyColumns(baseTable);
  const validWhereColumns = whereColumns.filter((columnName) => baseTable.columns.some((column) => column.name === columnName));
  const invalidWhereColumns = whereColumns.filter((columnName) => !validWhereColumns.includes(columnName));
  for (const columnName of invalidWhereColumns) {
    warnings.push(`where_column_not_found:${baseTable.name}.${columnName}`);
  }

  const sqlLines = [
    "SELECT",
    selectLines.join(",\n"),
    `FROM ${quoteIdentifier(baseTable.name)} AS ${quoteIdentifier("t0")}`,
    ...joinClauses
  ];
  if (validWhereColumns.length > 0) {
    sqlLines.push("WHERE " + validWhereColumns.map((columnName) => `${quoteIdentifier("t0")}.${quoteIdentifier(columnName)} = :${columnName}`).join("\n  AND "));
  }
  const orderByColumns = primaryKeyColumns(baseTable);
  if (orderByColumns.length > 0) {
    sqlLines.push(`ORDER BY ${orderByColumns.map((columnName) => `${quoteIdentifier("t0")}.${quoteIdentifier(columnName)}`).join(", ")}`);
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
      physicalName: baseTable.physicalName
    },
    includeRelations: Boolean(options.includeRelations),
    includedTables: selectedTables.map((table) => table.name),
    parameters: validWhereColumns.map((columnName) => `:${columnName}`),
    sql: `${sqlLines.join("\n")};`,
    warnings
  };
}

function isA5erParsed(result: CliResult): result is A5erCliResult {
  return result.kind === "a5er" && typeof result.parsed === "object" && result.parsed !== null && "tables" in result.parsed;
}

function relationshipSummary(relationship: ParsedA5erRelationship, tables: ParsedA5erTable[]): JsonObject {
  const source = relationship.entity1 ? tables.find((table) => table.name === relationship.entity1) : undefined;
  const target = relationship.entity2 ? tables.find((table) => table.name === relationship.entity2) : undefined;
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
    targetRelationType: relationship.relationType2
  };
}

function tableMatches(table: ParsedA5erTable, normalizedQuery: string): string[] {
  const matches: string[] = [];
  const tableFields = [
    ["name", table.name],
    ["physicalName", table.physicalName],
    ["logicalName", table.logicalName],
    ["comment", table.comment]
  ] as const;
  for (const [fieldName, value] of tableFields) {
    if (value?.toLocaleLowerCase().includes(normalizedQuery)) {
      matches.push(fieldName);
    }
  }
  for (const column of table.columns) {
    const columnMatched = [column.name, column.physicalName, column.logicalName, column.comment].some((value) =>
      value?.toLocaleLowerCase().includes(normalizedQuery)
    );
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
      .some((value) => value.toLocaleLowerCase() === lowerName)
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
  aliases: Map<string, string>
): string {
  const baseAlias = aliases.get(baseTable.name) ?? "t0";
  const relatedAlias = aliases.get(relatedTable.name) ?? "t1";
  const pairs =
    relationship.entity1 === baseTable.name
      ? relationship.fields1.map((sourceColumn, index) => ({
          baseColumn: sourceColumn,
          relatedColumn: relationship.fields2[index] ?? relationship.fields2[0] ?? "id"
        }))
      : relationship.fields2.map((sourceColumn, index) => ({
          baseColumn: sourceColumn,
          relatedColumn: relationship.fields1[index] ?? relationship.fields1[0] ?? "id"
        }));
  const condition = pairs
    .map(
      (pair) =>
        `${quoteIdentifier(relatedAlias)}.${quoteIdentifier(pair.relatedColumn)} = ${quoteIdentifier(baseAlias)}.${quoteIdentifier(pair.baseColumn)}`
    )
    .join(" AND ");
  return `LEFT JOIN ${quoteIdentifier(relatedTable.name)} AS ${quoteIdentifier(relatedAlias)} ON ${condition}`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function jsonResult<T extends JsonObject>(output: T) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(output, null, 2)
      }
    ],
    structuredContent: output
  };
}
