const { OUT, chromiumPath, assert, summary } = require("./lib");
/* 3台が立て続けに入力しても、全員の内容が最終的に揃うかを実ファイルで確認する */
const http=require("http"),fs=require("fs"),path=require("path");
const {chromium}=require("playwright");
const ROOT = path.join(__dirname, "..");
const SHARE=path.join(OUT, "share2");

fs.rmSync(SHARE,{recursive:true,force:true}); fs.mkdirSync(SHARE,{recursive:true});
const FILE=path.join(SHARE,"team-schedule.json"); fs.writeFileSync(FILE,"");
const server=http.createServer((q,r)=>{r.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
  r.end(fs.readFileSync(path.join(ROOT,"gantt.html")));});

async function attach(page){
  await page.exposeFunction("__read",()=>({text:fs.readFileSync(FILE,"utf8"),lastModified:fs.statSync(FILE).mtimeMs}));
  await page.exposeFunction("__write",d=>{fs.writeFileSync(FILE,d);});
  await page.evaluate(async()=>{
    await connectHandle({name:"team-schedule.json",
      queryPermission:async()=>"granted", requestPermission:async()=>"granted",
      getFile:async()=>{const r=await window.__read();return{lastModified:r.lastModified,text:async()=>r.text};},
      createWritable:async()=>{let p="";return{write:async d=>{p=d;},close:async()=>{await window.__write(p);}};},
    },false);
  });
}
(async()=>{
  await new Promise(r=>server.listen(8092,r));
  const b=await chromium.launch({executablePath: chromiumPath()});
  const pages=[];
  for(let i=0;i<3;i++){ const c=await b.newContext({timezoneId:"Asia/Tokyo"});
    const p=await c.newPage(); await p.goto("http://localhost:8092/"); await p.waitForSelector(".row");
    pages.push(p); }
  const today=await pages[0].evaluate(()=>{const q=n=>String(n).padStart(2,"0");const d=new Date();
    return `${d.getFullYear()}-${q(d.getMonth()+1)}-${q(d.getDate())}`;});
  for(const p of pages) await attach(p);

  // 3台が同時に、それぞれ5件ずつ立て続けに入力する
  const N=5;
  await Promise.all(pages.map((p,pi)=>p.evaluate(async ({t,pi,N})=>{
    const m=liveMembers()[pi%liveMembers().length];
    for(let k=0;k<N;k++){
      state.tasks.push({id:`p${pi}_${k}`,memberIds:[m.id],title:`PC${pi}の作業${k}`,
        start:`${t}T${String(8+k).padStart(2,"0")}:00`,end:`${t}T${String(9+k).padStart(2,"0")}:00`,
        color:"#4F6AF0",note:"",deleted:false,updatedAt:Date.now()});
      changed();
      await new Promise(r=>setTimeout(r,120));
    }
  },{t:today,pi,N})));

  // 収束を待つ（最大40秒）
  const want=15; let ok=false;
  for(let i=0;i<40;i++){
    await pages[0].waitForTimeout(1000);
    const inFile=JSON.parse(fs.readFileSync(FILE,"utf8")||"{}").tasks?.filter(t=>!t.deleted).length||0;
    const counts=await Promise.all(pages.map(p=>p.evaluate(()=>liveTasks().length)));
    if(inFile===want&&counts.every(c=>c===want)){ ok=true;
      console.log(`収束まで約${i+1}秒（ファイル${inFile}件 / 各画面 ${counts.join(",")}）`); break; }
  }
  const inFile=JSON.parse(fs.readFileSync(FILE,"utf8")).tasks.filter(t=>!t.deleted).length;
  const counts=await Promise.all(pages.map(p=>p.evaluate(()=>liveTasks().length)));
  assert(ok,`3台×5件=15件が全員に揃う (ファイル${inFile}件 / 各画面 ${counts.join(",")})`);

  // 書き込みが壊れたJSONを残していないこと
  let parsed=true; try{ JSON.parse(fs.readFileSync(FILE,"utf8")); }catch(e){ parsed=false; }
  assert(parsed,"共有ファイルが壊れていない");
  summary();
  await b.close(); server.close();
})();
