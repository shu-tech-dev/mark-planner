# Mark Planner

1ファイル = 1つの予定/タスク。frontmatterに日付を書いたMarkdownファイルを、VS Code上のカレンダーとガントチャートで表示・編集します。

## 書式

```markdown
---
id: k3f9x2            # 自動付与。parent/depends はこのIDで参照する
title: 設計レビュー
type: task            # task | event
status: todo          # todo | doing | done
start: 2026-10-06     # 時刻付きなら 2026-10-06T10:00
end: 2026-10-08       # 終了日（この日を含む）。end のみなら締切扱い
tags: []
parent: a8d2m1
depends: [p0q7z4]
---

本文は自由
```

`start` または `end` を持つファイルが対象です。`id` だけを持つ日付なしのファイルも、親タスクとして使えます。

## 親子関係

子タスクに `parent: <親のid>` を書きます。

- ガント：親の直下に子が並び、子の名前には `└` が付きます。親のバーはグレーで表示します。
- 親に日付がない場合は、子タスクの期間からバーを算出し、点線で表示します（ドラッグしても変更されません）。
- カレンダー：予定にマウスを乗せると `v1リリース › 実装 › API実装` のように親の名前が出ます。

## コマンド

- `Mark Planner: カレンダーを開く` / `ガントチャートを開く`
- `Mark Planner: 新規タスク/予定` — `planner/YYYY-MM-DD-タイトル.md` を作成（重複時は `-2` などを付与）
- `Mark Planner: 重複IDを振り直す`

## 設定

| キー | 既定値 | 説明 |
|---|---|---|
| `markPlanner.include` | `**/*.md` | 読み込むファイル |
| `markPlanner.exclude` | `**/node_modules/**` | 除外するファイル |
| `markPlanner.newItemFolder` | `planner` | 新規ファイルの保存先 |
| `markPlanner.properties` | `{}` | キー名の読み替え（例: `{"end": "due"}`） |

## 開発

```sh
npm install
npm run build              # dist/ と media/ を生成
npm test                   # 単体テスト
npm run test:integration   # VS Code を起動して結合テスト（WSL では xvfb-run -a を付ける）
```

F5 で拡張機能開発ホストを起動します。
