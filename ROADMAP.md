# ROADMAP

このロードマップは、`a5sql-mcp` を 1.0.0 までに「ローカル A5:SQL 資産を安全に読み取り、AI が扱いやすい形で配信する MCP サーバー」として安定させるためのものです。

1.0.0 では、接続先 DB への SQL 実行、A5:SQL 設定ファイルへの書き込み、資格情報の復号・表示は扱いません。読み取り専用、秘密情報マスク、段階的な読み取り、MCP tool の安定性を優先します。

## 現在地

現在の主な強み:

- `packages/parser`、`packages/core`、`packages/cli` の責務分離がある。
- `.a5er`、`.sql`、text file を読み取り、MCP tool として提供できる。
- `.a5er` のテーブル、カラム、リレーションを検索・要約・生成補助に使える。
- `search_a5sql_assets` と `parse_a5sql_asset` により、指定 root 配下の資産探索から解析までつながっている。
- 秘密情報のマスク、private key のマスク、`read_a5sql_file` のマスクが入っている。
- `release:check`、tag/version 整合性チェック、npm publish workflow がある。

現在の主な弱み:

- `detectA5sqlLocations`、`listA5sqlConnections`、`readA5sqlAsset` など、core にある機能の一部が MCP 公開面に出ていない。
- MCP tool が増えており、1.0.0 の安定 API と実験的な生成系 tool の境界が曖昧になりつつある。
- `packages/cli/src/mcp/tool-outputs.ts` が大きく、schema review、SQL 生成、model 生成、migration 案生成が 1 ファイルに集まっている。
- README、AGENTS.md、`.agents/skills/a5sql-mcp/SKILL.md` の tool 一覧にずれが出やすい。
- MCP server の実起動から `tools/list` / `callTool` までを確認する E2E テストが薄い。
- asset search の `truncated` は近似であり、総件数や探索打ち切り理由はまだ明確ではない。

## 不足しているもの

### 1. 公開面の穴

- `detect_a5sql_locations`
  - A5:SQL の候補ディレクトリを、存在有無、読み取り可否、検出理由つきで返す。
  - これにより、利用者が `A5SQL_MCP_ROOTS` や `roots` を設定しやすくなる。
- `read_a5sql_asset`
  - `assetId` で指定した資産本文を、サイズ制限とマスクつきで読む。
  - `search_a5sql_assets` で見つけた SQL や text を、解析前に安全に確認できるようにする。
- `list_a5sql_connections`
  - core の connection extraction を MCP に出す。
  - パスワード、接続文字列、秘密情報は返さず、非秘密項目もデフォルトではマスクする。

### 2. MCP E2E 検証

- `packages/cli` の handler 直接テストだけでなく、stdio MCP server を起動して `tools/list` と代表 `callTool` を確認する。
- sample `.a5er`、SQL、text、asset root を使い、公開 tool の有無と主要レスポンスを確認する。
- `Auth: Unsupported` は正常、`Tools: (none)` は失敗として扱う検証を残す。

### 3. 安定した出力契約

- tool ごとに `found`、`truncated`、`hasMore`、`total...Count`、`returned...Count`、`warnings`、`nextAction` の使い方を揃える。
- `search_a5sql_assets` の結果には、探索打ち切り理由や effective limit を明示できるようにする。
- 1.0.0 で安定 API とする tool と、将来変更可能な experimental tool を分ける。

### 4. セキュリティ境界

- root 制限の考え方を README に明記する。
- `roots` / `A5SQL_MCP_ROOTS` の指定例と、広すぎる root を避けるガイドを書く。
- fixture、docs、error、test snapshot に秘密情報やユーザー固有パスが混ざらないことを検証する。
- connection 情報は「存在を知らせる」ことと「値を返す」ことを明確に分ける。

### 5. A5:SQL 実ファイルへの耐性

