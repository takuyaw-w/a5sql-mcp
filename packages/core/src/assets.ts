import { opendir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { stableAssetId } from "./hash.js";
import { maskSensitiveText } from "./mask.js";
import { readTextFile } from "./text.js";
import type {
  A5sqlAssetKind,
  AssetRecord,
  ReadAssetOptions,
  ReadAssetResult,
  SearchAssetsOptions,
  SearchAssetsResult,
} from "./types.js";

const DEFAULT_LIMIT = 50;
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_READ_BYTES = 128 * 1024;

const TEXT_EXTENSIONS = new Set([
  ".sql",
  ".txt",
  ".ini",
  ".conf",
  ".config",
  ".xml",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".log",
  ".md",
  ".a5er",
]);

export async function searchA5sqlAssets(options: SearchAssetsOptions = {}): Promise<AssetRecord[]> {
  return (await searchA5sqlAssetsWithMetadata(options)).assets;
}

export async function searchA5sqlAssetsWithMetadata(
  options: SearchAssetsOptions = {},
): Promise<SearchAssetsResult> {
  const roots = await resolveReadableRoots(options.roots);
  const limit = clamp(options.limit ?? DEFAULT_LIMIT, 1, 500);
  const maxDepth = clamp(options.maxDepth ?? DEFAULT_MAX_DEPTH, 1, 32);
  const maxFiles = clamp(options.maxFiles ?? DEFAULT_MAX_FILES, 1, 100000);
  const maxFileBytes = clamp(
    options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    1024,
    10 * 1024 * 1024,
  );
  const query = options.query?.trim().toLocaleLowerCase();
  const kinds = options.kinds ? new Set(options.kinds) : undefined;
  const results: AssetRecord[] = [];
  let visitedFiles = 0;

  for (const root of roots) {
    for await (const filePath of walkFiles(root, {
      includeHidden: options.includeHidden ?? false,
      maxDepth,
    })) {
      const cutoffReason =
        results.length >= limit
          ? "limit_exceeded"
          : visitedFiles >= maxFiles
            ? "max_files_reached"
            : null;
      if (cutoffReason) {
        return {
          assets: results,
          effectiveLimit: limit,
          visitedFileCount: visitedFiles,
          truncated: true,
          cutoffReason,
        };
      }
      visitedFiles += 1;

      const kind = classifyAsset(filePath);
      if (kind === "unknown" && !query) {
        continue;
      }
      if (kinds && !kinds.has(kind)) {
        continue;
      }

      const fileStat = await safeStat(filePath);
      if (!fileStat?.isFile()) {
        continue;
      }

      const textSearchable = isTextSearchable(filePath) && fileStat.size <= maxFileBytes;
      let matched = !query;
      let snippet: string | undefined;
      let warning: string | undefined;

      if (query && textSearchable) {
        const decoded = await readTextFile(filePath, maxFileBytes);
        if (decoded.encoding === "binary") {
          warning = "binary_file_not_searched";
          matched = path.basename(filePath).toLocaleLowerCase().includes(query);
        } else {
          const index = decoded.text.toLocaleLowerCase().indexOf(query);
          matched = index >= 0 || path.basename(filePath).toLocaleLowerCase().includes(query);
          if (index >= 0) {
            snippet = makeMaskedSnippet(decoded.text, index);
          }
        }
      } else if (query) {
        matched = path.basename(filePath).toLocaleLowerCase().includes(query);
        if (!matched && fileStat.size > maxFileBytes) {
          warning = "file_too_large_for_content_search";
        }
      }

      if (!matched) {
        continue;
      }

      results.push({
        id: stableAssetId(filePath),
        kind,
        path: filePath,
        fileName: path.basename(filePath),
        size: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
        matched,
        snippet,
        warning,
      });
    }
  }

  return {
    assets: results,
    effectiveLimit: limit,
    visitedFileCount: visitedFiles,
    truncated: false,
    cutoffReason: null,
  };
}

export async function readA5sqlAsset(options: ReadAssetOptions): Promise<ReadAssetResult | null> {
  const maxBytes = clamp(options.maxBytes ?? DEFAULT_READ_BYTES, 1, 2 * 1024 * 1024);
  if (options.path) {
    if (!options.roots || options.roots.length === 0) {
      return null;
    }
    const filePath = path.resolve(options.path);
    const withinRoots = await isPathWithinRoots(filePath, options.roots);
    if (!withinRoots) {
      return null;
    }
    return readAssetPath(filePath, stableAssetId(filePath), maxBytes);
  }

  if (!options.assetId) {
    return null;
  }

  const roots = await resolveReadableRoots(options.roots);

  for (const root of roots) {
    for await (const filePath of walkFiles(root, {
      includeHidden: true,
      maxDepth: DEFAULT_MAX_DEPTH,
    })) {
      if (stableAssetId(filePath) !== options.assetId) {
        continue;
      }
      return readAssetPath(filePath, options.assetId, maxBytes);
    }
  }

  return null;
}

export function classifyAsset(filePath: string): A5sqlAssetKind {
  const extension = path.extname(filePath).toLocaleLowerCase();
  if (extension === ".sql") {
    return "sql";
  }
  if (extension === ".a5er") {
    return "er";
  }
  if ([".ini", ".conf", ".config", ".xml", ".json", ".yaml", ".yml"].includes(extension)) {
    return "config";
  }
  if ([".db", ".sqlite", ".sqlite3", ".mdb", ".accdb"].includes(extension)) {
    return "database";
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return "text";
  }
  return "unknown";
}

async function resolveReadableRoots(roots: string[] | undefined): Promise<string[]> {
  if (roots && roots.length > 0) {
    return roots.map((root) => path.resolve(root));
  }
  return splitRoots(process.env.A5SQL_MCP_ROOTS).map((root) => path.resolve(root));
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

function isTextSearchable(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLocaleLowerCase());
}

async function* walkFiles(
  root: string,
  options: { includeHidden: boolean; maxDepth: number },
  depth = 0,
): AsyncGenerator<string> {
  if (depth > options.maxDepth) {
    return;
  }

  let dir;
  try {
    dir = await opendir(root);
  } catch {
    return;
  }

  for await (const entry of dir) {
    if (!options.includeHidden && entry.name.startsWith(".")) {
      continue;
    }
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(entryPath, options, depth + 1);
      continue;
    }
    if (entry.isFile()) {
      yield entryPath;
    }
  }
}

