const { OUT, chromiumPath, assert, summary } = require("./lib");
/* 共有フォルダ上の1つのJSONを、2台のPCが同時に読み書きする状況を実ファイルで再現する */
const http=require("http"),fs=require("fs"),path=require("path");
const {chromium}=require("playwright");
const ROOT = path.join(__dirname, "..");
const SHARE=path.join(OUT, "share");

fs.rmSync(SHARE,{recursive:true,force:true}); fs.mkdirSync(SHARE,{recursive:true});
const FILE=path.join(SHARE,"team-schedule.json");
fs.writeFileSync(FILE,"");

const server=http.createServer((q,r)=>{r.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
  r.end(fs.readFileSync(path.join(ROOT,"gantt.html")));});

/* 実ファイルを読み書きするハンドルをページに注入する（ネイティブのファイル選択は自動化できないため） */
async function attach(page){
  await page.exposeFunction("__read", () => ({
    text: fs.readFileSync(FILE,"utf8"), lastModified: fs.statSync(FILE).mtimeMs }));
  await page.exposeFunction("__write", d => { fs.writeFileSync(FILE,d); });
  await page.evaluate(async () => {
    const h = {
      name:"team-schedule.json",
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      getFile: async () => { const r = await window.__read();
        return { lastModified:r.lastModified, text: async () => r.text }; },
      createWritable: async () => { let p=""; return {
        write: async d => { p=d; }, close: async () => { await window.__write(p); } }; },
    };
    await connectHandle(h, false);
  });
}

(async()=>{
  await new Promise(r=>server.listen(8093,r));
  const b=await chromium.launch({executablePath: chromiumPath()});
  const ctxA=await b.newContext({timezoneId:"Asia/Tokyo"});   // PC-A
  const ctxB=await b.newContext({timezoneId:"Asia/Tokyo"});   // PC-B
  const A=await ctxA.newPage(), B=await ctxB.newPage();
  for(const p of [A,B]){ await p.goto("http://localhost:8093/"); await p.waitForSelector(".row"); }

  const today=await A.evaluate(()=>{const q=n=>String(n).padStart(2,"0");const d=new Date();
    return `${d.getFullYear()}-${q(d.getMonth()+1)}-${q(d.getDate())}`;});

  await attach(A); await attach(B);
  assert(fs.readFileSync(FILE,"utf8").length>0,"最初の接続で共有ファイルが初期化される");

  // PC-A で入力 → 共有ファイルに保存される
  await A.evaluate(t=>{const m=liveMembers()[0];
    state.tasks.push({id:"fromA",memberIds:[m.id],title:"A拠点の作業",start:`${t}T09:00`,end:`${t}T10:00`,
      color:"#4F6AF0",note:"",deleted:false,updatedAt:Date.now()}); changed();},today);
  await A.waitForTimeout(3000);   // 自動保存(最大1.6秒後＋書き込み)を待つ
  assert(JSON.parse(fs.readFileSync(FILE,"utf8")).tasks.some(t=>t.id==="fromA"),
    "PC-Aの入力が共有ファイルに自動保存される");

  // PC-B がポーリングで受け取る
  await B.waitForFunction(()=>liveTasks().some(t=>t.id==="fromA"),null,{timeout:15000});
  assert(await B.evaluate(()=>liveTasks().some(t=>t.id==="fromA")),"PC-Bに数秒で反映される");

  // 両方が別々の作業を同時に入力しても、どちらも消えない
  await Promise.all([
    A.evaluate(t=>{const m=liveMembers()[0];
      state.tasks.push({id:"a2",memberIds:[m.id],title:"A追加",start:`${t}T11:00`,end:`${t}T12:00`,
        color:"#4F6AF0",note:"",deleted:false,updatedAt:Date.now()}); changed();},today),
    B.evaluate(t=>{const m=liveMembers()[1];
      state.tasks.push({id:"b2",memberIds:[m.id],title:"B追加",start:`${t}T13:00`,end:`${t}T14:00`,
        color:"#2fa84f",note:"",deleted:false,updatedAt:Date.now()}); changed();},today),
  ]);
  await A.waitForTimeout(9000);
  const ids=JSON.parse(fs.readFileSync(FILE,"utf8")).tasks.map(t=>t.id);
  assert(ids.includes("a2")&&ids.includes("b2"),"同時に入力しても両方の作業が残る ("+ids.join(",")+")");
  await A.waitForFunction(()=>liveTasks().some(t=>t.id==="b2"),null,{timeout:15000});
  await B.waitForFunction(()=>liveTasks().some(t=>t.id==="a2"),null,{timeout:15000});
  assert(true,"両PCの画面が揃う");

  // 資格データも同期される
  await A.evaluate(()=>{
    state.certTypes.push({id:"ct1",name:"フォークリフト",order:0,deleted:false,updatedAt:Date.now()});
    state.certs.push({id:"cc1",memberId:liveMembers()[0].id,typeId:"ct1",
      expiry:"2027-03-15",lastRenewed:null,note:"",deleted:false,updatedAt:Date.now()});
    changed();
  });
  await B.waitForFunction(()=>liveCerts().some(c=>c.id==="cc1"),null,{timeout:15000});
  assert(await B.evaluate(()=>liveCertTypes().length===1&&liveCerts()[0].expiry==="2027-03-15"),
    "資格の種類と期限がもう1台に同期される");
  // B側で更新（1年延長）→ A に伝わる
  await B.evaluate(()=>{const c=liveCerts()[0];
    c.expiry=plusOneYear(c.expiry); c.lastRenewed="2026-07-28"; c.updatedAt=Date.now(); changed();});
  await A.waitForFunction(()=>liveCerts()[0]&&liveCerts()[0].expiry==="2028-03-15",null,{timeout:15000});
  assert(true,"資格の更新がもう1台に反映される");

  // 全体予定も同期される
  await A.evaluate(()=>{
    state.events.push({id:"ev1",title:"北海道出張",kind:"trip",
      start:"2026-08-03",end:"2026-08-14",memberIds:[liveMembers()[0].id],
      note:"",deleted:false,updatedAt:Date.now()});
    changed();
  });
  await B.waitForFunction(()=>liveEvents().some(e=>e.id==="ev1"),null,{timeout:15000});
  assert(await B.evaluate(()=>liveEvents()[0].kind==="trip"&&liveEvents()[0].end==="2026-08-14"),
    "全体予定がもう1台に同期される");

  // PC-B で削除 → PC-A からも消える
  await B.evaluate(()=>{const t=state.tasks.find(x=>x.id==="fromA");
    t.deleted=true; t.updatedAt=Date.now(); changed();});
  await A.waitForFunction(()=>!liveTasks().some(t=>t.id==="fromA"),null,{timeout:15000});
  assert(true,"片方の削除がもう片方にも伝わる");

  summary();
  await b.close(); server.close();
})();
