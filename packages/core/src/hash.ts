import { createHash } from "node:crypto";
import path from "node:path";

export function stableAssetId(filePath: string): string {
  const normalized = path.resolve(filePath);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 24);
}

export function stableScopedId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 24);
}