async function safeStat(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

async function readAssetPath(
  filePath: string,
  assetId: string,
  maxBytes: number,
): Promise<ReadAssetResult | null> {
  const fileStat = await safeStat(filePath);
  if (!fileStat?.isFile()) {
    return null;
  }
  const asset: AssetRecord = {
    id: assetId,
    kind: classifyAsset(filePath),
    path: filePath,
    fileName: path.basename(filePath),
    size: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    matched: true,
  };

  if (!isTextSearchable(filePath)) {
    return {
      asset,
      content: "",
      encoding: "binary_or_unsupported",
      truncated: false,
      bytesRead: 0,
      warnings: ["asset_content_not_returned_for_binary_or_unsupported_type"],
    };
  }

  const decoded = await readTextFile(filePath, maxBytes);
  return {
    asset,
    content: maskSensitiveText(decoded.text),
    encoding: decoded.encoding,
    truncated: decoded.truncated,
    bytesRead: decoded.bytesRead,
    warnings: decoded.encoding === "binary" ? ["binary_file_not_returned"] : [],
  };
}

async function isPathWithinRoots(filePath: string, roots: string[]): Promise<boolean> {
  const resolvedFilePath = await safeRealpath(filePath);
  if (!resolvedFilePath) {
    return false;
  }

  for (const root of roots) {
    const resolvedRoot = await safeRealpath(path.resolve(root));
    if (!resolvedRoot) {
      continue;
    }
    const relativePath = path.relative(resolvedRoot, resolvedFilePath);
    if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
      return true;
    }
  }
  return false;
}

async function safeRealpath(filePath: string): Promise<string | null> {
  try {
    return await realpath(filePath);
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function makeMaskedSnippet(text: string, matchIndex: number): string {
  const start = Math.max(0, matchIndex - 120);
  const end = Math.min(text.length, matchIndex + 240);
  return maskSensitiveText(text.slice(start, end)).replace(/\s+/g, " ").trim();
}
