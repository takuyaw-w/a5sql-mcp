import { readA5sqlAsset } from "./assets.js";
import { parseA5erIni, parseSqlStatements } from "@takuyaw-w/a5sql-mcp-parser";
import type { ParseAssetOptions, ParsedAssetResult } from "./types.js";

export async function parseA5sqlAsset(
  options: ParseAssetOptions,
): Promise<ParsedAssetResult | null> {
  const read = await readA5sqlAsset({
    roots: options.roots,
    assetId: options.assetId,
    maxBytes: options.maxBytes ?? 1024 * 1024,
  });
  if (!read) {
    return null;
  }

  if (read.asset.kind === "er" || read.asset.fileName.toLocaleLowerCase().endsWith(".a5er")) {
    const parsed = parseA5erIni(read.content);
    return {
      asset: read.asset,
      parser: "a5er-ini-v19",
      summary: `${parsed.tables.length} tables, ${parsed.relationships.length} relationships`,
      manager: parsed.manager,
      tables: parsed.tables,
      relationships: parsed.relationships,
      warnings: [...read.warnings, ...parsed.warnings],
    };
  }

  if (read.asset.kind === "sql") {
    const statements = parseSqlStatements(read.content);
    return {
      asset: read.asset,
      parser: "sql-heuristic",
      summary: `${statements.length} SQL statements`,
      statements,
      warnings: read.warnings,
    };
  }

  if (read.content.length > 0) {
    return {
      asset: read.asset,
      parser: "text-summary",
      summary: `${read.content.split(/\r?\n/).length} lines, ${read.content.length} characters`,
      warnings: read.warnings,
    };
  }

  return {
    asset: read.asset,
    parser: "unsupported",
    summary: "No text content returned for this asset type.",
    warnings: read.warnings,
  };
}
