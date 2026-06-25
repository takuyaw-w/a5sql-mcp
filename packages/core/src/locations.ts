import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { DetectLocationOptions, LocationCandidate } from "./types.js";

export async function detectA5sqlLocations(
  options: DetectLocationOptions = {}
): Promise<LocationCandidate[]> {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const rawCandidates: Array<Omit<LocationCandidate, "exists" | "readable" | "reason">> = [];

  const envRoots = splitRoots(env.A5SQL_MCP_ROOTS);
  for (const root of envRoots) {
    rawCandidates.push({ path: root, source: "env", label: "A5SQL_MCP_ROOTS" });
  }

  for (const root of options.extraRoots ?? []) {
    rawCandidates.push({ path: root, source: "extra", label: "extraRoots" });
  }

  if (platform === "win32") {
    addIfPresent(rawCandidates, env.APPDATA, "platform", "APPDATA");
    addIfPresent(rawCandidates, env.LOCALAPPDATA, "platform", "LOCALAPPDATA");
    addIfPresent(rawCandidates, env.USERPROFILE, "home", "USERPROFILE");
  }

  const appData = env.APPDATA;
  const localAppData = env.LOCALAPPDATA;
  const userProfile = env.USERPROFILE ?? homeDir;

  const suffixes = [
    "A5M2",
    "A5SQL",
    "A5SQL Mk-2",
    path.join("A5SQL Mk-2"),
    path.join("A5M2", "Data")
  ];

  for (const base of [appData, localAppData, userProfile, homeDir]) {
    if (!base) {
      continue;
    }
    for (const suffix of suffixes) {
      rawCandidates.push({
        path: path.join(base, suffix),
        source: base === homeDir ? "home" : "platform",
        label: `${path.basename(base)}/${suffix}`
      });
    }
  }

  for (const wineUser of wineUserDirs(homeDir, env.USER ?? env.USERNAME)) {
    for (const suffix of suffixes) {
      rawCandidates.push({
        path: path.join(wineUser, "AppData", "Roaming", suffix),
        source: "wine",
        label: `Wine Roaming/${suffix}`
      });
      rawCandidates.push({
        path: path.join(wineUser, "AppData", "Local", suffix),
        source: "wine",
        label: `Wine Local/${suffix}`
      });
    }
  }

  const unique = dedupePaths(rawCandidates);
  const results: LocationCandidate[] = [];
  for (const candidate of unique) {
    results.push(await withAccessState(candidate));
  }
  return results;
}

function splitRoots(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function addIfPresent(
  candidates: Array<Omit<LocationCandidate, "exists" | "readable" | "reason">>,
  value: string | undefined,
  source: LocationCandidate["source"],
  label: string
): void {
  if (value) {
    candidates.push({ path: value, source, label });
  }
}

function wineUserDirs(homeDir: string, userName: string | undefined): string[] {
  const usersRoot = path.join(homeDir, ".wine", "drive_c", "users");
  const dirs = [path.join(usersRoot, "Public")];
  if (userName) {
    dirs.push(path.join(usersRoot, userName));
  }
  return dirs;
}

function dedupePaths<T extends { path: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const results: T[] = [];
  for (const item of items) {
    const key = path.resolve(item.path).toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push({ ...item, path: path.resolve(item.path) });
  }
  return results;
}

async function withAccessState(
  candidate: Omit<LocationCandidate, "exists" | "readable" | "reason">
): Promise<LocationCandidate> {
  try {
    const current = await stat(candidate.path);
    if (!current.isDirectory()) {
      return { ...candidate, exists: true, readable: false, reason: "not_directory" };
    }
    await access(candidate.path, constants.R_OK);
    return { ...candidate, exists: true, readable: true };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
    if (code === "ENOENT") {
      return { ...candidate, exists: false, readable: false, reason: "not_found" };
    }
    return { ...candidate, exists: true, readable: false, reason: code };
  }
}
