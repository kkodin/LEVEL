# CLAUDE.md

このファイルは Claude Code (claude.ai/code) がこのリポジトリで作業する際の指針です。

## プロジェクト概要

**レベル野帳 (LEVEL)**
水準測量の野帳（器高式）をスマホで記録・計算するオフライン動作可能なPWA。

- リモート: https://github.com/kkodin/LEVEL.git (branch: `main`)
- **作業リポジトリ（ここでコミット・push する）**: `C:\Users\OWNER\開発\LEVEL`
- **バージョン保管庫（Dropbox・git管理外）**: `C:\Users\OWNER\Dropbox (個人用)\Documents\GITHUB\LEVEL\`

**詳細な引継ぎは [仕様書.md](仕様書.md) を読むこと。** このファイルはその要約。

## 作業ルール（必須）

保管庫の構成:

```
Dropbox\Documents\GITHUB\LEVEL\
  LEVEL_vrNNN\      ← 最新版の完成状態（直下には1つだけ）
  OLD\              ← 旧バージョンのフォルダはここへ移す
```

**大規模な改善・改修ごとに**、以下の順で進めること。小さな修正では版を切らず、作業リポジトリで直接コミットしてよい。

**スナップショットは改修が「終わった」状態を保存する。**
`LEVEL_vrNNN\index.html` をそのまま開けばその版の完成品が動くこと。

1. 作業リポジトリ `C:\Users\OWNER\開発\LEVEL` で改修する
2. ブラウザで動作確認する
3. ユーザーに確認する
4. **ユーザーが明示的に「pushして」と言った時だけ** commit / `git push origin main` する
5. 直下にある既存の `LEVEL_vrNNN` を `OLD\` へ移動する
6. `LEVEL_vr(NNN+1)\` を直下に新規作成し、作業リポジトリの `.git` を除く全ファイルをコピーする
7. スナップショットに `VERSION.txt` を置き、対応コミットハッシュと変更概要を記録する

### 版番号

`LEVEL_vr000` から連番。最新は `LEVEL_vr014`（コミット `4597134`）。

### Dropbox 内で git 操作をしないこと

`C:\Users\OWNER\Dropbox (個人用)\Documents\GITHUB\LEVEL` 直下は**バージョン保管庫専用**。
**保管庫には `LEVEL_vrNNN` と `OLD` しか置かない**（root に作業ファイルを置かない）。
別PCで再開するときは保管庫をコピーせず `git clone` すること（仕様書 第12章）。
PCが変わるとユーザー名が変わるので、このファイルのパスも合わせて直す。
ここに `.git` を置くと Dropbox の同期が `.git` 内のファイルを掴んで
`index.lock` 競合・競合コピーの混入・リポジトリ破損を招くため、
git 操作は必ず `C:\Users\OWNER\開発\LEVEL` で行う。

## ファイル構成

| ファイル | 役割 |
|---------|------|
| `index.html` | 全画面のマークアップ（表・入力パネル・各シート） |
| `app.js` | 全ロジック（約2700行・単一ファイル、モジュールではなくグローバル関数） |
| `styles.css` | 全スタイル |
| `service-worker.js` | オフラインキャッシュ |
| `manifest.json` | PWA設定 |
| `icon-180.png` / `icon.svg` | アプリアイコン（「Level / 野帳」2行デザイン） |

`app.js` は `<script src="app.js">`（非module）なので、関数はすべてグローバル。
ブラウザのコンソールから直接呼んで検証できる。

## 表の見出し行

`thead th` を `position: sticky; top: 0` で固定している。
**`.level-table` は `border-collapse: separate` にすること**。`collapse` だと
sticky 時に下の行が見出しの背景を透けて見える。罫線は各セルの右辺・下辺で引く。

## `selected` と `buffer` の対応（重要）

`selected = { row, field }` を書いたら、**直後の `buffer` が同じ `field` から
取られているか必ず確認する**。初期選択をGL→BSに変えたとき `buffer = rows[0]?.gl`
のままの箇所が6つ残り、保存データ読込時にBS欄がGLの値になる不具合を起こした。

## Service Worker の更新（必須）

ファイルを変更したら必ず `service-worker.js` 先頭の `VERSION` を上げること。

```javascript
const VERSION = "0032";   // 番号を上げる
```

**同時に `index.html` の `?v=` も同じ番号に揃えること。**

```html
<link rel="stylesheet" href="styles.css?v=0032">
<script src="app.js?v=0032"></script>
```

キャッシュは Service Worker とブラウザのHTTPキャッシュの2層ある。
SWのキャッシュ名だけ上げても、HTTPキャッシュは URL が変わらないと古いファイルを返す。
`?v=` でURL自体を変えて両方に効かせている。`APP_FILES` も同じURLで登録すること。

## 表の列

`BS | IH | FS | GL | 測点名 | 基準高 | 誤差mm` の7列。
右の2列は登録済み基準点と同名の測点にだけ「既知GL」と「符号付きmm差」を出す
読み取り専用の列で、狭い画面（スマホ）では出さない。

## 野帳のデータ構造（最重要）

器高式。**同じ行の FS と BS は同一の移器点**を指す。

```
行0: GL=10.000  BS=1.500            → IH=11.500     ← 基準点の行
行1: FS=0.500   BS=2.000            → GL=11.000, IH=13.000
行2: FS=1.000                       → GL=12.000     ← BSなし = 中間視(IP)
```

`calculate()` の計算式:

```javascript
// 行 i (i>0) : GL_i = 直前のIH - FS_i
// 続けて BS があれば : IH_i = GL_i + BS_i
```

**行0の FS は計算に使われない**。

表: `{ name, date, time, rows }`。`time` は作成時刻 `"HH:MM"`（24時制、無ければ空）。
**新しく表を作る3経路（`addTable` / `finishSetupAndChooseBasePoint` / `startNewSite`）は
必ず `nowTimeString()` を入れる**。古いデータへの後付けはしない。
日付と同じく **表追加 / 名称変更 の2か所でだけ**編集できる（測定情報の欄は表示専用）。
xlsxのシート名は `YYYY.MM.DD_HHMM_名前`（旧形式の読み込みにも対応）。

`rows` の1行: `{ bs, ih, fs, gl, point, isBase }`。
`ih` と `gl`（行1以降）は `calculate()` が算出する計算列。
`isBase` は「GL が計算結果ではなく置き直した基準高」の印で、その行から器高を計算し直す。

**FS を消したら、その FS から求めた GL・IH も消える**（非基準行は `next.gl = ""`）。
古い GL が残って誤った器高を出し続けないための処理なので、外さないこと。

## xlsx の表シートの形

```
A          B      C     D      E       F       G
1  日付      2026.09.02
2  時刻      09:30
3  作業名    1号線
4  BS       IH    FS    GL     測点名   基準高   誤差mm   ← 見出し
5  1.148    =…          10.000 KBM     =…      =…       ← データ1行目
```

- 行番号は `XLSX_TABLE_HEADER_ROW`(=4) / `XLSX_TABLE_FIRST_DATA_ROW`(=5) から計算する。
  **`xlsxMeasurementRow()` に行番号を直書きしないこと**
- `基準高` は `VLOOKUP` で基本情報シートの基準点一覧を引く。
  **`basicSheetRows()` の行数を変えたら `XLSX_POINTS_ROW`（=9）も直すこと**
- `誤差mm` は `ROUND((GL-基準高)*1000,0)`。表示は `+0;-0;+0`（styles の numFmt 165）
- この2列は確認用の計算列。**読込側（`parseXlsx` / `parseExcelXml`）は A〜E しか見ない**
- 見出し行は `tableHeaderIndex()`（A列が `BS` の行）で探すので、
  見出しが1行目だった旧形式のファイルも読める。日付・時刻・作業名は
  `tableMetaFromSheet()` が先頭3行から拾い、無ければシート名から復元する


## 変位グラフシート（xlsx）

変位測量では**初期値を基準点として登録する**ので、`誤差mm` 列がそのまま
「初期値からの変位」になる。だから測量ロジックは何も足していない。
足りなかったのは「回ごとに横へ並べ直す集計」だけで、それが `変位グラフ` シート。

```
    A            B                  C             D          …
