import { describe, expect, it } from "vitest";

import { extractConnectionCandidate } from "../src/connections.js";

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
