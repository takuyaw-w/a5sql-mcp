import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readA5sqlAsset, searchA5sqlAssets, searchA5sqlAssetsWithMetadata } from "../src/assets.js";

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
        "select 'postgres://raw-token@localhost/app' as token_url;",
        "repository=https://ghp_rawtoken@github.com/example/private-repo.git",
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
    expect(read?.content).toContain("https://***@github.com/example/private-repo.git");
    expect(read?.content).toContain("host=localhost");
    expect(serialized).not.toContain("raw-password");
    expect(serialized).not.toContain("dsn-secret");
    expect(serialized).not.toContain("url-secret");
    expect(serialized).not.toContain("raw-token");
    expect(serialized).not.toContain("ghp_rawtoken");
    expect(serialized).not.toContain("postgres://alice:raw-password@localhost/app");
    expect(serialized).not.toContain(
      "Server=localhost;User ID=alice;Password=raw-password;Database=app",
    );
  });

  it("masks expanded secret forms in asset snippets and read contents", async () => {
    const root = await makeTempDir();
    const sqlPath = path.join(root, "queries", "expanded-secrets.sql");
    await mkdir(path.dirname(sqlPath), { recursive: true });
    await writeFile(
      sqlPath,
      [
        "-- expanded secret forms",
        'select \'{"password":"json-password","api_key":"json-api-key"}\' as payload;',
        "Authorization: Bearer raw-bearer-token",
        "jdbc:postgresql://localhost/app?user=alice&password=query-password&token=query-token",
        "Driver=PostgreSQL;Server=localhost;User ID=alice;Pwd=odbc-password;Database=app",
      ].join("\n"),
      "utf8",
    );

    const assets = await searchA5sqlAssets({ roots: [root], query: "expanded" });
    expect(assets).toHaveLength(1);
    const read = await readA5sqlAsset({ roots: [root], assetId: assets[0]!.id });
    expect(read).not.toBeNull();
    expect(read?.content).toContain('"password":"***"');
    expect(read?.content).toContain('"api_key":"***"');
    expect(read?.content).toContain("Authorization: Bearer ***");
    expect(read?.content).toContain("password=***");
    expect(read?.content).toContain("token=***");
    expect(read?.content).toContain("Pwd=***");
    expect(read?.content).not.toContain("json-password");
    expect(read?.content).not.toContain("json-api-key");
    expect(read?.content).not.toContain("raw-bearer-token");
    expect(read?.content).not.toContain("query-password");
    expect(read?.content).not.toContain("query-token");
    expect(read?.content).not.toContain("odbc-password");

    expect(assets[0]?.snippet).toBeTruthy();
    expect(assets[0]?.snippet).toContain('"password":"***"');
    expect(assets[0]?.snippet).toContain('"api_key":"***"');
    expect(assets[0]?.snippet).toContain("Authorization: Bearer ***");
    expect(assets[0]?.snippet).not.toContain("json-password");
    expect(assets[0]?.snippet).not.toContain("json-api-key");

    const authAssets = await searchA5sqlAssets({ roots: [root], query: "Authorization" });
    expect(authAssets).toHaveLength(1);
    expect(authAssets[0]?.snippet).toContain("Authorization: Bearer ***");
    expect(authAssets[0]?.snippet).not.toContain("raw-bearer-token");

    const jdbcAssets = await searchA5sqlAssets({ roots: [root], query: "query-password" });
    expect(jdbcAssets).toHaveLength(1);
    expect(jdbcAssets[0]?.snippet).toContain("password=***");
    expect(jdbcAssets[0]?.snippet).toContain("token=***");
    expect(jdbcAssets[0]?.snippet).not.toContain("query-password");
    expect(jdbcAssets[0]?.snippet).not.toContain("query-token");

    const odbcAssets = await searchA5sqlAssets({ roots: [root], query: "odbc-password" });
    expect(odbcAssets).toHaveLength(1);
    expect(odbcAssets[0]?.snippet).toContain("Pwd=***");
    expect(odbcAssets[0]?.snippet).not.toContain("odbc-password");
  });

  it("masks private key material when asset reads are truncated", async () => {
    const root = await makeTempDir();
    const keyPath = path.join(root, "keys", "private-key.txt");
    await mkdir(path.dirname(keyPath), { recursive: true });
    await writeFile(
      keyPath,
      [
        "-----BEGIN PRIVATE KEY-----",
        "raw-private-key-material-that-would-otherwise-leak",
        "-----END PRIVATE KEY-----",
      ].join("\n"),
      "utf8",
    );

    const assets = await searchA5sqlAssets({ roots: [root], query: "PRIVATE KEY" });
    expect(assets).toHaveLength(1);
    const read = await readA5sqlAsset({
      roots: [root],
      assetId: assets[0]!.id,
      maxBytes: 50,
    });

    expect(read).not.toBeNull();
    expect(read?.truncated).toBe(true);
    expect(read?.content).toContain("-----BEGIN PRIVATE KEY-----");
    expect(read?.content).toContain("***");
    expect(read?.content).not.toContain("raw-private-key");
    expect(read?.content).not.toContain("material-that-would-otherwise-leak");
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

  it("does not return content for binary bytes in supported extensions", async () => {
    const root = await makeTempDir();
    const sqlPath = path.join(root, "binary.sql");
    await writeFile(sqlPath, Buffer.from([0x00, 0x01, 0x02, 0x03]));

    const read = await readA5sqlAsset({ roots: [root], path: sqlPath });

    expect(read).toMatchObject({
      content: "",
      encoding: "binary",
      truncated: false,
      warnings: ["binary_file_not_returned"],
    });
  });

  it("does not decode tiny odd-position NUL buffers as UTF-16LE text", async () => {
    const root = await makeTempDir();
    try {
      const sqlPath = path.join(root, "tiny-binary.sql");
      await writeFile(sqlPath, Buffer.from([0x01, 0x00, 0x02, 0x03]));

      const read = await readA5sqlAsset({ roots: [root], path: sqlPath });

      expect(read).not.toBeNull();
      expect(read?.encoding).toBe("binary");
      expect(read?.content).toBe("");
      expect(read?.warnings).toContain("binary_file_not_returned");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses explicit path reads without roots", async () => {
    const root = await makeTempDir();
    const sqlPath = path.join(root, "personal-note.sql");
    await writeFile(sqlPath, "select 'local personal marker' as memo;", "utf8");

    await expect(readA5sqlAsset({ path: sqlPath })).resolves.toBeNull();
  });

  it("does not search platform or home defaults when roots are omitted", async () => {
    const originalUserProfile = process.env.USERPROFILE;
    const originalRoots = process.env.A5SQL_MCP_ROOTS;
    const root = await makeTempDir();
    const defaultCandidate = path.join(root, "A5M2");
    const sqlPath = path.join(defaultCandidate, "leaky.sql");
    await mkdir(defaultCandidate, { recursive: true });
    await writeFile(sqlPath, "select 'default root marker' as memo;", "utf8");

    try {
      process.env.USERPROFILE = root;
      delete process.env.A5SQL_MCP_ROOTS;

      await expect(searchA5sqlAssets({ query: "default root marker" })).resolves.toEqual([]);
      await expect(readA5sqlAsset({ assetId: stableAssetId(sqlPath) })).resolves.toBeNull();
    } finally {
      restoreEnv("USERPROFILE", originalUserProfile);
      restoreEnv("A5SQL_MCP_ROOTS", originalRoots);
    }
  });

  it("reports when search stops because maxFiles is reached", async () => {
    const root = await makeTempDir();
    await writeFile(path.join(root, "first.sql"), "select * from users;", "utf8");
    await writeFile(path.join(root, "second.sql"), "select * from accounts;", "utf8");

    const result = await searchA5sqlAssetsWithMetadata({
      roots: [root],
      kinds: ["sql"],
      limit: 10,
      maxFiles: 1,
    });

    expect(result).toMatchObject({
      effectiveLimit: 10,
      visitedFileCount: 1,
      truncated: true,
      cutoffReason: "max_files_reached",
    });
    expect(result.assets).toHaveLength(1);
  });
});

async function makeTempDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `a5sql-mcp-${randomUUID()}`);
  await mkdir(dir, {
    recursive: true,
  });
  return dir;
}

function stableAssetId(filePath: string): string {
  return createHash("sha256").update(path.resolve(filePath)).digest("hex").slice(0, 24);
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
