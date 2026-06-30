# Implementation Plan Guard

このリポジトリで ROADMAP 実装や複数ファイルにまたがる実装計画を書く場合は、plan の最初に Task 0 を置き、実装前 preflight を必ず通します。

```md
### Task 0: Worktree / Branch Preflight

- [ ] `rtk pnpm agent:preflight` を実行する
- [ ] `main` / `master` 上でないことを確認する
- [ ] working tree が clean であることを確認する
- [ ] 例外的に `main` で進める場合は、ユーザーの明示承認を plan または作業ログに記録し、`rtk pnpm agent:preflight -- --allow-main` を実行する
```

`agent:preflight` は、実装を始める前に branch / worktree / dirty tree を機械的に確認するための guard です。design や plan の作成だけでなく、実装タスクに入る直前にも Task 0 として実行してください。
