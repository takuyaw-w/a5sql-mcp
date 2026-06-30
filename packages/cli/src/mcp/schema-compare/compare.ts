import type {
  ParsedA5erColumn,
  ParsedA5erDocument,
  ParsedA5erTable,
} from "@takuyaw-w/a5sql-mcp-parser";
import type {
  A5erSchemaCompareResult,
  CompareA5erWithLiveSchemaOptions,
  JsonObject,
  LiveSchemaColumn,
  LiveSchemaDocument,
  SchemaCompareIssue,
} from "./types.js";
import { withUntrustedPayloadContract } from "../output-contract.js";

const DEFAULT_SCHEMA_COMPARE_ISSUE_LIMIT = 200;
const MAX_SCHEMA_COMPARE_WARNINGS = 100;

type IssueSummary = Record<SchemaCompareIssue["severity"], number>;

type IssueCollector = {
  add: (severity: SchemaCompareIssue["severity"], createIssue: () => SchemaCompareIssue) => void;
  issues: SchemaCompareIssue[];
  issueCount: number;
  summary: IssueSummary;
  truncated: boolean;
};

type WarningCollector = {
  add: (warning: string) => void;
  values: string[];
};

type A5erLookupIndex = {
  tablesByLookupName: Map<string, ParsedA5erTable>;
};

type LiveSchemaTableIndex = {
  key: string;
  name: string;
  schema?: string;
  type?: "table" | "view";
  columns: LiveSchemaColumn[];
  columnsByName: Map<string, LiveSchemaColumn>;
};

type LiveSchemaIndex = {
  tables: LiveSchemaTableIndex[];
  tablesByLookupName: Map<string, LiveSchemaTableIndex>;
};

export function compareA5erWithLiveSchema(
  result: A5erSchemaCompareResult,
  options: CompareA5erWithLiveSchemaOptions,
): JsonObject {
  if (result.parsed.parseStatus !== "ok") {
    return withUntrustedPayloadContract(
      unrecognizedA5erResult(result, { found: false, issues: [] }),
    );
  }

  const compareDataTypes = options.compareDataTypes ?? true;
  const compareNullable = options.compareNullable ?? true;
  const comparePrimaryKeys = options.comparePrimaryKeys ?? true;
  const includeExtraLiveTables = options.includeExtraLiveTables ?? true;
  const maxIssues = options.maxIssues ?? DEFAULT_SCHEMA_COMPARE_ISSUE_LIMIT;
  const warnings = createWarningCollector(MAX_SCHEMA_COMPARE_WARNINGS);
  const issueCollector = createIssueCollector(maxIssues);
  const a5erIndex = buildA5erIndex(result.parsed);
  const liveIndex = buildLiveSchemaIndex(options.liveSchema, warnings);
  const requestedTables = options.tableNames ?? [];
  const requestedTableNames = new Set<string>();

  for (const tableName of requestedTables) {
    const table = findTable(a5erIndex, tableName);
    if (table) {
      requestedTableNames.add(table.name);
      continue;
    }
    warnings.add(`table_filter_not_found:${tableName}`);
  }

  const a5erTables = result.parsed.tables.filter((table) => {
    if (requestedTables.length === 0) {
      return true;
    }
    return requestedTableNames.has(table.name);
  });
  const matchedLiveTableKeys = new Set<string>();
  let matchedTableCount = 0;

  for (const a5erTable of a5erTables) {
    const liveTable = findLiveTable(liveIndex, a5erTable);
    if (!liveTable) {
      issueCollector.add("error", () => ({
        severity: "error",
        code: "table_missing_in_live",
        message: "A5:ER に存在するテーブルが live schema に存在しません。",
        table: a5erTable.name,
        a5er: tableCompareSummary(a5erTable),
      }));
      continue;
    }

    matchedTableCount += 1;
    matchedLiveTableKeys.add(liveTable.key);
    compareTableColumns(issueCollector, a5erTable, liveTable, {
      compareDataTypes,
      compareNullable,
      comparePrimaryKeys,
    });
  }

  if (includeExtraLiveTables && requestedTables.length === 0) {
    for (const liveTable of liveIndex.tables) {
      if (matchedLiveTableKeys.has(liveTable.key)) {
        continue;
      }
      issueCollector.add("warning", () => ({
        severity: "warning",
        code: "table_extra_in_live",
        message: "live schema にだけ存在するテーブルです。",
        table: liveTable.name,
        live: liveTableCompareSummary(liveTable),
      }));
    }
  }

  return withUntrustedPayloadContract({
    found: true,
    filePath: result.filePath,
    kind: result.kind,
    liveDialect: options.liveSchema.dialect,
    a5erTableCount: result.parsed.tables.length,
    liveTableCount: options.liveSchema.tables.length,
    comparedTableCount: a5erTables.length,
    matchedTableCount,
    issueCount: issueCollector.issueCount,
    truncated: issueCollector.truncated,
    maxIssues,
    options: {
      compareDataTypes,
      compareNullable,
      comparePrimaryKeys,
      includeExtraLiveTables,
      tableNames: requestedTables,
    },
    summary: issueCollector.summary,
    warnings: warnings.values,
    issues: issueCollector.issues,
    nextAction:
      "live schema は既存の DB MCP などで取得し、この tool にはスナップショット JSON として渡してください。a5sql-mcp は DB へ接続しません。",
  });
}