1  作業名        路面変異測量初期値   路面変異測量   路面変異測量
2  日時          8/25 21:30         8/25 22:25    8/26 21:20
3  G1            +0                 +3            +5
4  G2            +0                 +3            +3
5  G3            +0                 +1            +2
6  管理値 (mm)   =基本情報!$B$6      …
7  警告値 (mm)   =基本情報!$B$6*$B$7 …
```

- **値は行番号でなく測点名で引く**（`INDEX`+`MATCH`）。
  `=IFERROR(INDEX('シート名'!$G:$G,MATCH($A3,'シート名'!$E:$E,0)),"")`
  行番号を直接指すと、Excel 側で行や測点を消したとたん `#REF!` だらけになる。
  **この形を崩さないこと。**
- 列は測定回。**日付＋時刻の昇順に並べ替える**（`Array.prototype.sort` は安定なので
  日付が無いものは元の並びのまま後ろへ）
- 行に出す測点は `displacementPoints()` が決める。判定は `isChartPoint()`:
  - `point.chart` が真偽値 → 測点ごとの明示指定（登録済測点のチェックで書き換わる）
  - `undefined` → 自動判定。**行0の器械据付基準（KBM 等。常に変位0）を除く**
  **`point.chart` に既定値を持たせないこと。** 既定を入れると、基準点を後から
  足したときに勝手に外れる／入る。「未設定＝自動」を保つ
