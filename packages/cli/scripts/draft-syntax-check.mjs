#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { generateModelFiles } from "../dist/mcp/generation-tools.js";

const hostileTables = ["class", "123-orders", "注文", "foo-bar", "foo bar"].map(
  (name, tableIndex) => ({
    name,
    objectType: "entity",
    columns:
      tableIndex === 0
        ? ["class", "123-id", "display-name", "display name", "quote'\\\n$", "注文"].map(
            (columnName, columnIndex) => ({
              name: columnName,
              dataType: columnIndex === 0 ? "bigint" : "text",
              primaryKey: columnIndex === 0,
              nullable: columnIndex !== 0,
            }),
          )
        : [{ name: "id", dataType: "bigint", primaryKey: true, nullable: false }],
  }),
);

const parsed = {
  filePath: "hostile.a5er",
  kind: "a5er",
  encoding: "utf-8",
  parsed: {
    parseStatus: "ok",
    tables: hostileTables,
    relationships: [],
    warnings: [],
  },
};

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "a5sql-mcp-draft-syntax-"));
const laravel = generateModelFiles(parsed, { framework: "laravel" });
const sqlalchemy = generateModelFiles(parsed, { framework: "sqlalchemy" });
const requestedLanguages = new Set(process.argv.slice(2));
for (const language of requestedLanguages) {
  if (language !== "--php-only" && language !== "--python-only") {
    throw new Error(`Unknown draft syntax check option: ${language}`);
  }
}
const checkPhp = requestedLanguages.size === 0 || requestedLanguages.has("--php-only");
const checkPython = requestedLanguages.size === 0 || requestedLanguages.has("--python-only");

if (checkPhp) {
  for (const file of laravel.files) {
    const filePath = path.join(tempRoot, path.basename(file.path));
    await writeFile(filePath, file.content, "utf8");
    run("php", ["-l", filePath]);
  }
}

if (checkPython) {
  const pythonFile = path.join(tempRoot, "models.py");
  await writeFile(pythonFile, sqlalchemy.files[0].content, "utf8");
  run(process.platform === "win32" ? "python" : "python3", ["-m", "py_compile", pythonFile]);
}

console.log("draft syntax check ok");

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}
