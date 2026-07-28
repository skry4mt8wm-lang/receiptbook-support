const { OUT, chromiumPath, assert, summary } = require("./lib");
const http=require("http"),fs=require("fs"),path=require("path");
const {chromium}=require("playwright");
const server=http.createServer((q,r)=>{r.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
  r.end(fs.readFileSync(path.join(__dirname,"..","gantt.html")));});
(async()=>{
  await new Promise(r=>server.listen(8080,r));
  const b=await chromium.launch({executablePath: chromiumPath()});
  const p=await b.newPage({viewport:{width:1500,height:700},timezoneId:"Asia/Tokyo"});
  const errs=[]; p.on("pageerror",e=>errs.push(String(e)));
  p.on("console",m=>{if(m.type()==="error")errs.push("console: "+m.text());});
  await p.goto("http://localhost:8080/"); await p.waitForSelector(".row");
  const today=await p.evaluate(()=>{const q=v=>String(v).padStart(2,"0");const d=new Date();
    return `${d.getFullYear()}-${q(d.getMonth()+1)}-${q(d.getDate())}`;});

  // --- 日表示：常に空きの段がある ---
  await p.click('#viewSeg button[data-view="day"]');
  const h0=await p.locator(".row").first().evaluate(e=>e.getBoundingClientRect().height);
  assert(h0>=32,"作業が無い行はそのまま空きマスとして使える (h="+Math.round(h0)+")");
  assert((await p.locator(".row").first().locator(".addhint").count())===1,
    "空き段に追加の目印が出る");

  // 継続案件を1件入れる
  await p.evaluate(t=>{const m=liveMembers()[0];
    state.tasks.push({id:"base",memberIds:[m.id],title:"A社 常駐プロジェクト",
      start:`${t}T09:00`,end:`${t}T18:00`,color:"#4F6AF0",note:"",deleted:false,updatedAt:Date.now()});
    changed();},today);
  const h1=await p.locator(".row").first().evaluate(e=>e.getBoundingClientRect().height);
  assert(h1>h0-1,"1件入れても空き段は残る (h="+Math.round(h1)+")");
  assert((await p.locator(".row").first().locator(".addhint").textContent()).includes("重ねて"),
    "目印が「重ねて追加できます」に変わる");

  // 空き段をクリック → 既存バーと同じ時間帯に重ねて追加できる
  const lanes=p.locator(".row").first().locator(".lanes");
  const box=await lanes.boundingBox();
  await p.mouse.click(box.x+box.width*0.45, box.y+box.height-8);   // 下段の空き
  await p.waitForSelector("#taskMask:not([hidden])");
  assert(true,"空き段のクリックで新規作成が開く");
  await p.fill("#fTitle","緊急トラブル対応");
  await p.fill("#fStart",`${today}T10:00`);
  await p.fill("#fEnd",`${today}T15:00`);
  await p.click("#taskSave");

  assert((await p.locator(".row").first().locator(".bar").count())===2,"同じ時間帯に2件が並ぶ");
  const tops=await p.locator(".row").first().locator(".bar").evaluateAll(
    els=>els.map(e=>e.style.top));
  assert(new Set(tops).size===2,"2件が別の段に置かれる ("+tops.join(",")+")");
  const h2=await p.locator(".row").first().evaluate(e=>e.getBoundingClientRect().height);
  assert(h2>h1,"重なると行が伸びる ("+Math.round(h1)+" → "+Math.round(h2)+")");
  assert((await p.locator(".row").first().locator(".lanesep").count())>=2,"段の区切り線が入る");

  // バーの上でダブルクリック → さらに重ねて追加
  await p.locator('.bar:has-text("A社 常駐プロジェクト")').dblclick();
  await p.waitForSelector("#taskMask:not([hidden])");
  assert((await p.inputValue("#fTitle"))==="","バーのダブルクリックは編集ではなく新規作成");
  await p.fill("#fTitle","月例会議");
  await p.fill("#fStart",`${today}T11:00`);
  await p.fill("#fEnd",`${today}T12:00`);
  await p.click("#taskSave");
  assert((await p.locator(".row").first().locator(".bar").count())===3,"3件目も重ねられる");
  const h3=await p.locator(".row").first().evaluate(e=>e.getBoundingClientRect().height);
  assert(h3>h2,"さらに行が伸びる ("+Math.round(h2)+" → "+Math.round(h3)+")");
  const lanesUsed=await p.locator(".row").first().locator(".bar").evaluateAll(
    els=>[...new Set(els.map(e=>e.style.top))].length);
  assert(lanesUsed===3,"3段に分かれる");

  // バーのシングルクリックは従来どおり編集
  await p.locator('.bar:has-text("月例会議")').click();
  await p.waitForSelector("#taskMask:not([hidden])",{timeout:5000});
  assert((await p.inputValue("#fTitle"))==="月例会議","シングルクリックは編集のまま");
  await p.click("#taskCancel");

  // --- 週表示：重なりが段組みで見え、ドリルダウンは維持 ---
  await p.click('#viewSeg button[data-view="week"]');
  const wTops=await p.locator(".row").first().locator(".bar").evaluateAll(
    els=>[...new Set(els.map(e=>e.style.top))].length);
  assert(wTops===3,"週表示でも3段で重なって見える");
  assert((await p.locator(".row").first().locator(".addhint").count())===0,
    "週表示では空き段を作らない（クリックは掘り下げのため）");

  // 週表示：バーのダブルクリックで重ねて追加（掘り下げない）
  await p.locator('.bar:has-text("A社 常駐プロジェクト")').first().dblclick();
  await p.waitForSelector("#taskMask:not([hidden])");
  assert((await p.inputValue("#fTitle"))==="","週表示でもダブルクリックで重ねて追加できる");
  await p.click("#taskCancel");
  await p.waitForTimeout(400);
  assert((await p.textContent("#viewSeg button.on"))==="週","ダブルクリックでは掘り下げない");

  // 週表示：空き部分のシングルクリックは掘り下げ（従来どおり）
  const wl=p.locator(".row").nth(2).locator(".lanes");
  const wb=await wl.boundingBox();
  await p.mouse.click(wb.x+wb.width*0.5, wb.y+wb.height/2);
  await p.waitForTimeout(400);
  assert((await p.textContent("#viewSeg button.on"))==="日","空き部分のクリックは日表示へ掘り下げる");

  await p.screenshot({path:OUT+"/overlap-day.png",clip:{x:0,y:0,width:1500,height:340}});
  summary();
  assert(errs.length===0,"JSエラーなし "+JSON.stringify(errs));
  await b.close(); server.close();
})();
