import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("GitHub Actions contract", () => {
  it("runs the full validation matrix for pull requests and main", async () => {
    const workflow = await readFile(
      new URL("../../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    );

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("- main");
    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain('node-version: "24"');
    expect(workflow).toContain("actions/setup-python@v6");
    expect(workflow).toContain("shivammathur/setup-php@v2");
    for (const command of [
      "pnpm format:check",
      "pnpm lint",
      "pnpm build",
      "pnpm test",
      "pnpm typecheck",
      "pnpm draft-syntax:check",
    ]) {
      expect(workflow).toContain(command);
    }
  });

  it("validates installed packages before either publish branch", async () => {
    const workflow = await readFile(
      new URL("../../../.github/workflows/publish.yml", import.meta.url),
      "utf8",
    );
    const installedCheck = workflow.indexOf("run: pnpm published:check");
    const tokenPublish = workflow.indexOf("Publish packages with npm token");
    const trustedPublish = workflow.indexOf("Publish packages with trusted publishing");

    expect(installedCheck).toBeGreaterThan(0);
    expect(installedCheck).toBeLessThan(tokenPublish);
    expect(installedCheck).toBeLessThan(trustedPublish);
  });
});
