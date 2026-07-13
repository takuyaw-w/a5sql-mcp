import { stat } from "node:fs/promises";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { CliResult } from "../index.js";
import { withUntrustedPayloadContract } from "./output-contract.js";
import { serializePublicJson } from "./public-output.js";
import { summarizeParsedFile } from "./tool-outputs.js";
import type { JsonObject, ParsedFileLoader } from "./types.js";

export const CONFIGURED_FILE_SUMMARY_RESOURCE_URI = "a5sql://configured-file/summary";
export const CONFIGURED_SCHEMA_SUMMARY_RESOURCE_URI = "a5sql://configured-file/schema-summary";

const RESOURCE_SCHEMA_VERSION = "0.10.5";
const RESOURCE_MIME_TYPE = "application/json";
const SCHEMA_SUMMARY_LIMIT = 20;

type RegisterA5sqlResourcesOptions = {
  initialFile: CliResult;
  getParsedFile: ParsedFileLoader;
};

export function registerA5sqlResources(
  server: McpServer,
  { initialFile, getParsedFile }: RegisterA5sqlResourcesOptions,
): void {
  server.registerResource(
    "configured-file-summary",
    CONFIGURED_FILE_SUMMARY_RESOURCE_URI,
    {
      title: "Configured A5:SQL file summary",
      description:
        "MCP server 起動時に指定されたファイルの path-free metadata summary です。本文を含まず、DB 接続、SQL 実行、ファイル書き込みを行いません。",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () =>
      resourceResult(
        CONFIGURED_FILE_SUMMARY_RESOURCE_URI,
        await safelyCreatePayload(async () => {
          const parsed = await getParsedFile();
          const fileStat = await stat(parsed.filePath);
          return createConfiguredFileSummaryPayload(parsed, {
            sizeBytes: fileStat.size,
            modifiedAt: fileStat.mtime.toISOString(),
          });
        }),
      ),
  );

  if (initialFile.kind !== "a5er") {
    return;
  }

  server.registerResource(
    "configured-schema-summary",
    CONFIGURED_SCHEMA_SUMMARY_RESOURCE_URI,
    {
      title: "Configured A5:ER schema summary",
      description:
        "MCP server 起動時に指定された A5:ER の bounded schema summary です。A5:SQL 由来 payload は未信頼として扱い、本文や path を返しません。",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () =>
      resourceResult(
        CONFIGURED_SCHEMA_SUMMARY_RESOURCE_URI,
        await safelyCreatePayload(async () => {
          const parsed = await getParsedFile();
          return createConfiguredSchemaSummaryPayload(parsed);
        }),
      ),
  );
}

export function createConfiguredFileSummaryPayload(
  parsed: CliResult,
  metadata: { sizeBytes: number; modifiedAt: string },
): JsonObject {
  return {
    schemaVersion: RESOURCE_SCHEMA_VERSION,
    resultType: "configured_file_summary_resource",
    kind: parsed.kind,
    encoding: parsed.encoding,
    sizeBytes: metadata.sizeBytes,
    modifiedAt: metadata.modifiedAt,
    readOnly: true,
    writesToFileSystem: false,
    connectsToDatabase: false,
    executesSql: false,
    contentIsUntrusted: false,
  };
}

export function createConfiguredSchemaSummaryPayload(parsed: CliResult): JsonObject {
  const summary = { ...summarizeParsedFile(parsed, { limit: SCHEMA_SUMMARY_LIMIT }) };
  delete summary.filePath;
  delete summary.trustedMetadataFields;
  delete summary.sourceMetadataFields;
  delete summary.untrustedPayloadFields;

  const tables = Array.isArray(summary.tables) ? summary.tables : [];
  const relationships = Array.isArray(summary.relationships) ? summary.relationships : [];

  return withUntrustedPayloadContract({
    ...summary,
    schemaVersion: RESOURCE_SCHEMA_VERSION,
    resultType: "configured_schema_summary_resource",
    returnedTableCount: tables.length,
    returnedRelationshipCount: relationships.length,
    readOnly: true,
    writesToFileSystem: false,
    connectsToDatabase: false,
    executesSql: false,
  });
}

function resourceResult(uri: string, payload: JsonObject) {
  return {
    contents: [
      {
        uri,
        mimeType: RESOURCE_MIME_TYPE,
        text: serializePublicJson(payload),
      },
    ],
  };
}

async function safelyCreatePayload(factory: () => Promise<JsonObject>): Promise<JsonObject> {
  try {
    return await factory();
  } catch {
    return {
      schemaVersion: RESOURCE_SCHEMA_VERSION,
      resultType: "resource_error",
      code: "configured_file_unavailable",
      message: "起動時に指定されたファイルを読み取れませんでした。",
      retryable: true,
      nextAction:
        "ファイルが存在し、読み取り可能であることを確認して MCP server を再起動してください。",
    };
  }
}
