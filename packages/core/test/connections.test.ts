import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractConnectionCandidate,
  listA5sqlConnections,
  listA5sqlConnectionsWithMetadata,
} from "../src/connections.js";

describe("extractConnectionCandidate", () => {
  it("extracts connection-like fields without returning passwords", () => {
    const candidate = extractConnectionCandidate(
      "/tmp/sample.ini",
      [
        "Name=Local PostgreSQL",
        "Host=localhost",
        "Port=5432",
        "Database=app",
        "User=developer",
        "Password=raw-password",
      ].join("\n"),
      false,
    );

    expect(candidate).not.toBeNull();
    expect(candidate?.hasPassword).toBe(true);
    expect(candidate?.fields.host?.value).toBe("l***t");
    expect(candidate?.fields.database?.value).toBe("a***p");
    expect(JSON.stringify(candidate)).not.toContain("raw-password");
  });

  it("can reveal non-secret fields while still hiding passwords", () => {
    const candidate = extractConnectionCandidate(
      "/tmp/sample.ini",
      "Host=db.example.test\nDatabase=main\nUser=alice\nPassword=raw-password",
      true,
    );

    expect(candidate?.fields.host?.value).toBe("db.example.test");
    expect(JSON.stringify(candidate)).not.toContain("raw-password");
  });

  it("does not expose complete ODBC connection strings as public field values", () => {
    const candidate = extractConnectionCandidate(
      "/tmp/sample.ini",
      [
        "Name=Local ODBC",
        "Driver=PostgreSQL;Server=db.internal.test;User ID=alice;Pwd=raw-password;Database=app",
      ].join("\n"),
      true,
    );
    const serialized = JSON.stringify(candidate);

    expect(candidate).not.toBeNull();
    expect(candidate?.hasPassword).toBe(true);
    expect(candidate?.fields.type?.value).toBe("PostgreSQL");
    expect(candidate?.fields.host?.value).toBe("db.internal.test");
    expect(candidate?.fields.database?.value).toBe("app");
    expect(candidate?.fields.user?.value).toBe("alice");
    expect(serialized).not.toContain("raw-password");
    expect(serialized).not.toContain(
      "PostgreSQL;Server=db.internal.test;User ID=alice;Pwd=raw-password;Database=app",
    );
    expect(serialized).not.toContain("Server=db.internal.test;User ID=alice");
  });
});

describe("listA5sqlConnectionsWithMetadata", () => {
  it("reports an exact total after a complete scan while respecting the return limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "a5sql-mcp-connections-"));
    await Promise.all(
      ["one", "two", "three"].map((name) =>
        writeFile(path.join(root, `${name}.ini`), `Name=${name}\nHost=localhost\nDatabase=app`),
      ),
    );

    await expect(listA5sqlConnectionsWithMetadata({ roots: [root], limit: 1 })).resolves.toEqual(
      expect.objectContaining({
        knownConnectionCount: 3,
        totalConnectionCount: 3,
        totalConnectionCountIsExact: true,
        returnedConnectionCount: 1,
        truncated: true,
        cutoffReason: null,
      }),
    );
    await expect(listA5sqlConnections({ roots: [root], limit: 1 })).resolves.toHaveLength(1);
  });

  it("uses a nullable total when the asset scan is cut off", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "a5sql-mcp-connections-cutoff-"));
    const files = path.join(root, "files");
    await mkdir(files);
    await Promise.all(
      Array.from({ length: 501 }, (_, index) =>
        writeFile(
          path.join(files, `${String(index).padStart(3, "0")}.ini`),
          `Name=db-${index}\nHost=localhost\nDatabase=app`,
        ),
      ),
    );

    const result = await listA5sqlConnectionsWithMetadata({ roots: [root], limit: 10 });

    expect(result).toEqual(
      expect.objectContaining({
        knownConnectionCount: 500,
        totalConnectionCount: null,
        totalConnectionCountIsExact: false,
        returnedConnectionCount: 10,
        truncated: true,
        cutoffReason: "limit_exceeded",
      }),
    );
  });
});
