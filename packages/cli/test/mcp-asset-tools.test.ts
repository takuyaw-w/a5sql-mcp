import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseFile } from "../src/index.js";
import { createReadA5sqlFileHandler } from "../src/mcp/tool-handlers.js";

describe("A5:SQL asset MCP tools", () => {
  it("masks secrets when reading the configured file", async () => {
    const root = await makeTempDir();
    const sqlPath = path.join(root, "queries", "credentials.sql");
    await mkdir(path.dirname(sqlPath), { recursive: true });
    await writeFile(
      sqlPath,
      [
        "select * from users where password='raw-password';",
        "token: raw-token",
        "api_key=raw-api-key",
      ].join("\n"),
      "utf8",
    );

    const parsed = await parseFile(sqlPath);
    const result = await createReadA5sqlFileHandler(parsed)({});

    expect(result.structuredContent.text).toContain("password='***'");
    expect(result.structuredContent.text).toContain("token: ***");
    expect(result.structuredContent.text).toContain("api_key=***");
    expect(JSON.stringify(result.structuredContent)).not.toContain("raw-password");
    expect(JSON.stringify(result.structuredContent)).not.toContain("raw-token");
    expect(JSON.stringify(result.structuredContent)).not.toContain("raw-api-key");
  });

  it("parses a discovered SQL asset by asset ID", async () => {
    const root = await makeTempDir();
    const sqlPath = path.join(root, "queries", "find-users.sql");
    await mkdir(path.dirname(sqlPath), { recursive: true });
    await writeFile(sqlPath, "select * from users where id = 1;", "utf8");

    const { createParseA5sqlAssetHandler } = await loadAssetHandlers();
    expect(createParseA5sqlAssetHandler).toBeTypeOf("function");

    const result = await createParseA5sqlAssetHandler!()({
      roots: [root],
      assetId: stableAssetId(sqlPath),
    });

    expect(result.structuredContent).toMatchObject({
      found: true,
      parser: "sql-heuristic",
      summary: "1 SQL statements",
    });
    expect(result.structuredContent.asset).toMatchObject({
      kind: "sql",
      fileName: "find-users.sql",
    });
    expect(result.structuredContent.statements).toEqual([
      expect.objectContaining({
        operation: "select",
        referencedTables: ["users"],
      }),
    ]);
  });

  it("searches assets and returns MCP-friendly asset IDs with masked snippets", async () => {
    const root = await makeTempDir();
    const sqlPath = path.join(root, "queries", "find-users.sql");
    await mkdir(path.dirname(sqlPath), { recursive: true });
    await writeFile(
      sqlPath,
      [
        "select * from users where password='raw-password';",
        "select * from audit_log where token='raw-token';",
      ].join("\n"),
      "utf8",
    );

    const { createSearchA5sqlAssetsHandler } = await loadAssetHandlers();
    expect(createSearchA5sqlAssetsHandler).toBeTypeOf("function");

    const result = await createSearchA5sqlAssetsHandler!()({
      roots: [root],
      query: "users",
      kinds: ["sql"],
    });

    expect(result.structuredContent).toMatchObject({
      query: "users",
      roots: [root],
      count: 1,
      truncated: false,
      nextAction: "parse_a5sql_asset に assetId を渡すと内容を解析できます。",
    });
    expect(result.structuredContent.assets).toEqual([
      expect.objectContaining({
        assetId: stableAssetId(sqlPath),
        kind: "sql",
        fileName: "find-users.sql",
        path: sqlPath,
        size: expect.any(Number),
        modifiedAt: expect.any(String),
        snippet: expect.stringContaining("password='***'"),
        warning: null,
      }),
    ]);
    expect(JSON.stringify(result.structuredContent)).not.toContain("raw-password");
    expect(JSON.stringify(result.structuredContent)).not.toContain("raw-token");
  });

  it("marks search output as truncated when the limit is reached", async () => {
    const root = await makeTempDir();
    const firstPath = path.join(root, "queries", "first.sql");
    const secondPath = path.join(root, "queries", "second.sql");
    await mkdir(path.dirname(firstPath), { recursive: true });
    await writeFile(firstPath, "select * from users;", "utf8");
    await writeFile(secondPath, "select * from accounts;", "utf8");

    const { createSearchA5sqlAssetsHandler } = await loadAssetHandlers();
    const result = await createSearchA5sqlAssetsHandler!()({
      roots: [root],
      kinds: ["sql"],
      limit: 1,
    });

    expect(result.structuredContent).toMatchObject({
      count: 1,
      truncated: true,
    });
    expect(result.structuredContent.assets).toHaveLength(1);
  });

  it("marks search output as truncated when the default limit is reached", async () => {
    const root = await makeTempDir();
    const queriesDir = path.join(root, "queries");
    await mkdir(queriesDir, { recursive: true });
    await Promise.all(
      Array.from({ length: 51 }, (_, index) =>
        writeFile(
          path.join(queriesDir, `query-${String(index).padStart(2, "0")}.sql`),
          `select ${index} as value;`,
          "utf8",
        ),
      ),
    );

    const { createSearchA5sqlAssetsHandler } = await loadAssetHandlers();
    const result = await createSearchA5sqlAssetsHandler!()({
      roots: [root],
      kinds: ["sql"],
    });

    expect(result.structuredContent).toMatchObject({
      count: 50,
      truncated: true,
    });
    expect(result.structuredContent.assets).toHaveLength(50);
  });
});

async function makeTempDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `a5sql-mcp-asset-tools-${randomUUID()}`);
  await mkdir(dir, {
    recursive: true,
  });
  return dir;
}

function stableAssetId(filePath: string): string {
  return createHash("sha256").update(path.resolve(filePath)).digest("hex").slice(0, 24);
}

async function loadAssetHandlers() {
  const handlers = await import("../src/mcp/tool-handlers.js");
  return handlers as unknown as {
    createSearchA5sqlAssetsHandler?: () => (input: {
      roots?: string[];
      query?: string;
      kinds?: string[];
      limit?: number;
      includeHidden?: boolean;
      maxDepth?: number;
      maxFiles?: number;
      maxFileBytes?: number;
    }) => Promise<{ structuredContent: Record<string, unknown> }>;
    createParseA5sqlAssetHandler?: () => (input: {
      roots: string[];
      assetId: string;
    }) => Promise<{ structuredContent: Record<string, unknown> }>;
  };
}
