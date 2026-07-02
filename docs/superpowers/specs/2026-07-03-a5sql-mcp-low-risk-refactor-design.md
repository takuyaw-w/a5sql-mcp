# a5sql-mcp 低リスクリファクタリング設計

作成日: 2026-07-03

## 目的

`packages/cli/src/mcp` の重複と肥大化を減らし、1.0.0 前の MCP contract を保ったまま保守しやすくする。

今回のリファクタリングは、公開 tool の挙動を変えない内部整理に限定する。tool 名、入力 schema、`structuredContent` の外形、秘密情報マスク、untrusted payload contract、draft disclosure は変更しない。

## 背景

現状では `tool-handlers.ts`、`tool-outputs.ts`、`generation-tools.ts` に MCP 公開面の処理が集中している。

- `tool-handlers.ts` は、A5:ER 判定、未認識 A5:ER、`roots_required`、`asset_not_found` などの定型レスポンスが複数 handler に散っている。
- `tool-outputs.ts` は、schema exploration、schema review、Mermaid、summary、slice 処理が同居している。
- `generation-tools.ts` は、SQL、Markdown、model、migration の生成補助が 1 ファイルに集まっている。
- `server.ts` は、tool 登録の metadata、schema、handler の対応が手書きで増えやすい。

ただし現在は 0.9.x であり、1.0.0 前の安定化が優先される。大きな構造変更よりも、contract を固定したまま重複を減らす。

## スコープ

今回行うこと:

- `tool-handlers.ts` の定型処理を helper 化する。
- `tool-outputs.ts` から安全に切り出せる共通処理だけを小さく分離する。
- `generation-tools.ts` は大分割せず、明らかな重複 helper の整理に留める。
- 既存テストを contract test として使い、必要な場合だけ fallback のピンポイントテストを追加する。

今回行わないこと:

- MCP tool 名、説明、入力 schema、公開 JSON shape の変更。
- parser/core の仕様変更。
- DB 接続、SQL 実行、A5:SQL 設定ファイル書き込みの追加。
- README、AGENTS.md、skill の tool 一覧を書き換える機能変更。
- `server.ts` の tool 登録を配列定義へ全面移行すること。
- `generation-tools.ts` の大規模な機能別分割。

## 設計

### Handler 層

`tool-handlers.ts` では、handler ごとに繰り返している分岐を helper に寄せる。

- A5:ER 以外の設定ファイルに対する fallback レスポンス。
- `isRecognizedA5erParsed` が false の場合の `unrecognizedA5erResult` 呼び出し。
- `roots_required`、`asset_not_found`、asset selector validation の定型レスポンス。
- `jsonResult` の呼び出し前後で繰り返す構造。

各 handler は、入力の受け取り、対象ファイルや asset の読み取り、純粋関数への委譲を中心にする。

### Output 層

`tool-outputs.ts` では、公開 output の shape を変えず、共通処理だけを切り出す。

- `withUntrustedPayloadContract` の薄い wrapper。
- offset/limit と `returned...Count`、`hasMore`、`truncated` を組み立てる paging helper。
- table、column、relationship の summary helper のうち、複数機能にまたがるもの。
- text slice の処理のうち、入力と返却 metadata が安定しているもの。

個別 tool の output field 名は維持する。既存の `mcp-tools.test.ts` と `mcp-server-smoke.test.ts` が期待する JSON は変えない。

### Generation 層

`generation-tools.ts` は今回の主対象にしない。

`generateSqlSelect`、`generateModelFiles`、`generateSchemaMarkdown`、`generateMigrationPlan` は draft output contract を持つため、結果 shape の変化を避ける。重複が明らかな小 helper だけを整理し、機能別ファイル分割は別タスクに残す。

## データフロー

1. MCP client が tool を呼ぶ。
2. handler が入力を受け取り、必要に応じて `getParsedFile`、core の asset/connection API、または text reader を呼ぶ。
3. handler が A5:ER 判定、root 境界、asset selector などの guard を通す。
4. output helper または generation helper が既存と同じ JSON shape を返す。
5. `jsonResult` が `content` と `structuredContent` を同じ output から生成する。

この流れは変更しない。refactor 後も、A5:SQL 由来 payload は trusted guidance と混ぜない。

## エラー処理と安全境界

`warnings`、`message`、`code`、`nextAction` は固定 guidance として扱い、A5:SQL 由来の文字列を直接混ぜない。

`roots` または `A5SQL_MCP_ROOTS` が必要な tool では、root 未指定時に既定候補を探索しない。`roots_required` の code、warning、nextAction は既存 contract を維持する。

`read_a5sql_file`、`read_a5sql_asset`、`search_a5sql_assets`、`parse_a5sql_asset` の秘密情報マスクと `contentIsUntrusted` は維持する。

生成補助 tool は `outputKind: "draft"`、`readOnly: true`、`writesToFileSystem: false`、`connectsToDatabase: false`、`executesSql: false` を維持する。

## 検証

実装前に `rtk pnpm agent:preflight` を実行する。`main` 上で実装しないため、implementation plan では feature worktree を作る。

実装後の検証:

- `rtk pnpm --filter @takuyaw-w/a5sql-mcp test`
- `rtk pnpm typecheck`
- `rtk pnpm release:check`

必要に応じて、handler helper 抽出で落としやすい fallback だけ追加テストを書く。

## 完了条件

- 既存 tool 一覧、tool 名、入力 schema、公開 JSON shape が変わらない。
- secrets mask、untrusted payload contract、draft disclosure の既存テストが通る。
- `tool-handlers.ts` の定型分岐が減り、handler が薄くなる。
- `tool-outputs.ts` から安全な共通処理だけが分離される。
- parser/core の仕様変更、DB 接続、SQL 実行、A5:SQL 設定ファイル書き込みを追加しない。
