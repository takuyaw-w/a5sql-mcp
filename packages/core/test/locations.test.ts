import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { detectA5sqlLocations } from "../src/locations.js";

describe("detectA5sqlLocations", () => {
  it("can return only explicit roots when defaults are disabled", async () => {
    const root = path.join(os.tmpdir(), `a5sql-mcp-location-${process.pid}`);
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
    const root = path.join(os.tmpdir(), `a5sql-mcp-location-file-${process.pid}`);
    const filePath = path.join(root, "settings.ini");
    await mkdir(root, { recursive: true });
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
