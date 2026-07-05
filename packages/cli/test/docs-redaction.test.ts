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

  it("documents the MCP adversarial E2E release check", async () => {
    const docs = await Promise.all(
      PUBLIC_GUIDANCE_FILES.map(async (relativePath) => ({
        relativePath,
        text: await readFile(new URL(relativePath, import.meta.url), "utf8"),
      })),
    );
    const readme = docs.find((doc) => doc.relativePath === "../../../README.md")?.text ?? "";

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

  it("documents the 0.9.8 client and agent safety guidance", async () => {
    const docs = await Promise.all(
      PUBLIC_GUIDANCE_FILES.map(async (relativePath) => ({
        relativePath,
        text: await readFile(new URL(relativePath, import.meta.url), "utf8"),
      })),
    );
    const readme = docs.find((doc) => doc.relativePath === "../../../README.md")?.text ?? "";

    expect(readme).toContain("MCP クライアント / AI エージェント向け安全ガイド");
    expect(readme).toContain("read_a5sql_file");
    expect(readme).toContain("startLine");
    expect(readme).toContain("maxLines");
    expect(readme).toContain("offsetChars");
    expect(readme).toContain("read_a5sql_asset");
    expect(readme).toContain("maxChars");
    expect(readme).toContain("そのまま実行");
    expect(readme).toContain("そのまま適用");

    for (const { relativePath, text } of docs) {
      expect(text, `${relativePath} should document 0.9.8 safety docs`).toContain("0.9.8");
      expect(text, `${relativePath} should document contentIsUntrusted`).toContain(
        "contentIsUntrusted",
      );
      expect(text, `${relativePath} should document trusted metadata`).toContain(
        "trustedMetadataFields",
      );
      expect(text, `${relativePath} should document untrusted payload`).toContain(
        "untrustedPayloadFields",
      );
      expect(text, `${relativePath} should document draft output`).toContain("draftOutputFields");
      expect(text, `${relativePath} should document draft disclosure`).toContain(
        "draftIsDerivedFromUntrustedInput",
      );
      expect(text, `${relativePath} should document root minimum privilege`).toContain(
        "A5SQL_MCP_ROOTS",
      );
    }
  });

  it("documents the 0.9.9 API freeze tool classification", async () => {
    const docs = await Promise.all(
      PUBLIC_GUIDANCE_FILES.map(async (relativePath) => ({
        relativePath,
        text: await readFile(new URL(relativePath, import.meta.url), "utf8"),
      })),
    );
    const readme = docs.find((doc) => doc.relativePath === "../../../README.md")?.text ?? "";
    const stableSection = readme.slice(
      readme.indexOf("### 安定 read-only tool"),
      readme.indexOf("### 生成補助 tool"),
    );
    const draftSection = readme.slice(
      readme.indexOf("### 生成補助 tool"),
      readme.indexOf("大きな `.a5er`"),
    );

    expect(readme).toContain("0.9.9 API Freeze Rehearsal");
    expect(stableSection).toContain("review_a5sql_schema");
    expect(stableSection).toContain("suggest_schema_changes");
    expect(stableSection).toContain("compare_a5er_with_live_schema");
    expect(draftSection).not.toContain("review_a5sql_schema");
    expect(draftSection).not.toContain("suggest_schema_changes");
    expect(draftSection).not.toContain("compare_a5er_with_live_schema");
    expect(draftSection).toContain("generate_sql_select");
    expect(draftSection).toContain("generate_mermaid_er_diagram");
    expect(draftSection).toContain("generate_model_files");
    expect(draftSection).toContain("generate_schema_markdown");
    expect(draftSection).toContain("generate_migration_plan");

    for (const { relativePath, text } of docs) {
      expect(text, `${relativePath} should document 0.9.9`).toContain("0.9.9");
      expect(text, `${relativePath} should document API freeze`).toContain("API Freeze");
      expect(text, `${relativePath} should document experimental draft tools`).toContain(
        "experimental draft",
      );
      expect(text, `${relativePath} should document review as stable`).toContain(
        "review_a5sql_schema",
      );
      expect(text, `${relativePath} should document comparison as stable`).toContain(
        "compare_a5er_with_live_schema",
      );
    }
  });

  it("documents the 0.9.10 preflight contract audit", async () => {
    const docs = await Promise.all(
      PUBLIC_GUIDANCE_FILES.map(async (relativePath) => ({
        relativePath,
        text: await readFile(new URL(relativePath, import.meta.url), "utf8"),
      })),
    );

    for (const { relativePath, text } of docs) {
      expect(text, `${relativePath} should document 0.9.10`).toContain("0.9.10");
      expect(text, `${relativePath} should document preflight contract audit`).toContain(
        "Preflight Contract Audit",
      );
      expect(text, `${relativePath} should document contract drift`).toContain("contract drift");
      expect(text, `${relativePath} should keep tools/list as source of truth`).toContain(
        "tools/list",
      );
      expect(text, `${relativePath} should document experimental draft marker`).toContain(
        "experimental draft tool",
      );
    }
  });

  it("documents the 0.9.13 docs and onboarding freeze boundaries", async () => {
    const docs = await Promise.all(
      PUBLIC_GUIDANCE_FILES.map(async (relativePath) => ({
        relativePath,
        text: await readFile(new URL(relativePath, import.meta.url), "utf8"),
      })),
    );
    const readme = docs.find((doc) => doc.relativePath === "../../../README.md")?.text ?? "";

    expect(readme).toContain("0.9.13");
    expect(readme).toContain("Docs / Onboarding Freeze");
    expect(readme).toContain("Codex");
    expect(readme).toContain("Cursor");
    expect(readme).toContain("Claude Code");

    for (const { relativePath, text } of docs) {
      expect(text, `${relativePath} should document 0.9.13`).toContain("0.9.13");
      expect(text, `${relativePath} should document docs freeze`).toContain(
        "Docs / Onboarding Freeze",
      );
      expect(text, `${relativePath} should document --mcp file startup`).toContain("--mcp");
      expect(text, `${relativePath} should document root env`).toContain("A5SQL_MCP_ROOTS");
      expect(text, `${relativePath} should document roots`).toContain("roots");
      expect(text, `${relativePath} should document detect as hint only`).toContain(
        "detect_a5sql_locations",
      );
      expect(text, `${relativePath} should document minimum privilege roots`).toContain(
        "必要最小限",
      );
      expect(text, `${relativePath} should document line range read`).toContain("startLine");
      expect(text, `${relativePath} should document maxLines`).toContain("maxLines");
      expect(text, `${relativePath} should document offset range read`).toContain("offsetChars");
      expect(text, `${relativePath} should document maxChars`).toContain("maxChars");
      expect(text, `${relativePath} should document untrusted signal`).toContain(
        "contentIsUntrusted",
      );
      expect(text, `${relativePath} should document trusted metadata`).toContain(
        "trustedMetadataFields",
      );
      expect(text, `${relativePath} should document untrusted payload`).toContain(
        "untrustedPayloadFields",
      );
      expect(text, `${relativePath} should document draft input source`).toContain(
        "draftIsDerivedFromUntrustedInput",
      );
      expect(text, `${relativePath} should document draft output fields`).toContain(
        "draftOutputFields",
      );
      expect(text, `${relativePath} should warn against direct execution`).toContain(
        "そのまま実行",
      );
      expect(text, `${relativePath} should warn against direct application`).toContain(
        "そのまま適用",
      );
      expect(text, `${relativePath} should document database connection non-goal`).toContain(
        "DB 接続",
      );
      expect(text, `${relativePath} should document SQL execution non-goal`).toContain("SQL 実行");
      expect(text, `${relativePath} should document write non-goal`).toContain("書き込み");
      expect(text, `${relativePath} should document credential non-goal`).toContain("資格情報");
      expect(text, `${relativePath} should document Web UI non-goal`).toContain("Web UI");
      expect(text, `${relativePath} should document daemon non-goal`).toContain("daemon");
    }
  });
});
