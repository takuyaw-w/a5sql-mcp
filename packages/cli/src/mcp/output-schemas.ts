import { z } from "zod";

import type { A5sqlMcpToolName } from "./tool-profiles.js";

function stableOutputWith(requiredField: string) {
  return z
    .object({
      schemaVersion: z.literal("0.10.3"),
      resultType: z.enum(["success", "error", "not_found", "unrecognized"]),
      [requiredField]: z.json(),
      code: z.string().optional(),
      ...(requiredField === "found" ? {} : { found: z.boolean().optional() }),
      message: z.string().optional(),
    })
    .passthrough();
}

export const stableToolOutputSchemas = {
  describe_a5sql_file: stableOutputWith("sizeBytes"),
  parse_a5sql_file: stableOutputWith("kind"),
  read_a5sql_file: stableOutputWith("content"),
  detect_a5sql_locations: stableOutputWith("locations"),
  read_a5sql_asset: stableOutputWith("found"),
  list_a5sql_connections: stableOutputWith("connections"),
  search_a5sql_assets: stableOutputWith("assets"),
  parse_a5sql_asset: stableOutputWith("found"),
  list_a5sql_tables: stableOutputWith("tables"),
  describe_a5sql_table: stableOutputWith("found"),
  explain_a5sql_table: stableOutputWith("found"),
  list_a5sql_relationships: stableOutputWith("relationships"),
  find_a5sql_tables: stableOutputWith("tables"),
  find_a5sql_columns: stableOutputWith("columns"),
  review_a5sql_schema: stableOutputWith("issues"),
  suggest_schema_changes: stableOutputWith("suggestions"),
  compare_a5er_with_live_schema: stableOutputWith("issues"),
} satisfies Partial<Record<A5sqlMcpToolName, z.ZodType>>;

export type StableToolName = keyof typeof stableToolOutputSchemas;

export function outputSchemaForTool(toolName: A5sqlMcpToolName): z.ZodType | undefined {
  return stableToolOutputSchemas[toolName as StableToolName];
}

export const requiredStableOutputFields = {
  describe_a5sql_file: "sizeBytes",
  parse_a5sql_file: "kind",
  read_a5sql_file: "content",
  detect_a5sql_locations: "locations",
  read_a5sql_asset: "found",
  list_a5sql_connections: "connections",
  search_a5sql_assets: "assets",
  parse_a5sql_asset: "found",
  list_a5sql_tables: "tables",
  describe_a5sql_table: "found",
  explain_a5sql_table: "found",
  list_a5sql_relationships: "relationships",
  find_a5sql_tables: "tables",
  find_a5sql_columns: "columns",
  review_a5sql_schema: "issues",
  suggest_schema_changes: "suggestions",
  compare_a5er_with_live_schema: "issues",
} satisfies Record<StableToolName, string>;

export function requiredOutputFieldForTool(toolName: A5sqlMcpToolName): string | undefined {
  return requiredStableOutputFields[toolName as StableToolName];
}
