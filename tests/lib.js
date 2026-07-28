/* テスト共通の下ごしらえ。
   Chromium の場所やポートは環境で変わるため、ここで吸収する。 */
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");

/** Playwright が使う Chromium を探す（環境ごとにバージョン番号が変わる） */
function chromiumPath(){
  if(process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  try{
    const dir = fs.readdirSync(base).find(d => /^chromium-\d+$/.test(d));
    if(dir){
      for(const p of ["chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]){
        const full = path.join(base, dir, p);
        if(fs.existsSync(full)) return full;
      }
    }
  }catch(e){ /* 見つからなければ Playwright の既定に任せる */ }
  return undefined;
}

/** gantt.html を配信する簡易サーバー（file:// では同期機能が試せないため） */
function serve(port){
  const server = http.createServer((req, res) => {
    const name = (req.url === "/" ? "/gantt.html" : req.url.split("?")[0]).replace(/^\//, "");
    fs.readFile(path.join(ROOT, name), (e, d) => {
      if(e){ res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, { "Content-Type":"text/html; charset=utf-8" });
      res.end(d);
    });
  });
  return new Promise(r => server.listen(port, () => r(server)));
}

let failed = 0, passed = 0;
const assert = (cond, msg) => {
  if(cond){ passed++; console.log("ok  - " + msg); }
  else { failed++; process.exitCode = 1; console.log("FAIL: " + msg); }
};
const summary = () => console.log(`\n${passed} passed, ${failed} failed`);

fs.mkdirSync(OUT, { recursive: true });

module.exports = { ROOT, OUT, chromiumPath, serve, assert, summary };
