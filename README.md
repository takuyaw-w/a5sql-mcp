# a5sql-mcp

ローカルに存在する A5:SQL Mk-2 の ER 図や SQL ファイルを読み取り、AI が扱いやすい形で配信する CLI / MCP サーバーです。

初期実装では安全性を優先し、A5:SQL の設定ファイルや接続先 DB への書き込み、DB への SQL 実行、資格情報の復号は行いません。

---

## インストール方法

各 MCP クライアントに `@takuyaw-w/a5sql-mcp` を登録し、読み取りたい A5:ER ファイルの絶対パスを指定します。

### サーバーコマンド単体

対象の A5:ER ファイルを指定して起動します。

```bash
npx @takuyaw-w/a5sql-mcp --mcp /absolute/path/to/model.a5er
```

MCP クライアントから起動する場合は、相対パスの基準ディレクトリがクライアント依存になるため、基本的には絶対パスを指定します。

### Codex

Codex は `~/.codex/config.toml`、または trusted project 内の `.codex/config.toml` に MCP server を設定します。CLI から登録する場合:

```bash
codex mcp add a5sql -- npx -y @takuyaw-w/a5sql-mcp --mcp /absolute/path/to/model.a5er
```

`config.toml` に直接書く場合:

```toml
[mcp_servers.a5sql]
command = "npx"
args = ["-y", "@takuyaw-w/a5sql-mcp", "--mcp", "/absolute/path/to/model.a5er"]
startup_timeout_sec = 20
tool_timeout_sec = 60
```

Codex のセッション内では `/mcp` で接続状態を確認できます。

### Cursor

Cursor は `.cursor/mcp.json` に MCP server を設定できます。

設定例:

```json
{
  "mcpServers": {
    "a5sql": {
      "command": "npx",
      "args": ["-y", "@takuyaw-w/a5sql-mcp", "--mcp", "/absolute/path/to/model.a5er"]
    }
  }
}
```

### Claude Code

Claude Code は `claude mcp add` で登録できます。ユーザー設定に登録する場合:

```bash
claude mcp add --transport stdio --scope user a5sql -- npx -y @takuyaw-w/a5sql-mcp --mcp /absolute/path/to/model.a5er
```

現在のプロジェクトだけで共有する場合は、プロジェクト root の `.mcp.json` に書けます。ただし、このリポジトリ自体には利用者ごとに異なる A5:ER パスを固定しない方針です。

```json
{
  "mcpServers": {
    "a5sql": {
      "command": "npx",
      "args": ["-y", "@takuyaw-w/a5sql-mcp", "--mcp", "/absolute/path/to/model.a5er"]
    }
  }
}
```

Claude Code のセッション内では `/mcp` で接続状態を確認できます。

## プロンプト例

MCP クライアント側では、自然文で依頼すれば必要な tool が呼び出されます。tool 呼び出し自体を検証したい場合は、tool 名を明示すると挙動を確認しやすくなります。

MCP 接続とファイル解析を確認する:

```text
a5sql の MCP tool を使って、parse_a5sql_file の summary から読み込めているテーブル数とリレーション数を教えて。
```

テーブル一覧を確認する:

```text
a5sql の MCP tool を使って、A5:ER ファイルに含まれるテーブル一覧を 100 件ずつ論理名つきで表示して。
```

特定テーブルの定義を確認する:

```text
a5sql の describe_a5sql_table を使って、users テーブルのカラム、主キー、NOT NULL、コメントを整理して。
```

リレーションを確認する:

```text
a5sql の list_a5sql_relationships を使って、users と関係しているテーブルを洗い出して。外部キーの向きも分かるように説明して。
```

業務用語からテーブル候補を探す:

```text
a5sql の find_a5sql_tables を使って、「製品」「商品」「product」に関係しそうなテーブルを探して。候補ごとに根拠になったカラム名も教えて。
```

SELECT SQL のたたき台を作る:

```text
a5sql の generate_sql_select を使って、ユーザー情報を取得する SELECT SQL を生成して。関連するプロフィール情報があれば JOIN も含めて。
```

Mermaid ER 図を生成する:

```text
a5sql の generate_mermaid_er_diagram を使って、A5:ER ファイルの Mermaid ER diagram を生成して。
```

フレームワーク向けのモデル作成に使う:

```text
a5sql の generate_model_files を使って、users と user_profiles の Laravel Eloquent Model を作成して。fillable、casts、belongsTo / hasMany も定義から推測して。
```

レビュー観点を出す:

```text
a5sql の review_a5sql_schema を使って、NULL 許容、主キー、外部キー、命名の観点で気になるテーブル定義をレビューして。
```

この MCP サーバーはローカルファイルを読み取るだけで、接続先 DB へ SQL を実行しません。生成された SQL やモデルコードは、実際の DB 方言やアプリケーション規約に合わせて確認してから利用してください。

---

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
- テキストファイルは UTF-8、Shift_JIS、UTF-16LE の候補から読み取ります。
- asset ID 指定の解析では `packages/core` の安全な asset 読み取りとマスク処理を使います。
- MCP mode では stdout をプロトコル用に使うため、診断ログは stderr に出します。

### 依存方向

依存方向は次のように保ちます。

```text
packages/parser
  ↑
packages/core
  ↑
packages/cli

packages/parser
  ↑
packages/cli
```

`packages/parser` は最下層です。`core`, `cli` には依存させません。

## セットアップ

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

外部ライブラリのバージョンは `pnpm-workspace.yaml` の `catalog` で管理します。各 package の `package.json` では、共通 tooling や MCP SDK などの外部依存を `catalog:` で参照します。

リリース前に npm package の内容を確認する場合:

```bash
pnpm build
pnpm pack:check
```

## CLI

ローカル開発中は、まず build してから root script で実行します。

```bash
pnpm build
pnpm local ./example/schema.a5er
```

package 公開後は次の形で実行できます。

```bash
npx @takuyaw-w/a5sql-mcp ./path/to/model.a5er
```

package 単体で確認する場合:

