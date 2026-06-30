import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { A5SQL_MCP_SERVER_VERSION, createA5sqlMcpServer } from "../src/mcp/server.js";

describe("A5:SQL MCP server smoke", () => {
  it("reports 0.7.0 version metadata", async () => {
    expect(A5SQL_MCP_SERVER_VERSION).toBe("0.7.0");

    const packageJsonPaths = [
      new URL("../../../package.json", import.meta.url),
      new URL("../../parser/package.json", import.meta.url),
      new URL("../../core/package.json", import.meta.url),
      new URL("../package.json", import.meta.url),
    ];
    const packageJsons = await Promise.all(
      packageJsonPaths.map(async (packageJsonPath) =>
        JSON.parse(await readFile(packageJsonPath, "utf8")),
      ),
    );

    expect(packageJsons.map((packageJson) => packageJson.version)).toEqual([
      "0.7.0",
      "0.7.0",
      "0.7.0",
      "0.7.0",
    ]);
  });

  it("lists current tools and returns representative structuredContent contracts", async () => {
    const root = path.join(os.tmpdir(), `a5sql-mcp-smoke-${randomUUID()}`);
    const filePath = path.join(root, "schema.sql");
    const extraFilePath = path.join(root, "extra.sql");
    await mkdir(root, { recursive: true });
    await writeFile(filePath, "select * from users;", "utf8");
    await writeFile(extraFilePath, "select * from accounts where token='raw-token';", "utf8");

    const server = await createA5sqlMcpServer({ fileArg: filePath });
    const client = new Client({ name: "a5sql-mcp-test", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const tools = await client.listTools();
      const toolNames = tools.tools.map((tool) => tool.name);

      expect(toolNames).toEqual(
        expect.arrayContaining([
          "detect_a5sql_locations",
          "read_a5sql_asset",
          "list_a5sql_connections",
          "search_a5sql_assets",
          "parse_a5sql_asset",
        ]),
      );

      const result = await client.callTool({
        name: "detect_a5sql_locations",
        arguments: { roots: [root], includeDefaults: false },
      });

      expect(result.structuredContent).toMatchObject({
        totalCandidateCount: 1,
        returnedCandidateCount: 1,
        warnings: [],
        nextAction: expect.any(String),
      });

      const searchResult = await client.callTool({
        name: "search_a5sql_assets",
        arguments: { roots: [root], query: "accounts", kinds: ["sql"], limit: 1 },
      });

      expect(searchResult.structuredContent).toMatchObject({
        effectiveLimit: 1,
        returnedAssetCount: 1,
        truncated: true,
        cutoffReason: "limit_exceeded",
        warnings: expect.any(Array),
        nextAction: expect.any(String),
      });
      expect(JSON.stringify(searchResult.structuredContent)).not.toContain("raw-token");

      const readResult = await client.callTool({
        name: "read_a5sql_asset",
        arguments: { roots: [root], path: extraFilePath, maxChars: 200 },
      });

      expect(readResult.structuredContent).toMatchObject({
        found: true,
        truncated: false,
        warnings: [],
        nextAction: expect.any(String),
      });
      expect(JSON.stringify(readResult.structuredContent)).not.toContain("raw-token");
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
      await rm(root, { recursive: true, force: true });
    }
  });
});
