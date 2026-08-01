const { OUT, chromiumPath, assert, summary } = require("./lib");
const http=require("http"),fs=require("fs"),path=require("path");
const {chromium}=require("playwright");
const server=http.createServer((q,r)=>{r.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
  r.end(fs.readFileSync(path.join(__dirname,"..","gantt.html")));});
(async()=>{
  await new Promise(r=>server.listen(8079,r));
  const b=await chromium.launch({executablePath: chromiumPath()});
  const p=await b.newPage({viewport:{width:1500,height:900},timezoneId:"Asia/Tokyo"});
  const errs=[]; p.on("pageerror",e=>errs.push(String(e)));
  p.on("console",m=>{if(m.type()==="error")errs.push("console: "+m.text());});
  p.on("dialog",d=>d.accept());
  await p.goto("http://localhost:8079/"); await p.waitForSelector(".row");

  // 階級つきのメンバーと、記号つきのパターン・割当を用意
  await p.evaluate(()=>{
    state.members=[
      {id:"m1",name:"南目 晃宏",rank:"2佐",order:0,deleted:false,updatedAt:1},
      {id:"m2",name:"中田 信吾",rank:"2佐",order:1,deleted:false,updatedAt:1},
      {id:"m3",name:"横山 幸司",rank:"3佐",order:2,deleted:false,updatedAt:1},
    ];
    state.dutyPatterns=[
      {id:"p1",code:"Dg3",name:"日勤",kind:"long", start:"08:15",end:"18:15",breakMin:60,order:0,deleted:false,updatedAt:1},
      {id:"p2",code:"(6)i1",name:"警衛",kind:"short",start:"08:15",end:"16:30",breakMin:60,order:1,deleted:false,updatedAt:1},
      {id:"p3",code:"⑤k2",name:"其番",kind:"normal",start:"08:15",end:"16:30",breakMin:30,order:2,deleted:false,updatedAt:1},
    ];
    ui.dutyMonth="2026-07"; ui.screen="report";
    state.duties=[
      {id:"d1",memberId:"m1",date:"2026-07-22",patternId:"p1",note:"",deleted:false,updatedAt:1},
      {id:"d2",memberId:"m2",date:"2026-07-06",patternId:"p2",note:"",deleted:false,updatedAt:1},
      {id:"d3",memberId:"m3",date:"2026-07-09",patternId:"p3",note:"",deleted:false,updatedAt:1},
    ];
    changed();
  });

  assert(!(await p.locator("#reportScreen").isHidden()),"月次報告が表示される");
  assert((await p.textContent(".fm-title")).includes("特別の日課指定・勤務計画表"),"表題が出る");
  assert((await p.textContent(".fm-title")).includes("令和8年7月"),
    "西暦2026年7月が令和8年7月になる ("+(await p.textContent(".fm-title")).replace(/\s+/g," ").trim()+")");
  assert((await p.textContent(".fm-title")).includes("部隊名"),"部隊名の欄がある");

  // 縦=人、横=日にち
  const cols=await p.locator(".fmtable thead tr").first().locator("th").count();
  assert(cols===2+31,"7月なので 階級・氏名＋31日で33列 ("+cols+")");
  const rows=await p.locator(".fmtable tbody tr").count();
  assert(rows===3,"メンバー3名ぶんの行");
  const first=await p.locator(".fmtable tbody tr").first();
  assert((await first.locator("td.rk").textContent())==="2佐","階級が出る");
  assert((await first.locator("td.nm").textContent())==="南目 晃宏","氏名が出る");

  // マスに記号
  const c22=await first.locator("td").nth(2+21).textContent();     // 7/22
  assert(c22==="Dg3","割り当てた記号がマスに出る ("+c22+")");
  const r2=p.locator(".fmtable tbody tr").nth(1);
  assert((await r2.locator("td").nth(2+5).textContent())==="(6)i1","括弧つきの記号もそのまま出る");
  const r3=p.locator(".fmtable tbody tr").nth(2);
  assert((await r3.locator("td").nth(2+8).textContent())==="⑤k2","丸数字の記号もそのまま出る");
  assert((await first.locator("td").nth(2+0).textContent())==="","割当が無いマスは空欄");

  // 曜日と土日の色
  const wd=await p.locator(".fmtable thead tr").nth(1).locator("th").nth(2).textContent();
  assert(wd==="水","2026年7月1日は水曜");
  const sunCount=await p.locator(".fmtable thead tr").first().locator("th.sun").count();
  assert(sunCount===4,"7月の日曜は4日ぶん赤くなる ("+sunCount+")");

  // 帳票の設定
  await p.click("#fmBtn");
  await p.waitForSelector("#fmMask:not([hidden])");
  await p.fill("#fmUnit","第４０５飛行隊");
  await p.fill("#fmHeaderUnit","第４０５飛行隊");
  await p.fill("#fmDoc","第４０２飛行隊長");
  await p.fill("#fmKeep","5年");
  await p.fill("#fmUntil","2032.3.31");
  await p.fill("#fmSheets","3枚");
  await p.fill("#fmDist","総括班 1箇所");
  await p.fill("#fmLegend","1 勤務期間\n2 警：警衛勤務（0815〜0815）");
  await p.click("#fmSave");
  assert((await p.textContent(".fm-title")).includes("第４０５飛行隊"),"部隊名が反映される");
  assert((await p.textContent(".fm-unit"))==="第４０５飛行隊","右上の隊名が出る");
  assert((await p.textContent(".fm-meta")).includes("第４０２飛行隊長"),"文書管理者が出る");
  assert((await p.textContent(".fm-meta")).includes("2032.3.31"),"保存期限満了日が出る");
  assert((await p.textContent(".fm-legend")).includes("警衛勤務"),"記載要領が枠に出る");

  // 設定は同期される
  assert(await p.evaluate(()=>purge(JSON.parse(JSON.stringify(state))).report.unitName==="第４０５飛行隊"),
    "帳票の設定が同期データに入る");
  await p.reload(); await p.waitForSelector(".fmtable");
  assert((await p.textContent(".fm-title")).includes("第４０５飛行隊"),"再起動後も残る");

  // 月を動かすと和暦も追従
  await p.click("#rNext");
  assert((await p.textContent(".fm-title")).includes("令和8年8月"),"翌月に動かせる");
  await p.click("#rPrev");

  // 参考の集計も付く
  assert((await p.textContent(".summary-sheet")).includes("前月繰越"),"参考の集計が付く");
  assert((await p.textContent(".summary-sheet")).includes("2佐 南目 晃宏"),"集計にも階級が出る");

  // 旧データ互換
  assert(await p.evaluate(()=>{const n=normalize({version:1,members:[{id:"a",name:"旧"}],tasks:[]});
    return n.report.title==="特別の日課指定・勤務計画表" && n.members[0].rank==="";}),
    "階級・帳票設定を持たない旧JSONも読める");

  await p.screenshot({path:OUT+"/form-report.png",clip:{x:0,y:0,width:1500,height:620}});
  summary();
  assert(errs.length===0,"JSエラーなし "+JSON.stringify(errs));
  await b.close(); server.close();
})();
