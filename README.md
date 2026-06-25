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
a5sql の MCP tool を使って、parse_a5sql_file の結果から読み込めているテーブル数とリレーション数を教えて。
```

テーブル一覧を確認する:

```text
a5sql の MCP tool を使って、A5:ER ファイルに含まれるテーブル一覧を論理名つきで表示して。
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
- `parse_a5sql_file`: 起動時に指定された `.a5er` / `.sql` ファイルを AI 向けの構造に変換します。
- `read_a5sql_file`: 起動時に指定されたファイル本文を、最大文字数つきで返します。
- `list_a5sql_tables`: `.a5er` ファイル内のテーブル/ビュー一覧を返します。
- `describe_a5sql_table`: `.a5er` ファイル内の特定テーブル/ビュー定義を返します。
- `list_a5sql_relationships`: `.a5er` ファイル内のリレーション一覧を返します。任意でテーブル名により絞り込めます。
- `find_a5sql_tables`: `.a5er` ファイル内のテーブルを、テーブル名・論理名・コメント・カラム名から検索します。
- `generate_sql_select`: `.a5er` ファイル内の定義から、指定テーブルを起点にした SELECT SQL のたたき台を生成します。DB には接続しません。
- `generate_mermaid_er_diagram`: `.a5er` ファイル内のテーブルとリレーションから Mermaid ER diagram を生成します。
- `generate_model_files`: `.a5er` ファイル内のテーブル定義から Laravel Eloquent または SQLAlchemy のモデルファイル案を生成します。ファイルシステムには書き込みません。
- `review_a5sql_schema`: `.a5er` ファイル内のスキーマ品質を、主キー・型・コメント・リレーション整合性の観点でレビューします。

## 環境変数

現時点の CLI / MCP サーバーは、起動時に指定した単一ファイルを読み取ります。設定ディレクトリ探索用の環境変数はまだ公開 API として提供していません。

## セキュリティ方針

- パスワード、トークン、秘密鍵、接続文字列はレスポンス内でマスクします。
- デフォルトではホスト名、DB 名、ユーザー名もマスクします。
- ローカルファイルの読み取り専用です。
- 接続先 DB へのクエリ実行は実装していません。

## ライセンス

MIT License です。詳しくは [LICENSE](./LICENSE) を参照してください。
