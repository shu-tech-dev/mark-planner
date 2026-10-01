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

- **週末:** 設定した曜日をその曜日の色で塗ります（既定は土曜=青、日曜=赤）。カレンダーでは日付の数字と曜日の見出しも同じ色になります。
- **祝日:** 日本の祝日（振替休日・国民の休日を含む、1970〜2050年）を祝日の色（既定は赤）で塗り、土日と重なる場合は祝日を優先します。カレンダーには祝日名も出します。データは [@holiday-jp/holiday_jp](https://github.com/holiday-jp/holiday_jp-js) を同梱しており、通信はしません。
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

## テーブル

上部の「テーブル」で、全件を Notion のデータベースのような表で一覧できます。

- **セルで直接編集:** タイトル・種類・ステータス・開始・終了・タグ・親をクリックして編集すると frontmatter に書き戻します（Enter / フォーカスを外すと確定、Esc で取り消し）。行にマウスを乗せると出る「ファイルを開く」で本文を開けます。
- **ツリー表示:** 親の下に子を字下げして並べ、▾ で折りたためます。
- **並べ替え:** 列見出しをクリック（昇順 → 降順 → 解除）。兄弟の中で並べ替えます。
- **絞り込み:** タイトル検索、種類・ステータス・タグのフィルター。該当項目の親も文脈として表示します。
- **グループ化:** ステータス別・種類別。
- **列:** 表示／非表示と並び順を「列」メニューで、幅は見出しの右端をドラッグで変更。
- **新規行:** 最下行にタイトルを入力して Enter で、日付なしのタスクを作成します。

並べ替え・絞り込み・列の設定はワークスペースごとに保存されます。

## コマンド

- `Mark Planner: カレンダーを開く` / `ガントチャートを開く` / `テーブルを開く` / `設定を開く`
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
| `markPlanner.theme` | `auto` | 画面のテーマ（`auto` = VS Code に合わせる / `light` / `dark`） |
| `markPlanner.calendarView` | `month` | カレンダーの初期表示 |
| `markPlanner.weekStart` | `0`（日曜） | 週の開始曜日 |
| `markPlanner.ganttViewMode` | `Day` | ガントの初期スケール |
| `markPlanner.hideDone` | `false` | 完了扱いのタスクを表示しない |
| `markPlanner.maxEventsPerDay` | `0`（無制限） | カレンダーで1日に表示する件数。0 なら全件表示してマスを縦に伸ばし、n なら超えた分を「他 N 件」にまとめる |
| `markPlanner.weekendColors` | `{"0": "#f14c4c", "6": "#3794ff"}`（日=赤, 土=青） | 休日として塗る曜日と色 |
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