- A5:SQL Mk-2 の保存場所、文字コード、`.a5er` の variant、SQL 履歴/保存 SQL の実例に対する検証を増やす。
- `a5er_structure_not_recognized` や encoding mismatch 時の次アクションを、tool 出力と README で分かりやすくする。
- 実ファイルを repo に含めない前提で、匿名化済み fixture または synthetic fixture を増やす。

## 過剰になっているもの

### 1. 生成系 tool の広がり

`generate_model_files`、`generate_schema_markdown`、`generate_migration_plan` は便利だが、1.0.0 の中核ではない。これらは「ローカル資産の読み取り」とは別に、AI 向けの生成補助である。

1.0.0 までにやること:

- 生成系 tool は read-only の案生成であり、ファイルシステムや DB に書き込まないことを明確にする。
- migration plan は実行可能な移行ツールではなく、レビュー用の草案として位置づける。
- framework 依存の出力は最小限に留め、過度な ORM 対応を増やさない。

### 2. `tool-outputs.ts` の肥大化

`packages/cli/src/mcp/tool-outputs.ts` は 2000 行を超えており、複数の責務が混ざっている。

1.0.0 までにやること:

- schema exploration、SQL generation、Markdown/model generation、schema review、migration planning を小さなモジュールに分ける。
- MCP handler は薄く保ち、出力整形の純粋関数をテストしやすくする。
- 分割は機能追加のついでに行い、無関係な大規模リライトは避ける。

### 3. tool 一覧の重複管理

README、AGENTS.md、skill、server 登録、テストで tool 一覧が重複している。

1.0.0 までにやること:

- README と AGENTS.md の一覧を定期的に照合するテストまたは簡単なチェックを入れる。
- `.agents/skills/a5sql-mcp/SKILL.md` の tool 一覧を現状に合わせて更新する。
- 「実装済み」と「今後の候補」を同じ見出し内で混ぜない。

## 1.0.0 までのマイルストーン

### 0.4.0: Asset / Location / Connection の公開面を埋める

目的:

- core にある探索・読み取り・接続候補抽出を MCP から使えるようにする。
- `search_a5sql_assets` から次に何をすべきかを明確にする。

主な作業:

- `detect_a5sql_locations` を追加する。
- `read_a5sql_asset` を追加する。
- `list_a5sql_connections` を追加する。
- README と AGENTS.md に root 指定、接続情報マスク、asset 読み取りの使い分けを書く。
- MCP E2E smoke test の土台を作る。

完了条件:

- `search_a5sql_assets` → `read_a5sql_asset` / `parse_a5sql_asset` の流れが README で説明されている。
- connection 情報はデフォルトで秘密値も非秘密値も安全側に倒れている。
- `pnpm release:check` が通る。

### 0.5.0: MCP 出力契約の安定化

目的:

- 1.0.0 で安定 API として扱う tool の JSON 形を揃える。

主な作業:

- tool ごとの出力フィールドを棚卸しする。
- `found`、`truncated`、`hasMore`、`warnings`、`nextAction` の使い方を揃える。
- `search_a5sql_assets` に effective limit と打ち切り理由を追加する。
- MCP E2E で `tools/list` と代表 tool の `structuredContent` を検証する。
- README に「安定 tool」と「生成補助 tool」の位置づけを書く。

完了条件:

- 主要 tool のレスポンスが AI と人間の両方にとって予測しやすい。
- 大きなファイルや未知形式で、次に確認すべきことが `nextAction` で分かる。

### 0.6.0: 実ファイル耐性と parser 強化

目的:

- A5:SQL Mk-2 の実運用ファイルに対する読み取り成功率を上げる。

主な作業:

- `.a5er` の variant fixture を増やす。
- Shift_JIS、UTF-8、UTF-16LE の文字コード検証を強化する。
- SQL split の quote/comment 処理を改善する。
- View、Index、Position、PageInfo、DomainInfo の扱いをレビューする。
- `parseStatus` と warnings の説明を README に追加する。

