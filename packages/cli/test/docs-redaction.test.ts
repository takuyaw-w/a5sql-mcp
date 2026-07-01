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

  it("documents the 0.9.7 MCP adversarial E2E release check", async () => {
    const docs = await Promise.all(
      PUBLIC_GUIDANCE_FILES.map(async (relativePath) => ({
        relativePath,
        text: await readFile(new URL(relativePath, import.meta.url), "utf8"),
      })),
    );
    const readme = docs.find((doc) => doc.relativePath === "../../../README.md")?.text ?? "";

    expect(readme).toContain("0.9.7");
    expect(readme).toContain("MCP クライアント経由");
    expect(readme).toContain("adversarial");
    expect(readme).toContain("roots_required");
    expect(readme).toContain("draftIsDerivedFromUntrustedInput");

    for (const { relativePath, text } of docs) {
      expect(text, `${relativePath} should document adversarial E2E`).toContain("adversarial");
      expect(text, `${relativePath} should document untrusted content`).toContain(
        "contentIsUntrusted",
      );
    }
  });

  it("documents the agent preflight guard before implementation", async () => {
    const docs = await Promise.all(
      [...PUBLIC_GUIDANCE_FILES, "../../../docs/superpowers/plans/README.md"].map(
        async (relativePath) => ({
          relativePath,
          text: await readFile(new URL(relativePath, import.meta.url), "utf8"),
        }),
      ),
    );

    for (const { relativePath, text } of docs) {
      expect(text, `${relativePath} should document agent preflight`).toContain("agent:preflight");
      expect(text, `${relativePath} should document Task 0`).toContain("Task 0");
      expect(text, `${relativePath} should document main guard`).toContain("main");
      expect(text, `${relativePath} should document explicit approval`).toContain("明示");
    }
  });
});
