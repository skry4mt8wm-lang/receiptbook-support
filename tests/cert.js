const { OUT, chromiumPath, assert, summary } = require("./lib");
const http=require("http"),fs=require("fs"),path=require("path");
const {chromium}=require("playwright");
const SP = OUT;
const server=http.createServer((q,r)=>{r.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
  r.end(fs.readFileSync(path.join(__dirname, "..", "gantt.html")));});

(async()=>{
  await new Promise(r=>server.listen(8089,r));
  const b=await chromium.launch({executablePath: chromiumPath()});
  const p=await b.newPage({viewport:{width:1400,height:760},timezoneId:"Asia/Tokyo"});
  const errs=[]; p.on("pageerror",e=>errs.push(String(e)));
  p.on("console",m=>{if(m.type()==="error")errs.push("console: "+m.text());});
  await p.goto("http://localhost:8089/"); await p.waitForSelector(".row");

  // 資格画面へ
  await p.click("#certBtn");
  assert(!(await p.locator("#certScreen").isHidden()),"「資格」ボタンで資格画面に切り替わる");
  assert(await p.locator("#scroller").isHidden(),"スケジュール側は隠れる");
  assert(!(await p.locator("#addTypeBtn").isHidden()),"「＋ 資格の種類」が出る");

  // 資格の種類を4つ作り、期限を流し込む
  await p.evaluate(()=>{
    const d=n=>{const x=new Date();x.setDate(x.getDate()+n);
      const q=v=>String(v).padStart(2,"0");
      return `${x.getFullYear()}-${q(x.getMonth()+1)}-${q(x.getDate())}`;};
    const T=["フォークリフト","高所作業車","玉掛け","衛生管理者"];
    T.forEach((n,i)=>state.certTypes.push({id:"t"+i,name:n,order:i,deleted:false,updatedAt:Date.now()}));
    const M=liveMembers();
    const add=(mi,ti,days)=>state.certs.push({id:`c${mi}${ti}`,memberId:M[mi].id,typeId:"t"+ti,
      expiry:d(days),lastRenewed:null,note:"",deleted:false,updatedAt:Date.now()});
    add(0,0,230); add(0,1,5);  add(0,2,176);
    add(1,0,44);  add(1,1,215); add(1,3,126);
    add(2,0,38);  add(2,2,-18);            // 期限切れ／フォークリフトは同月に集中
    ui.meId=M[0].id;   // 山田は高所作業車が残り5日
    changed();
  });

  const cells=p.locator("#certTable .cell");
  assert((await cells.count())===12,"3名×4種類=12セルが並ぶ");
  assert((await p.locator("#certTable .cell.ok").count())>0,"有効な資格が緑になる");
  assert((await p.locator("#certTable .cell.soon").count())>0,"30日以内が橙になる");
  assert((await p.locator("#certTable .cell.warn").count())>0,"60日以内が黄になる");
  assert((await p.locator("#certTable .cell.expired").count())===1,"期限切れが赤になる");
  assert((await p.locator("#certTable .cell.none").count())===4,"未保有セルが4つ");

  // 保有者数と属人化
  const head=await p.locator("#certTable thead th").nth(4).textContent();
  assert(head.includes("1名"),"保有者1名の資格に人数が出る ("+head.trim()+")");
  assert((await p.locator("#certTable .thcount.alone").count())>=1,"属人化の資格が強調される");

  // 相互補完の警告
  const warn=await p.locator("#certWarn").textContent();
  assert(warn.includes("期限切れ"),"期限切れの警告が出る");
  assert(warn.includes("衛生管理者")&&warn.includes("のみ"),"属人化の警告が出る");
  assert((await p.locator(".cwarn").count())>=2,"警告が複数表示される");
  assert(warn.includes("まとめて期限切れ"),"期限集中の警告が出る");
  assert(warn.includes("有効な保有者は1名になります"),"集中後に何名残るかが出る");

  // 資格名クリックで「今日動ける人」
  let dialogText="";
  p.once("dialog",async d=>{dialogText=d.message();await d.dismiss();});
  await p.locator("#certTable .thname .tname").first().click();
  await p.waitForTimeout(200);
  assert(dialogText.includes("今日動ける人")&&dialogText.includes("山田"),
    "資格名クリックで有効な保有者が出る ("+dialogText.split("\n")[0]+")");

  // バナー（自分の分を優先）
  assert(!(await p.locator("#certBanner").isHidden()),"期限が近いとバナーが出る");
  const banner=await p.locator("#certBanner").textContent();
  assert(banner.includes("あなたの")&&banner.indexOf("あなたの")<banner.indexOf("鈴木"),
    "自分の資格が先頭に出る ("+banner.slice(0,50).trim()+")");
  assert(banner.includes("高所作業車")&&banner.includes("残り5日"),"自分の直近の期限が具体的に出る");

  // 期限の直接入力
  await p.locator("#certTable .cell").first().click();
  await p.waitForSelector("#certMask:not([hidden])");
  assert((await p.textContent("#certWho")).includes("フォークリフト"),"セルから資格ダイアログが開く");
  await p.fill("#cExpiry","2028-04-01");
  assert((await p.textContent("#cLeft")).includes("残り"),"残り日数が出る");
  await p.click("#cSave");
  assert(await p.locator("#certMask").isHidden(),"保存でダイアログが閉じる");
  assert((await p.locator("#certTable .cell").first().textContent()).includes("2028-04-01"),
    "直接入力した期限が反映される");

  // 「更新した」ボタン（1年延長）
  await p.locator("#certTable .cell").first().click();
  await p.waitForSelector("#certMask:not([hidden])");
  assert((await p.textContent("#cRenewNote")).includes("2029-04-01"),"押した結果の期限が事前に出る");
  await p.click("#cRenew");
  assert((await p.locator("#certTable .cell").first().textContent()).includes("2029-04-01"),
    "「更新した」で期限が1年延びる");
  await p.locator("#certTable .cell").first().click();
  await p.waitForSelector("#certMask:not([hidden])");
  assert((await p.textContent("#certWho")).includes("前回の更新"),"更新日が記録される");
  await p.click("#cCancel");

  // 期限切れの資格を更新すると、今日から1年後になる
  const expired=p.locator("#certTable .cell.expired").first();
  await expired.click();
  await p.waitForSelector("#certMask:not([hidden])");
  const note=await p.textContent("#cRenewNote");
  const want=await p.evaluate(()=>plusOneYear(toDateStr(startOfDay(new Date()))));
  assert(note.includes(want),"期限切れ後の更新は今日から1年後になる ("+want+")");
  await p.click("#cRenew");
  assert((await p.locator("#certTable .cell.expired").count())===0,"更新すると期限切れが解消する");

  // 未保有セルから新規登録
  await p.locator("#certTable .cell.none").first().click();
  await p.waitForSelector("#certMask:not([hidden])");
  assert((await p.textContent("#certTitle")).includes("登録"),"未保有セルは「資格を登録」で開く");
  await p.fill("#cExpiry","2027-06-30");
  await p.click("#cSave");
  assert((await p.locator("#certTable .cell.none").count())===3,"未保有セルが1つ減る");

  // 資格を外す
  p.on("dialog",d=>d.accept());
  await p.locator("#certTable .cell").first().click();
  await p.waitForSelector("#certMask:not([hidden])");
  await p.click("#cDelete");
  await p.waitForTimeout(200);
  assert((await p.locator("#certTable .cell.none").count())===4,"「この資格を外す」で未保有に戻る");

  // 同期データに含まれ、再起動後も残る
  const inJson=await p.evaluate(()=>{const s=JSON.parse(JSON.stringify(purge(state)));
    return {types:s.certTypes.length,certs:s.certs.filter(c=>!c.deleted).length};});
  assert(inJson.types===4&&inJson.certs>0,"資格データが同期対象に入る ("+JSON.stringify(inJson)+")");
  await p.reload(); await p.waitForSelector("#certTable");
  assert((await p.locator("#certTable .cell").count())===12,"再起動後も資格画面が復元される");

  // 旧データ（資格なし）も読める
  const old=await p.evaluate(()=>{const n=normalize({version:1,members:[],tasks:[]});
    return Array.isArray(n.certTypes)&&Array.isArray(n.certs);});
  assert(old,"資格を持たない旧JSONも読み込める");

  await p.screenshot({path:SP+"/cert-screen.png"});
  assert(errs.length===0,"JSエラーなし "+JSON.stringify(errs));
  summary();
  await b.close(); server.close();
})();
