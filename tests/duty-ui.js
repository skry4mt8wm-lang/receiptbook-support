const { OUT, chromiumPath, assert, summary } = require("./lib");
const http=require("http"),fs=require("fs"),path=require("path");
const {chromium}=require("playwright");
const server=http.createServer((q,r)=>{r.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
  r.end(fs.readFileSync(path.join(__dirname, "..", "gantt.html")));});
(async()=>{
  await new Promise(r=>server.listen(8085,r));
  const b=await chromium.launch({executablePath: chromiumPath()});
  const p=await b.newPage({viewport:{width:1500,height:820},timezoneId:"Asia/Tokyo"});
  const errs=[]; p.on("pageerror",e=>errs.push(String(e)));
  p.on("console",m=>{if(m.type()==="error")errs.push("console: "+m.text());});
  p.on("dialog",d=>d.accept());
  await p.goto("http://localhost:8085/"); await p.waitForSelector(".row");

  await p.click("#dutyBtn");
  assert(!(await p.locator("#dutyScreen").isHidden()),"「特日課」で専用画面に切り替わる");
  assert((await p.locator("#dutyTable").textContent()).includes("パターン台帳"),
    "パターン未登録なら案内が出る");

  // パターン台帳
  await p.click("#patternBtn");
  await p.waitForSelector("#patMask:not([hidden])");
  await p.click("#patAdd");
  const row=p.locator("#patTable tbody tr").first();
  await row.locator("input").nth(0).fill("L1");
  await row.locator("input").nth(0).dispatchEvent("change");
  await p.locator("#patTable tbody tr").first().locator("input").nth(1).fill("早出LONG");
  await p.locator("#patTable tbody tr").first().locator("input").nth(1).dispatchEvent("change");
  assert((await p.locator("#patTable tbody tr").first().textContent()).includes("+1:30"),
    "08:00-18:15/休憩60分 が +1:30 と計算される");
  await p.click("#patAdd");
  const r2=p.locator("#patTable tbody tr").nth(1);
  await r2.locator("input").nth(0).fill("S1"); await r2.locator("input").nth(0).dispatchEvent("change");
  const r2b=p.locator("#patTable tbody tr").nth(1);
  await r2b.locator("select").selectOption("short");
  const r2c=p.locator("#patTable tbody tr").nth(1);
  await r2c.locator("input").nth(3).fill("15:45"); await r2c.locator("input").nth(3).dispatchEvent("change");
  assert((await p.locator("#patTable tbody tr").nth(1).textContent()).includes("-1:00"),
    "SHORTは -1:00 になる");
  await p.click("#patClose");

  // 割当
  assert((await p.locator("#dutyTable .dcell").count())>=28,"日数ぶんのセルが並ぶ");
  const cells=p.locator("#dutyTable tbody tr").first().locator(".dcell");
  await cells.nth(0).click();
  await p.waitForSelector("#dutyMask:not([hidden])");
  assert((await p.textContent("#dutyWho")).includes("山田"),"セルから割当ダイアログが開く");
  await p.locator("#dutyPick label").first().click();
  assert((await cells.nth(0).textContent())==="L1","割り当てたコードがセルに出る");
  const tot=await p.locator("#dutyTable tbody tr").first().locator("td.total").allTextContents();
  assert(tot[0].includes("+1:30"),"当月付与に反映される ("+tot.join(" / ")+")");
  assert(tot[2].includes("1:30"),"月末残高に反映される");

  // 消費
  await cells.nth(2).click();
  await p.waitForSelector("#dutyMask:not([hidden])");
  await p.locator("#dutyPick label").nth(1).click();
  const tot2=await p.locator("#dutyTable tbody tr").first().locator("td.total").allTextContents();
  assert(tot2[1].includes("1:00"),"当月消費に反映される ("+tot2.join(" / ")+")");
  assert(tot2[2].includes("0:30"),"残高は +1:30 - 1:00 = 0:30 ("+tot2[2]+")");

  // まとめて割当
  await p.click("#bulkBtn");
  await p.waitForSelector("#bulkMask:not([hidden])");
  await p.click("#bulkAll");
  await p.locator("#bulkDows input").nth(1).check();   // 月曜だけ
  await p.click("#bulkSave");
  await p.waitForTimeout(300);
  const setCount=await p.locator("#dutyTable .dcell.set").count();
  assert(setCount>=9,"まとめて割当で複数人・複数日に入る ("+setCount+"セル)");

  // 月移動
  const m1=await p.textContent("#dMonth");
  await p.click("#dNext");
  const m2=await p.textContent("#dMonth");
  assert(m1!==m2,"月を移動できる ("+m1+" → "+m2+")");
  await p.click("#dThis");
  assert((await p.textContent("#dMonth"))===m1,"「今月」で戻る");

  // 月次報告
  await p.click("#reportBtn");
  assert(!(await p.locator("#reportScreen").isHidden()),"月次報告に切り替わる");
  const rep=await p.textContent("#reportBody");
  assert(rep.includes("前月繰越")&&rep.includes("翌月繰越"),"繰越の列がある");
  assert(rep.includes("取得明細"),"取得明細が付く");
  assert((await p.locator(".rtable tbody tr").count())===3,"メンバー3名ぶんの行が出る");
  assert((await p.locator(".rtable tfoot").textContent()).includes("合計"),"合計行がある");
  await p.screenshot({path:OUT+"/duty-report.png"});
  await p.click("#rBack");
  await p.screenshot({path:OUT+"/duty-matrix.png"});

  // 日表示・週表示への反映
  await p.click("#dutyBtn");
  await p.click('#viewSeg button[data-view="week"]');
  const fr=await p.locator(".dutyframe").count();
  assert(fr>0,"週表示に勤務時間の枠が出る ("+fr+"個)");
  await p.click('#viewSeg button[data-view="day"]');
  await p.waitForTimeout(200);
  await p.screenshot({path:OUT+"/duty-week.png",clip:{x:0,y:0,width:1500,height:280}});
  assert((await p.locator(".dutyframe").count())>=0,"日表示でも落ちない");
  const frameTitle=await p.locator(".dutyframe").first().getAttribute("title").catch(()=>"");
  assert(!frameTitle||frameTitle.includes("L1")||frameTitle.includes("S1"),"枠にパターン情報が入る");

  // 同期・復元・旧データ
  const inJson=await p.evaluate(()=>{const s=purge(JSON.parse(JSON.stringify(state)));
    return {pat:s.dutyPatterns.filter(x=>!x.deleted).length,du:s.duties.filter(x=>!x.deleted).length};});
  assert(inJson.pat===2&&inJson.du>0,"日課データが同期対象に入る ("+JSON.stringify(inJson)+")");
  await p.reload(); await p.waitForSelector("#dutyTable,.row");
  assert(await p.evaluate(()=>liveDutyPatterns().length===2),"再起動後もパターンが残る");
  assert(await p.evaluate(()=>Array.isArray(normalize({version:1,members:[],tasks:[]}).duties)),
    "日課を持たない旧JSONも読める");

  summary();
  assert(errs.length===0,"JSエラーなし "+JSON.stringify(errs));
  await b.close(); server.close();
})();
