export type A5sqlAssetKind = "sql" | "er" | "config" | "text" | "database" | "unknown";

export type LocationCandidate = {
  path: string;
  source: "env" | "extra" | "platform" | "home" | "wine";
  label: string;
  exists: boolean;
  readable: boolean;
  reason?: string;
};

export type DetectLocationOptions = {
  extraRoots?: string[];
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  includeDefaults?: boolean;
};

export type AssetRecord = {
  id: string;
  kind: A5sqlAssetKind;
  path: string;
  fileName: string;
  size: number;
  modifiedAt: string;
  matched: boolean;
  snippet?: string;
  warning?: string;
};

export type SearchAssetsOptions = {
  roots?: string[];
  query?: string;
  kinds?: A5sqlAssetKind[];
  limit?: number;
  includeHidden?: boolean;
  maxDepth?: number;
  maxFiles?: number;
  maxFileBytes?: number;
};

export type SearchAssetsCutoffReason = "limit_exceeded" | "max_files_reached";

export type SearchAssetsResult = {
  assets: AssetRecord[];
  effectiveLimit: number;
  visitedFileCount: number;
  truncated: boolean;
  cutoffReason: SearchAssetsCutoffReason | null;
};

export type ReadAssetOptions = {
  roots?: string[];
  assetId?: string;
  path?: string;
  maxBytes?: number;
};

export type ReadAssetResult = {
  asset: AssetRecord;
  content: string;
  encoding: string;
  truncated: boolean;
  bytesRead: number;
  warnings: string[];
};

import type {
  ParsedA5erRelationship,
  ParsedA5erTable,
  ParsedSqlStatement,
} from "@takuyaw-w/a5sql-mcp-parser";

export type ParsedAssetResult = {
  asset: AssetRecord;
  parser: "a5er-ini-v19" | "sql-heuristic" | "text-summary" | "unsupported";
  summary: string;
  manager?: Record<string, unknown>;
  tables?: ParsedA5erTable[];
  relationships?: ParsedA5erRelationship[];
  statements?: ParsedSqlStatement[];
  warnings: string[];
};

export type ParseAssetOptions = {
  roots?: string[];
  assetId: string;
  maxBytes?: number;
};

export type ConnectionField = {
  value: string | null;
  masked: boolean;
};

export type ConnectionCandidate = {
  id: string;
  sourcePath: string;
  sourceName: string;
  confidence: number;
  fields: {
    name?: ConnectionField;
    type?: ConnectionField;
    host?: ConnectionField;
    port?: ConnectionField;
    database?: ConnectionField;
    user?: ConnectionField;
  };
  hasPassword: boolean;
  matchedKeys: string[];
  warnings: string[];
};

export type ListConnectionsOptions = {
  roots?: string[];
  limit?: number;
  revealNonSecret?: boolean;
};
