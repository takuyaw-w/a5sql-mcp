# a5sql-mcp Low-Risk Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP の公開 contract を変えずに、`packages/cli/src/mcp` の handler/output 周辺の重複を減らす。

**Architecture:** 既存の handler -> pure output function -> `jsonResult` の流れを維持する。小さな helper module を追加し、A5:ER guard、定型 JSON result、paging/untrusted wrapper を集約する。`generation-tools.ts` の大規模分割と tool 登録の配列化は行わない。

**Tech Stack:** TypeScript, pnpm, Vitest, Model Context Protocol SDK, existing `@takuyaw-w/a5sql-mcp-*` packages.

---

## File Structure

- Create: `packages/cli/src/mcp/tool-handler-utils.ts`
  - `jsonResult` と A5:ER handler guard を集約する。
  - `tool-handlers.ts` から使う内部 helper として公開する。
- Create: `packages/cli/src/mcp/output-utils.ts`
  - `withUntrustedContentSignal` と paging helper を集約する。
  - `tool-outputs.ts` から使う内部 helper として公開する。
- Modify: `packages/cli/src/mcp/tool-handlers.ts`
  - `jsonResult` のローカル定義を削除する。
  - A5:ER 専用 handler の繰り返し guard を `jsonA5erToolResult` に置き換える。
  - asset/root まわりの公開 JSON shape は変えない。
- Modify: `packages/cli/src/mcp/tool-outputs.ts`
  - untrusted wrapper と paging helper を `output-utils.ts` に移す。
  - `listA5sqlTables`、`findA5sqlColumns` などの出力 field 名を維持する。
- Modify: `packages/cli/test/mcp-asset-tools.test.ts`
  - refactor で壊れやすい A5:ER fallback contract を固定するテストを追加する。

---

### Task 0: Worktree と preflight を準備する

**Files:**

- No source changes in this task.

- [ ] **Step 1: main の状態を確認する**

Run:

```bash
rtk git status --short --branch
```

Expected:

```text
## main...origin/main [ahead 2]
```

`ahead` の数は design/plan commit 数により変わるが、working tree は clean であること。

- [ ] **Step 2: implementation worktree を作成する**

Run:

```bash
rtk git worktree add .worktrees/low-risk-mcp-refactor -b refactor/low-risk-mcp-refactor
```

Expected: `.worktrees/low-risk-mcp-refactor` が作成される。

- [ ] **Step 3: worktree へ移動して preflight を実行する**

Run:

```bash
cd /home/takuya/develop/github.com/takuyaw-w/a5sql-mcp/.worktrees/low-risk-mcp-refactor
rtk pnpm agent:preflight
```

Expected: non-main branch、clean tree、detached HEAD ではないことが確認され、PASS する。

- [ ] **Step 4: Task 0 の完了を記録する**

Commit は不要。以後の task は worktree 内で実行する。

---

### Task 1: A5:ER fallback contract のテストを追加する

**Files:**

- Modify: `packages/cli/test/mcp-asset-tools.test.ts`

- [ ] **Step 1: contract test を追加する**

`packages/cli/test/mcp-asset-tools.test.ts` の import を次の形に広げる。

```ts
import {
  createGenerateSqlSelectHandler,
  createListA5sqlTablesHandler,
  createParseA5sqlFileHandler,
  createReadA5sqlFileHandler,
} from "../src/mcp/tool-handlers.js";
```

同じ `describe("A5:SQL asset MCP tools", () => { ... })` 内に次の test を追加する。

```ts
it("keeps stable fallback responses for A5:ER-only handlers on non-A5ER files", async () => {
  const root = await makeTempDir();
  const sqlPath = path.join(root, "queries", "plain.sql");
  await mkdir(path.dirname(sqlPath), { recursive: true });
  await writeFile(sqlPath, "select 1 as value;", "utf8");

  const parsed = await parseFile(sqlPath);
  const getParsedFile = async () => parsed;

  const tables = await createListA5sqlTablesHandler(getParsedFile)({});
  const select = await createGenerateSqlSelectHandler(getParsedFile)({
    tableName: "users",
  });

  expect(tables.structuredContent).toEqual({
    filePath: sqlPath,
    kind: "sql",
    tables: [],
  });
  expect(select.structuredContent).toEqual({
    found: false,
    filePath: sqlPath,
    kind: "sql",
    message: "configured_file_is_not_a5er",
  });
});
```

- [ ] **Step 2: test を実行して現状 PASS を確認する**

Run:

```bash
rtk pnpm --filter @takuyaw-w/a5sql-mcp test -- mcp-asset-tools.test.ts
```

Expected: PASS。これは refactor 前の contract 固定テストなので、失敗した場合は期待値を現状出力に合わせる。

- [ ] **Step 3: commit する**

Run:

```bash
rtk git add packages/cli/test/mcp-asset-tools.test.ts
rtk git commit -m "test: pin a5er handler fallback contract"
```

Expected: test commit が 1 つ作成される。

---

### Task 2: handler 共通 helper を追加して A5:ER guard を集約する

**Files:**

- Create: `packages/cli/src/mcp/tool-handler-utils.ts`
- Modify: `packages/cli/src/mcp/tool-handlers.ts`
- Test: `packages/cli/test/mcp-asset-tools.test.ts`

- [ ] **Step 1: helper file を作成する**

Create `packages/cli/src/mcp/tool-handler-utils.ts`:

```ts
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
```

- [ ] **Step 2: `tool-handlers.ts` の imports を変更する**

Add:

```ts
import {
  configuredFileIsNotA5erOutput,
  jsonA5erToolResult,
  jsonResult,
  notA5erOutput,
  unrecognizedA5erOutput,
} from "./tool-handler-utils.js";
```

Remove `jsonResult` local function at the bottom of `tool-handlers.ts`.

- [ ] **Step 3: A5:ER 専用 handler を置き換える**

`createListA5sqlTablesHandler` は次の形にする。

```ts
export function createListA5sqlTablesHandler(getParsedFile: ParsedFileLoader) {
  return async ({ offset, limit }: { offset?: number; limit?: number }) =>
    jsonA5erToolResult({
      getParsedFile,
      notA5er: (parsed) => notA5erOutput(parsed, { tables: [] }),
      unrecognized: (parsed) => unrecognizedA5erOutput(parsed),
      recognized: (parsed) => listA5sqlTables(parsed, { offset, limit }),
    });
}
```

次の mapping で各 handler を置き換える。

