# ドキュメント一覧

このディレクトリのファイルはサイトとして配信されない（`_config.yml` の `exclude` で
Jekyll から外してある）。中に何を書いてもデプロイは壊れない。

## どれを読むか

| 目的 | ファイル |
|---|---|
| **いま何が正しいのか**を知りたい | [`spec/travel-plans-redesign.md`](spec/travel-plans-redesign.md) |
| **次に何をするのか**を知りたい | [`handoff/2026-08-10.md`](handoff/2026-08-10.md) |
| 色・余白・タイポグラフィの値を知りたい | [`design/design-system.md`](design/design-system.md) |
| 実装のときに手を動かす手順が要る | [`plans/`](plans/) の該当フェーズ |

## ディレクトリの役割

### `spec/` — 設計書（唯一の正）

[`travel-plans-redesign.md`](spec/travel-plans-redesign.md) 1 本。
**このリポジトリで仕様の食い違いが起きたら、常にこれを正とする**
（`CLAUDE.md` も `README.md` もここの要約であり、古くなりうる）。
データモデル・保存と公開・暗号化・各ページの仕様・残っている課題（§13）を持つ。

### `plans/` — 実装計画（フェーズごと・完了済みの記録）

着手前に書いた手順書。**実装が済んだあとは歴史的記録**であって、正ではない。
現状と食い違ったら `spec/` を見ること。

| ファイル | 内容 | 状態 |
|---|---|---|
| [`phase-a-design-system-and-schedule.md`](plans/phase-a-design-system-and-schedule.md) | デザイントークン、旅程カレンダー、地図 | 完了 |
| [`phase-b1-store-sync-editor.md`](plans/phase-b1-store-sync-editor.md) | 下書き保存、GitHub への公開、予定エディタ | 完了 |
| [`phase-b2-packing.md`](plans/phase-b2-packing.md) | 持ち物リストとそのエディタ | 完了 |
| [`phase-b4-passphrase-and-encryption.md`](plans/phase-b4-passphrase-and-encryption.md) | 合言葉、PBKDF2 + AES-GCM による暗号化 | 完了 |

Phase B3（コメント機能）は未着手で、計画もまだ無い。仕様は `spec/` の §4.3 / §7.5。
旧 Phase C（Gmail / LINE の検索アーカイブ）は 2026-08-09 に取りやめた。

### `design/` — デザイン仕様と参照モック

- [`design-system.md`](design/design-system.md) — 色・タイプスケール・余白グリッドの
  仕様。出典は aman.com の computed style（2026-08-09 実測）
- [`aman-mock.html`](design/aman-mock.html) — 検証済みの参照実装（約 4,300 行）。
  **実装対象ではなく、値を写す元。** CSS の一部はこのファイルの行番号を指して
  「ここから写した」と記録してある

### `handoff/` — セッションをまたぐ引き継ぎ

[`2026-08-10.md`](handoff/2026-08-10.md) — その時点の残タスクと順序だけを持つ。
**判断の根拠は書かない**（それは `spec/` の役目）。
