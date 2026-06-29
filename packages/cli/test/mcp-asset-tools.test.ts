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

    const handlers = await import("../src/mcp/tool-handlers.js");
    const createParseA5sqlAssetHandler = (
      handlers as unknown as {
        createParseA5sqlAssetHandler?: () => (input: {
          roots: string[];
          assetId: string;
        }) => Promise<{ structuredContent: Record<string, unknown> }>;
      }
    ).createParseA5sqlAssetHandler;
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
