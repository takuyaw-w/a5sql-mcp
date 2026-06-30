import type {
  ParsedA5erDocument,
  ParsedA5erRelationship,
  ParsedA5erTable,
} from "@takuyaw-w/a5sql-mcp-parser";

import type { A5erCliResult, JsonObject } from "./types.js";

export type A5erLookupIndex = {
  tablesByName: Map<string, ParsedA5erTable>;
  tablesByLookupName: Map<string, ParsedA5erTable>;
  relationshipsByTable: Map<string, ParsedA5erRelationship[]>;
};

export function buildA5erIndex(document: ParsedA5erDocument): A5erLookupIndex {
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

export function findTable(index: A5erLookupIndex, tableName: string): ParsedA5erTable | undefined {
  return index.tablesByLookupName.get(normalizeLookupName(tableName));
}

export function normalizeLookupName(value: string): string {
  return value.toLocaleLowerCase();
}

export function primaryKeyColumns(table: ParsedA5erTable): string[] {
  return table.columns
    .filter((column) => column.primaryKey)
    .sort((a, b) => (a.keyOrder ?? 0) - (b.keyOrder ?? 0))
    .map((column) => column.name);
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
