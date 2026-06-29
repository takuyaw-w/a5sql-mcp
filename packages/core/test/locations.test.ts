import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { detectA5sqlLocations } from "../src/locations.js";

describe("detectA5sqlLocations", () => {
  it("preserves env roots when defaults are disabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "a5sql-mcp-location-"));
    const explicitRoot = path.join(root, "A5M2");
    await mkdir(explicitRoot, { recursive: true });

    const candidates = await detectA5sqlLocations({
      env: { A5SQL_MCP_ROOTS: explicitRoot },
      homeDir: root,
      platform: "linux",
      includeDefaults: false,
    });

    expect(candidates).toEqual([
      {
        path: explicitRoot,
        source: "env",
        label: "A5SQL_MCP_ROOTS",
        exists: true,
        readable: true,
      },
    ]);
  });

  it("can return only explicit roots when defaults are disabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "a5sql-mcp-location-"));
    const explicitRoot = path.join(root, "A5M2");
    await mkdir(explicitRoot, { recursive: true });

    const candidates = await detectA5sqlLocations({
      extraRoots: [explicitRoot],
      env: {},
      homeDir: root,
      platform: "linux",
      includeDefaults: false,
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        path: explicitRoot,
        source: "extra",
        label: "extraRoots",
        exists: true,
        readable: true,
      }),
    ]);
  });

  it("marks explicit file paths as not readable directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "a5sql-mcp-location-file-"));
    const filePath = path.join(root, "settings.ini");
    await writeFile(filePath, "Host=localhost", "utf8");

    const candidates = await detectA5sqlLocations({
      extraRoots: [filePath],
      env: {},
      homeDir: root,
      platform: "linux",
      includeDefaults: false,
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        path: filePath,
        source: "extra",
        exists: true,
        readable: false,
        reason: "not_directory",
      }),
    ]);
  });
});
