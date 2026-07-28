const { OUT, chromiumPath, assert, summary } = require("./lib");
const http=require("http"),fs=require("fs"),path=require("path");
const {chromium}=require("playwright");
const server=http.createServer((q,r)=>{r.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
  r.end(fs.readFileSync(path.join(__dirname, "..", "gantt.html")));});
(async()=>{
  await new Promise(r=>server.listen(8086,r));
  const b=await chromium.launch({executablePath: chromiumPath()});
  const p=await b.newPage({timezoneId:"Asia/Tokyo"});
  await p.goto("http://localhost:8086/"); await p.waitForSelector(".row");

  const r=await p.evaluate(()=>{
    const out={};
    // パターン: L1=+1:30 / S1=-1:00 / N=0
    state.dutyPatterns=[
      {id:"L1",code:"L1",name:"長",kind:"long", start:"08:00",end:"18:15",breakMin:60,order:0,deleted:false,updatedAt:1},
      {id:"S1",code:"S1",name:"短",kind:"short",start:"08:00",end:"15:45",breakMin:60,order:1,deleted:false,updatedAt:1},
      {id:"N", code:"N", name:"通",kind:"normal",start:"08:00",end:"16:45",breakMin:60,order:2,deleted:false,updatedAt:1},
    ];
    const P=id=>state.dutyPatterns.find(x=>x.id===id);
    out.longMin  = patternWorkMin(P("L1"));
    out.longDelta= patternDelta(P("L1"));
    out.shortDelta=patternDelta(P("S1"));
    out.normDelta= patternDelta(P("N"));
    out.fmt=[fmtMin(90,true),fmtMin(-60,true),fmtMin(465,false)];

    const m="mX";
    const D=(date,pid)=>state.duties.push({id:date+pid,memberId:m,date,patternId:pid,
      note:"",deleted:false,updatedAt:1});

    // 1) 貯めて使う
    state.duties=[];
    D("2026-09-01","L1"); D("2026-09-02","L1"); D("2026-09-03","S1");
    out.basic=dutyLedger(m,"2026-09-30").balance;          // +90+90-60 = 120

    // 2) 8週間で失効（9/1に貯めた分は 10/27 まで有効）
    state.duties=[];
    D("2026-09-01","L1"); D("2026-11-02","S1");            // 11/2時点では失効済み
    const led2=dutyLedger(m,"2026-11-30");
    out.expired=led2.balance;                               // 0
    out.shortage=led2.events.filter(e=>e.type==="use")[0].short;  // 60 不足
    out.expireEvent=led2.events.some(e=>e.type==="expire");

    // 3) 期限ぎりぎりは使える（9/1 + 56日 = 10/27）
    state.duties=[];
    D("2026-09-01","L1"); D("2026-10-27","S1");
    const led3=dutyLedger(m,"2026-10-31");
    const use3=led3.events.find(e=>e.type==="use");
    out.justInTime={used:-use3.min, short:use3.short, balance:led3.balance};

    // 4) 古いものから先に使う
    state.duties=[];
    D("2026-09-01","L1"); D("2026-10-20","L1"); D("2026-10-25","S1");
    const led4=dutyLedger(m,"2026-10-31");
    out.fifoRemain=led4.lots.map(l=>`${l.date}:${l.remain}`).join(",");  // 9/1が先に減る

    // 5) 月次集計
    state.duties=[];
    D("2026-09-10","L1"); D("2026-09-20","L1");            // 9月に+180
    D("2026-10-05","S1"); D("2026-10-06","S1");            // 10月に-120
    out.sep=dutyMonthly(m,2026,9);
    out.oct=dutyMonthly(m,2026,10);
    return out;
  });

  assert(r.longMin===555,"LONGの実働が正しい (555分=9:15, got "+r.longMin+")");
  assert(r.longDelta===90,"LONGは+1:30 (got "+r.longDelta+")");
  assert(r.shortDelta===-60,"SHORTは-1:00 (got "+r.shortDelta+")");
  assert(r.normDelta===0,"7:45ちょうどは増減0");
  assert(r.fmt[0]==="+1:30"&&r.fmt[1]==="-1:00"&&r.fmt[2]==="7:45","時間の表示形式 ("+r.fmt.join(" ")+")");
  assert(r.basic===120,"貯めた分から消費できる (+1:30×2-1:00=2:00, got "+r.basic+"分)");
  assert(r.expired===0&&r.expireEvent,"8週間を過ぎた残高は失効する");
  assert(r.shortage===60,"失効後に消費すると不足として記録される ("+r.shortage+"分)");
  assert(r.justInTime.used===60&&r.justInTime.short===0,
    "期限当日(発生+56日)でも消費できる (使用"+r.justInTime.used+"分・不足"+r.justInTime.short+"分)");
  assert(r.justInTime.balance===0,"使い残した分は期限日を過ぎると失効する");
  assert(r.fifoRemain==="2026-09-01:30,2026-10-20:90"||r.fifoRemain==="2026-10-20:90",
    "古い分から先に消費する ("+r.fifoRemain+")");
  assert(r.sep.earn===180&&r.sep.closing===180,"9月: 付与180・月末180 ("+JSON.stringify(r.sep)+")");
  assert(r.oct.opening===180&&r.oct.use===120&&r.oct.closing===60,
    "10月: 繰越180・消費120・月末60 ("+JSON.stringify(r.oct)+")");
  summary();
  await b.close(); server.close();
})();
