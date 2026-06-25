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
});