```bash
pnpm --filter @takuyaw-w/a5sql-mcp start -- ./path/to/model.a5er
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

## 公開する MCP tool

- `describe_a5sql_file`: 起動時に指定されたファイルのパス、種別、サイズ、更新日時を返します。
- `parse_a5sql_file`: 起動時に指定された `.a5er` / `.sql` ファイルを AI 向けの構造に変換します。デフォルトは `summary` で件数と代表要素だけを返します。`mode: "full"` でも `maxTables` / `maxRelationships` / `maxColumnsPerTable` による上限つきで返します。
- `read_a5sql_file`: 起動時に指定されたファイル本文を、最大文字数つきで返します。`offsetChars` による文字位置指定、または `startLine` / `maxLines` による行範囲指定ができます。
- `search_a5sql_assets`: `roots` または `A5SQL_MCP_ROOTS` で指定された root 配下から A5:SQL 関連 asset を検索し、`parse_a5sql_asset` に渡せる `assetId` とマスク済み抜粋を返します。DB には接続しません。
- `parse_a5sql_asset`: `assetId` で指定された `.a5er` / `.sql` / text asset を AI 向けの構造に変換します。任意の `roots` で探索対象を絞れます。DB には接続しません。
- `list_a5sql_tables`: `.a5er` ファイル内のテーブル/ビュー一覧を返します。`offset` / `limit` によるページングに対応し、デフォルトは 100 件です。
- `describe_a5sql_table`: `.a5er` ファイル内の特定テーブル/ビュー定義を返します。
- `explain_a5sql_table`: `.a5er` ファイル内の特定テーブルを、役割・主キー・関連テーブル・注意点つきで要約します。
- `list_a5sql_relationships`: `.a5er` ファイル内のリレーション一覧を返します。任意でテーブル名により絞り込めます。
- `find_a5sql_tables`: `.a5er` ファイル内のテーブルを、テーブル名・論理名・コメント・カラム名から検索します。
- `find_a5sql_columns`: `.a5er` ファイル内のカラムを、カラム名・論理名・コメント・型・テーブル名から検索します。
- `generate_sql_select`: `.a5er` ファイル内の定義から、指定テーブルを起点にした SELECT SQL のたたき台を生成します。DB には接続しません。関連テーブルの JOIN は `maxRelatedTables` で上限を指定できます。
- `generate_mermaid_er_diagram`: `.a5er` ファイル内のテーブルとリレーションから Mermaid ER diagram を生成します。`maxTables` で出力対象テーブル数を制限できます。
- `generate_model_files`: `.a5er` ファイル内のテーブル定義から Laravel Eloquent または SQLAlchemy のモデルファイル案を生成します。ファイルシステムには書き込みません。`maxTables` で生成対象テーブル数を制限できます。
- `generate_schema_markdown`: `.a5er` ファイル内のテーブル定義とリレーションから Markdown の定義書案を生成します。ファイルシステムには書き込みません。
- `review_a5sql_schema`: `.a5er` ファイル内のスキーマ品質を、主キー・型・コメント・リレーション整合性の観点でレビューします。
- `suggest_schema_changes`: `.a5er` ファイル内のスキーマ品質レビュー結果から、主キー・型・リレーション・コメントの改善提案を返します。
- `compare_a5er_with_live_schema`: `.a5er` ファイル内の定義と、外部 DB MCP などから渡された live schema JSON を比較します。DB には接続せず、テーブル/カラム欠落、余剰、型、NULL 許容、主キー差分を返します。
- `generate_migration_plan`: `.a5er` ファイル内の定義と live schema JSON の差分から migration 案を生成します。DB には接続せず、実行もしません。

大きな `.a5er` ファイルでは、tool は `truncated`, `hasMore`, `total...Count` などのメタデータを返します。必要な範囲を `offset` / `limit`、`tableNames`、`maxTables` などで絞り込んでから詳細 tool を使う想定です。

`.a5er` の解析結果には `parseStatus` が含まれます。`ok` は A5:ER として認識できた状態、`unrecognized` は A5:ER らしいヘッダーやセクションを検出できなかった状態です。`unrecognized` の場合は、まず `read_a5sql_file` で先頭行と文字コードを確認してください。

主な warning は次のとおりです。

- `a5er_structure_not_recognized`: A5:ER らしい構造を検出できません。対象ファイル、文字コード、拡張子を確認してください。
- `a5er_encoding_mismatch:<declared>:<decoded>`: A5:ER ヘッダーの `ENCODING` と実際に読み取った文字コードが一致していません。文字化けや誤ったファイル指定の可能性があります。

大きなER図を読むときは、`parse_a5sql_file` の `summary` で件数と `parseStatus` を確認し、`find_a5sql_tables` / `list_a5sql_tables` で対象を絞り、最後に `describe_a5sql_table` や生成系 tool を呼び出す流れを推奨します。

## 環境変数

基本の CLI / MCP サーバーは、起動時に指定した単一ファイルを読み取ります。`search_a5sql_assets` と `parse_a5sql_asset` では `roots` または `A5SQL_MCP_ROOTS` を使って、指定 root 配下の asset を検索・解析できます。設定ディレクトリ探索そのものを返す tool はまだ公開 API として提供していません。

## セキュリティ方針

- パスワード、トークン、秘密鍵、接続文字列はレスポンス内でマスクします。
- デフォルトではホスト名、DB 名、ユーザー名もマスクします。
- ローカルファイルの読み取り専用です。
- 接続先 DB へのクエリ実行は実装していません。

## ライセンス

MIT License です。詳しくは [LICENSE](./LICENSE) を参照してください。
