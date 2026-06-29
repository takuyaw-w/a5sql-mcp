# search_a5sql_assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing core `searchA5sqlAssets` function as a safe, documented MCP tool named `search_a5sql_assets`.

**Architecture:** Keep the search implementation in `packages/core/src/assets.ts` unchanged. Add a thin MCP layer in `packages/cli` that validates inputs with zod, calls `searchA5sqlAssets`, maps `AssetRecord.id` to `assetId`, and returns search metadata plus assets for the next `parse_a5sql_asset` call.

**Tech Stack:** TypeScript, Node.js, zod, MCP SDK, Vitest, pnpm workspace commands through `rtk proxy pnpm`.

---

## File Structure

- Modify `packages/cli/src/mcp/tool-schemas.ts`
  - Add `searchA5sqlAssetsInputSchema`.
  - Reuse the existing `A5sqlAssetKind` union values as a zod enum literal list.
- Modify `packages/cli/src/mcp/tool-handlers.ts`
  - Import `searchA5sqlAssets`.
  - Add `createSearchA5sqlAssetsHandler`.
  - Shape MCP output with `query`, `roots`, `count`, `truncated`, `nextAction`, and `assets`.
- Modify `packages/cli/src/mcp/server.ts`
  - Import the schema and handler.
  - Register `search_a5sql_assets` before `parse_a5sql_asset`.
- Modify `packages/cli/test/mcp-asset-tools.test.ts`
  - Add tests for search output, secret-masked snippets, `truncated`, and handoff to `parse_a5sql_asset`.
- Modify `README.md`
  - Add `search_a5sql_assets` to the public MCP tool list.
  - Update the environment variable section to mention search plus parse.
- Modify `AGENTS.md`
  - Add `search_a5sql_assets` to the public MCP tool list.
  - Remove it from future-candidate wording by making the search item reflect remaining non-public categories only.

### Task 1: Add Failing MCP Handler Tests

**Files:**
- Modify: `packages/cli/test/mcp-asset-tools.test.ts`

- [ ] **Step 1: Import the new handler type through dynamic import in the existing test file**

Keep the existing test style. Add this helper near the existing `stableAssetId` helper:

```ts
async function loadAssetHandlers() {
  const handlers = await import("../src/mcp/tool-handlers.js");
  return handlers as unknown as {
    createSearchA5sqlAssetsHandler?: () => (input: {
      roots?: string[];
      query?: string;
      kinds?: string[];
      limit?: number;
      includeHidden?: boolean;
      maxDepth?: number;
      maxFiles?: number;
      maxFileBytes?: number;
    }) => Promise<{ structuredContent: Record<string, unknown> }>;
    createParseA5sqlAssetHandler?: () => (input: {
      roots: string[];
      assetId: string;
    }) => Promise<{ structuredContent: Record<string, unknown> }>;
  };
}
```

Replace the dynamic import inside the existing `parses a discovered SQL asset by asset ID` test with:

```ts
const { createParseA5sqlAssetHandler } = await loadAssetHandlers();
```

- [ ] **Step 2: Add a failing test for search output and masked snippets**

Append this test inside `describe("A5:SQL asset MCP tools", () => { ... })`:

```ts
it("searches assets and returns MCP-friendly asset IDs with masked snippets", async () => {
  const root = await makeTempDir();
  const sqlPath = path.join(root, "queries", "find-users.sql");
  await mkdir(path.dirname(sqlPath), { recursive: true });
  await writeFile(
    sqlPath,
    [
      "select * from users where password='raw-password';",
      "select * from audit_log where token='raw-token';",
    ].join("\n"),
    "utf8",
  );

  const { createSearchA5sqlAssetsHandler } = await loadAssetHandlers();
  expect(createSearchA5sqlAssetsHandler).toBeTypeOf("function");

  const result = await createSearchA5sqlAssetsHandler!()({
    roots: [root],
    query: "users",
    kinds: ["sql"],
  });

  expect(result.structuredContent).toMatchObject({
    query: "users",
    roots: [root],
    count: 1,
    truncated: false,
    nextAction: "parse_a5sql_asset に assetId を渡すと内容を解析できます。",
  });
  expect(result.structuredContent.assets).toEqual([
    expect.objectContaining({
      assetId: stableAssetId(sqlPath),
      kind: "sql",
      fileName: "find-users.sql",
      path: sqlPath,
      size: expect.any(Number),
      modifiedAt: expect.any(String),
      snippet: expect.stringContaining("password='***'"),
      warning: null,
    }),
  ]);
  expect(JSON.stringify(result.structuredContent)).not.toContain("raw-password");
  expect(JSON.stringify(result.structuredContent)).not.toContain("raw-token");
});
```

- [ ] **Step 3: Add a failing test for truncated output**

Append this test after the masked snippet test:

