import { randomUUID } from "node:crypto";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { isCliEntrypoint, parseFile } from "../src/index.js";

describe("a5sql-mcp cli", () => {
  it("parses an a5er file path argument", async () => {
    const dir = path.join(os.tmpdir(), `a5sql-mcp-cli-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "model.a5er");
    await writeFile(
      filePath,
      [
        "# A5:ER FORMAT:19",
        "[Entity]",
        "PName=users",
        "LName=ユーザー",
        'Field="ID","id","Integer","NOT NULL",0,"","",$FFFFFFFF,""',
      ].join("\n"),
      "utf8",
    );

    const output = (await parseFile(filePath)) as {
      kind: string;
      parsed: { tables: Array<{ name: string }> };
    };

    expect(output.kind).toBe("a5er");
    expect(output.parsed.tables[0]?.name).toBe("users");
  });

  it("parses a sql file path argument", async () => {
    const dir = path.join(os.tmpdir(), `a5sql-mcp-cli-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "query.sql");
    await writeFile(filePath, "select * from users;", "utf8");

    const output = (await parseFile(filePath)) as {
      kind: string;
      parsed: { statements: Array<{ operation: string; referencedTables: string[] }> };
    };

    expect(output.kind).toBe("sql");
    expect(output.parsed.statements[0]?.operation).toBe("select");
    expect(output.parsed.statements[0]?.referencedTables).toEqual(["users"]);
  });

  it("detects package bin symlink as direct cli invocation", async () => {
    const dir = path.join(os.tmpdir(), `a5sql-mcp-cli-${randomUUID()}`);
    const distDir = path.join(dir, "dist");
    const binDir = path.join(dir, "node_modules", ".bin");
    await mkdir(distDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    const entrypoint = path.join(distDir, "index.js");
    const binPath = path.join(binDir, "a5sql-mcp");
    await writeFile(entrypoint, "", "utf8");
    await symlink(entrypoint, binPath);

    expect(isCliEntrypoint(binPath, pathToFileURL(entrypoint).href)).toBe(true);
  });
});