- 登録済測点（`#pointList`）の各行に「☑ 変位」のチップがある。
  **`.point-item` は `<button>` なので入れ子の `<input>`/`<button>` は置けない。**
  `span.point-chart` にして、click ハンドラで
  `event.target.closest(".point-chart")` を見て振り分けている
- 表が1つしか無い／対象測点が無いときは**シートごと作らない**
- 管理値・警告値は基本情報シートの `LIMIT` / `WARN` を参照する。ここが唯一の出どころ
- シート名は数式に埋めるので `sheetRef()` で `'` を `''` に escape すること
- **`columnLetter()` は AA 以降も返す。** 測定回が26を超えると Z で止まって壊れるため

### 集計シートを足したら

`isSummarySheetName()` に**必ず足すこと**。読込側がそれを野帳の表として
取り込もうとして、空の表が1つ増える。

## 基本情報シートの行番号

| 行 | タグ | 中身 |
|---|---|---|
| 1〜5 | `LEVEL_APP` / `TITLE` / `SITE` / `DATE` / `PLACE` | |
| 6 | `LIMIT` | 管理値 (mm)。既定 45 |
| 7 | `WARN` | 警告値の割合。既定 0.8（0% 書式で 80% と出る） |
| 8 | | 空行 |
| 9 | `POINTS` | B列に「初期値」の表示名 |
| 10 | | `測点名` / `数値` / `変位グラフ` の見出し |
| 11〜 | | 登録済み基準点（C列 `○`＝変位グラフに出す / `×`＝出さない） |

**行を増減したら `XLSX_LIMIT_ROW` / `XLSX_WARN_ROW` / `XLSX_POINTS_ROW` を必ず直すこと。**
表シートの `基準高` 列の `VLOOKUP` 範囲がここから作られる。
読込は A列のタグを見ているので行がずれても読めるが、書き出した数式は壊れる。
`POINTS` は「初期値」と書き換えられたファイルも読めるようにしてある。

## 数値の扱い

- 表示・保存とも **小数点3桁固定**（`fmt` / `fmtInput` が `toFixed(3)`）
- 入力時、小数点以下4桁目は受け付けない（`appendKey` の `decimalsOf(buffer) >= DECIMALS`）
- 弾いたときは `rejectInput()` が画面点滅（`body.input-reject`）＋ブザー＋振動で知らせる
- 編集中のセルだけは入力途中の値をそのまま表示する（`cellDisplay`）

## 入力パネル（キーパッド）

```
[ 測点名 / BS 1.235（40px） ]  [ 確認せず次へ ☐ ]  ← 入力中は OK / 修正
[ 7 ] [ 8 ] [ 9 ]              [ AC  ]
[ 4 ] [ 5 ] [ 6 ]              [ C   ]
[ 1 ] [ 2 ] [ 3 ]              [ ⌫   ]
[ 0 ] [ . ]                    [ +/- ]   ← 0 と . は縦3行ぶん
[   ] [   ] [ ↑ ]              [ ↓   ]
[   ] [   ] [ BS]              [ FS  ]
```

- 確定ボタンは廃止済み。測点名は**測点名セルをタップ**して選択シートから入れる
- `←` `→`（列移動）も廃止。物理キーボードの矢印/Tabのみ
- **行0の FS は選択できない**（`isUnusedCell()`）。計算に使わないセルなので斜線背景にしてある
- **原則: FSに数値がある行＝GLが分かっている行。その行にBSを入れると `IH = GL + BS` が求まる**。
  逆に FS が空で基準行でもない行は GL が無く、BS を入れても意味がない。
  BSセルへ入る全経路でこれを守ること:
  - BS ボタン → `isBsKeyBlocked()` で無効化する。
    BS列にいて FS列に数値が1つも無いとき／**FS列にいてその行のFSが空のとき**
  - ↑↓・矢印キー・セル直タップ → `requestNewBaseGl()` で先に基準高を決めさせる
