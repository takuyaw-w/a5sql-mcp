# AGENTS.md

このリポジトリは、ローカルに存在する A5:SQL Mk-2 の設定・メタデータ・SQL 資産を読み取り、AI エージェントが安全に扱いやすい形で配信する MCP サーバーを開発するためのものです。

## 開発の目的

- A5:SQL のローカル資産を、AI が検索・要約・参照しやすい構造化データとして提供する。
- データベース接続情報、ER 図、テーブル定義、SQL 履歴、SQL ファイルなどを段階的に扱えるようにする。
- まずは読み取り専用を基本とし、ローカル環境や接続先 DB を壊さない。
- 秘密情報を不用意にログ、レスポンス、テストスナップショット、コミットに含めない。

## 基本方針

- 実装より前に、A5:SQL がローカルに保存するファイル形式・保存場所・文字コードを確認する。
- 保存場所や形式はユーザー環境・A5:SQL のバージョン・Windows/Wine/Linux などの実行形態で変わり得るため、ハードコードを避ける。
- デフォルト動作は読み取り専用にする。
- 書き込み、削除、接続先 DB へのクエリ実行、資格情報の復号・表示は、明示的に実装範囲へ入るまで扱わない。
- AI 向けの配信では「生データをそのまま渡す」のではなく、識別子、要約、参照パス、必要最小限の抜粋に整形する。
- 例外や解析失敗時は、ファイルパスや秘密情報を含みすぎないエラーにする。

## 想定する公開面

現在の MCP サーバーは、起動時に指定された `.a5er` / `.sql` / text ファイルを読み取る stdio サーバーです。独立した `packages/mcp-server` は持たず、`packages/cli` の `--mcp` モードで提供します。

現時点で公開している tool は次のとおりです。

- `describe_a5sql_file`: 起動時に指定されたファイルのパス、種別、サイズ、更新日時を返す。
- `parse_a5sql_file`: 起動時に指定された `.a5er` / `.sql` ファイルを AI 向けの構造に変換する。デフォルトは summary。`mode: "full"` でも `maxTables` / `maxRelationships` / `maxColumnsPerTable` による上限つきで返す。
- `read_a5sql_file`: 起動時に指定されたファイル本文を、最大文字数つきで返す。`offsetChars`、または `startLine` / `maxLines` で読み取り範囲を絞れる。
- `detect_a5sql_locations`: A5:SQL の設定ディレクトリ候補を、存在有無、読み取り可否、検出理由つきで返す。DB には接続しない。
- `read_a5sql_asset`: `assetId` で指定された asset 本文を、サイズ制限と秘密情報マスクつきで返す。バイナリや未対応ファイルは本文を返さず warning を返す。
- `list_a5sql_connections`: A5:SQL 設定 root 配下から接続候補を抽出し、秘密情報を返さない形で一覧する。非秘密項目もデフォルトではマスクする。
- `search_a5sql_assets`: `roots` または `A5SQL_MCP_ROOTS` で指定された root 配下から A5:SQL 関連 asset を検索し、`parse_a5sql_asset` に渡せる `assetId` とマスク済み抜粋を返す。DB には接続しない。
- `parse_a5sql_asset`: `assetId` で指定された `.a5er` / `.sql` / text asset を AI 向けの構造に変換する。`roots` または `A5SQL_MCP_ROOTS` で探索対象を明示する。DB には接続しない。
- `list_a5sql_tables`: `.a5er` ファイル内のテーブル/ビュー一覧を返す。`offset` / `limit` によるページングに対応し、デフォルトは 100 件。
- `describe_a5sql_table`: `.a5er` ファイル内の特定テーブル/ビュー定義を返す。
- `explain_a5sql_table`: `.a5er` ファイル内の特定テーブルを、役割・主キー・関連テーブル・注意点つきで要約する。
- `list_a5sql_relationships`: `.a5er` ファイル内のリレーション一覧を返す。
- `find_a5sql_tables`: `.a5er` ファイル内のテーブルを、テーブル名・論理名・コメント・カラム名から検索する。
- `find_a5sql_columns`: `.a5er` ファイル内のカラムを、カラム名・論理名・コメント・型・テーブル名から検索する。
- `generate_sql_select`: `.a5er` ファイル内の定義から SELECT SQL のたたき台を生成する。DB には接続しない。`maxRelatedTables` で JOIN 対象の上限を指定できる。
- `generate_mermaid_er_diagram`: `.a5er` ファイル内のテーブルとリレーションから Mermaid ER diagram を生成する。`maxTables` で出力対象テーブル数を制限できる。
- `generate_model_files`: `.a5er` ファイル内のテーブル定義から Laravel Eloquent または SQLAlchemy のモデルファイル案を生成する。ファイルシステムには書き込まない。`maxTables` で生成対象テーブル数を制限できる。
- `generate_schema_markdown`: `.a5er` ファイル内のテーブル定義とリレーションから Markdown の定義書案を生成する。ファイルシステムには書き込まない。
- `review_a5sql_schema`: `.a5er` ファイル内のスキーマ品質を、主キー・型・コメント・リレーション整合性の観点でレビューする。
- `suggest_schema_changes`: `.a5er` ファイル内のスキーマ品質レビュー結果から、主キー・型・リレーション・コメントの改善提案を返す。
- `compare_a5er_with_live_schema`: `.a5er` ファイル内の定義と、外部 DB MCP などから渡された live schema JSON を比較する。DB には接続せず、テーブル/カラム欠落、余剰、型、NULL 許容、主キー差分を返す。
- `generate_migration_plan`: `.a5er` ファイル内の定義と live schema JSON の差分から migration 案を生成する。DB には接続せず、実行しない。