| Handler                                  | notA5er output                                  | unrecognized output                                                 | recognized output                                                                                                                                         |
| ---------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createDescribeA5sqlTableHandler`        | `configuredFileIsNotA5erOutput(parsed)`         | `unrecognizedA5erOutput(parsed, { found: false, tableName })`       | `describeA5sqlTable(parsed, { tableName })`                                                                                                               |
| `createExplainA5sqlTableHandler`         | `configuredFileIsNotA5erOutput(parsed)`         | `unrecognizedA5erOutput(parsed, { found: false, tableName })`       | `explainA5sqlTable(parsed, { tableName, maxRelatedTables })`                                                                                              |
| `createListA5sqlRelationshipsHandler`    | `notA5erOutput(parsed, { relationships: [] })`  | `unrecognizedA5erOutput(parsed, { tableName, relationships: [] })`  | `listA5sqlRelationships(parsed, { tableName })`                                                                                                           |
| `createFindA5sqlTablesHandler`           | `notA5erOutput(parsed, { query, tables: [] })`  | `unrecognizedA5erOutput(parsed, { query, tables: [] })`             | `findA5sqlTables(parsed, { query, limit })`                                                                                                               |
| `createFindA5sqlColumnsHandler`          | `notA5erOutput(parsed, { query, columns: [] })` | `unrecognizedA5erOutput(parsed, { query, columns: [] })`            | `findA5sqlColumns(parsed, { query, tableNames, dataType, onlyPrimaryKeys, onlyForeignKeyLike, offset, limit })`                                           |
| `createGenerateSqlSelectHandler`         | `configuredFileIsNotA5erOutput(parsed)`         | `unrecognizedA5erOutput(parsed, { found: false, tableName })`       | `generateSqlSelect(parsed, { tableName, includeRelations, relatedTables, whereColumns, limit, maxRelatedTables })`                                        |
| `createGenerateMermaidErDiagramHandler`  | `configuredFileIsNotA5erOutput(parsed)`         | `unrecognizedA5erOutput(parsed, { found: false })`                  | `generateMermaidErDiagram(parsed, { tableNames, includeViews, includeColumns, maxTables })`                                                               |
| `createGenerateModelFilesHandler`        | `configuredFileIsNotA5erOutput(parsed)`         | `unrecognizedA5erOutput(parsed, { found: false })`                  | `generateModelFiles(parsed, { framework, tableNames, maxTables })`                                                                                        |
| `createReviewA5sqlSchemaHandler`         | `configuredFileIsNotA5erOutput(parsed)`         | `unrecognizedA5erOutput(parsed, { found: false, issues: [] })`      | `reviewA5sqlSchema(parsed, { maxIssues, includeInfo })`                                                                                                   |
| `createSuggestSchemaChangesHandler`      | `configuredFileIsNotA5erOutput(parsed)`         | `unrecognizedA5erOutput(parsed, { found: false, suggestions: [] })` | `suggestSchemaChanges(parsed, { maxSuggestions, includeInfo })`                                                                                           |
| `createCompareA5erWithLiveSchemaHandler` | `configuredFileIsNotA5erOutput(parsed)`         | `unrecognizedA5erOutput(parsed, { found: false, issues: [] })`      | `compareA5erWithLiveSchema(parsed, { liveSchema, tableNames, compareDataTypes, compareNullable, comparePrimaryKeys, includeExtraLiveTables, maxIssues })` |
| `createGenerateMigrationPlanHandler`     | `configuredFileIsNotA5erOutput(parsed)`         | `unrecognizedA5erOutput(parsed, { found: false, operations: [] })`  | `generateMigrationPlan(parsed, { liveSchema, tableNames, style, includeDestructive, maxOperations })`                                                     |
| `createGenerateSchemaMarkdownHandler`    | `configuredFileIsNotA5erOutput(parsed)`         | `unrecognizedA5erOutput(parsed, { found: false, markdown: "" })`    | `generateSchemaMarkdown(parsed, { tableNames, includeRelationships, includeViews, maxTables, maxColumnsPerTable })`                                       |

例として `createGenerateSqlSelectHandler` は次の形にする。

```ts
export function createGenerateSqlSelectHandler(getParsedFile: ParsedFileLoader) {
  return async ({
    tableName,
    includeRelations,
    relatedTables,
    whereColumns,
    limit,
    maxRelatedTables,
  }: {
    tableName: string;
    includeRelations?: boolean;
    relatedTables?: string[];
    whereColumns?: string[];
    limit?: number;
    maxRelatedTables?: number;
  }) =>
    jsonA5erToolResult({
      getParsedFile,
      notA5er: (parsed) => configuredFileIsNotA5erOutput(parsed),
      unrecognized: (parsed) => unrecognizedA5erOutput(parsed, { found: false, tableName }),
      recognized: (parsed) =>
        generateSqlSelect(parsed, {
          tableName,
          includeRelations,
          relatedTables,
          whereColumns,
          limit,
          maxRelatedTables,
        }),
    });
}
```

- [ ] **Step 4: focused tests を実行する**

Run:

```bash
rtk pnpm --filter @takuyaw-w/a5sql-mcp test -- mcp-asset-tools.test.ts mcp-tools.test.ts
```

Expected: PASS。

- [ ] **Step 5: typecheck を実行する**

Run:

```bash
rtk pnpm typecheck
```

Expected: PASS。

- [ ] **Step 6: commit する**

Run:

```bash
rtk git add packages/cli/src/mcp/tool-handler-utils.ts packages/cli/src/mcp/tool-handlers.ts
rtk git commit -m "refactor: share mcp handler guards"
```

Expected: handler helper commit が 1 つ作成される。

---

### Task 3: output 共通 helper を追加して paging と untrusted wrapper を集約する

**Files:**

- Create: `packages/cli/src/mcp/output-utils.ts`
- Modify: `packages/cli/src/mcp/tool-outputs.ts`
- Test: `packages/cli/test/mcp-tools.test.ts`

- [ ] **Step 1: output utility file を作成する**

Create `packages/cli/src/mcp/output-utils.ts`:

```ts
import { withUntrustedPayloadContract } from "./output-contract.js";
import type { JsonObject } from "./types.js";

export function withUntrustedContentSignal(output: JsonObject): JsonObject {
  return withUntrustedPayloadContract(output);
}

export type PageSlice<T> = {
  items: T[];
  offset: number;
  limit: number;
  totalCount: number;
  returnedCount: number;
  hasMore: boolean;
  truncated: boolean;
};

export function slicePage<T>(
  items: T[],
  options: { offset?: number; limit: number },
): PageSlice<T> {
  const offset = options.offset ?? 0;
  const limit = options.limit;
  const pageItems = items.slice(offset, offset + limit);
  const hasMore = offset + pageItems.length < items.length;
  return {
    items: pageItems,
    offset,
    limit,
    totalCount: items.length,
    returnedCount: pageItems.length,
    hasMore,
    truncated: hasMore,
  };
}

