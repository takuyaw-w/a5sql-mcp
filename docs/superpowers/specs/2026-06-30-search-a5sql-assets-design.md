# search_a5sql_assets MCP tool 設計

## 背景

`parse_a5sql_asset` は `assetId` を受け取って A5:SQL 関連 asset を解析できるが、利用者が `assetId` を取得する MCP tool がまだ公開されていない。core には `searchA5sqlAssets` があり、root 配下の SQL、A5:ER、設定、text、database などを探索して `AssetRecord` を返せる。

今回の目的は、既存の core 実装を使って `search_a5sql_assets` を MCP tool として公開し、利用者が検索結果の `assetId` を `parse_a5sql_asset` に渡せるようにすること。

## スコープ

実装すること:

- `packages/cli` の MCP server に `search_a5sql_assets` を登録する。
- 入力として `query`、`roots`、`kinds`、`limit`、`includeHidden`、`maxDepth`、`maxFiles`、`maxFileBytes` を受け付ける。
- 出力は単なる配列ではなく、検索条件、件数、打ち切り有無、次の操作案、asset 一覧を含む JSON にする。
- snippet は既存の `maskSensitiveText` を通した値だけを返す。
- README と AGENTS.md の公開 tool 一覧を更新する。
- MCP handler のテストを追加し、検索結果とマスク、`truncated` の扱いを確認する。

実装しないこと:

- 接続先 DB への接続や SQL 実行。
- A5:SQL の設定ディレクトリ検出を専用 tool として公開すること。
- `relativePath` や検索スコアなど、既存 `AssetRecord` にない追加メタデータの設計。
- `read_a5sql_asset` の MCP tool 公開。

## 入力

`search_a5sql_assets` は次の入力を受け付ける。

- `query`: 任意。ファイル名または検索可能な本文に含まれる語。
- `roots`: 任意。探索対象 root。省略時は `A5SQL_MCP_ROOTS` や既定候補から読み取り可能な場所を使う。
- `kinds`: 任意。`sql`、`er`、`config`、`text`、`database`、`unknown` の配列。
- `limit`: 任意。返す最大件数。既存 core の制限に合わせ、最大 500。
- `includeHidden`: 任意。隠しファイル、隠しディレクトリを探索するか。省略時は false。
- `maxDepth`: 任意。探索深さの上限。
- `maxFiles`: 任意。探索するファイル数の上限。
- `maxFileBytes`: 任意。本文検索する最大 byte 数。

## 出力

出力は次の形を基本にする。

```json
{
  "query": "users",
  "roots": ["/path/to/root"],
  "count": 2,
  "truncated": false,
  "nextAction": "parse_a5sql_asset に assetId を渡すと内容を解析できます。",
  "assets": [
    {
      "assetId": "...",
      "kind": "sql",
      "fileName": "find-users.sql",
      "path": "/path/to/root/queries/find-users.sql",
      "size": 1234,
      "modifiedAt": "2026-06-30T00:00:00.000Z",
      "snippet": "select * from users where password='***'",
      "warning": null
    }
  ]
}
```

`truncated` は、検索結果数が指定された `limit` に到達した場合に true とする。これは「まだ候補がある可能性がある」ことを示す近似値であり、総件数の完全な計算はしない。

## コンポーネント

- `packages/core/src/assets.ts`
  - 既存の `searchA5sqlAssets` をそのまま利用する。
  - 今回は core の検索仕様を広げない。
- `packages/cli/src/mcp/tool-schemas.ts`
  - `searchA5sqlAssetsInputSchema` を追加する。
- `packages/cli/src/mcp/tool-handlers.ts`
  - `createSearchA5sqlAssetsHandler` を追加する。
  - core の `AssetRecord.id` は MCP 出力では `assetId` として返す。
- `packages/cli/src/mcp/server.ts`
  - `parse_a5sql_asset` の前に `search_a5sql_assets` を登録する。

## エラーと安全性

- 存在しない root や読めない root は、既存 core の挙動どおり探索結果なしとして扱う。
- バイナリや大きすぎるファイルは本文検索せず、必要に応じて `warning` を返す。
- snippet と asset 読み取り内容はマスク済みの値だけを返す。
- この tool はローカルファイル探索だけを行い、DB へは接続しない。

## テスト

追加する確認:

- `query` で SQL asset が見つかり、`assetId`、`kind`、`fileName`、`snippet` が返る。
- snippet にパスワード、トークン、秘密鍵などの秘密情報が残らない。
- `limit` に到達した場合に `truncated: true` になる。
- 検索結果の `assetId` を既存の `parse_a5sql_asset` handler に渡せる。

## 完了条件

- `search_a5sql_assets` が MCP tool として登録されている。
- README と AGENTS.md の公開 tool 一覧に反映されている。
- テスト、型チェック、lint、format、build が成功する。
