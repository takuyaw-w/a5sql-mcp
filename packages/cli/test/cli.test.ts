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
      encoding: string;
      kind: string;
      parsed: { tables: Array<{ name: string }> };
    };

    expect(output.kind).toBe("a5er");
    expect(output.encoding).toBe("utf-8");
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

  it("parses a Shift_JIS a5er file", async () => {
    const dir = path.join(os.tmpdir(), `a5sql-mcp-cli-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "shift-jis.a5er");
    await writeFile(filePath, shiftJisA5erBuffer());

    const output = (await parseFile(filePath)) as {
      encoding: string;
      kind: string;
      parsed: { tables: Array<{ name: string; logicalName?: string }> };
    };

    expect(output.kind).toBe("a5er");
    expect(output.encoding).toBe("shift_jis");
    expect(output.parsed.tables[0]).toEqual(
      expect.objectContaining({
        name: "users",
        logicalName: "ユーザー",
      }),
    );
  });

  it("parses a UTF-16LE a5er file", async () => {
    const dir = path.join(os.tmpdir(), `a5sql-mcp-cli-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "utf16le.a5er");
    const source = [
      "# A5:ER FORMAT:19",
      "[Entity]",
      "PName=users",
      "LName=ユーザー",
      'Field="ID","id","Integer","NOT NULL",0,"","",$FFFFFFFF,""',
    ].join("\n");
    await writeFile(
      filePath,
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(source, "utf16le")]),
    );

    const output = (await parseFile(filePath)) as {
      encoding: string;
      kind: string;
      parsed: { tables: Array<{ name: string; logicalName?: string }> };
    };

    expect(output.kind).toBe("a5er");
    expect(output.encoding).toBe("utf-16le");
    expect(output.parsed.tables[0]?.logicalName).toBe("ユーザー");
  });

  it("does not silently parse binary a5er input as an empty schema", async () => {
    const dir = path.join(os.tmpdir(), `a5sql-mcp-cli-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "binary.a5er");
    await writeFile(filePath, Buffer.from([0, 1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0]));

    const output = (await parseFile(filePath)) as {
      encoding: string;
      kind: string;
      parsed: { parseStatus: string; warnings: string[]; tables: unknown[] };
    };

    expect(output.kind).toBe("a5er");
    expect(output.encoding).toBe("binary");
    expect(output.parsed.parseStatus).toBe("unrecognized");
    expect(output.parsed.warnings).toContain("a5er_structure_not_recognized");
    expect(output.parsed.tables).toEqual([]);
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

function shiftJisA5erBuffer(): Buffer {
  return Buffer.concat([
    Buffer.from(["# A5:ER FORMAT:19", "[Entity]", "PName=users", "LName="].join("\n"), "ascii"),
    Buffer.from([0x83, 0x86, 0x81, 0x5b, 0x83, 0x55, 0x81, 0x5b]),
    Buffer.from('\nField="ID","id","Integer","NOT NULL",0,"","",$FFFFFFFF,""', "ascii"),
  ]);
}
