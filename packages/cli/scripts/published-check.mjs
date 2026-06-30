#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EXPECTED_TOOL_NAMES = [
  "compare_a5er_with_live_schema",
  "describe_a5sql_file",
  "describe_a5sql_table",
  "detect_a5sql_locations",
  "explain_a5sql_table",
  "find_a5sql_columns",
  "find_a5sql_tables",
  "generate_mermaid_er_diagram",
  "generate_migration_plan",
  "generate_model_files",
  "generate_schema_markdown",
  "generate_sql_select",
  "list_a5sql_connections",
  "list_a5sql_relationships",
  "list_a5sql_tables",
  "parse_a5sql_asset",
  "parse_a5sql_file",
  "read_a5sql_asset",
  "read_a5sql_file",
  "review_a5sql_schema",
  "search_a5sql_assets",
  "suggest_schema_changes",
].sort();

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "a5sql-mcp-published-"));
  let client;

  try {
    const parserTarball = await packPackage(tempRoot, "@takuyaw-w/a5sql-mcp-parser");
    const coreTarball = await packPackage(tempRoot, "@takuyaw-w/a5sql-mcp-core");
    const cliTarball = await packPackage(tempRoot, "@takuyaw-w/a5sql-mcp");

    await writeFile(
      path.join(tempRoot, "package.json"),
      JSON.stringify({ private: true, type: "module" }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(tempRoot, "pnpm-workspace.yaml"),
      [
        "packages:",
        "  - .",
        "overrides:",
        `  "@takuyaw-w/a5sql-mcp-core": ${JSON.stringify(localTarballSpecifier(coreTarball))}`,
        `  "@takuyaw-w/a5sql-mcp-parser": ${JSON.stringify(localTarballSpecifier(parserTarball))}`,
        "",
      ].join("\n"),
      "utf8",
    );

    runPnpm(["add", cliTarball], tempRoot);

    const binPath = path.join(
      tempRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "a5sql-mcp.cmd" : "a5sql-mcp",
    );
    await access(binPath);

    const sampleA5er = path.join(repoRoot, "example", "schema.a5er");
    const transport = new StdioClientTransport({
      command: binPath,
      args: ["--mcp", sampleA5er],
      cwd: tempRoot,
    });
    client = new Client({ name: "a5sql-mcp-published-check", version: "0.0.0" });
    await client.connect(transport);

    const toolsResult = await client.listTools();
    const actualToolNames = toolsResult.tools.map((tool) => tool.name).sort();
    const missing = EXPECTED_TOOL_NAMES.filter((toolName) => !actualToolNames.includes(toolName));
    const unexpected = actualToolNames.filter(
      (toolName) => !EXPECTED_TOOL_NAMES.includes(toolName),
    );

    if (missing.length > 0 || unexpected.length > 0) {
      throw new Error(
        [
          "Published-style MCP tools/list did not match the expected tool set.",
          `Missing: ${missing.length > 0 ? missing.join(", ") : "(none)"}`,
          `Unexpected: ${unexpected.length > 0 ? unexpected.join(", ") : "(none)"}`,
          `Actual: ${actualToolNames.join(", ")}`,
        ].join("\n"),
      );
    }

    console.log(
      `published:check passed with ${actualToolNames.length} tools from installed package bin`,
    );
  } finally {
    try {
      if (client) {
        await client.close();
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

async function packPackage(tempRoot, filter) {
  const before = new Set(await listTarballs(tempRoot));
  runPnpm(["--filter", filter, "pack", "--pack-destination", tempRoot], repoRoot);
  const after = await listTarballs(tempRoot);
  const created = after.filter((fileName) => !before.has(fileName));

  if (created.length !== 1) {
    throw new Error(
      `Expected one tarball for ${filter}, got ${created.length}: ${created.join(", ")}`,
    );
  }

  return path.join(tempRoot, created[0]);
}

function localTarballSpecifier(tarballPath) {
  return `file:${tarballPath}`;
}

async function listTarballs(directory) {
  return (await readdir(directory)).filter((fileName) => fileName.endsWith(".tgz")).sort();
}

function runPnpm(args, cwd) {
  const result = spawnSync("pnpm", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `pnpm ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return result.stdout;
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