```ts
it("marks search output as truncated when the limit is reached", async () => {
  const root = await makeTempDir();
  const firstPath = path.join(root, "queries", "first.sql");
  const secondPath = path.join(root, "queries", "second.sql");
  await mkdir(path.dirname(firstPath), { recursive: true });
  await writeFile(firstPath, "select * from users;", "utf8");
  await writeFile(secondPath, "select * from accounts;", "utf8");

  const { createSearchA5sqlAssetsHandler } = await loadAssetHandlers();
  const result = await createSearchA5sqlAssetsHandler!()({
    roots: [root],
    kinds: ["sql"],
    limit: 1,
  });

  expect(result.structuredContent).toMatchObject({
    count: 1,
    truncated: true,
  });
  expect(result.structuredContent.assets).toHaveLength(1);
});
```

- [ ] **Step 4: Run the focused test and confirm it fails**

Run:

```bash
rtk proxy pnpm --filter @takuyaw-w/a5sql-mcp-cli test -- mcp-asset-tools.test.ts
```

Expected: FAIL because `createSearchA5sqlAssetsHandler` is not exported yet.

### Task 2: Add MCP Schema and Handler

**Files:**
- Modify: `packages/cli/src/mcp/tool-schemas.ts`
- Modify: `packages/cli/src/mcp/tool-handlers.ts`

- [ ] **Step 1: Add the input schema**

In `packages/cli/src/mcp/tool-schemas.ts`, add this export after `readA5sqlFileInputSchema` and before `parseA5sqlAssetInputSchema`:

```ts
export const searchA5sqlAssetsInputSchema = {
  query: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe("任意。ファイル名または検索可能な本文に含まれる語。"),
  roots: z
    .array(z.string().min(1))
    .max(20)
    .optional()
    .describe(
      "探索対象 root。省略時は A5SQL_MCP_ROOTS や A5:SQL の既定候補から読み取り可能な場所を使います。",
    ),
  kinds: z
    .array(z.enum(["sql", "er", "config", "text", "database", "unknown"]))
    .max(20)
    .optional()
    .describe("任意。探索対象の asset 種別。"),
  limit: z.number().int().min(1).max(500).optional().describe("返す最大件数。省略時は 50。"),
  includeHidden: z
    .boolean()
    .optional()
    .describe("true の場合、隠しファイルや隠しディレクトリも探索します。省略時は false。"),
  maxDepth: z
    .number()
    .int()
    .min(1)
    .max(32)
    .optional()
    .describe("探索するディレクトリ深さの上限。省略時は 8。"),
  maxFiles: z
    .number()
    .int()
    .min(1)
    .max(100_000)
    .optional()
    .describe("探索するファイル数の上限。省略時は 5000。"),
  maxFileBytes: z
    .number()
    .int()
    .min(1024)
    .max(10 * 1024 * 1024)
    .optional()
    .describe("本文検索する最大 byte 数。省略時は 512KB。"),
};
```

- [ ] **Step 2: Import core search in the handler file**

In `packages/cli/src/mcp/tool-handlers.ts`, extend the core import to include `searchA5sqlAssets`:

```ts
import {
  maskSensitiveText,
  parseA5sqlAsset,
  searchA5sqlAssets,
  type ParsedAssetResult,
} from "@takuyaw-w/a5sql-mcp-core";
```

- [ ] **Step 3: Add the search handler**

Add this function after `createReadA5sqlFileHandler` and before `createParseA5sqlAssetHandler`:

```ts
export function createSearchA5sqlAssetsHandler() {
  return async ({
    roots,
    query,
    kinds,
    limit,
    includeHidden,
    maxDepth,
    maxFiles,
    maxFileBytes,
  }: {
    roots?: string[];
    query?: string;
    kinds?: ("sql" | "er" | "config" | "text" | "database" | "unknown")[];
    limit?: number;
    includeHidden?: boolean;
    maxDepth?: number;
    maxFiles?: number;
    maxFileBytes?: number;
  }) => {
    const assets = await searchA5sqlAssets({
      roots,
      query,
      kinds,
      limit,
      includeHidden,
      maxDepth,
      maxFiles,
      maxFileBytes,
    });

    return jsonResult({
      query: query ?? null,
      roots: roots ?? null,
      count: assets.length,
      truncated: limit !== undefined && assets.length >= limit,
      nextAction: "parse_a5sql_asset に assetId を渡すと内容を解析できます。",
      assets: assets.map((asset) => ({
        assetId: asset.id,
        kind: asset.kind,
        fileName: asset.fileName,
        path: asset.path,
        size: asset.size,
        modifiedAt: asset.modifiedAt,
        snippet: asset.snippet ?? null,
        warning: asset.warning ?? null,
      })),
    });
  };
}
```

- [ ] **Step 4: Run the focused test and confirm handler tests pass or fail only because the server is not registered**

Run:

```bash
rtk proxy pnpm --filter @takuyaw-w/a5sql-mcp-cli test -- mcp-asset-tools.test.ts
```

