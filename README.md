# Mark Planner

1ファイル = 1つの予定/タスク。frontmatterに日付を書いたMarkdownファイルを、VS Code上のカレンダーとガントチャートで表示・編集します。

## 書式

```markdown
---
id: tk2m9a            # 作成時刻から自動生成。parent/depends はこのIDで参照する
title: 設計レビュー
type: task            # task | event | holiday（休暇）
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

## ID とファイル名

新規作成したファイルは `tk2m9a-設計レビュー.md` のように ID を頭に付けます。

- ID は作成時刻（2020年からの秒数）の36進数なので、ファイル名順＝作成順になる。
- ID は変わらないので、日付を動かしてもファイル名は古くならない。`Ctrl+P` で ID を打てばファイルが開ける。
- 正は frontmatter の `id`。ファイル名を手で変えても参照は壊れない。

## 親子関係

子タスクに `parent: <親のid>` を書きます。

- ガント：親の直下に子が並び、子の名前には `└` が付きます。親のバーはグレーで表示します。
- 親に日付がない場合は、子タスクの期間からバーを算出し、点線で表示します（ドラッグしても変更されません）。
- カレンダー：予定にマウスを乗せると `v1リリース › 実装 › API実装` のように親の名前が出ます。

## 休日・祝日・休暇

- **週末:** 設定した曜日（既定は土日）を、カレンダーとガントで薄く塗ります。
- **祝日:** 日本の祝日（振替休日・国民の休日を含む、1970〜2050年）を祝日の色で塗り、カレンダーには祝日名も出します。データは [@holiday-jp/holiday_jp](https://github.com/holiday-jp/holiday_jp-js) を同梱しており、通信はしません。
- **休暇:** `type: holiday` のファイルが自分の休暇です。カレンダーではバー（ドラッグで日付変更可）と日の塗りで、ガントでは列の塗りで表示します。「＋ 新規」で「休暇」を選ぶと作れます。

```markdown
---
id: vac008
title: 有給休暇
type: holiday
start: 2026-10-19
end: 2026-10-20
---
```

## コマンド

- `Mark Planner: カレンダーを開く` / `ガントチャートを開く` / `設定を開く`
- `Mark Planner: 新規タスク/予定` — `planner/<id>-タイトル.md` を作成
- `Mark Planner: 重複IDを振り直す` — コピー側に新しいIDを振り、ファイル名の頭のIDも付け替える

## 設定

パネル右上の「⚙ 設定」タブ（またはコマンド `Mark Planner: 設定を開く`）で変更できます。保存先はワークスペース設定（`.vscode/settings.json`）で、VS Code 標準の設定画面からも同じ値を編集できます。

| キー | 既定値 | 説明 |
|---|---|---|
| `markPlanner.include` / `exclude` | `**/*.md` / `**/node_modules/**` | 読み込む／除外するファイル |
| `markPlanner.newItemFolder` | `planner` | 新規ファイルの保存先 |
| `markPlanner.template.body` | `""` | 新規ファイルの本文。`{{title}}` `{{date}}` を置換 |
| `markPlanner.template.frontmatter` | `{}` | 新規ファイルに追加する frontmatter |
| `markPlanner.properties` | `{}` | キー名の読み替え（例: `{"end": "due"}`） |
| `markPlanner.statuses` | todo / doing / done | ステータスの値・表示名・色・進捗率・完了扱い。先頭が新規作成時の初期値 |
| `markPlanner.eventColor` | `#b180d7` | `type: event` の色 |
| `markPlanner.calendarView` | `month` | カレンダーの初期表示 |
| `markPlanner.weekStart` | `0`（日曜） | 週の開始曜日 |
| `markPlanner.ganttViewMode` | `Day` | ガントの初期スケール |
| `markPlanner.hideDone` | `false` | 完了扱いのタスクを表示しない |
| `markPlanner.maxEventsPerDay` | `0`（無制限） | カレンダーで1日に表示する件数。0 なら全件表示してマスを縦に伸ばし、n なら超えた分を「他 N 件」にまとめる |
| `markPlanner.weekendDays` | `[0, 6]`（日・土） | 休日として塗る曜日 |
| `markPlanner.showHolidays` | `true` | 日本の祝日を表示する |
| `markPlanner.holidayColor` / `vacationColor` | `#f14c4c` / `#2ea043` | 祝日／休暇の色 |
| `markPlanner.language` | `auto` | 画面と通知の言語（`auto` / `ja` / `en`）。コマンド名と標準設定画面の文言は VS Code の表示言語に従います |

## 開発

```sh
npm install
npm run build              # dist/ と media/ を生成
npm test                   # 単体テスト
npm run test:integration   # VS Code を起動して結合テスト（WSL では xvfb-run -a を付ける）
```

F5 で拡張機能開発ホストを起動します。
