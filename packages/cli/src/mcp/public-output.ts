import { hasSecretLikeKey, maskSensitiveText } from "@takuyaw-w/a5sql-mcp-core";

export function maskForPublicConsumption(input: string, sourceText?: string): string {
  const quotedJsonMasked = input.replace(
    /(["'])(password|passwd|pass|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key)\1(\s*:\s*)(["'])([^"'"\r\n]+)\4/gi,
    (_match, quote, key, separator, valueQuote) =>
      `${quote}${key}${quote}${separator}${valueQuote}***${valueQuote}`,
  );
  const masked = maskSensitiveText(quotedJsonMasked);
  const queryRecovered = recoverQuerySecretMasks(sourceText ?? input, masked);
  return queryRecovered
    .replace(
      /(authorization)(\s*:\s*)(bearer|basic)(\s+)[^\r\n]+/gi,
      (_match, key, separator, scheme) => `${key}${separator}${scheme} ***`,
    )
    .replace(
      /\b(password|passwd|pwd|pass|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key)\s*=\s*[^;"'\r\n<> &]+/gi,
      (_match, key) => `${key}=***`,
    );
}

export function serializePublicJson(payload: unknown): string {
  return JSON.stringify(maskPublicValue(payload));
}

function maskPublicValue(value: unknown, key?: string): unknown {
  if (key && hasSecretLikeKey(key)) {
    return "***";
  }
  if (typeof value === "string") {
    return maskForPublicConsumption(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskPublicValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        maskPublicValue(childValue, childKey),
      ]),
    );
  }
  return value;
}

function recoverQuerySecretMasks(originalText: string, maskedText: string): string {
  const sourceLines = originalText.split(/\r?\n/);
  const targetLines = maskedText.split(/\r?\n/);

  for (let i = 0; i < sourceLines.length; i += 1) {
    const sourceLine = sourceLines[i];
    const matches = [
      ...sourceLine.matchAll(
        /([?&;])((?:password|passwd|pwd|pass|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key)=[^&\s"'<>;]+)/gi,
      ),
    ];
    if (matches.length === 0) {
      continue;
    }
    const secretKeys = new Set(matches.map((match) => match[2].split("=")[0].toLowerCase()));
    const targetLine = targetLines[i];
    if (!targetLine) {
      continue;
    }

    const presentKeys = new Set<string>();
    for (const key of secretKeys) {
      if (new RegExp(`\\b${key}=`, "i").test(targetLine)) {
        presentKeys.add(key);
      }
    }

    const missingKeys = [...secretKeys].filter((key) => !presentKeys.has(key));
    if (missingKeys.length === 0) {
      continue;
    }

    let rebuilt = targetLine;
    for (const key of missingKeys) {
      const prefix = rebuilt.includes("?") ? "&" : rebuilt.includes(";") ? ";" : "?";
      rebuilt = `${rebuilt}${prefix}${key}=***`;
    }
    targetLines[i] = rebuilt;
  }

  return targetLines.join("\n");
}
