import type { ParsedA5erDocument } from "@takuyaw-w/a5sql-mcp-parser";

import type { CliResult } from "../index.js";

export type JsonObject = Record<string, unknown>;

export type A5erCliResult = CliResult & {
  kind: "a5er";
  parsed: ParsedA5erDocument;
};

export type ParsedFileLoader = () => Promise<CliResult>;
