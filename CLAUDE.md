# CLAUDE.md

このファイルは Claude Code (claude.ai/code) がこのリポジトリで作業する際の指針です。

## プロジェクト概要

**レベル野帳 (LEVEL)**
水準測量の野帳（器高式）をスマホで記録・計算するオフライン動作可能なPWA。

- リモート: https://github.com/kkodin/LEVEL.git (branch: `main`)
- **作業リポジトリ（ここでコミット・push する）**: `C:\Users\mande\開発\LEVEL`
- **バージョン保管庫（Dropbox・git管理外）**: `C:\Users\mande\Dropbox\Documents\GITHUB\LEVEL\`

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

1. 作業リポジトリ `C:\Users\mande\開発\LEVEL` で改修する
2. ブラウザで動作確認する
3. ユーザーに確認する
4. **ユーザーが明示的に「pushして」と言った時だけ** commit / `git push origin main` する
5. 直下にある既存の `LEVEL_vrNNN` を `OLD\` へ移動する
6. `LEVEL_vr(NNN+1)\` を直下に新規作成し、作業リポジトリの `.git` を除く全ファイルをコピーする
7. スナップショットに `VERSION.txt` を置き、対応コミットハッシュと変更概要を記録する

### 版番号

`LEVEL_vr000` から連番。最新は `LEVEL_vr001`（コミット `ecaed8e`）。

### Dropbox 内で git 操作をしないこと

`C:\Users\mande\Dropbox\Documents\GITHUB\LEVEL` 直下は**バージョン保管庫専用**。
ここに `.git` を置くと Dropbox の同期が `.git` 内のファイルを掴んで
`index.lock` 競合・競合コピーの混入・リポジトリ破損を招くため、
git 操作は必ず `C:\Users\mande\開発\LEVEL` で行う。

## ファイル構成

| ファイル | 役割 |
|---------|------|
| `index.html` | 全画面のマークアップ（表・入力パネル・各シート） |
| `app.js` | 全ロジック（約2300行・単一ファイル、モジュールではなくグローバル関数） |
| `styles.css` | 全スタイル |
| `service-worker.js` | オフラインキャッシュ |
| `manifest.json` | PWA設定 |
| `icon-180.png` / `icon.svg` | アプリアイコン（「Level / 野帳」2行デザイン） |

`app.js` は `<script src="app.js">`（非module）なので、関数はすべてグローバル。
ブラウザのコンソールから直接呼んで検証できる。

## Service Worker の更新（必須）

ファイルを変更したら必ず `service-worker.js` 先頭のキャッシュ名を上げること。

```javascript
const CACHE_NAME = "level-book-vr0008";  // 番号を上げる
```

上げないとユーザーのブラウザに古いキャッシュが残り続ける。

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

`rows` の1行: `{ bs, ih, fs, gl, point, isBase }`。
`ih` と `gl`（行1以降）は `calculate()` が算出する計算列。
`isBase` は「GL が計算結果ではなく置き直した基準高」の印で、その行から器高を計算し直す。

**FS を消したら、その FS から求めた GL・IH も消える**（非基準行は `next.gl = ""`）。
古い GL が残って誤った器高を出し続けないための処理なので、外さないこと。

## 数値の扱い

- 表示・保存とも **小数点3桁固定**（`fmt` / `fmtInput` が `toFixed(3)`）
- 入力時、小数点以下4桁目は受け付けない（`appendKey` の `decimalsOf(buffer) >= DECIMALS`）
- 弾いたときは `rejectInput()` が画面点滅（`body.input-reject`）＋ブザー＋振動で知らせる
- 編集中のセルだけは入力途中の値をそのまま表示する（`cellDisplay`）

## 入力パネル（キーパッド）

```
[ 読み取り行 (GL/BS/FS・測点名・値) ]  [ AC ]
[ 7 ] [ 8 ] [ 9 ]                      [ C   ]
[ 4 ] [ 5 ] [ 6 ]                      [ ⌫   ]
[ 1 ] [ 2 ] [ 3 ]                      [ +/- ]
[ 0 ] [ . ] [ ↑ ]                      [ ↓   ]   ← 0 と . は縦2行ぶん
[   ] [   ] [ BS]                      [ FS  ]
```

- 確定ボタンは廃止済み。測点名は**測点名セルをタップ**して選択シートから入れる
- `←` `→`（列移動）も廃止。物理キーボードの矢印/Tabのみ
- BS/FS ボタンは `lastFilledFsRow() + 1` の行を選ぶ
  （FSは行1以降に限定。行0はFSを持たないため）

### 上下移動（`moveRow`）の制限

- **FS列**: 下へは「FS入力済み最下段のすぐ一つ下」まで。空のままさらに下へは行かせない（`rejectInput()`）
- **BS列**: 移動先のFSが空で基準行でもないなら、移動せず基準点選択シートを開く。
  選ばずに閉じたら元のセルに留まる（`selected` を触らないので自動的にそうなる）

## 音声フィードバック

打鍵ごとに `speechSynthesis` を呼ぶとスマホのTTS起動待ちで連打に追いつかない。
そのため次の方式にしてある。**打鍵ごとの読み上げに戻さないこと。**

| タイミング | 動作 |
|---|---|
| キータップ | `clickTone()` — Web Audio の打鍵音（ピッ）だけ。読み上げはしない |
| セルを離れる操作の**1回目** | `confirmLeaveCell()` が値を読み上げて**移動を止める** |
| セルを離れる操作の**2回目** | 聞いて問題なしと判断し、読み上げずに移動する |

離脱操作は BS/FS ボタン・↑↓・セルタップ・矢印/Tab の全経路。
`confirmLeaveCell()` はその4経路の先頭に置いてあり、`false` を返したら呼び出し側が即 `return` する。

自分で打ち込んだ数値セル（`entryDirty`）だけを確認対象にする。触っていないセル・
測点名・行0の基準点セルは素通り。打ち直すと `resetLeaveConfirm()` が確認待ちを解除するので、
訂正後はもう一度読み上げから始まる。

`warmUpSpeech()` が初回打鍵で無音の空読みをしてTTSを暖める。

## 基準点（必須フロー）

- 新規現場・表追加・表切替で行0に基準点が無ければ、`ensureBasePoint()` が
  基準点シートを **required モード**で開き、決まるまで閉じられない
  （`×` と「あとで設定する」を非表示、`closeBasePointSheet()` が案内を出して拒否）
- **行0の GL と測点名はキーパッドから編集不可**（`isBasePointCell()`）
- 行0の GL セル／測点名セルをタップすると基準点選択シートが開く

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
