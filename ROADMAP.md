# ROADMAP

このロードマップは、`a5sql-mcp` を 1.0.0 までに「ローカル A5:SQL 資産を安全に読み取り、AI が扱いやすい形で配信する MCP サーバー」として安定させるためのものです。

1.0.0 では、接続先 DB への SQL 実行、A5:SQL 設定ファイルへの書き込み、資格情報の復号・表示は扱いません。読み取り専用、秘密情報マスク、段階的な読み取り、MCP tool の安定性を優先します。

## 現在地

現在の主な強み:

- `packages/parser`、`packages/core`、`packages/cli` の責務分離がある。
- `.a5er`、`.sql`、text file を読み取り、MCP tool として提供できる。
- `.a5er` のテーブル、カラム、リレーションを検索・要約・生成補助に使える。
- `search_a5sql_assets` と `parse_a5sql_asset` により、指定 root 配下の資産探索から解析までつながっている。
- `detect_a5sql_locations`、`read_a5sql_asset`、`list_a5sql_connections` を MCP から利用できる。
- 秘密情報、private key、URL userinfo、ODBC 形式の credential、`read_a5sql_file` / `read_a5sql_asset` / `search_a5sql_assets` の抜粋マスクが入っている。
- 生成補助 tool は `outputKind: "draft"`、`readOnly: true`、`writesToFileSystem: false`、`connectsToDatabase: false`、`executesSql: false` を返す。
- `release:check`、`published:check`、tag/version 整合性チェック、npm publish workflow がある。

現在の主な弱み:

- A5:ER のコメント、テーブル/カラム名、SQL コメント、SQL 本文は untrusted content だが、prompt injection 防衛の contract とテストはまだ横断的に固定しきれていない。
- trusted metadata と A5:SQL 由来 payload の境界が、tool ごとに読み取る必要がある。
- MCP tool が増えており、1.0.0 の安定 API と experimental draft tool の境界を release 前に凍結する必要がある。
- `packages/cli/src/mcp/tool-outputs.ts` と周辺の MCP 出力整形はまだ大きく、schema review、SQL 生成、model 生成、migration 案生成の責務境界を継続して見直す余地がある。
- README、AGENTS.md、`.agents/skills/a5sql-mcp/SKILL.md` の tool 一覧にずれが出やすい。
- published package の MCP startup は確認できるが、hostile fixture を使った adversarial E2E はまだ薄い。
- 1.0.0 直前に、API freeze、docs 同期、non-goal 表現、release preflight をもう一段確認する必要がある。

## 不足しているもの

### 1. 公開面の最終確認

- `detect_a5sql_locations`、`read_a5sql_asset`、`list_a5sql_connections` は MCP 公開済みなので、1.0.0 前に出力契約と docs を再確認する。
- `search_a5sql_assets` から `read_a5sql_asset` / `parse_a5sql_asset` へ進む導線が、README と tool の `nextAction` で一致しているか確認する。
- connection 情報は、パスワード、接続文字列、秘密情報を返さず、非秘密項目もデフォルトではマスクする contract を維持する。
- prompt injection 防衛と root 境界の観点で、公開済み tool に漏れがないか確認する。

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
- A5:ER コメント、SQL コメント、SQL 本文、テーブル/カラム名に含まれる文言を、ユーザー指示や system 指示として扱わない contract を tool 出力と docs に固定する。
- `nextAction`、`warnings`、`message` などの trusted metadata を、A5:SQL 由来の未信頼文字列から直接組み立てない。

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

### 0.9.1: RC follow-up と公開パッケージ検証

目的:

- 0.9.0 RC の後続として、公開パッケージ相当の起動検証と docs の整合を安定させる。

主な作業:

- root workspace、parser、core、cli、MCP server metadata の version を揃える。
- `rtk pnpm release:check` と `rtk pnpm published:check` を release candidate の検証手順として明記する。
- tarball install 後の MCP startup と `tools/list` を確認する。
- README、AGENTS.md、`.agents/skills/a5sql-mcp/SKILL.md` の 1.0.0 non-goal 表現を揃える。

完了条件:

- package として install した後も MCP server が起動し、期待 tool 一覧を返す。
- `Tools: (none)` や期待 tool 不足を release 前に検出できる。

