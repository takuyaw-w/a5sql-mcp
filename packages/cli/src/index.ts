#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseA5erIni, parseSqlStatements } from "@takuyaw-w/a5sql-mcp-parser";

import {
  DEFAULT_TOOL_PROFILE,
  TOOL_PROFILES,
  parseToolProfile,
  type ToolProfile,
} from "./mcp/tool-profiles.js";
import { readDecodedTextFile, type DecodedText } from "./text.js";

const DEFAULT_CONFIGURED_FILE_MAX_BYTES = 10 * 1024 * 1024;

export type CliResult = {
  filePath: string;
  kind: "a5er" | "sql" | "text";
  encoding: string;
  parsed: unknown;
  fileRead: {
    status: "ok" | "file_too_large";
    sizeBytes: number;
    bytesRead: number;
    maxBytes: number;
    truncated: boolean;
  };
};

export type ParseFileOptions = {
  maxBytes?: number;
};

export type CliArguments =
  | { mode: "help"; exitCode: 0 | 1 }
  | { mode: "parse"; fileArg: string }
  | { mode: "mcp"; fileArg: string; toolProfile: ToolProfile };

export function parseCliArguments(args: string[]): CliArguments {
  if (args.length === 0) {
    return { mode: "help", exitCode: 1 };
  }
  if (args[0] === "--help" || args[0] === "-h") {
    return { mode: "help", exitCode: 0 };
  }
  if (args[0] !== "--mcp") {
    return { mode: "parse", fileArg: args[0] };
  }

  const fileArg = args[1];
  if (!fileArg || fileArg === "--help" || fileArg === "-h") {
    return { mode: "help", exitCode: fileArg ? 0 : 1 };
  }

  let toolProfile = DEFAULT_TOOL_PROFILE;
  for (let index = 2; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--tool-profile") {
      const value = args[index + 1];
      if (!value) {
        throw new Error(`--tool-profile requires one of: ${TOOL_PROFILES.join(", ")}.`);
      }
      toolProfile = parseToolProfile(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown MCP option: ${option}`);
  }

  return { mode: "mcp", fileArg, toolProfile };
}

async function main(argv: string[]): Promise<void> {
  const parsedArgs = parseCliArguments(argv.slice(2));
  if (parsedArgs.mode === "help") {
    printHelp();
    process.exitCode = parsedArgs.exitCode;
    return;
  }

  if (parsedArgs.mode === "mcp") {
    const { runMcpServer } = await import("./mcp.js");
    await runMcpServer({
      fileArg: parsedArgs.fileArg,
      toolProfile: parsedArgs.toolProfile,
    });
    return;
  }

  const result = await parseFile(parsedArgs.fileArg);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function printHelp(): void {
  process.stderr.write(`Usage:\n`);
  process.stderr.write(`  a5sql-mcp <file>\n`);
  process.stderr.write(`  a5sql-mcp --mcp <file> [--tool-profile <profile>]\n\n`);
  process.stderr.write(
    `Parse a local .a5er or .sql file and print JSON, or serve it over MCP stdio.\n`,
  );
  process.stderr.write(`MCP tool profiles: all, core-read, schema-explore, draft-generation.\n`);
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

export async function parseFile(
  fileArg: string,
  options: ParseFileOptions = {},
): Promise<CliResult> {
  const filePath = path.resolve(fileArg);
  const maxBytes = options.maxBytes ?? DEFAULT_CONFIGURED_FILE_MAX_BYTES;
  const decoded = await readTextFileWithMetadata(filePath, maxBytes);
  const kind = detectKind(filePath);
  const fileRead: CliResult["fileRead"] = {
    status: decoded.truncated ? "file_too_large" : "ok",
    sizeBytes: decoded.sizeBytes,
    bytesRead: decoded.bytesRead,
    maxBytes,
    truncated: decoded.truncated,
  };
  if (decoded.truncated) {
    return {
      filePath,
      kind,
      encoding: decoded.encoding,
      parsed: {
        code: "file_too_large",
        message:
          "configured file exceeds the initial read limit and was not parsed as a complete file.",
        sizeBytes: decoded.sizeBytes,
        maxBytes,
        bytesRead: decoded.bytesRead,
      },
      fileRead,
    };
  }
  const parsed =
    kind === "a5er"
      ? parseA5erIni(decoded.text, { fileEncoding: decoded.encoding })
      : kind === "sql"
        ? { statements: parseSqlStatements(decoded.text) }
        : { text: decoded.text };

  return {
    filePath,
    kind,
    encoding: decoded.encoding,
    parsed,
    fileRead,
  };
}

export async function readTextFile(filePath: string): Promise<string> {
  return (await readTextFileWithMetadata(filePath)).text;
}

export async function readTextFileWithMetadata(
  filePath: string,
  maxBytes = DEFAULT_CONFIGURED_FILE_MAX_BYTES,
): Promise<DecodedText> {
  return readDecodedTextFile(filePath, maxBytes);
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
