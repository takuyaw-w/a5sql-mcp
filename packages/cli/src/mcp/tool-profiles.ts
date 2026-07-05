export const TOOL_PROFILES = ["all", "core-read", "schema-explore", "draft-generation"] as const;

export type ToolProfile = (typeof TOOL_PROFILES)[number];

export const DEFAULT_TOOL_PROFILE: ToolProfile = "all";

export const CORE_READ_TOOL_NAMES = [
  "describe_a5sql_file",
  "parse_a5sql_file",
  "read_a5sql_file",
  "detect_a5sql_locations",
  "read_a5sql_asset",
  "list_a5sql_connections",
  "search_a5sql_assets",
  "parse_a5sql_asset",
] as const;

export const SCHEMA_EXPLORE_ONLY_TOOL_NAMES = [
  "list_a5sql_tables",
  "describe_a5sql_table",
  "explain_a5sql_table",
  "list_a5sql_relationships",
  "find_a5sql_tables",
  "find_a5sql_columns",
] as const;

export const DRAFT_GENERATION_ONLY_TOOL_NAMES = [
  "generate_sql_select",
  "generate_mermaid_er_diagram",
  "generate_model_files",
  "generate_schema_markdown",
  "review_a5sql_schema",
  "suggest_schema_changes",
  "compare_a5er_with_live_schema",
  "generate_migration_plan",
] as const;

export const SCHEMA_EXPLORE_TOOL_NAMES = [
  ...CORE_READ_TOOL_NAMES,
  ...SCHEMA_EXPLORE_ONLY_TOOL_NAMES,
] as const;

export const DRAFT_GENERATION_TOOL_NAMES = [
  ...CORE_READ_TOOL_NAMES,
  ...DRAFT_GENERATION_ONLY_TOOL_NAMES,
] as const;

export const ALL_TOOL_NAMES = [
  ...CORE_READ_TOOL_NAMES,
  ...SCHEMA_EXPLORE_ONLY_TOOL_NAMES,
  ...DRAFT_GENERATION_ONLY_TOOL_NAMES,
] as const;

export type A5sqlMcpToolName = (typeof ALL_TOOL_NAMES)[number];

export function parseToolProfile(value: string | undefined): ToolProfile {
  if (value === undefined) {
    return DEFAULT_TOOL_PROFILE;
  }
  if (isToolProfile(value)) {
    return value;
  }
  throw new Error(`Invalid tool profile: ${value}. Expected one of: ${TOOL_PROFILES.join(", ")}.`);
}

export function isToolProfile(value: string): value is ToolProfile {
  return (TOOL_PROFILES as readonly string[]).includes(value);
}

export function shouldRegisterToolForProfile(
  toolName: A5sqlMcpToolName,
  profile: ToolProfile,
): boolean {
  if (profile === "all") {
    return true;
  }
  return getToolNamesForProfile(profile).includes(toolName);
}

export function getToolNamesForProfile(profile: ToolProfile): readonly A5sqlMcpToolName[] {
  switch (profile) {
    case "all":
      return ALL_TOOL_NAMES;
    case "core-read":
      return CORE_READ_TOOL_NAMES;
    case "schema-explore":
      return SCHEMA_EXPLORE_TOOL_NAMES;
    case "draft-generation":
      return DRAFT_GENERATION_TOOL_NAMES;
  }
}
