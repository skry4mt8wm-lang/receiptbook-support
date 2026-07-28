/* すべてのテストを順番に実行して結果をまとめる。
   使い方:  node tests/run-all.js  */
const { spawnSync } = require("child_process");
const path = require("path");

const SUITES = [
  ["test.js",   "基本機能（表示・作業・同期・複数人アサイン・Z TIME・週一覧）"],
  ["layout.js", "画面レイアウト（画面サイズ別の高さ配分）"],
  ["cert.js",   "資格の期限管理（マトリクス・相互補完の警告・更新）"],
  ["event.js",  "全体予定（レーン・背景帯・今後の一覧）"],
  ["twopc.js",  "2台のPCが同じ共有ファイルを使う同期"],
  ["stress.js", "3台が同時入力したときの収束"],
];

let total = 0, failed = 0;
for(const [file, desc] of SUITES){
  console.log(`\n===== ${file} — ${desc} =====`);
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding:"utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  process.stdout.write(out);
  const ok = (out.match(/^ok  - /gm) || []).length;
  const ng = (out.match(/^FAIL: /gm) || []).length;
  total += ok; failed += ng;
  if(r.status !== 0 && ng === 0){
    console.log(`(${file} は途中で終了しました)`);
    failed++;
  }
}
console.log(`\n========================================`);
console.log(`合計 ${total} 項目パス / 失敗 ${failed} 件`);
process.exitCode = failed ? 1 : 0;
