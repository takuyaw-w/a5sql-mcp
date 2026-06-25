# a5sql-mcp

ローカルに存在する A5:SQL Mk-2 の ER 図や SQL ファイルを読み取り、AI が扱いやすい形で配信する CLI / MCP サーバーです。

初期実装では安全性を優先し、A5:SQL の設定ファイルや接続先 DB への書き込み、DB への SQL 実行、資格情報の復号は行いません。

## パッケージ構成

### `packages/parser`

A5:SQL Mk-2 が出力するファイル形式を、ファイルシステムや MCP から独立して解析する pure parser です。

- `.a5er` の A5:ER INI 形式を解析します。
- `Manager`, `Entity`, `View`, `Relation` を構造化します。
- `Field`, `Index`, `Position`, `PageInfo` などの complex 値を分解します。
- SQL ファイルは statement 単位で分割し、操作種別と参照テーブル候補を抽出します。
- ローカルファイルの読み取り、秘密情報マスク、MCP レスポンス整形は担当しません。

### `packages/core`

ローカル A5:SQL 資産を安全に探索・読み取りし、AI が扱いやすい内部モデルへつなぐ中核層です。

- A5:SQL の保存場所候補を検出します。
- 指定 root 配下から `.a5er`, `.sql`, 設定ファイルなどの asset を探索します。
- asset ID を生成し、サイズ制限付きで本文を読み取ります。
- パスワード、トークン、接続文字列などをマスクします。
- 接続情報らしき key/value をマスク済みで抽出します。
- `packages/parser` を呼び出して `.a5er` / SQL の解析結果を返します。

### `packages/cli`

ローカルファイルを引数で受け取り、解析結果を JSON で出力する CLI 兼 stdio MCP サーバーです。

- `a5sql-mcp <file>` 形式で使います。
- `a5sql-mcp --mcp <file>` 形式で、指定ファイルを対象にした MCP サーバーとして起動します。
- `.a5er` は `packages/parser` で ER 図として解析します。
- `.sql` は statement 単位で解析します。
- MCP mode では stdout をプロトコル用に使うため、診断ログは stderr に出します。

### 依存方向

依存方向は次のように保ちます。

```text
packages/parser
  ↑
packages/core

packages/parser
  ↑
packages/cli
```

`packages/parser` は最下層です。`core`, `cli` には依存させません。

## セットアップ

```bash
pnpm install
pnpm build
```

外部ライブラリのバージョンは `pnpm-workspace.yaml` の `catalog` で管理します。各 package の `package.json` では、共通 tooling や MCP SDK などの外部依存を `catalog:` で参照します。

## CLI

ローカル開発中は、まだ npm registry に公開されていないため `npx a5sql-mcp ...` は使えません。まず build してから root script で実行します。

```bash
pnpm build
pnpm local ./schema.a5er
```

package 公開後は次の形を想定しています。

```bash
npx a5sql-mcp ./path/to/model.a5er
```

package 単体で確認する場合は次のようにも実行できます。

```bash
pnpm --filter a5sql-mcp start -- ./path/to/model.a5er
```

ビルド後は次のようにも実行できます。

```bash
node packages/cli/dist/index.js ./path/to/model.a5er
```

出力例:

```json
{
  "filePath": "/path/to/model.a5er",
  "kind": "a5er",
  "parsed": {
    "formatVersion": 19,
    "encoding": "UTF8",
    "manager": {},
    "tables": [],
    "relationships": [],
    "warnings": []
  }
}
```

## MCP サーバー起動

指定したファイルを対象に stdio MCP サーバーとして起動します。

ローカル開発中は次の形で起動します。

```bash
pnpm build
pnpm local --mcp ./schema.a5er
```

package 公開後は次の形を想定しています。

```bash
npx a5sql-mcp --mcp ./path/to/model.a5er
```

MCP クライアントから起動する場合は、相対パスの基準ディレクトリがクライアント依存になるため、基本的には絶対パスを指定します。

このリポジトリでは、ローカル開発用の MCP 設定を `.mcp.json` に置いています。Claude Code など project-local の `.mcp.json` を読むクライアントでは、このファイルを使います。

ローカル開発中に MCP クライアントへ手動設定する場合:

```json
{
  "mcpServers": {
    "a5sql": {
      "command": "node",
      "args": [
        "/absolute/path/to/a5sql-mcp/packages/cli/dist/index.js",
        "--mcp",
        "/absolute/path/to/a5sql-mcp/schema.a5er"
      ]
    }
  }
}
```

package 公開後に MCP クライアントから使う場合:

```json
{
  "mcpServers": {
    "a5sql": {
      "command": "npx",
      "args": ["-y", "a5sql-mcp", "--mcp", "/absolute/path/to/model.a5er"]
    }
  }
}
```

## 公開する MCP tool

- `describe_a5sql_file`: 起動時に指定されたファイルのパス、種別、サイズ、更新日時を返します。
- `parse_a5sql_file`: 起動時に指定された `.a5er` / `.sql` ファイルを AI 向けの構造に変換します。
- `read_a5sql_file`: 起動時に指定されたファイル本文を、最大文字数つきで返します。
- `list_a5sql_tables`: `.a5er` ファイル内のテーブル/ビュー一覧を返します。
- `describe_a5sql_table`: `.a5er` ファイル内の特定テーブル/ビュー定義を返します。

## 環境変数

- `A5SQL_MCP_ROOTS`: 探索対象のルートディレクトリを追加します。複数指定する場合は OS の path delimiter で区切ります。

## セキュリティ方針

- パスワード、トークン、秘密鍵、接続文字列はレスポンス内でマスクします。
- デフォルトではホスト名、DB 名、ユーザー名もマスクします。
- ローカルファイルの読み取り専用です。
- 接続先 DB へのクエリ実行は実装していません。

## subagents の使い方

このリポジトリでは、作業が分かれる場合に subagents を使います。役割の説明は `docs/subagents.md`、Codex 用の custom agent 定義は `.codex/agents/*.toml` にあります。

- `a5sql-researcher`: A5:SQL の保存場所、ファイル形式、文字コードを調査する。
- `mcp-designer`: MCP tool/resource の名前、入力、出力、エラー形式を設計する。
- `parser-implementer`: `packages/parser` の A5:ER / SQL parser を実装・拡張する。
- `security-reviewer`: 秘密情報マスク、ログ、読み取り専用境界を確認する。
- `docs-maintainer`: README、AGENTS.md、SKILL.md、subagents.md を整える。

複数 subagents を使う場合は、編集対象を分けます。たとえば parser 拡張は `parser-implementer`、MCP tool の追加は `mcp-designer`、漏えいリスク確認は `security-reviewer` に分けます。並行編集で衝突しないよう、同じファイルを複数 agent に触らせない方針です。