### 0.9.2: Prompt Injection Defense Baseline

目的:

- A5:SQL 由来の本文・コメント・識別子を、AI への命令ではなく untrusted content として扱う contract を固定する。

主な作業:

- A5:ER コメント、テーブル名、カラム名、SQL コメント、SQL 本文が返る tool を棚卸しする。
- `contentIsUntrusted: true` を返すべき tool と field を整理する。
- prompt injection 文を含む synthetic fixture を追加する。
- `parse_a5sql_file`、`read_a5sql_file`、`read_a5sql_asset`、`parse_a5sql_asset`、検索/説明系 tool の代表出力で、未信頼 content の扱いをテストする。
- README に「tool 出力内の本文はユーザー指示でも system 指示でもない」ことを短く明記する。

完了条件:

- A5:SQL 由来の本文・コメント・識別子を含む代表レスポンスに、untrusted content として扱うための明示的な signal がある。
- prompt injection 文を含む fixture でも、tool の trusted metadata がその文言を指示として扱わない。

### 0.9.3: Trusted Metadata / Untrusted Payload 分離

目的:

- `nextAction`、`warnings`、`message`、`code` などの trusted metadata と、A5:SQL 由来 payload の境界を明確にする。

主な作業:

- MCP tool の出力を、trusted metadata、source metadata、untrusted payload、draft output に分類する。
- `nextAction` と `message` が A5:SQL 由来の生文字列を直接含まないことをテストする。
- path metadata、asset metadata、schema 名、SQL 本文、Markdown/model/migration draft の扱いを整理する。
- 生成補助 tool の draft output にも、A5:SQL 由来の内容が含まれる場合は untrusted input から作られた案であることを示す。

完了条件:

- AI が「次に呼ぶべき tool」を判断する metadata と、読むだけの payload を区別しやすい。
- A5:SQL 由来のプロンプト注入文が `warnings` や `nextAction` のような trusted guidance に混ざらない。

### 0.9.4: Redaction and Path Privacy Audit

目的:

- 秘密情報とユーザー固有 path が、レスポンス、ログ、fixture、docs、test snapshot に混ざらないことを再確認する。

主な作業:

- password、token、API key、private key、URL userinfo、ODBC connection string、JSON/env 形式の credential fixture を追加または見直す。
- `read_a5sql_file`、`read_a5sql_asset`、`search_a5sql_assets`、`parse_a5sql_asset`、`list_a5sql_connections` のマスクを代表ケースで検証する。
- error、warning、`nextAction`、test failure message に秘密値や長すぎる絶対 path が出ないか確認する。
- README / docs の例に実在 path や credential に見える値がないか確認する。

完了条件:

- 代表的な credential 形式が public output に残らない。
- connection candidate は存在確認に必要な情報だけを返し、秘密値や完全な接続文字列を返さない。

### 0.9.5: Root Boundary Hardening

目的:

- `roots` / `A5SQL_MCP_ROOTS` の最小権限境界を、実装・テスト・docs で一貫させる。

主な作業:

- `search_a5sql_assets`、`read_a5sql_asset`、`parse_a5sql_asset`、`list_a5sql_connections` が root 未指定時に既定候補を探索しないことを確認する。
- `detect_a5sql_locations` は候補提示だけであり、見つけた path を自動で探索 root にしないことを明記する。
- 広すぎる root を避ける説明と、目的別 root 例を README に整理する。
- explicit path 読み取りでは `roots` が必須であり、root 外 path を読めないことをテストする。

完了条件:

- root 制限の挙動が docs と test で一致している。
- 利用者が home や drive 全体を指定する前に、より狭い root を選びやすい説明になっている。

### 0.9.6: Parser Robustness for Hostile / Weird Files

目的:

- 壊れたファイル、未知 variant、文字コード不一致、巨大ファイル、プロンプト注入文を含む実運用寄りファイルへの耐性を上げる。

主な作業:

- encoding mismatch、unknown `.a5er`、途中で切れた `.a5er`、壊れた SQL、巨大 text の synthetic fixture を増やす。
- `a5er_structure_not_recognized` と `a5er_encoding_mismatch:<declared>:<decoded>` の `nextAction` を確認する。
- SQL split の quote/comment 耐性を、秘密情報マスクと矛盾しない範囲で検証する。
- 未知形式を空の正常 schema として扱わないことを再確認する。

