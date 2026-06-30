import type { JsonObject } from "./types.js";

const TRUSTED_METADATA_FIELD_CANDIDATES = [
  "code",
  "message",
  "warnings",
  "nextAction",
  "outputKind",
  "readOnly",
  "writesToFileSystem",
  "connectsToDatabase",
  "executesSql",
  "draftIsDerivedFromUntrustedInput",
] as const;

const SOURCE_METADATA_FIELD_CANDIDATES = [
  "filePath",
  "kind",
  "encoding",
  "fileEncoding",
  "asset",
  "parser",
  "parseStatus",
] as const;

const UNTRUSTED_PAYLOAD_FIELD_CANDIDATES = [
  "parsed",
  "text",
  "content",
  "summary",
  "tables",
  "table",
  "columns",
  "relationships",
  "statements",
  "assets",
  "issues",
  "suggestions",
  "baseTable",
  "includedTables",
  "parameters",
] as const;

const DRAFT_OUTPUT_FIELD_CANDIDATES = [
  "sql",
  "mermaid",
  "markdown",
  "files",
  "plan",
  "operations",
] as const;

const GENERATION_DRAFT_DISCLOSURE = {
  outputKind: "draft",
  readOnly: true,
  writesToFileSystem: false,
  connectsToDatabase: false,
  executesSql: false,
} as const;

export function withUntrustedPayloadContract(output: JsonObject): JsonObject {
  return {
    ...output,
    contentIsUntrusted: true,
    trustedMetadataFields: presentFieldNames(output, TRUSTED_METADATA_FIELD_CANDIDATES),
    sourceMetadataFields: presentFieldNames(output, SOURCE_METADATA_FIELD_CANDIDATES),
    untrustedPayloadFields: presentFieldNames(output, UNTRUSTED_PAYLOAD_FIELD_CANDIDATES),
  };
}

export function withDraftOutputContract(output: JsonObject): JsonObject {
  const draftOutput = {
    ...GENERATION_DRAFT_DISCLOSURE,
    ...output,
    draftIsDerivedFromUntrustedInput: true,
  };
  return {
    ...withUntrustedPayloadContract(draftOutput),
    draftOutputFields: presentFieldNames(draftOutput, DRAFT_OUTPUT_FIELD_CANDIDATES),
  };
}

function presentFieldNames<T extends readonly string[]>(
  output: JsonObject,
  candidates: T,
): string[] {
  return candidates.filter((fieldName) => Object.hasOwn(output, fieldName));
}
