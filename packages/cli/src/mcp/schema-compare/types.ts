import type { ParsedA5erDocument } from "@takuyaw-w/a5sql-mcp-parser";

export type JsonObject = Record<string, unknown>;

export type A5erSchemaCompareResult = {
  filePath: string;
  kind: "a5er";
  encoding?: string;
  parsed: ParsedA5erDocument;
};

export type LiveSchemaDocument = {
  dialect?: string;
  tables: LiveSchemaTable[];
};

export type LiveSchemaTable = {
  name: string;
  schema?: string;
  type?: "table" | "view";
  columns: LiveSchemaColumn[];
};

export type LiveSchemaColumn = {
  name: string;
  dataType?: string;
  nullable?: boolean;
  primaryKey?: boolean;
  defaultValue?: string;
};

export type CompareA5erWithLiveSchemaOptions = {
  liveSchema: LiveSchemaDocument;
  tableNames?: string[];
  compareDataTypes?: boolean;
  compareNullable?: boolean;
  comparePrimaryKeys?: boolean;
  includeExtraLiveTables?: boolean;
  maxIssues?: number;
};

export type SchemaCompareIssue = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  table?: string;
  column?: string;
  a5er?: JsonObject;
  live?: JsonObject;
};
