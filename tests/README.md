# テスト

`gantt.html` を実ブラウザ（Chromium）で操作して検証します。
このアプリは単一HTMLなので、テストもビルド不要で動きます。

## 準備

```
npm install playwright
```

Claude Code の実行環境では Chromium が `/opt/pw-browsers` に用意済みです
（`playwright install` は不要）。別環境の場合は `CHROMIUM_PATH` 環境変数で
実行ファイルを指定できます。

## 実行

```
node tests/run-all.js        # すべて実行して合計を表示
node tests/test.js           # 個別に実行
```

## 各ファイル

| ファイル | 内容 |
|---|---|
| `test.js` | 基本機能。表示切替、作業の追加・編集、マージ、複数人アサイン、Z TIME、週の作業一覧、設定画面、同期フォルダ指定 |
| `layout.js` | 画面サイズ別の高さ配分（チャートと一覧の取り合い） |
| `cert.js` | 資格の期限管理。マトリクス、色分け、相互補完の警告、期限の直接入力と「更新した」ボタン |
| `event.js` | 全体予定。レーン、段組み、背景帯、今後の一覧 |
| `twopc.js` | 2台のPCが同じ共有ファイルを読み書きする同期（実ファイルを使用） |
| `stress.js` | 3台が同時に連続入力したときに全員へ収束するか |
| `lib.js` | 共通処理（Chromiumの場所、簡易サーバー、assert） |

`twopc.js` と `stress.js` は File System Access API のハンドルを
偽物に差し替えて、実際のファイルを読み書きします。

## 注意

- スクリーンショットなどの出力は `tests/out/`（gitignore 済み）に入ります。
- テストはブラウザのタイムゾーンを `Asia/Tokyo` に固定しています。
- 日付に依存するテストがあるため、**未来の日付**でデータを作っています。
  過去日で作ると「今後の全体予定」などが空になり失敗します。