Expected: PASS for handler tests. If TypeScript reports a `kinds` type mismatch, import `type A5sqlAssetKind` from core and use `kinds?: A5sqlAssetKind[]`.

### Task 3: Register the MCP Tool

**Files:**
- Modify: `packages/cli/src/mcp/server.ts`

- [ ] **Step 1: Import the handler**

In `packages/cli/src/mcp/server.ts`, add `createSearchA5sqlAssetsHandler` to the existing handler import list:

```ts
  createSearchA5sqlAssetsHandler,
```

- [ ] **Step 2: Import the schema**

Add `searchA5sqlAssetsInputSchema` to the existing schema import list:

```ts
  searchA5sqlAssetsInputSchema,
```

- [ ] **Step 3: Register `search_a5sql_assets`**

Add this block after `read_a5sql_file` registration and before `parse_a5sql_asset` registration:

```ts
  server.registerTool(
    "search_a5sql_assets",
    {
      title: "Search A5:SQL assets",
      description:
        "A5:SQL 関連 asset を root 配下から検索し、parse_a5sql_asset に渡せる assetId と抜粋を返します。DB には接続しません。",
      inputSchema: searchA5sqlAssetsInputSchema,
    },
    createSearchA5sqlAssetsHandler(),
  );
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
rtk proxy pnpm typecheck
```

Expected: PASS.

### Task 4: Update README and AGENTS

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Update README public tool list**

In `README.md`, add this bullet immediately before `parse_a5sql_asset`:

```md
- `search_a5sql_assets`: `roots` または `A5SQL_MCP_ROOTS` で指定された root 配下から A5:SQL 関連 asset を検索し、`parse_a5sql_asset` に渡せる `assetId` とマスク済み抜粋を返します。DB には接続しません。
```

- [ ] **Step 2: Update README environment variable section**

Replace:

```md
基本の CLI / MCP サーバーは、起動時に指定した単一ファイルを読み取ります。`parse_a5sql_asset` では `roots` または `A5SQL_MCP_ROOTS` を使って、指定 root 配下の asset ID を解析対象にできます。設定ディレクトリ探索そのものを返す tool はまだ公開 API として提供していません。
```

With:

```md
基本の CLI / MCP サーバーは、起動時に指定した単一ファイルを読み取ります。`search_a5sql_assets` と `parse_a5sql_asset` では `roots` または `A5SQL_MCP_ROOTS` を使って、指定 root 配下の asset を検索・解析できます。設定ディレクトリ探索そのものを返す tool はまだ公開 API として提供していません。
```

- [ ] **Step 3: Update AGENTS public tool list**

In `AGENTS.md`, add this bullet immediately before `parse_a5sql_asset`:

```md
- `search_a5sql_assets`: `roots` または `A5SQL_MCP_ROOTS` で指定された root 配下から A5:SQL 関連 asset を検索し、`parse_a5sql_asset` に渡せる `assetId` とマスク済み抜粋を返す。DB には接続しない。
```

- [ ] **Step 4: Update AGENTS future-candidate section**

Replace the two search-oriented future bullets:

```md
- テーブル定義や ER 図メタデータを検索する。
- 保存済み SQL、履歴、メモを検索する。
```

With:

```md
- A5:SQL の内部設定や履歴形式をより深く解釈した検索を追加する。
```

- [ ] **Step 5: Run docs diff review**

Run:

```bash
rtk git diff -- README.md AGENTS.md
```

Expected: the diff only documents the new public `search_a5sql_assets` tool and adjusts future-candidate wording.

### Task 5: Full Verification and Commit

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run focused CLI tests**

Run:

```bash
rtk proxy pnpm --filter @takuyaw-w/a5sql-mcp-cli test -- mcp-asset-tools.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
rtk proxy pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
rtk proxy pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Run format check**

Run:

```bash
rtk proxy pnpm format:check
```

Expected: PASS. If it fails, run `rtk proxy pnpm format`, review the diff, then run `rtk proxy pnpm format:check` again.

- [ ] **Step 5: Run lint**

Run:

```bash
rtk proxy pnpm lint
```

Expected: PASS.

- [ ] **Step 6: Run build**

Run:

```bash
rtk proxy pnpm build
```

Expected: PASS.

- [ ] **Step 7: Review final diff for secret leakage and scope**

Run:

```bash
rtk git diff --stat
rtk git diff
```

Expected: only MCP schema, handler, server registration, tests, README, and AGENTS are changed. No real secrets, local user paths, or fixture credentials are added.

- [ ] **Step 8: Commit implementation**

Run:

```bash
git add packages/cli/src/mcp/tool-schemas.ts packages/cli/src/mcp/tool-handlers.ts packages/cli/src/mcp/server.ts packages/cli/test/mcp-asset-tools.test.ts README.md AGENTS.md
git commit -m "Add search_a5sql_assets MCP tool"
```

Expected: a commit containing the implementation only. The design and plan documents should already be committed or staged separately from the implementation.
