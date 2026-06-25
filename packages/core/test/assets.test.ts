import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readA5sqlAsset, searchA5sqlAssets } from "../src/assets.js";

describe("A5:SQL asset search", () => {
  it("finds sql assets and masks snippets/read contents", async () => {
    const root = await makeTempDir();
    const sqlPath = path.join(root, "queries", "find-users.sql");
    await mkdir(path.dirname(sqlPath), { recursive: true });
    await writeFile(sqlPath, "select * from users where password='secret';", "utf8");

    const assets = await searchA5sqlAssets({ roots: [root], query: "users" });

    expect(assets).toHaveLength(1);
    expect(assets[0]?.kind).toBe("sql");
    expect(assets[0]?.snippet).not.toContain("secret");

    const read = await readA5sqlAsset({ roots: [root], assetId: assets[0]!.id });
    expect(read?.content).not.toContain("secret");
    expect(read?.content).toContain("password='***'");
  });
});

async function makeTempDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `a5sql-mcp-${randomUUID()}`);
  await mkdir(dir, {
    recursive: true
  });
  return dir;
}
