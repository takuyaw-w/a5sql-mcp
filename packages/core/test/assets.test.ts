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

  it("masks URL and DSN credentials when reading assets", async () => {
    const root = await makeTempDir();
    const sqlPath = path.join(root, "queries", "connection-urls.sql");
    await mkdir(path.dirname(sqlPath), { recursive: true });
    await writeFile(
      sqlPath,
      [
        "DATABASE_URL=postgres://alice:raw-password@localhost/app",
        "CONNECTION_STRING=Server=localhost;User ID=alice;Password=raw-password;Database=app",
        "DSN=mysql://bob:dsn-secret@localhost/app",
        "select 'postgres://alice:url-secret@localhost/app' as url;",
        "host=localhost",
      ].join("\n"),
      "utf8",
    );

    const assets = await searchA5sqlAssets({ roots: [root], query: "DATABASE_URL" });
    const read = await readA5sqlAsset({ roots: [root], assetId: assets[0]!.id });
    const serialized = JSON.stringify(read);

    expect(read?.content).toContain("DATABASE_URL=***");
    expect(read?.content).toContain("CONNECTION_STRING=***");
    expect(read?.content).toContain("DSN=***");
    expect(read?.content).toContain("postgres://***@localhost/app");
    expect(read?.content).toContain("host=localhost");
    expect(serialized).not.toContain("raw-password");
    expect(serialized).not.toContain("dsn-secret");
    expect(serialized).not.toContain("url-secret");
    expect(serialized).not.toContain("postgres://alice:raw-password@localhost/app");
    expect(serialized).not.toContain(
      "Server=localhost;User ID=alice;Password=raw-password;Database=app",
    );
  });

  it("does not return content for binary or unsupported assets", async () => {
    const root = await makeTempDir();
    const sqlitePath = path.join(root, "cache.sqlite");
    await writeFile(sqlitePath, Buffer.from([0x00, 0x01, 0x02, 0x03]));

    const assets = await searchA5sqlAssets({ roots: [root], kinds: ["database"] });
    const read = await readA5sqlAsset({ roots: [root], assetId: assets[0]!.id });

    expect(read).toMatchObject({
      content: "",
      encoding: "binary_or_unsupported",
      truncated: false,
      bytesRead: 0,
      warnings: ["asset_content_not_returned_for_binary_or_unsupported_type"],
    });
  });
});

async function makeTempDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `a5sql-mcp-${randomUUID()}`);
  await mkdir(dir, {
    recursive: true,
  });
  return dir;
}
