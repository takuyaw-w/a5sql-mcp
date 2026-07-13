import { readA5sqlAssetWithMetadata } from "./assets.js";
import { parseA5erIni, parseSqlDocument } from "@takuyaw-w/a5sql-mcp-parser";
import type { ParseAssetLookupResult, ParseAssetOptions, ParsedAssetResult } from "./types.js";

export async function parseA5sqlAsset(
  options: ParseAssetOptions,
): Promise<ParsedAssetResult | null> {
  return (await parseA5sqlAssetWithMetadata(options)).parsed;
}

export async function parseA5sqlAssetWithMetadata(
  options: ParseAssetOptions,
): Promise<ParseAssetLookupResult> {
  const lookup = await readA5sqlAssetWithMetadata({
    roots: options.roots,
    assetId: options.assetId,
    maxBytes: options.maxBytes ?? 1024 * 1024,
    maxFiles: options.maxFiles,
  });
  const { result: read, ...lookupMetadata } = lookup;
  if (!read) {
    return { ...lookupMetadata, parsed: null };
  }

  const common = {
    asset: read.asset,
    sourceSizeBytes: read.sourceSizeBytes,
    bytesRead: read.bytesRead,
    sourceTruncated: read.truncated,
    visitedFileCount: lookupMetadata.visitedFileCount,
    lookupTruncated: lookupMetadata.lookupTruncated,
    cutoffReason: lookupMetadata.cutoffReason,
    maxFiles: lookupMetadata.maxFiles,
  };

  if (read.asset.kind === "er" || read.asset.fileName.toLocaleLowerCase().endsWith(".a5er")) {
    if (read.truncated) {
      return {
        ...lookupMetadata,
        parsed: {
          ...common,
          parser: "not-attempted",
          summary: "A5:ER parsing was not attempted because the source read was truncated.",
          warnings: [...read.warnings, "source_truncated"],
          warningDetails: [],
        },
      };
    }
    const parsed = parseA5erIni(read.content, { fileEncoding: read.encoding });
    return {
      ...lookupMetadata,
      parsed: {
        ...common,
        parser: "a5er-ini-v19",
        summary:
          parsed.parseStatus === "unrecognized"
            ? "unrecognized A5:ER document"
            : `${parsed.tables.length} tables, ${parsed.relationships.length} relationships`,
        parseStatus: parsed.parseStatus,
        encoding: parsed.encoding,
        fileEncoding: parsed.fileEncoding,
        manager: parsed.manager,
        tables: parsed.tables,
        relationships: parsed.relationships,
        warnings: [...read.warnings, ...parsed.warnings],
        warningDetails: parsed.warningDetails,
      },
    };
  }

  if (read.asset.kind === "sql") {
    const sql = parseSqlDocument(read.content, {
      maxStatements: options.maxStatements,
      sourceTruncated: read.truncated,
    });
    return {
      ...lookupMetadata,
      parsed: {
        ...common,
        parser: "sql-heuristic",
        summary: `${sql.totalStatementCount} SQL statements in the bounded source read`,
        ...sql,
        warnings: read.warnings,
        warningDetails: [],
      },
    };
  }

  if (read.content.length > 0) {
    return {
      ...lookupMetadata,
      parsed: {
        ...common,
        parser: "text-summary",
        summary: `${read.content.split(/\r?\n/).length} lines, ${read.content.length} characters`,
        warnings: read.warnings,
        warningDetails: [],
      },
    };
  }

  return {
    ...lookupMetadata,
    parsed: {
      ...common,
      parser: "unsupported",
      summary: "No text content returned for this asset type.",
      warnings: read.warnings,
      warningDetails: [],
    },
  };
}