- FS ボタンは `lastFilledFsRow() + 1` の行を選ぶ（行0はFSを持たないため行1以降に限定）
- **BS ボタンは押した時のフォーカス列で行き先が変わる**
  - FS列から押した → **同じ行の BS**（同一行のFSとBSは同じ移器点）
  - それ以外 → `lastFilledFsRow() + 1` の行の BS
- **BS列にフォーカスがある状態で BS を押した場合**は、その行へ移したうえで
  新しい基準高の選択を求める（`requestNewBaseGl`）。選ばずに閉じたら元のセルに戻る
- `.entry-top`（読み取り行＋AC）もキーパッドと同じ4列グリッドに乗せている。
  独自の列指定に戻すと AC だけ幅がずれるので変えないこと

### 上下移動（`moveRow`）の制限

- **FS列**: 下へは「FS入力済み最下段のすぐ一つ下」まで。空のままさらに下へは行かせない（`rejectInput()`）
- **BS列**: 移動先のFSが空で基準行でもないなら、移動せず基準点選択シートを開く。
  選ばずに閉じたら元のセルに留まる（`selected` を触らないので自動的にそうなる）

## 入力値の確認（音声読み上げは廃止）

音声合成は処理が遅れて連打に追いつかない。確認は**大きな文字＋OKボタン**で行う。
**打鍵ごと／離脱時の読み上げには戻さないこと。**

- テンキー打鍵 → `clickTone()` の打鍵音（ピッ）だけ
- 入力を始めると `OK` / `修正` が出て、**BS・FS が `disabled`** になる（`C` `⌫` `+/-` は有効）
- `OK` で確定し BS・FS が押せる。`修正` は値を消して入力し直す
- 「確認せず次へ」☑（`skipConfirm`）にすると確認を挟まず直接 BS・FS を押せる。
  保存しないので読み込み直すと未チェックに戻る
- 読み取り行の値は 40px・太字。小さくしないこと

## 測定情報は表示専用（2026-09-01）

作成日 / 作成時刻 / 現場名 / 作業名 の4欄は `updateMetaEditable()` が `disabled` にする。
変えられるのは次だけ。**欄を常時編集可能に戻さないこと。**

| 項目 | 変えられる場所 |
|---|---|
| 現場名（`meta.site`＝ファイル名） | 保存のダイアログ（`exportExcel`） |
| 作業名（`table.name`）/ 作成日 / 作成時刻 | 表追加・名称変更のダイアログ（`addTable` / `renameTable`） |

例外は新規現場の初期設定（ドロワーの `setup` モード）だけ。ここは4欄とも入力できる。
`date`/`time` は `readOnly` だとピッカーから変えられるので `disabled` を使う。

**画面上部の「既知点との誤差」バーと誤差モーダルは廃止済み**
（`updateClosureDisplay` / `openErrorModal` / `exportErrorCsv` / `exportErrorExcel` を削除）。
どの測点の誤差か分からない表示だったため。中身は表の `基準高`・`誤差mm` 列と
xlsx の「誤差一覧」シートに統合済み。**復活させないこと。**

## 保護（ロック）

`locked === true` で入力・移動を全部止める。ONになるのは
「前回の続き」／Excel・CSV読込／**別の表への切替（`switchTable`）**。
`ensureBasePoint()` は保護中に何もしないので、`toggleLock()` で**解除した時点**で呼んでいる。

## 基準点（必須フロー）

- 新規現場・表追加・表切替で行0に基準点が無ければ、`ensureBasePoint()` が
  基準点シートを **required モード**で開き、決まるまで閉じられない
  （`×` と「あとで設定する」を非表示、`closeBasePointSheet()` が案内を出して拒否）
- **行0の GL と測点名はどの経路からも編集不可**（`isBasePointCell()`）。
  行0は「登録済みの基準点から選ぶ」行で、**編集できるのは BS の数値だけ**
- 行0の GL セル／測点名セルをタップすると基準点選択シートが開く
- **読み取り行の測点名入力 `#activePoint` も塞ぐこと**（2026-09-01 に開いていた穴）。
  `updateReadout()` が行0と `locked` のとき `readOnly` にし、
  `commitPointName()` の先頭でも `locked` / `isBasePointCell()` を見て弾く。
  この欄は `input` で `rows[].point` を直接書き換えるので、ガードを外すと基準点名が壊れる

