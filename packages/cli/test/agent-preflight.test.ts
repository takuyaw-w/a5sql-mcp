import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = new URL("../../../scripts/agent-preflight.mjs", import.meta.url);

describe("agent preflight guard", () => {
  it("is exposed as a root package script", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["agent:preflight"]).toBe("node scripts/agent-preflight.mjs");
  });

  it("fails on main by default", async () => {
    const repo = await makeGitRepo("main");

    try {
      const result = await runPreflight(repo);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("main");
      expect(result.stderr).toContain("worktree");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("passes on a feature branch with a clean tree", async () => {
    const repo = await makeGitRepo("feature/preflight");

    try {
      const result = await runPreflight(repo);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("branch: feature/preflight");
      expect(result.stdout).toContain("working tree: clean");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("fails on a dirty feature branch", async () => {
    const repo = await makeGitRepo("feature/preflight");

    try {
      await writeFile(path.join(repo, "dirty.txt"), "local scratch", "utf8");
      const result = await runPreflight(repo);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("working tree is not clean");
      expect(result.stderr).toContain("dirty.txt");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("allows main only with an explicit override", async () => {
    const repo = await makeGitRepo("main");

    try {
      const result = await runPreflight(repo, ["--allow-main"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("branch: main");
      expect(result.stdout).toContain("main override: enabled");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

async function makeGitRepo(branch: string): Promise<string> {
  const repo = path.join(os.tmpdir(), `a5sql-mcp-preflight-${randomUUID()}`);
  await mkdir(repo, { recursive: true });
  await execFileAsync("git", ["init", "--quiet", "--initial-branch", branch], { cwd: repo });
  return repo;
}

async function runPreflight(
  cwd: string,
  args: string[] = [],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [SCRIPT_PATH.pathname, ...args],
      { cwd },
    );
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof failed.code === "number" ? failed.code : 1,
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? "",
    };
  }
}