大きなファイルでは全量を一度に返さず、`truncated`、`hasMore`、総件数、返却件数を見て段階的に読む。起動時に指定した単一ファイルも初期読み取り上限を持ち、上限超過時は全量 parse せず `file_too_large` として返す。

`.a5er` の解析結果では `parseStatus` を必ず確認する。`unrecognized` の場合は、空の正常スキーマとして扱わず、`read_a5sql_file` で先頭行・文字コード・ファイル形式を確認する。`a5er_structure_not_recognized` は A5:ER らしい構造が見つからないことを示し、`a5er_encoding_mismatch:<declared>:<decoded>` はヘッダー上の文字コードと実デコード結果の不一致を示す。

0.9.6 の parser robustness では、壊れたファイルや prompt injection 風 payload を含むファイルでも、`warnings`、`message`、`code`、`nextAction` に A5:SQL 由来の文字列を混ぜないことを確認する。

今後の拡張候補は次のとおりです。実装済み機能として扱わないでください。

- A5:SQL の内部設定や履歴形式をより深く解釈した検索を追加する。
- 指定された資産を AI 向けに要約して返す。

実際に接続先 DB へ SQL を実行する機能は、初期スコープには含めません。将来追加する場合も、読み取り専用クエリ、明示的な許可、監査ログ、タイムアウト、件数制限を必須条件にしてください。

## セキュリティとプライバシー