## 画面サイズへの追従

`applyUiScale()` が `document.body.style.zoom` で全体を拡大し、タブレットでも表示幅いっぱいに使う。

- 拡大率 = `min(画面幅/420, 画面高さ×0.5/パネル高さ, 2.4)`（パネルが画面の半分を超えない）
- 余った幅は `--app-max-width`（上限900px）で表とパネルを広げて使い切る
- `zoom` は `vh`/`vw` に効かないので `--app-vh` / `--app-vw` を配っている。
  **CSS に `100vh` / `100dvh` を直接書かないこと**
- `ResizeObserver` の再発火ループを避けるため `lastUiViewport` で実サイズ変化のみ処理する

## 横向きの2段組み

`(orientation: landscape) and (min-width: 900px)` で `.app` をグリッドにする。
**左＝現場情報・計算表切替・情報パネル / 右＝野帳表(上)＋テンキー(下)**。
テンキーは押しやすいよう必ず右下。**縦向きの見た目は変えていない。**

```
grid-template-areas:
  "summary table"   "switch  table"   "info    table"
  "info    pad"     "state   pad";
```

- `.side-stack { display: contents }` は縦横どちらでも有効。横向きでは
  `.entry-panel` と `.info-pane` がそのまま `.app` のグリッド項目になる
- `.entry-panel` は横向きだけ `position: static`。縦向きは下端 `fixed` のまま
- `info` を2行にまたがせて左カラムの残りを全部使う
- `applyUiScale()` の横向きの式は `min(画面高/(パネル高+300), 画面幅/980, 2.4)`。
  **拡大しすぎると表の行数が減る**ので表に300px残す
- **横向きではドロワー（アコーディオン）を使わない。** `placeDrawerContent()` が
  `#metaBar` `#drawerActions` `#pointEntry` `#pointList` を左カラムの `#slot*` へ**移動**する
  （複製しない。複製すると入力値の同期ずれが起きる）。`body.inline-panel` が付き、
  CSS が取っ手ボタンとドロワーを隠す
- **`openDrawer()` は必ず `placeDrawerContent(true)` で中身をドロワーへ戻してから開くこと。**
  `setup` / `base` / `register` はドロワー内の要素を使うため。`closeDrawer()` で戻す
- 情報パネルは 保存・読込 / 基準点 / 現在の状態 の3ブロック。
  「既知点との誤差」一覧は表の `基準高`・`誤差mm` 列に、
  「登録済み基準点」（表示専用）は `#pointList` に統合済み。**復活させないこと**
- **表とテンキーは同じ幅で右端に揃える**。`.table-wrap` / `.entry-top` / `.keypad` の3つに
  `max-width: var(--pad-max-width)` + `margin-left: auto` + `margin-right: 0`。
  横向きの右カラムも `var(--pad-max-width)` 固定で、余りは左の情報パネルが受け取る
- **表の列幅に `min(110px, 17%)` のような % 混じりの `min()` を使わないこと**。
  `table-layout: fixed` では幅指定ごと無視され全列が均等割りになる。必ず素の px（`52px`）で書く
- **最終行の下罫線は消さない**（表の終わりが分からなくなる）。消してよいのは最終列の右罫線だけ
- 測点名の右に `基準高` と `誤差mm` の2列がある（`refCell()` / `diffCell()`）。
  **`fields` には入れない**ので選択・列移動・キー入力の対象にならない。
  スマホでは出さない（`applyUiScale()` が `body.show-wide` を付け外しする）
- 展開行（▼）の `colSpan` は **`visibleColumnCount()`**＝いま見えている列数。
  **固定値にしないこと。** 5列しか出していないのに `colSpan=7` にすると
  ブラウザが幻の列を2つ作り、測点名列が縮んで表の右側に空欄ができる

## 動作確認

静的ファイルなので簡易サーバで開く。Bash でサーバを起動せず、
`.claude/launch.json` の設定 + preview ツールを使うこと。

Service Worker がキャッシュを返すため、変更が反映されないときは
`navigate` を `force: true` で呼ぶか、SW の登録解除＋`caches.delete()` をしてから再読込する。

## デプロイ

```bash
git add -A
git commit -m "コミットメッセージ（日本語可）"
git push origin main
```
