import path from "node:path";

import { searchA5sqlAssets } from "./assets.js";
import { stableScopedId } from "./hash.js";
import { hasSecretLikeKey, maskSensitiveText, maskValue } from "./mask.js";
import { readTextFile } from "./text.js";
import type { ConnectionCandidate, ConnectionField, ListConnectionsOptions } from "./types.js";

const CONNECTION_KEYS = new Map<string, keyof ConnectionCandidate["fields"]>([
  ["name", "name"],
  ["connectionname", "name"],
  ["title", "name"],
  ["type", "type"],
  ["dbtype", "type"],
  ["driver", "type"],
  ["provider", "type"],
  ["host", "host"],
  ["hostname", "host"],
  ["server", "host"],
  ["address", "host"],
  ["port", "port"],
  ["database", "database"],
  ["dbname", "database"],
  ["schema", "database"],
  ["sid", "database"],
  ["service", "database"],
  ["user", "user"],
  ["username", "user"],
  ["userid", "user"],
  ["uid", "user"]
]);

const CANDIDATE_KINDS = ["config", "text", "er"] as const;

export async function listA5sqlConnections(
  options: ListConnectionsOptions = {}
): Promise<ConnectionCandidate[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const assets = await searchA5sqlAssets({
    roots: options.roots,
    kinds: [...CANDIDATE_KINDS],
    limit: 500,
    includeHidden: true,
    maxFileBytes: 512 * 1024
  });

  const results: ConnectionCandidate[] = [];
  for (const asset of assets) {
    if (results.length >= limit) {
      break;
    }
    const decoded = await readTextFile(asset.path, 512 * 1024);
    if (decoded.encoding === "binary" || decoded.text.length === 0) {
      continue;
    }

    const parsed = extractConnectionCandidate(
      asset.path,
      decoded.text,
      options.revealNonSecret ?? false
    );
    if (parsed) {
      results.push(parsed);
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

export function extractConnectionCandidate(
  sourcePath: string,
  text: string,
  revealNonSecret: boolean
): ConnectionCandidate | null {
  const normalizedText = maskSensitiveText(text);
  const rawValues = new Map<keyof ConnectionCandidate["fields"], string>();
  const matchedKeys: string[] = [];
  let hasPassword = false;

  for (const [key, value] of readKeyValues(normalizedText)) {
    const normalizedKey = normalizeKey(key);
    if (hasSecretLikeKey(normalizedKey)) {
      hasPassword = true;
      matchedKeys.push(normalizedKey);
      continue;
    }
    const field = CONNECTION_KEYS.get(normalizedKey);
    if (!field || rawValues.has(field)) {
      continue;
    }
    rawValues.set(field, cleanValue(value));
    matchedKeys.push(normalizedKey);
  }

  const confidence = scoreCandidate(rawValues, hasPassword);
  if (confidence < 2) {
    return null;
  }

  const fields: ConnectionCandidate["fields"] = {};
  for (const [field, value] of rawValues.entries()) {
    fields[field] = fieldValue(value, revealNonSecret);
  }

  return {
    id: stableScopedId(sourcePath, [...matchedKeys].sort().join(",")),
    sourcePath,
    sourceName: path.basename(sourcePath),
    confidence,
    fields,
    hasPassword,
    matchedKeys: [...new Set(matchedKeys)].sort(),
    warnings: revealNonSecret ? [] : ["non_secret_connection_fields_masked_by_default"]
  };
}

function* readKeyValues(text: string): Generator<[string, string]> {
  const linePattern = /^\s*([A-Za-z0-9_. -]{2,64})\s*[:=]\s*(.+?)\s*$/gm;
  for (const match of text.matchAll(linePattern)) {
    yield [match[1] ?? "", match[2] ?? ""];
  }

  const xmlPattern = /<([A-Za-z0-9_.:-]{2,64})(?:\s[^>]*)?>([^<]{1,512})<\/\1>/g;
  for (const match of text.matchAll(xmlPattern)) {
    yield [match[1] ?? "", match[2] ?? ""];
  }

  const connectionStringPattern = /\b([A-Za-z ]{2,32})\s*=\s*([^;\r\n]+)/g;
  for (const match of text.matchAll(connectionStringPattern)) {
    yield [match[1] ?? "", match[2] ?? ""];
  }
}

function normalizeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, "").toLocaleLowerCase();
}

function cleanValue(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "").slice(0, 256);
}

function fieldValue(value: string, reveal: boolean): ConnectionField {
  return {
    value: maskValue(value, reveal),
    masked: !reveal
  };
}

function scoreCandidate(
  values: Map<keyof ConnectionCandidate["fields"], string>,
  hasPassword: boolean
): number {
  let score = values.size;
  if (values.has("host")) {
    score += 2;
  }
  if (values.has("database")) {
    score += 1;
  }
  if (values.has("user")) {
    score += 1;
  }
  if (hasPassword) {
    score += 1;
  }
  return score;
}
