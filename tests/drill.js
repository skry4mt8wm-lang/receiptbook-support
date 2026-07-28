const { OUT, chromiumPath, assert, summary } = require("./lib");
const http=require("http"),fs=require("fs"),path=require("path");
const {chromium}=require("playwright");
const server=http.createServer((q,r)=>{r.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
  r.end(fs.readFileSync(path.join(__dirname,"..","gantt.html")));});
(async()=>{
  await new Promise(r=>server.listen(8083,r));
  const b=await chromium.launch({executablePath: chromiumPath()});
  const p=await b.newPage({viewport:{width:1500,height:700},timezoneId:"Asia/Tokyo"});
  const errs=[]; p.on("pageerror",e=>errs.push(String(e)));
  p.on("console",m=>{if(m.type()==="error")errs.push("console: "+m.text());});
  await p.goto("http://localhost:8083/"); await p.waitForSelector(".row");

  // 月表示の第3週あたりを、2人目の行でダブルクリック
  await p.click('#viewSeg button[data-view="month"]');
  const monthLabel=await p.textContent("#rangeLabel");
  const lanes=p.locator(".row").nth(1).locator(".lanes");
  const box=await lanes.boundingBox();
  await p.mouse.dblclick(box.x+box.width*0.45, box.y+box.height/2);
  await p.waitForTimeout(200);

  assert((await p.textContent("#viewSeg button.on"))==="週","月表示のダブルクリックで週表示になる");
  const weekLabel=await p.textContent("#rangeLabel");
  assert(weekLabel!==monthLabel&&/\d+\/\d+ 〜 \d+\/\d+/.test(weekLabel),"クリックした週が表示される ("+weekLabel+")");
  const anchor=await p.evaluate(()=>ui.anchor);
  assert(/^\d{4}-\d{2}-\d{2}T00:00$/.test(anchor),"その週の日付が起点になる ("+anchor+")");

  // 掘り下げた人の行が光る
  assert((await p.locator(".row.flash").count())===1,"クリックした人の行が強調される");
  const flashName=await p.locator(".row.flash .name").textContent();
  assert(flashName.includes("佐藤"),"強調されるのはクリックした人 ("+flashName.trim()+")");

  // 月表示ではシングルクリックで作業追加ダイアログが出ないこと
  await p.click('#viewSeg button[data-view="month"]');
  await p.locator(".row").first().locator(".lanes").click({position:{x:100,y:10}});
  await p.waitForTimeout(250);
  assert(await p.locator("#taskMask").isHidden(),"月表示のシングルクリックでは作業追加が開かない");

  // 週表示の日マスをクリック → 日表示
  await p.click('#viewSeg button[data-view="week"]');
  const wLanes=p.locator(".row").nth(2).locator(".lanes");
  const wbox=await wLanes.boundingBox();
  await p.mouse.click(wbox.x+wbox.width*(3.5/7), wbox.y+wbox.height/2);   // 週の4日目
  await p.waitForTimeout(200);
  assert((await p.textContent("#viewSeg button.on"))==="日","週表示のクリックで日表示になる");
  const dayLabel=await p.textContent("#rangeLabel");
  assert(/\d+\/\d+\/\d+/.test(dayLabel),"クリックした日が表示される ("+dayLabel+")");
  assert((await p.locator(".row.flash .name").textContent()).includes("鈴木"),
    "週→日でもクリックした人が強調される");
  assert(await p.locator("#taskMask").isHidden(),"週表示のクリックでは作業追加が開かない");

  // 日表示では従来どおり、クリックで新規作成
  await p.locator(".row").first().locator(".lanes").click({position:{x:400,y:10}});
  await p.waitForSelector("#taskMask:not([hidden])");
  assert(true,"日表示のクリックは作業の追加（従来どおり）");
  await p.click("#taskCancel");

  // 強調は一定時間で消える
  await p.waitForTimeout(2400);
  assert((await p.locator(".row.flash").count())===0,"強調はしばらくすると消える");

  // カーソルの見た目
  await p.click('#viewSeg button[data-view="week"]');
  const cur=await p.locator(".row").first().locator(".lanes").evaluate(e=>getComputedStyle(e).cursor);
  assert(cur==="zoom-in","週表示は掘り下げできるカーソルになる ("+cur+")");
  await p.click('#viewSeg button[data-view="day"]');
  const cur2=await p.locator(".row").first().locator(".lanes").evaluate(e=>getComputedStyle(e).cursor);
  assert(cur2==="crosshair","日表示は入力用のカーソルのまま ("+cur2+")");

  summary();
  assert(errs.length===0,"JSエラーなし "+JSON.stringify(errs));
  await b.close(); server.close();
})();
