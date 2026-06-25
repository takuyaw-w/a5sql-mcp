#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

import { parseA5erIni, parseSqlStatements } from "@takuyaw-w/a5sql-mcp-parser";

export type CliResult = {
  filePath: string;
  kind: "a5er" | "sql" | "text";
  parsed: unknown;
};

async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const mcpMode = args[0] === "--mcp";
  const fileArg = mcpMode ? args[1] : args[0];
  if (!fileArg || fileArg === "--help" || fileArg === "-h") {
    printHelp();
    process.exitCode = fileArg ? 0 : 1;
    return;
  }

  if (mcpMode) {
    const { runMcpServer } = await import("./mcp.js");
    await runMcpServer({ fileArg });
    return;
  }

  const result = await parseFile(fileArg);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function printHelp(): void {
  process.stderr.write(`Usage:\n`);
  process.stderr.write(`  a5sql-mcp <file>\n`);
  process.stderr.write(`  a5sql-mcp --mcp <file>\n\n`);
  process.stderr.write(
    `Parse a local .a5er or .sql file and print JSON, or serve it over MCP stdio.\n`,
  );
}

function detectKind(filePath: string): CliResult["kind"] {
  const extension = path.extname(filePath).toLocaleLowerCase();
  if (extension === ".a5er") {
    return "a5er";
  }
  if (extension === ".sql") {
    return "sql";
  }
  return "text";
}

export async function parseFile(fileArg: string): Promise<CliResult> {
  const filePath = path.resolve(fileArg);
  const text = await readTextFile(filePath);
  const kind = detectKind(filePath);
  const parsed =
    kind === "a5er"
      ? parseA5erIni(text)
      : kind === "sql"
        ? { statements: parseSqlStatements(text) }
        : { text };

  return {
    filePath,
    kind,
    parsed,
  };
}

export async function readTextFile(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return decoder.decode(buffer).replace(/^\uFEFF/, "");
}

export function isCliEntrypoint(argvEntry: string | undefined, moduleUrl: string): boolean {
  if (!argvEntry) {
    return false;
  }
  return resolveRealPath(argvEntry) === resolveRealPath(fileURLToPath(moduleUrl));
}

function resolveRealPath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  try {
    return realpathSync(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

if (isCliEntrypoint(process.argv[1], import.meta.url)) {
  main(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`a5sql-mcp: ${message}\n`);
    process.exitCode = 1;
  });
}