完了条件:

- 未知形式を正常スキーマとして誤認しない。
- 文字化けや encoding mismatch の原因が tool 出力から追いやすい。

### 0.7.0: セキュリティとプライバシーの hardening

目的:

- ローカル秘密情報を扱う MCP として、1.0.0 に必要な安全性を満たす。

主な作業:

- 秘密情報マスクの test case を増やす。
- connection candidate の公開方針を再確認する。
- error、warning、log に秘密情報や長い絶対パスが出すぎないか確認する。
- `roots` の最小権限ガイドを README に追加する。
- 実 DB への接続や SQL 実行を 1.0.0 の non-goal として明記する。

完了条件:

- README、AGENTS.md、テストに「読み取り専用」「秘密情報を返さない」が一貫している。
- `read_a5sql_file`、`read_a5sql_asset`、`search_a5sql_assets` の抜粋がマスク済みであることをテストしている。

### 0.8.0: 生成系 tool の整理

目的:

- 生成系 tool を削るのではなく、1.0.0 の中核から切り分けて保守しやすくする。

主な作業:

- `tool-outputs.ts` を責務別に分割する。
- `generate_model_files`、`generate_schema_markdown`、`generate_migration_plan` の出力に「案である」ことを明示する。
- migration plan の destructive 操作はデフォルト off のまま維持する。
- framework 対応をむやみに増やさない方針を README に書く。

完了条件:

- 生成系 tool の境界が明確で、読み取り専用の約束を崩していない。
- 分割後も既存テストが通る。

### 0.9.0: Release Candidate

目的:

- 1.0.0 に向けた release candidate として、公開 API、docs、release workflow を固定する。

主な作業:

- tool 一覧と README / AGENTS.md / skill の整合性を確認する。
- `npx -y @takuyaw-w/a5sql-mcp --mcp <file>` の published-style startup を tarball で検証する。
- `tools/list` に期待 tool が出ることを確認する。
- `pnpm release:check`、`pnpm pack:check`、tag/version preflight を実行する。
- 1.0.0 で入れない項目を README に明記する。

完了条件:

- npm package と MCP startup の検証手順が再現可能である。
- 破壊的変更が必要なら 1.0.0 前に完了している。

### 1.0.0: Stable read-only MCP

目的:

- ローカル A5:SQL 資産を安全に探索・読み取り・解析する MCP サーバーとして安定版を出す。

#### 1.0.0 に含めるもの

- `.a5er` / `.sql` / text asset の安全な探索、読み取り、解析。
- A5:ER のテーブル、カラム、リレーション検索。
- SQL、Mermaid、Markdown、model、migration の read-only な案生成。
- 接続情報候補のマスク済み一覧。
- MCP E2E と release workflow による基本検証。

#### 1.0.0 に含めないもの

- 接続先 DB への SQL 実行。
- A5:SQL 設定ファイルや ER 図ファイルへの書き込み。
- 資格情報の復号、表示、保存。
- ORM や migration framework への完全対応。
- Web UI や常駐 daemon。

## 優先順位

最優先:

1. `read_a5sql_asset`
2. `detect_a5sql_locations`
3. `list_a5sql_connections`
4. MCP E2E smoke test
5. 出力契約の整理

次点:

1. `tool-outputs.ts` の段階的分割
2. parser fixture の拡充
3. README の導線整理
4. skill / AGENTS / README の tool 一覧同期

後回し:

1. 新しい ORM 対応
2. DB 実行
3. 書き込み系 tool
4. UI

## 判断基準

1.0.0 までの判断では、次の順序で優先する。

1. 秘密情報を漏らさない。
2. ローカル環境や DB を壊さない。
3. AI が次に呼ぶべき tool を判断しやすい。
4. 大きなファイルでも段階的に読める。
5. 公開 API と docs が一致している。
6. 生成系は便利さよりも誤用されにくさを優先する。
