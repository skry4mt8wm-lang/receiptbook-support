# CLAUDE.md

このリポジトリで作業するときの前提と約束事。

## このリポジトリの中身

| ファイル | 役割 |
|---|---|
| `gantt.html` | **本体。これが製品そのもの**。単一HTMLファイルで完結 |
| `GANTT-README.md` | 利用者向けの説明書（日本語） |
| `tests/` | Playwright による実ブラウザテスト（268項目） |
| `index.html` | 無関係な別プロジェクト（ReceiptBook のサポートページ）。触らない |

## 何を作っているか

Windows PC のブラウザで動く**チームスケジュール管理アプリ**。
利用者は日本語話者で、IT に詳しいとは限らない現場のチーム（数十人規模、複数拠点）。

主な機能:

- ガントチャート（縦=メンバー、横=日/週/月）で各人の作業を管理
- 1件の作業に**複数名をまとめてアサイン**（担当者全員の行に同じバーを表示）
- 時間軸に **I TIME（ローカル）と Z TIME（UTC）を併記**
- 週表示では、下部に作業内容の文字一覧
- **全体予定**（長期出張・訓練・来訪）を全表示の最上部レーン＋背景帯で表示
- **資格の期限管理**（年1回更新）。属人化・期限集中の警告つき
- **特別の日課**（7時間45分の超過分を貯めて消費。8週間で失効）と月次報告
- **共有フォルダ経由で約5秒ごとに全員と同期**（サーバー不要）

## 絶対に守ること

### 1. 単一HTMLファイルを維持する

`gantt.html` は**1ファイルで完結**していなければならない。

- 外部URLの読み込み禁止（CDN、フォント、画像すべて）
- ビルド工程を作らない。ダブルクリックで動くこと
- npm パッケージをアプリ側に入れない（テストは別）

利用者はこのファイルをメール添付やUSBで配り、オフラインPCで使う。
確認: `grep -c "https\?://" gantt.html` が 0 であること。

### 2. 同期データの後方互換を壊さない

利用者は既にデータを持っている。`normalize()` は**古い形式を必ず読めること**。

- 過去の変更例: `memberId`（単一）→ `memberIds`（配列）に移行したときも旧形式を変換して読めるようにした
- 新しい配列を `state` に足すときは、`normalize` / `mergeState` / `purge` の3箇所すべてに追加する
- `liveXxx()` アクセサは `(state.xxx || [])` と書く。旧データで落ちないように

### 3. 同期の競合でデータを消さない

複数PCが同じJSONを読み書きするため、素朴に書くと**後から保存した人が相手の入力を消す**。
実際にこのバグを出したことがある。仕組みは3段構え:

1. 保存前に必ず共有ファイルを読み直してマージ（`saveToFile`）
2. 読み込み後、手元にしかないデータがあれば自動で書き戻す（`needsPush`）
3. 自動保存の時刻を各PCで少しずらす（`scheduleAutoSave`）

同期まわりを変更したら **必ず `tests/twopc.js` と `tests/stress.js` を実行**すること。

### 4. 日本語で書く

UI・コメント・ドキュメント・コミットメッセージの本文はすべて日本語。
コミットの1行目のみ英語。

## データモデル

`state` は同期される。`ui` はそのPC専用（同期されない）。

```
state = {
  version, 
  members[]   { id, name, order, deleted, updatedAt }
  tasks[]     { id, memberIds[], title, start, end, color, note, deleted, updatedAt }
  certTypes[] { id, name, order, deleted, updatedAt }
  certs[]     { id, memberId, typeId, expiry, lastRenewed, note, deleted, updatedAt }
  events[]    { id, title, kind, start, end, memberIds[], note, deleted, updatedAt }
  dutyPatterns[] { id, code, name, kind, start, end, breakMin, order, deleted, updatedAt }
  duties[]    { id, memberId, date, patternId, note, deleted, updatedAt }
}
ui = { view, anchor, showList, meId, fileName, screen, dutyMonth }
```

- マージは **id ごとに updatedAt が新しい方が勝つ**（last-write-wins）
- 削除は `deleted:true` の墓標を残す（30日保持。`TOMBSTONE_KEEP_MS`）
- `tasks` は時刻まで（`YYYY-MM-DDTHH:MM`）、`certs`/`events` は日付のみ（`YYYY-MM-DD`）
- `events.end` は**その日を含む**（描画時に翌日0時へ変換）

### 特別の日課の計算

- 基準は `BASE_MIN`（7時間45分＝465分）。パターンの実働との差が増減になる
- 貯めた分は `DUTY_EXPIRE_DAYS`（8週間＝56日）で失効。**古い分から先に消費**する
- 計算は `dutyLedger()` に集約。残高・失効・不足をここで出す
- 勤務枠は**タスクとして保存しない**。`paintDutyFrames()` が毎回描く
- **PDFからパターンを取り込む予定**。台帳の項目はその受け皿

## テスト

```
npm install playwright     # 初回のみ
node tests/run-all.js      # 268項目
```

変更したら関連するテストを実行し、**新しい機能にはテストを足す**。
詳細は `tests/README.md`。

日付に依存するテストは**未来の日付**で書くこと。過去日で作ると
「今後の全体予定」などが空になり、原因が分かりにくい失敗になる。

## 作業の進め方

- 利用者は実機（Windows + Edge/Chrome）で確認する。
  ファイル選択ダイアログなど**この環境では検証できない部分がある**ことを伝える
- 画面を変えたらスクリーンショットを撮って確認する（Playwright で撮れる）
- 実装後は `gantt.html` を利用者に送る（SendUserFile）

## 未検証・既知の制約

- **実機での動作確認が未了**。特に「⚙ 設定 → 同期フォルダを選ぶ」が
  Windows の共有フォルダで動くか（`showDirectoryPicker`）は利用者の確認待ち
- `file://` で開いた場合に File System Access API が使えるかは環境依存。
  この環境の Chromium では API は存在しブロックもされなかったが、実機未確認
- 同期には Edge / Chrome が必要（Firefox は同期以外なら動く）
