const { OUT, chromiumPath, assert, summary } = require("./lib");
const http=require("http"),fs=require("fs"),path=require("path");
const {chromium}=require("playwright");
const SP = OUT;
const server=http.createServer((q,r)=>{r.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
  r.end(fs.readFileSync(path.join(__dirname, "..", "gantt.html")));});

(async()=>{
  await new Promise(r=>server.listen(8087,r));
  const b=await chromium.launch({executablePath: chromiumPath()});
  const p=await b.newPage({viewport:{width:1500,height:820},timezoneId:"Asia/Tokyo"});
  const errs=[]; p.on("pageerror",e=>errs.push(String(e)));
  p.on("console",m=>{if(m.type()==="error")errs.push("console: "+m.text());});
  await p.goto("http://localhost:8087/"); await p.waitForSelector(".row");

  // レーンは全ての表示で出る
  for(const v of ["day","week","month"]){
    await p.click(`#viewSeg button[data-view="${v}"]`);
    assert((await p.locator(".evlane").count())===1,`${v}表示に全体予定レーンが出る`);
  }
  assert((await p.locator(".evempty").count())===1,"予定が無いときは案内が出る");

  // 追加
  await p.click('#viewSeg button[data-view="month"]');
  await p.click("#nextBtn");          // 翌月に移動して、今後の予定として登録する
  await p.click("#addEventBtn");
  await p.waitForSelector("#eventMask:not([hidden])");
  const base=await p.evaluate(()=>{const d=currentRange().start;
    const q=v=>String(v).padStart(2,"0");
    return `${d.getFullYear()}-${q(d.getMonth()+1)}`;});
  await p.fill("#eTitle","北海道出張");
  await p.fill("#eStart",`${base}-03`);
  await p.fill("#eEnd",`${base}-14`);
  assert((await p.textContent("#eSpan")).includes("12日間"),"期間の日数が出る");
  await p.locator("#eMembers input").nth(0).check();
  await p.locator("#eMembers input").nth(1).check();
  assert((await p.textContent("#ePickCount"))==="2名","対象メンバー数が出る");
  await p.click("#eSave");
  assert((await p.locator(".evbar").count())===1,"レーンにバーが出る");
  assert((await p.locator(".evbar .t").first().textContent())==="北海道出張","内容が表示される");
  assert((await p.locator(".evbar .k").first().textContent())==="出張","幅のあるバーには種別バッジが出る");

  // 背景帯が全メンバー行に敷かれる
  const rows=await p.locator(".row").count();
  assert((await p.locator(".row .evband").count())===rows,"全メンバー行に背景帯が敷かれる ("+rows+"行)");

  // 種別を変えて2件目・3件目
  const mk=async(title,kind,s,e,members)=>{
    await p.click("#addEventBtn");
    await p.waitForSelector("#eventMask:not([hidden])");
    await p.fill("#eTitle",title);
    await p.locator("#eKinds button",{hasText:kind}).click();
    await p.fill("#eStart",s); await p.fill("#eEnd",e);
    for(const i of members) await p.locator("#eMembers input").nth(i).check();
    await p.click("#eSave");
  };
  await mk("新人訓練","訓練",`${base}-09`,`${base}-27`,[2]);
  await mk("本部長来訪","来訪",`${base}-12`,`${base}-12`,[]);
  assert((await p.locator(".evbar").count())===3,"3件の全体予定が並ぶ");
  const tops=await p.locator(".evbar").evaluateAll(els=>[...new Set(els.map(e=>e.style.top))]);
  assert(tops.length>=2,"重なる予定が段組みになる ("+tops.join(",")+")");
  const one=p.locator('.evbar:has-text("本部長来訪")');
  const oneDay=await one.evaluate(el=>el.getBoundingClientRect().width);
  assert(oneDay>=8,"1日だけの予定も潰れずに見える (w="+Math.round(oneDay)+")");
  assert((await one.locator(".k").count())===0,"細いバーでは種別バッジを省く");
  assert((await one.locator(".t").textContent())==="本部長来訪","細いバーでも内容を表示する");

  // 対象未選択は「全員向け」
  await p.locator('.evbar:has-text("本部長来訪")').click();
  await p.waitForSelector("#eventMask:not([hidden])");
  assert((await p.textContent("#ePickCount"))==="全員向け","対象未選択は全員向けと出る");
  await p.click("#eCancel");

  // 今後の全体予定一覧（月表示）
  assert(!(await p.locator("#evlist").isHidden()),"月表示に今後の全体予定が出る");
  assert((await p.locator(".evul li").count())===3,"一覧に3件並ぶ");
  const first=await p.locator(".evul li").first().textContent();
  assert(/日間/.test(first)&&/(あと\d+日|進行中)/.test(first),"日数と残り日数が出る ("+first.replace(/\s+/g," ").slice(0,50)+")");
  await p.click('#viewSeg button[data-view="week"]');
  assert(await p.locator("#evlist").isHidden(),"週表示では一覧を出さない");
  await p.click('#viewSeg button[data-view="month"]');

  // 一覧クリックで編集
  await p.locator(".evul li").first().click();
  await p.waitForSelector("#eventMask:not([hidden])");
  assert((await p.inputValue("#eTitle")).length>0,"一覧クリックで編集できる");
  await p.click("#eCancel");

  // 編集と削除
  await p.locator('.evbar:has-text("新人訓練")').click();
  await p.waitForSelector("#eventMask:not([hidden])");
  await p.fill("#eTitle","新人訓練（延長）");
  await p.click("#eSave");
  assert((await p.locator('.evbar:has-text("新人訓練（延長）")').count())===1,"編集が反映される");
  p.on("dialog",d=>d.accept());
  await p.locator('.evbar:has-text("新人訓練（延長）")').click();
  await p.waitForSelector("#eventMask:not([hidden])");
  await p.click("#eDelete");
  await p.waitForTimeout(200);
  assert((await p.locator(".evbar").count())===2,"削除できる");

  // 検証：終了日 < 開始日
  await p.click("#addEventBtn");
  await p.waitForSelector("#eventMask:not([hidden])");
  await p.fill("#eTitle","逆転");
  await p.fill("#eEnd",`${base}-02`);
  await p.fill("#eStart",`${base}-20`);
  await p.fill("#eEnd",`${base}-02`);
  await p.click("#eSave");
  assert((await p.textContent("#eventErr")).includes("終了日"),"終了日が前ならエラー");
  await p.click("#eCancel");

  // 同期対象・再起動後の復元・旧データ互換
  const inJson=await p.evaluate(()=>purge(JSON.parse(JSON.stringify(state))).events.filter(e=>!e.deleted).length);
  assert(inJson===2,"全体予定が同期対象に入る");
  await p.reload(); await p.waitForSelector(".evlane");
  assert((await p.locator(".evbar").count())===2,"再起動後も残る");
  assert((await p.locator(".evul li").count())===2,"再起動後も一覧に残る");
  assert(await p.evaluate(()=>Array.isArray(normalize({version:1,members:[],tasks:[]}).events)),
    "全体予定を持たない旧JSONも読める");

  await p.screenshot({path:SP+"/event-month.png"});
  await p.click('#viewSeg button[data-view="week"]');
  await p.screenshot({path:SP+"/event-week.png",clip:{x:0,y:0,width:1500,height:300}});
  assert(errs.length===0,"JSエラーなし "+JSON.stringify(errs));
  summary();
  await b.close(); server.close();
})();
