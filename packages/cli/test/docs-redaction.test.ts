import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const PUBLIC_GUIDANCE_FILES = [
  "../../../README.md",
  "../../../AGENTS.md",
  "../../../.agents/skills/a5sql-mcp/SKILL.md",
] as const;

describe("public documentation redaction audit", () => {
  it("does not include real local paths or credential-looking example values", async () => {
    const docs = await Promise.all(
      PUBLIC_GUIDANCE_FILES.map(async (relativePath) => ({
        relativePath,
        text: await readFile(new URL(relativePath, import.meta.url), "utf8"),
      })),
    );
    const forbiddenPatterns = [
      /\/home\/takuya\/(?!\.codex\/RTK\.md)/,
      /postgres:\/\/[^/\s:]+:[^@\s]+@/i,
      /\b(?:raw-password|raw-token|raw-api-key|json-password|json-api-key)\b/i,
      /\b(?:ghp|github_pat|sk-proj|sk)-[A-Za-z0-9_-]{8,}\b/,
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
    ];

    for (const { relativePath, text } of docs) {
      for (const pattern of forbiddenPatterns) {
        expect(text, `${relativePath} matched ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("documents the 0.9.6 parser robustness release check", async () => {
    const docs = await Promise.all(
      PUBLIC_GUIDANCE_FILES.map(async (relativePath) => ({
        relativePath,
        text: await readFile(new URL(relativePath, import.meta.url), "utf8"),
      })),
    );
    const readme = docs.find((doc) => doc.relativePath === "../../../README.md")?.text ?? "";

    expect(readme).toContain("0.9.6");
    expect(readme).toContain("壊れたファイル");
    expect(readme).toContain("正常な空 schema として扱いません");
    expect(readme).toContain("a5er_encoding_mismatch");

    for (const { relativePath, text } of docs) {
      expect(text, `${relativePath} should document parse status`).toContain("parseStatus");
      expect(text, `${relativePath} should document unrecognized A5ER`).toContain(
        "a5er_structure_not_recognized",
      );
      expect(text, `${relativePath} should document untrusted content`).toContain(
        "contentIsUntrusted",
      );
    }
  });
});
