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

  it("detects A5:SQL locations from explicit roots", async () => {
    const root = await makeTempDir();

    const { createDetectA5sqlLocationsHandler } = await loadAssetHandlers();
    expect(createDetectA5sqlLocationsHandler).toBeTypeOf("function");

    const result = await createDetectA5sqlLocationsHandler!()({
      roots: [root],
      includeDefaults: false,
    });

    expect(result.structuredContent).toMatchObject({
      totalCandidateCount: 1,
      returnedCandidateCount: 1,
      warnings: [],
    });
    expect(result.structuredContent.candidates).toEqual([
      expect.objectContaining({
        path: root,
        source: "extra",
        exists: true,
        readable: true,
      }),
    ]);
  });

  it("reads a discovered asset with masked content", async () => {
    const root = await makeTempDir();
    const sqlPath = path.join(root, "queries", "credentials.sql");
    await mkdir(path.dirname(sqlPath), { recursive: true });
    await writeFile(
      sqlPath,
      "select * from users where password='raw-password';\napi_key=raw-api-key",
      "utf8",
    );

    const { createReadA5sqlAssetHandler } = await loadAssetHandlers();
    expect(createReadA5sqlAssetHandler).toBeTypeOf("function");

    const result = await createReadA5sqlAssetHandler!()({
      roots: [root],
      assetId: stableAssetId(sqlPath),
      maxBytes: 1024,
    });

    expect(result.structuredContent).toMatchObject({
      found: true,
      asset: expect.objectContaining({
        assetId: stableAssetId(sqlPath),
        kind: "sql",
        fileName: "credentials.sql",
        path: sqlPath,
      }),
      encoding: "utf8",
      truncated: false,
      warnings: [],
    });
    expect(result.structuredContent.content).toContain("password='***'");
    expect(result.structuredContent.content).toContain("api_key=***");
    expect(JSON.stringify(result.structuredContent)).not.toContain("raw-password");
    expect(JSON.stringify(result.structuredContent)).not.toContain("raw-api-key");
  });

  it("lists connection candidates with non-secret fields masked by default", async () => {
    const root = await makeTempDir();
    const configPath = path.join(root, "connections.ini");
    await writeFile(
      configPath,
      [
        "Name=Local PostgreSQL",
        "Host=localhost",
        "Port=5432",
        "Database=app",
        "User=developer",
        "Password=raw-password",
      ].join("\n"),
      "utf8",
    );

    const { createListA5sqlConnectionsHandler } = await loadAssetHandlers();
    expect(createListA5sqlConnectionsHandler).toBeTypeOf("function");

    const result = await createListA5sqlConnectionsHandler!()({
      roots: [root],
      limit: 10,
    });

    expect(result.structuredContent).toMatchObject({
      totalConnectionCount: 1,
      returnedConnectionCount: 1,
      truncated: false,
    });
    expect(result.structuredContent.connections).toEqual([
      expect.objectContaining({
        sourceName: "connections.ini",
        hasPassword: true,
        fields: expect.objectContaining({
          host: { value: "l***t", masked: true },
          database: { value: "a***p", masked: true },
          user: { value: "d***r", masked: true },
        }),
        warnings: ["non_secret_connection_fields_masked_by_default"],
      }),
    ]);
    expect(JSON.stringify(result.structuredContent)).not.toContain("raw-password");
    expect(JSON.stringify(result.structuredContent)).not.toContain("developer");
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
    createDetectA5sqlLocationsHandler?: () => (input: {
      roots?: string[];
      includeDefaults?: boolean;
    }) => Promise<{ structuredContent: Record<string, unknown> }>;
    createReadA5sqlAssetHandler?: () => (input: {
      roots?: string[];
      assetId: string;
      maxBytes?: number;
    }) => Promise<{ structuredContent: Record<string, unknown> }>;
    createListA5sqlConnectionsHandler?: () => (input: {
      roots?: string[];
      limit?: number;
      revealNonSecret?: boolean;
    }) => Promise<{ structuredContent: Record<string, unknown> }>;
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