export function limitItems<T>(
  items: T[],
  limit: number,
): { items: T[]; returnedCount: number; truncated: boolean } {
  const limitedItems = items.slice(0, limit);
  return {
    items: limitedItems,
    returnedCount: limitedItems.length,
    truncated: items.length > limitedItems.length,
  };
}
```

- [ ] **Step 2: `tool-outputs.ts` の wrapper を置き換える**

Remove local `withUntrustedContentSignal` and import:

```ts
import { limitItems, slicePage, withUntrustedContentSignal } from "./output-utils.js";
```

Remove direct `withUntrustedPayloadContract` import from `tool-outputs.ts`.

- [ ] **Step 3: `listA5sqlTables` の paging を置き換える**

Replace the local slice logic with:

```ts
const page = slicePage(result.parsed.tables, {
  offset: options.offset,
  limit: options.limit ?? DEFAULT_TABLE_LIST_LIMIT,
});
return withUntrustedContentSignal({
  filePath: result.filePath,
  kind: result.kind,
  totalTableCount: page.totalCount,
  offset: page.offset,
  limit: page.limit,
  returnedTableCount: page.returnedCount,
  hasMore: page.hasMore,
  truncated: page.truncated,
  tables: page.items.map(tableSummary),
});
```

- [ ] **Step 4: `findA5sqlColumns` の paging を置き換える**

Replace its local `page` and `hasMore` logic with:

```ts
const page = slicePage(matches, { offset, limit });
return withUntrustedContentSignal({
  filePath: result.filePath,
  kind: result.kind,
  query,
  dataType: options.dataType,
  tableNames: requestedTables,
  totalColumnCount: matches.length,
  offset: page.offset,
  limit: page.limit,
  returnedColumnCount: page.returnedCount,
  hasMore: page.hasMore,
  truncated: page.truncated,
  columns: page.items,
});
```

Field names and values must match the current output exactly.

- [ ] **Step 5: limited output sites を置き換える**

Use `limitItems` only where the current output already uses `slice(0, limit)` and `truncated: source.length > limited.length`:

- `suggestSchemaChanges`
- `reviewA5sqlSchema`

Do not change `generateMermaidErDiagram` warning strings in this task.

- [ ] **Step 6: focused tests を実行する**

Run:

```bash
rtk pnpm --filter @takuyaw-w/a5sql-mcp test -- mcp-tools.test.ts
```

Expected: PASS。

- [ ] **Step 7: full CLI package tests を実行する**

Run:

```bash
rtk pnpm --filter @takuyaw-w/a5sql-mcp test
```

Expected: PASS。

- [ ] **Step 8: commit する**

Run:

```bash
rtk git add packages/cli/src/mcp/output-utils.ts packages/cli/src/mcp/tool-outputs.ts
rtk git commit -m "refactor: share mcp output helpers"
```

Expected: output helper commit が 1 つ作成される。

---

### Task 4: generation-tools を変更対象外として確認する

**Files:**

- Test: `packages/cli/test/mcp-tools.test.ts`

- [ ] **Step 1: diff を確認する**

Run:

```bash
rtk git diff --stat main...HEAD
```

Expected: changes are limited to handler/output helpers and tests.

- [ ] **Step 2: generation-tools が未変更であることを確認する**

Run:

```bash
rtk git diff --name-only main...HEAD
```

Expected: `packages/cli/src/mcp/generation-tools.ts` is not listed.

- [ ] **Step 3: generation output tests を実行する**

Run:

```bash
rtk pnpm --filter @takuyaw-w/a5sql-mcp test -- mcp-tools.test.ts
```

Expected: PASS。

- [ ] **Step 4: commit しないことを確認する**

Run:

```bash
rtk git status --short
```

Expected: Task 4 由来の unstaged/staged changes がない。`generation-tools.ts` は今回の実装で変更しない。

---

### Task 5: 全体検証と final commit 状態を確認する

**Files:**

- No planned source changes.

- [ ] **Step 1: format check を実行する**

Run:

```bash
rtk pnpm format:check
```

Expected: PASS。

- [ ] **Step 2: lint を実行する**

Run:

```bash
rtk pnpm lint
```

Expected: PASS。

- [ ] **Step 3: build を実行する**

Run:

```bash
rtk pnpm build
```

Expected: PASS。

- [ ] **Step 4: test を実行する**

Run:

```bash
rtk pnpm test
```

Expected: PASS。

- [ ] **Step 5: typecheck を実行する**

Run:

```bash
rtk pnpm typecheck
```

Expected: PASS。

- [ ] **Step 6: release gate を実行する**

Run:

```bash
rtk pnpm release:check
```

Expected: PASS。

- [ ] **Step 7: diff で公開 contract 変更がないことを確認する**

Run:

```bash
rtk git diff --stat main...HEAD
rtk git diff main...HEAD -- packages/cli/src/mcp/server.ts packages/cli/src/mcp/tool-schemas.ts README.md AGENTS.md .agents/skills/a5sql-mcp/SKILL.md
```

Expected:

- `server.ts` と `tool-schemas.ts` に意図しない変更がない。
- README、AGENTS.md、skill に機能説明変更がない。
- docs は design/plan の追加のみ。

- [ ] **Step 8: status を確認する**

Run:

```bash
rtk git status --short --branch
```

Expected: working tree clean on `refactor/low-risk-mcp-refactor`.

---

## Handoff

この plan の実行は、`superpowers:subagent-driven-development` または `superpowers:executing-plans` を使って task-by-task で進める。各 task の後に差分と test 結果を確認し、公開 contract の変更が混ざっていないことを確認する。