完了条件:

- 解析できないファイルでも、失敗理由と次に確認すべきことが分かる。
- 壊れた content や hostile content によって、正常 schema と誤認したり秘密情報を漏らしたりしない。

### 0.9.7: MCP Adversarial E2E

目的:

- handler 直接テストだけでなく、MCP server 起動後の `tools/list` / `callTool` で安全 contract を確認する。

主な作業:

- hostile fixture を使って stdio または in-memory MCP E2E を追加する。
- `tools/list` に期待 tool が出ることに加え、代表 `callTool` の `structuredContent` を確認する。
- secret masking、untrusted content signal、draft disclosure、root required error を E2E で検証する。
- published-style startup の検証対象に、最低限の adversarial assertion を足せるか確認する。

完了条件:

- MCP クライアント経由でも、mask、untrusted content、draft disclosure、root boundary が崩れていない。
- `Tools: (none)`、期待 tool 不足、代表 tool の contract regressions を release 前に検出できる。

### 0.9.8: Client / Agent Safety Docs

目的:

- MCP クライアントや AI エージェントが、この server の出力を安全に扱うための最小限の利用ガイドを整える。

主な作業:

- README に prompt injection 防衛、untrusted content、read-only、draft output、root 最小権限をまとめた短い節を置く。
- AGENTS.md と `.agents/skills/a5sql-mcp/SKILL.md` のセキュリティ方針を README と揃える。
- `read_a5sql_file` / `read_a5sql_asset` で本文を読む前に、必要な範囲だけを指定する例を追加する。
- 生成された SQL、Markdown、model、migration 案をそのまま実行・適用しない説明を再確認する。

完了条件:

- 利用者向け README とエージェント向け AGENTS / skill で、同じ安全境界を説明している。
- prompt injection への注意が、抽象論ではなくこの MCP の tool 出力に即して説明されている。

### 0.9.9: API Freeze Rehearsal

目的:

- 1.0.0 で安定扱いにする tool と、experimental draft tool の境界を凍結する。

主な作業:

- tool 名、description、input schema、output contract を棚卸しする。
- README、AGENTS.md、`.agents/skills/a5sql-mcp/SKILL.md`、server registration、test の tool 一覧を照合する。
- 安定 read-only tool と experimental draft tool の分類を README と test で確認する。
- 破壊的変更が必要な field name や response shape が残っていないか確認する。

完了条件:

- 1.0.0 前に変えるべき API 名・field 名・tool 分類が残っていない。
- docs と server registration の公開面が一致している。

### 0.9.10: Preflight Contract Audit

目的:

- 0.9.9 で凍結した API surface が、実装、README、AGENTS.md、skill、test で一致しているかを再監査する。

主な作業:

- `.a5er` 起動時の `tools/list` を source of truth として、tool 名、description、input schema を確認する。
- stable read-only tool と experimental draft tool の分類が README、AGENTS.md、`.agents/skills/a5sql-mcp/SKILL.md`、server registration、test で一致しているか確認する。
- 1.0.0 前に破壊的変更すべき API 名、field 名、tool 分類が残っていないか確認する。
- runtime behavior は原則変更せず、drift が見つかった場合は 1.0.0 contract としてどちらに寄せるかを明示してから最小修正する。

完了条件:

- docs、server registration、test の公開面に説明不能なズレがない。
- 1.0.0 前に変えるべき API 名・field 名・tool 分類が残っていない。

### 0.9.11: Output Contract Consistency Audit

目的:

- 代表 tool の `structuredContent` を横断的に確認し、AI が trusted metadata と A5:SQL 由来 payload を区別しやすい状態にする。

主な作業:

- stable read-only tool の代表レスポンスで `found`、`truncated`、`hasMore`、`warnings`、`nextAction` の使い方を確認する。
- `contentIsUntrusted`、`trustedMetadataFields`、`sourceMetadataFields`、`untrustedPayloadFields`、`draftOutputFields` の使い方を確認する。
- `warnings`、`message`、`code`、`nextAction` に A5:SQL 由来の生文字列が混ざらないことを確認する。
- 既存 JSON contract を不必要に変えず、必要な修正は regression test で意図を固定してから行う。