- `roots` または `A5SQL_MCP_ROOTS` は、目的に必要な最小範囲を前提に設計・説明する。
- `detect_a5sql_locations` は候補提示だけに使う。`search_a5sql_assets` / `read_a5sql_asset` / `parse_a5sql_asset` / `list_a5sql_connections` は、root 未指定時に APPDATA、LOCALAPPDATA、USERPROFILE、home、Wine などの既定候補を探索対象にしない。
- パスワード、トークン、秘密鍵、接続文字列、個人情報をそのまま返さない。
- 接続情報を扱う場合は、ホスト名・DB 名・ユーザー名も必要性を判断してマスク可能にする。
- 成功レスポンスで既存 contract として path metadata を返す場合でも、本文、抜粋、エラー、warning に秘密情報を混ぜない。
- ログにはファイル名や概要だけを残し、値そのものを出さない。
- テスト用フィクスチャには実在する接続情報やユーザー固有パスを入れない。
- 解析対象ファイルがバイナリ、暗号化済み、独自形式の場合は、推測で処理せず形式を切り分ける。
- A5:ER のコメント、テーブル/カラム名、SQL コメント、SQL 本文は untrusted content として扱う。これらの payload を含む代表的な tool 出力には `contentIsUntrusted: true` を付け、README でも prompt injection の注意を明記する。
- `trustedMetadataFields`、`sourceMetadataFields`、`untrustedPayloadFields`、`draftOutputFields` は trusted guidance、取得元 metadata、未信頼 payload、生成 draft の境界を示す contract として扱う。A5:SQL 由来の文字列を `warnings`、`message`、`code`、`nextAction` に直接混ぜない。
- 1.0.0 まで、実際の接続先 DB への接続、SQL 実行、資格情報の復号・表示は non-goal として扱う。

## 実装ルール

- ローカルコマンドは原則として `rtk` を付けて実行する。
- ROADMAP 実装や複数ファイルにまたがる実装では、implementation plan の先頭に Task 0 として `rtk pnpm agent:preflight` を入れ、実装開始前に実行する。`main` / `master` 上で実装する例外は、ユーザーの明示承認を plan または作業ログに残し、必要な場合だけ `--allow-main` を使う。
- リポジトリ内の既存方針が増えた場合は、その方針を優先する。
- 作業開始時は、依頼内容に該当する Codex/AI 向け skill がないか確認し、該当する場合は実作業や回答より前に読む。ユーザーが `using-superpowers` などの skill 名を明示した場合は、その skill を必ず読んでから進める。
- 複数の skill が該当する場合は、進め方を決める process 系 skill を先に読み、その後に `a5sql-mcp` などのドメイン固有 skill を読む。
- Superpowers の brainstorming / writing-plans など、承認ゲートを持つ process skill を使う場合は、ユーザーが手順遵守を明示していなくても、その skill の確認フェーズを省略しない。
- ROADMAP.md の項目が具体的でも、design の提示、plan の提示、実装開始の確認をユーザーに明示してから実装に入る。
- 「実装して」「すすめて」は、design / plan の確認フェーズを承認済みにする言葉ではない。確認フェーズを省略できるのは、ユーザーが「確認フェーズはスキップして実装してよい」「design / plan の承認済みとして進めてよい」など、確認省略を明示した場合だけにする。
- 依存関係を追加する前に、標準ライブラリや既存依存で十分か確認する。
- パーサーは ad hoc な文字列分割よりも、形式に合った構造化処理を優先する。
- 設定ファイル探索は OS ごとの候補パスを分離し、テストしやすい純粋関数に寄せる。
- I/O と解析ロジックを分け、解析は小さい fixture でテストできるようにする。
- MCP のレスポンスは、AI が扱いやすいように安定した JSON スキーマを意識する。
- 0.9.0 以降の release candidate では、`rtk pnpm release:check` に加えて `rtk pnpm published:check` を実行し、tarball install 後の MCP startup と `tools/list` を確認する。

## ドキュメント方針

- README には利用者向けのセットアップと起動方法を書く。
- AGENTS.md には開発者・エージェント向けの制約を書く。
- SKILL.md には、このプロジェクトを扱う Codex/AI 向けの作業手順を書く。
- subagents.md は、広い調査や設計レビューが必要な場合だけ参照する補助ドキュメントにする。

## レビュー観点

- 秘密情報がレスポンス、ログ、fixture、ドキュメント例に混入していないか。
- 読み取り専用の境界が守られているか。
- A5:SQL の保存形式を過度に決め打ちしていないか。
- OS 差分と文字コード差分をテストできる形になっているか。
- MCP tool/resource の名前、説明、入力、出力が AI にとって明確か。
- エラー時にユーザーが次に何を確認すべきか分かるか。
