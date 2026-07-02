import type { CliResult } from "../index.js";
import { isA5erParsed, isRecognizedA5erParsed, unrecognizedA5erResult } from "./tool-outputs.js";
import type { A5erCliResult, JsonObject, ParsedFileLoader } from "./types.js";

export function jsonResult<T extends JsonObject>(output: T) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(output, null, 2),
      },
    ],
    structuredContent: output,
  };
}

export type A5erToolOptions = {
  getParsedFile: ParsedFileLoader;
  notA5er: (parsed: CliResult) => JsonObject;
  unrecognized: (parsed: A5erCliResult) => JsonObject;
  recognized: (parsed: A5erCliResult) => JsonObject;
};

export async function jsonA5erToolResult({
  getParsedFile,
  notA5er,
  unrecognized,
  recognized,
}: A5erToolOptions) {
  const parsed = await getParsedFile();
  if (!isA5erParsed(parsed)) {
    return jsonResult(notA5er(parsed));
  }
  if (!isRecognizedA5erParsed(parsed)) {
    return jsonResult(unrecognized(parsed));
  }
  return jsonResult(recognized(parsed));
}

export function notA5erOutput(parsed: CliResult, extra: JsonObject): JsonObject {
  return {
    filePath: parsed.filePath,
    kind: parsed.kind,
    ...extra,
  };
}

export function configuredFileIsNotA5erOutput(
  parsed: CliResult,
  extra: JsonObject = {},
): JsonObject {
  return {
    found: false,
    filePath: parsed.filePath,
    kind: parsed.kind,
    message: "configured_file_is_not_a5er",
    ...extra,
  };
}

export function unrecognizedA5erOutput(parsed: A5erCliResult, extra: JsonObject = {}): JsonObject {
  return unrecognizedA5erResult(parsed, extra);
}