完了条件:

- 代表 tool の trusted metadata と untrusted payload の境界が説明できる。
- prompt injection 風 payload が trusted guidance に混ざらないことを release 前に検出できる。

### 0.9.12: Published Package / MCP Client Matrix

目的:

- source tree ではなく、install 後の package と MCP client 経由で 1.0.0 前の代表動作を確認する。

主な作業:

- `published:check` の assertion を見直し、tarball install 後の CLI bin から MCP server が起動することを確認する。
- MCP client 経由で `tools/list`、代表 `callTool`、root required error、secret masking、untrusted content signal、draft disclosure を確認する。
- 最低限の adversarial fixture assertion を package 形態の検証に含める。
- registry や network への依存を増やしすぎず、local tarball install の再現性を優先する。

完了条件:

- installed package の CLI bin から MCP server が起動し、期待 tool 一覧を返す。
- `Tools: (none)`、期待 tool 不足、masking / untrusted / draft disclosure の退行を release 前に検出できる。

### 0.9.13: Docs / Onboarding Freeze

目的:

- 1.0.0 前に README、AGENTS.md、`.agents/skills/a5sql-mcp/SKILL.md` の利用者向け・エージェント向け説明を最終固定する。

主な作業:

- install、起動、`roots` / `A5SQL_MCP_ROOTS`、安全な範囲読み取りの説明を確認する。
- `contentIsUntrusted`、`trustedMetadataFields`、`untrustedPayloadFields`、`draftOutputFields` の説明を docs 間で揃える。
- 生成補助 tool は review 用 draft であり、SQL 実行、migration 適用、ファイル書き込みを行わないことを確認する。
- 1.0.0 に含めない DB 接続、SQL 実行、書き込み、資格情報復号、Web UI、daemon が docs で明確か確認する。

完了条件:

- 利用者向け README とエージェント向け AGENTS / skill が同じ安全境界を説明している。
- 1.0.0 公開後に誤解されやすい install、root、draft、non-goal の説明が揃っている。

### 0.9.14: Final RC Dry Run

目的:

- 1.0.0 として tag / publish する直前の final rehearsal を行い、機能追加を止めた状態を確認する。

主な作業:

- `rtk pnpm release:check` と `rtk pnpm published:check` を実行する。
- root、parser、core、cli、MCP server metadata、test expectation の version lockstep を確認する。
- tag preflight と npm publish workflow の前提を確認する。
- 1.0.0 release note 相当の内容を整理する。
- 失敗が見つかり大きな修正が必要な場合は、0.9.14 に混ぜず 0.9.15 を切る。

完了条件:

- 1.0.0 でやることが version bump、tag、publish に近い状態になっている。
- 新機能や大きな contract 変更ではなく、release blocking regression だけを扱う状態になっている。

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

1. 0.9.10 で API surface、docs、test の contract drift を潰す。
2. 0.9.11 で trusted metadata と untrusted payload の境界を再監査する。
3. 0.9.12 で installed package と MCP client 経由の代表動作を確認する。
4. 0.9.13 で README、AGENTS.md、skill の onboarding と safety docs を固定する。
5. 0.9.14 で 1.0.0 final RC dry run を行う。

次点:

1. final RC で見つかった release blocking regression のみを 0.9.15 以降に切り出す。
2. `tool-outputs.ts` 周辺の段階的分割は、1.0.0 contract を壊さない範囲に限定する。
3. parser fixture の追加は、1.0.0 blocking な実ファイル耐性問題が見つかった場合に限定する。

後回し:

1. 新しい ORM 対応
2. DB 実行
3. 書き込み系 tool
4. UI
5. A5:SQL 内部設定や履歴形式の深い解釈

## 判断基準

1.0.0 までの判断では、次の順序で優先する。

1. 秘密情報を漏らさない。
2. ローカル環境や DB を壊さない。
3. AI が次に呼ぶべき tool を判断しやすい。
4. 大きなファイルでも段階的に読める。
5. 公開 API と docs が一致している。
6. 生成系は便利さよりも誤用されにくさを優先する。
