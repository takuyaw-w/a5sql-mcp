import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createA5sqlMcpServer } from "../src/mcp/server.js";

describe("A5:SQL MCP server smoke", () => {
  it("lists 0.4 tools and can call detect_a5sql_locations", async () => {
    const root = path.join(os.tmpdir(), `a5sql-mcp-smoke-${randomUUID()}`);
    const filePath = path.join(root, "schema.sql");
    await mkdir(root, { recursive: true });
    await writeFile(filePath, "select * from users;", "utf8");

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
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