function buildA5erIndex(document: ParsedA5erDocument): A5erLookupIndex {
  const tablesByLookupName = new Map<string, ParsedA5erTable>();

  for (const table of document.tables) {
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

  return {
    tablesByLookupName,
  };
}

function findTable(index: A5erLookupIndex, tableName: string): ParsedA5erTable | undefined {
  return index.tablesByLookupName.get(normalizeLookupName(tableName));
}

function buildLiveSchemaIndex(
  liveSchema: LiveSchemaDocument,
  warnings: WarningCollector,
): LiveSchemaIndex {
  const tables: LiveSchemaTableIndex[] = [];
  const tablesByLookupName = new Map<string, LiveSchemaTableIndex>();

  for (const table of liveSchema.tables) {
    const key = table.schema ? `${table.schema}.${table.name}` : table.name;
    const columnsByName = new Map<string, LiveSchemaColumn>();
    for (const column of table.columns) {
      const columnKey = normalizeLookupName(column.name);
      if (columnsByName.has(columnKey)) {
        warnings.add(`live_schema_duplicate_column:${key}.${column.name}`);
        continue;
      }
      columnsByName.set(columnKey, column);
    }

    const indexedTable: LiveSchemaTableIndex = {
      key,
      name: table.name,
      schema: table.schema,
      type: table.type,
      columns: table.columns,
      columnsByName,
    };
    tables.push(indexedTable);

    for (const lookupName of [table.name, key]) {
      const lookupKey = normalizeLookupName(lookupName);
      if (tablesByLookupName.has(lookupKey)) {
        warnings.add(`live_schema_duplicate_table:${lookupName}`);
        continue;
      }
      tablesByLookupName.set(lookupKey, indexedTable);
    }
  }

  return {
    tables,
    tablesByLookupName,
  };
}

function findLiveTable(
  index: LiveSchemaIndex,
  a5erTable: ParsedA5erTable,
): LiveSchemaTableIndex | undefined {
  for (const name of [a5erTable.name, a5erTable.physicalName, a5erTable.logicalName]) {
    if (!name) {
      continue;
    }
    const table = index.tablesByLookupName.get(normalizeLookupName(name));
    if (table) {
      return table;
    }
  }
  return undefined;
}

function compareTableColumns(
  issues: IssueCollector,
  a5erTable: ParsedA5erTable,
  liveTable: LiveSchemaTableIndex,
  options: {
    compareDataTypes: boolean;
    compareNullable: boolean;
    comparePrimaryKeys: boolean;
  },
): void {
  const matchedLiveColumns = new Set<string>();

  for (const a5erColumn of a5erTable.columns) {
    const liveColumn = findLiveColumn(liveTable, a5erColumn);
    if (!liveColumn) {
      issues.add("error", () => ({
        severity: "error",
        code: "column_missing_in_live",
        message: "A5:ER に存在するカラムが live schema に存在しません。",
        table: a5erTable.name,
        column: a5erColumn.name,
        a5er: columnCompareSummary(a5erColumn),
      }));
      continue;
    }

    matchedLiveColumns.add(normalizeLookupName(liveColumn.name));
    compareMatchedColumn(issues, a5erTable, a5erColumn, liveColumn, options);
  }

  for (const liveColumn of liveTable.columns) {
    if (matchedLiveColumns.has(normalizeLookupName(liveColumn.name))) {
      continue;
    }
    issues.add("warning", () => ({
      severity: "warning",
      code: "column_extra_in_live",
      message: "live schema にだけ存在するカラムです。",
      table: a5erTable.name,
      column: liveColumn.name,
      live: liveColumnCompareSummary(liveColumn),
    }));
  }
}

function findLiveColumn(
  liveTable: LiveSchemaTableIndex,
  a5erColumn: ParsedA5erColumn,
): LiveSchemaColumn | undefined {
  for (const name of [a5erColumn.name, a5erColumn.physicalName, a5erColumn.logicalName]) {
    if (!name) {
      continue;
    }
    const column = liveTable.columnsByName.get(normalizeLookupName(name));
    if (column) {
      return column;
    }
  }
  return undefined;
}

function compareMatchedColumn(
  issues: IssueCollector,
  table: ParsedA5erTable,
  a5erColumn: ParsedA5erColumn,
  liveColumn: LiveSchemaColumn,
  options: {
    compareDataTypes: boolean;
    compareNullable: boolean;
    comparePrimaryKeys: boolean;
  },
): void {
  if (options.compareDataTypes && a5erColumn.dataType && liveColumn.dataType) {
    const a5erType = normalizeDataTypeForCompare(a5erColumn.dataType);
    const liveType = normalizeDataTypeForCompare(liveColumn.dataType);
    if (a5erType !== liveType) {
      issues.add("warning", () => ({
        severity: "warning",
        code: "column_data_type_mismatch",
        message: "A5:ER と live schema のカラム型が一致しません。",
        table: table.name,
        column: a5erColumn.name,
        a5er: {
          dataType: a5erColumn.dataType,
          normalizedDataType: a5erType,
        },
        live: {
          dataType: liveColumn.dataType,
          normalizedDataType: liveType,
        },
      }));
    }
  }

  if (options.compareNullable && liveColumn.nullable !== undefined) {
    const a5erNullable = a5erColumn.nullable ?? true;
    if (a5erNullable !== liveColumn.nullable) {
      issues.add("warning", () => ({
        severity: "warning",
        code: "column_nullable_mismatch",
        message: "A5:ER と live schema の NULL 許容が一致しません。",
        table: table.name,
        column: a5erColumn.name,
        a5er: {
          nullable: a5erNullable,
        },
        live: {
          nullable: liveColumn.nullable,
        },
      }));
    }
  }

  if (options.comparePrimaryKeys && liveColumn.primaryKey !== undefined) {
    const a5erPrimaryKey = Boolean(a5erColumn.primaryKey);
    if (a5erPrimaryKey !== liveColumn.primaryKey) {
      issues.add("error", () => ({
        severity: "error",
        code: "column_primary_key_mismatch",
        message: "A5:ER と live schema の主キー定義が一致しません。",
        table: table.name,
        column: a5erColumn.name,
        a5er: {
          primaryKey: a5erPrimaryKey,
        },
        live: {
          primaryKey: liveColumn.primaryKey,
        },
      }));
    }
  }
}

function createIssueCollector(maxIssues: number): IssueCollector {
  const issues: SchemaCompareIssue[] = [];
  const summary: IssueSummary = {
    error: 0,
    warning: 0,
    info: 0,
  };
  let issueCount = 0;

  return {
    add(severity, createIssue) {
      issueCount += 1;
      summary[severity] += 1;
      if (issues.length < maxIssues) {
        issues.push(createIssue());
      }
    },
    get issues() {
      return issues;
    },
    get issueCount() {
      return issueCount;
    },
    get summary() {
      return summary;
    },
    get truncated() {
      return issueCount > issues.length;
    },
  };
}

function createWarningCollector(maxWarnings: number): WarningCollector {
  const values: string[] = [];
  let skipped = 0;

  return {
    add(warning) {
      if (values.length < maxWarnings) {
        values.push(warning);
        return;
      }
      skipped += 1;
      const truncatedWarning = `warnings_truncated:${skipped}`;
      if (values.length === maxWarnings) {
        values.push(truncatedWarning);
        return;
      }
      values[values.length - 1] = truncatedWarning;
    },
    values,
  };
}

function normalizeDataTypeForCompare(value: string): string {
  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[`"[\]]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+unsigned\b/g, "")
    .replace(/\s+not null\b/g, "")
    .trim();

  if (/^timestamp with time zone\b/.test(normalized)) {
    return "timestamptz";
  }
  if (/^timestamp without time zone\b/.test(normalized)) {
    return "timestamp";
  }

  const match = normalized.match(/^([a-z0-9_ ]+?)(?:\(([^)]*)\))?(?:\s|$)/);
  const rawBase = (match?.[1] ?? normalized).trim();
  const params = match?.[2]?.replace(/\s+/g, "");

  switch (rawBase) {
    case "bigserial":
    case "serial8":
    case "int8":
    case "bigint":
      return "bigint";
    case "serial":
    case "serial4":
    case "int":
    case "int4":
    case "integer":
    case "mediumint":
      return "integer";
    case "int2":
    case "smallint":
      return "smallint";
    case "tinyint":
      return params === "1" ? "boolean" : "smallint";
    case "bool":
    case "boolean":
      return "boolean";
    case "character varying":
    case "varying character":
    case "varchar":
    case "varchar2":
    case "nvarchar":
    case "nvarchar2":
      return params ? `varchar(${params})` : "varchar";
    case "character":
    case "char":
    case "nchar":
      return params ? `char(${params})` : "char";
    case "text":
    case "tinytext":
    case "mediumtext":
    case "longtext":
    case "citext":
    case "clob":
      return "text";
    case "numeric":
    case "decimal":
    case "dec":
    case "number":
      return params ? `decimal(${params})` : "decimal";
    case "double":
    case "double precision":
    case "float8":
      return "double";
    case "float":
    case "float4":
    case "real":
      return "float";
    case "datetime":
    case "datetime2":
    case "smalldatetime":
    case "timestamp":
      return "timestamp";
    case "date":
      return "date";
    case "time":
      return "time";
    case "uuid":
    case "uniqueidentifier":
      return "uuid";
    case "json":
    case "jsonb":
      return "json";
    case "bytea":
    case "blob":
    case "binary":
    case "varbinary":
    case "image":
      return "binary";
    default:
      return params ? `${rawBase}(${params})` : rawBase;
  }
}

function normalizeLookupName(value: string): string {
  return value.toLocaleLowerCase();
}

function tableCompareSummary(table: ParsedA5erTable): JsonObject {
  return {
    name: table.name,
    logicalName: table.logicalName,
    physicalName: table.physicalName,
    objectType: table.objectType,
    columnCount: table.columns.length,
  };
}

function liveTableCompareSummary(table: LiveSchemaTableIndex): JsonObject {
  return {
    name: table.name,
    schema: table.schema,
    type: table.type,
    columnCount: table.columns.length,
  };
}

function columnCompareSummary(column: ParsedA5erColumn): JsonObject {
  return {
    name: column.name,
    logicalName: column.logicalName,
    physicalName: column.physicalName,
    dataType: column.dataType,
    nullable: column.nullable ?? true,
    primaryKey: Boolean(column.primaryKey),
  };
}

function liveColumnCompareSummary(column: LiveSchemaColumn): JsonObject {
  return {
    name: column.name,
    dataType: column.dataType,
    nullable: column.nullable,
    primaryKey: column.primaryKey,
  };
}

function unrecognizedA5erResult(
  result: A5erSchemaCompareResult,
  extra: JsonObject = {},
): JsonObject {
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
