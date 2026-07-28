const { OUT, chromiumPath, assert, summary } = require("./lib");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, req.url === "/" ? "gantt.html" : req.url.split("?")[0]);
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end("nf"); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(d);
  });
});



(async () => {
  await new Promise(r => server.listen(8099, r));
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, timezoneId: "Asia/Tokyo" });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto("http://localhost:8099/gantt.html");
  await page.waitForSelector(".row");

  // --- 1. 初期表示 ---
  assert((await page.locator(".row").count()) === 3, "初期メンバー3行が表示される");
  assert((await page.locator("#viewSeg button.on").textContent()) === "週", "既定は週ビュー");
  const wkTicks = await page.locator(".head .tick").count();
  assert(wkTicks === 7, "週ビューの目盛りは7日 (got " + wkTicks + ")");

  // --- 2. 日/月ビュー ---
  await page.click('#viewSeg button[data-view="day"]');
  assert((await page.locator(".head .tick").count()) === 24, "日ビューの目盛りは24時間");
  await page.click('#viewSeg button[data-view="month"]');
  const mTicks = await page.locator(".head .tick").count();
  assert(mTicks >= 4 && mTicks <= 6, "月ビューの目盛りは4〜6週 (got " + mTicks + ")");

  // --- 3. 作業追加 ---
  await page.click('#viewSeg button[data-view="week"]');
  await page.click("#addBtn");
  await page.waitForSelector("#taskMask:not([hidden])");
  await page.fill("#fTitle", "A社 現場作業");
  const today = await page.evaluate(() => {
    const p = n => String(n).padStart(2, "0");
    const d = new Date();
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  await page.fill("#fStart", `${today}T09:00`);
  await page.fill("#fEnd", `${today}T17:30`);
  await page.click("#taskSave");
  await page.waitForSelector(".bar");
  assert((await page.locator(".bar").count()) === 1, "バーが1本表示される");
  assert((await page.locator(".bar .t").first().textContent()) === "A社 現場作業", "バーに作業内容が出る");

  // --- 4. バリデーション（終了 <= 開始） ---
  await page.click(".bar");
  await page.waitForSelector("#taskMask:not([hidden])");
  await page.fill("#fEnd", `${today}T08:00`);
  await page.click("#taskSave");
  assert((await page.textContent("#taskErr")).includes("終了は開始より後"), "終了が開始より前ならエラー");
  await page.click("#taskCancel");

  // --- 5. 重なりの段組み ---
  await page.evaluate(t => {
    const m = liveMembers()[0];
    state.tasks.push({ id: "x1", memberIds: [m.id], title: "重なり", start: `${t}T10:00`, end: `${t}T12:00`,
      color: "#2fa84f", note: "", deleted: false, updatedAt: Date.now() });
    changed();
  }, today);
  const rowH = await page.locator(".row").first().evaluate(el => el.getBoundingClientRect().height);
  assert(rowH > 40, "重なる作業で行が2段になる (h=" + Math.round(rowH) + ")");

  // --- 6. 日ビューは当日の作業のみ ---
  await page.click('#viewSeg button[data-view="day"]');
  assert((await page.locator(".bar").count()) === 2, "日ビューで当日の2件が出る");
  await page.click("#nextBtn");
  assert((await page.locator(".bar").count()) === 0, "翌日には作業がない");
  await page.click("#todayBtn");
  assert((await page.locator(".bar").count()) === 2, "「今日」で戻る");

  // --- 7. マージ（last-write-wins + tombstone） ---
  const merged = await page.evaluate(() => {
    const local  = { members: [], tasks: [
      { id: "a", memberIds: ["m"], title: "ローカル新", start: "2026-07-27T09:00", end: "2026-07-27T10:00", updatedAt: 200 },
      { id: "b", memberIds: ["m"], title: "残る",       start: "2026-07-27T09:00", end: "2026-07-27T10:00", updatedAt: 100 },
    ]};
    const remote = { members: [], tasks: [
      { id: "a", memberIds: ["m"], title: "リモート旧", start: "2026-07-27T09:00", end: "2026-07-27T10:00", updatedAt: 100 },
      { id: "c", memberIds: ["m"], title: "他人が追加", start: "2026-07-27T09:00", end: "2026-07-27T10:00", updatedAt: 300 },
      { id: "b", deleted: true, updatedAt: 400 },
    ]};
    const r = mergeState(normalize(local), normalize(remote));
    return r.tasks.map(t => `${t.id}:${t.deleted ? "DEL" : t.title}`).sort().join(",");
  });
  assert(merged === "a:ローカル新,b:DEL,c:他人が追加", "マージ結果が正しい (" + merged + ")");

  // --- 8. localStorage 復元 ---
  await page.reload();
  await page.waitForSelector(".bar");
  assert((await page.locator(".bar").count()) === 2, "リロード後もデータが残る");

  // --- 9. メンバー管理 ---
  await page.click("#memberBtn");
  await page.fill("#newMember", "田中 次郎");
  await page.click("#addMember");
  assert((await page.locator("#memberList li").count()) === 4, "メンバーを追加できる");
  await page.click("#memberClose");
  await page.click('#viewSeg button[data-view="week"]');
  assert((await page.locator(".row").count()) === 4, "追加したメンバーの行が増える");

  // --- 10. 細いバーでも作業内容が読める ---
  const barTxt = await page.locator(".bar .t").first().evaluate(el => {
    const r = el.getBoundingClientRect();
    return { w: r.width, text: el.textContent };
  });
  assert(barTxt.w > 20, "週ビューでも作業内容のラベルに幅がある (w=" + Math.round(barTxt.w) + ")");

  // --- 11. 日ビューは業務時間帯までスクロールされる ---
  await page.click('#viewSeg button[data-view="day"]');
  const sl = await page.locator("#scroller").evaluate(el => el.scrollLeft);
  assert(sl > 100, "日ビューが0:00ではなく現在時刻付近から表示される (scrollLeft=" + Math.round(sl) + ")");
  await page.click('#viewSeg button[data-view="week"]');

  // --- 12. 複数人の一括アサイン ---
  await page.click("#addBtn");
  await page.waitForSelector("#taskMask:not([hidden])");
  await page.fill("#fTitle", "棚卸し作業");
  await page.fill("#fStart", `${today}T14:00`);
  await page.fill("#fEnd", `${today}T16:00`);
  await page.click("#pickAll");
  assert((await page.textContent("#pickCount")).includes("4名"), "「全員」で4名が選択される");
  // 4人目だけ外して3名にする
  await page.locator("#fMembers input").nth(3).uncheck();
  assert((await page.textContent("#pickCount")).includes("3名"), "チェックを外すと選択数が減る");
  await page.click("#taskSave");

  const shared = page.locator('.bar:has-text("棚卸し作業")');
  assert((await shared.count()) === 3, "1件の作業が担当者3名の行に表示される (got " + (await shared.count()) + ")");
  assert((await page.evaluate(() => liveTasks().filter(t => t.title === "棚卸し作業").length)) === 1,
    "登録されるデータは1件だけ（人数分に増殖しない）");
  assert((await shared.first().locator(".n").textContent()) === "3名", "バーに人数バッジが出る");
  assert((await shared.first().getAttribute("title")).includes("担当: "), "ツールチップに担当者名が並ぶ");

  // どの行から開いても同じ1件を編集する
  await shared.nth(2).click();
  await page.waitForSelector("#taskMask:not([hidden])");
  assert((await page.inputValue("#fTitle")) === "棚卸し作業", "他の担当者の行からでも同じ作業を開く");
  assert((await page.textContent("#pickCount")).includes("3名"), "選択済みの担当者が復元される");
  await page.locator("#fMembers input:checked").first().uncheck();   // 1人外す
  await page.click("#taskSave");
  assert((await page.locator('.bar:has-text("棚卸し作業")').count()) === 2, "担当者を外すとその行から消える");

  // --- 12b. 旧形式(memberId 単一)のデータを読み込める ---
  const legacy = await page.evaluate(() =>
    JSON.stringify(normalize({ tasks: [{ id: "old", memberId: "m1",
      start: "2026-07-27T09:00", end: "2026-07-27T10:00" }] }).tasks[0].memberIds));
  assert(legacy === '["m1"]', "旧形式の memberId が memberIds に変換される (" + legacy + ")");

  // --- 13. Z TIME（UTC）の併記 ---
  await page.click('#viewSeg button[data-view="day"]');
  const zday = await page.locator(".head .tick").nth(9).evaluate(el => ({
    i: el.querySelector("span:not(.z)").textContent,
    z: el.querySelector(".z").textContent,
  }));
  assert(zday.i === "9:00" && zday.z === "0000Z",
    "日ビュー: I TIME 9:00 の下に Z TIME 0000Z (" + JSON.stringify(zday) + ")");
  assert((await page.textContent(".corner .legend")).includes("I TIME"),
    "凡例に I TIME / Z TIME が出る");

  await page.click('#viewSeg button[data-view="week"]');
  const zweek = await page.locator(".head .tick").first().locator(".z").textContent();
  assert(/^\d{6}Z$/.test(zweek), "週ビューの Z TIME は DDHHMMZ 形式 (" + zweek + ")");

  await page.locator('.bar:has-text("A社 現場作業")').first().click();
  await page.waitForSelector("#taskMask:not([hidden])");
  const zin = await page.textContent("#zStart");
  assert(/Z TIME: \d{6}Z/.test(zin), "入力欄の下に Z TIME が出る (" + zin + ")");
  await page.fill("#fStart", `${today}T15:00`);
  assert((await page.textContent("#zStart")).endsWith("0600Z"),
    "開始時刻を変えると Z TIME も追従する (" + (await page.textContent("#zStart")) + ")");
  await page.click("#taskCancel");

  // --- 14. 週表示の作業一覧（文字） ---
  assert(!(await page.locator("#daylist").isHidden()), "週表示では作業一覧が出る");
  assert((await page.locator(".dl-day").count()) === 7, "一覧は7日分の列になる");
  const todayCol = page.locator(".dl-day").filter({ hasText: "A社 現場作業" });
  assert((await todayCol.count()) === 1, "その日の列に作業内容が文字で出る");
  const li = todayCol.locator("li").filter({ hasText: "A社 現場作業" });
  assert((await li.locator(".tm").textContent()).includes("09:00–17:30"), "一覧に開始・終了時刻が出る");
  assert((await li.locator(".tm .z").textContent()) === "0000Z–0830Z", "一覧にも Z TIME が併記される");
  assert((await li.locator(".mb").textContent()).includes("山田"), "一覧に担当者名が出る");
  assert((await page.locator('.dl-day:has-text("予定なし")').count()) >= 1, "予定のない日は「予定なし」");

  // 一覧の日付クリックで日表示へ
  await todayCol.locator(".dl-date").click();
  assert((await page.locator("#viewSeg button.on").textContent()) === "日", "一覧の日付クリックで日表示に切替");
  assert(await page.locator("#daylist").isHidden(), "日表示では作業一覧を出さない");

  // 一覧の表示/非表示トグル
  await page.click('#viewSeg button[data-view="week"]');
  await page.click("#listBtn");
  assert(await page.locator("#daylist").isHidden(), "「作業一覧を隠す」で閉じる");
  await page.reload();
  await page.waitForSelector(".bar");
  assert(await page.locator("#daylist").isHidden(), "一覧の開閉状態が次回起動時も保たれる");
  await page.click("#listBtn");
  assert(!(await page.locator("#daylist").isHidden()), "もう一度押すと開く");

  // --- 15. このPCで入力する人（meId） ---
  await page.click("#settingsBtn");
  await page.selectOption("#meSel", { label: "佐藤 花子" });
  await page.click("#setClose");
  assert((await page.locator(".row.me .name").textContent()).includes("佐藤 花子"), "自分の行が強調される");
  assert((await page.locator(".row.me .youare").count()) === 1, "自分の行に「あなた」バッジが出る");
  await page.click("#addBtn");
  await page.waitForSelector("#taskMask:not([hidden])");
  const preset = await page.locator("#fMembers input:checked").evaluateAll(
    (els, ) => els.map(e => e.parentElement.textContent.trim()));
  assert(preset.length === 1 && preset[0] === "佐藤 花子", "新規作業の担当者が自分になる (" + preset + ")");
  await page.click("#taskCancel");
  const fname = await page.evaluate(() => exportFileName());
  assert(/^team-schedule_\d{8}_佐藤花子\.json$/.test(fname), "書き出しファイル名に日付と名前が入る (" + fname + ")");
  // meId はこのPC専用（書き出すJSONに混ざらない）
  assert(!(await page.evaluate(() => JSON.stringify(purge(state)))).includes("meId"),
    "meId は書き出すJSONに含まれない");
  await page.reload();
  await page.waitForSelector(".row");
  assert((await page.locator(".row.me .youare").count()) === 1, "「このPCで入力する人」は再起動後も保持される");

  // --- 16. 各PCで入力してメールでやり取りする運用（3台を想定） ---
  const relay = await page.evaluate(() => {
    const p = x => String(x).padStart(2, "0");
    const d = new Date();
    const t = `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
    const T = Date.now();
    const base = { version:1, members:[
      { id:"mA", name:"Aさん", order:0, deleted:false, updatedAt:T-9000 },
      { id:"mB", name:"Bさん", order:1, deleted:false, updatedAt:T-9000 },
      { id:"mC", name:"Cさん", order:2, deleted:false, updatedAt:T-9000 },
    ], tasks:[
      { id:"共通", memberIds:["mA"], title:"朝礼", start:`${t}T08:00`, end:`${t}T08:30`,
        color:"#4F6AF0", note:"", deleted:false, updatedAt:T-8000 },
    ]};
    const mk = (owner, id, title, h, at) => ({
      id, memberIds:[owner], title, start:`${t}T${p(h)}:00`, end:`${t}T${p(h+1)}:00`,
      color:"#4F6AF0", note:"", deleted:false, updatedAt:at });

    // 3人が各自のPCで、同じ元データから別々に入力する
    const A = normalize(JSON.parse(JSON.stringify(base)));
    const B = normalize(JSON.parse(JSON.stringify(base)));
    const C = normalize(JSON.parse(JSON.stringify(base)));
    A.tasks.push(mk("mA","a1","A社訪問",9,T-7000));
    B.tasks.push(mk("mB","b1","B社見積",10,T-6900));
    C.tasks.push(mk("mC","c1","C社搬入",11,T-6800));
    // Cさんは自分のPCで新しいメンバーも追加した
    C.members.push({ id:"mD", name:"Dさん", order:3, deleted:false, updatedAt:T-6700 });
    // Bさんは共通の予定の時刻を直した
    B.tasks.find(x => x.id === "共通").title = "朝礼（30分繰下げ）";
    B.tasks.find(x => x.id === "共通").updatedAt = T-5000;

    // 取りまとめ役(A)が B と C のJSONを順に読み込む
    let hub = A;
    hub = purge(mergeState(hub, B));
    const sumB = diffSummary(A, hub);
    const beforeC = hub;
    hub = purge(mergeState(hub, C));
    const sumC = diffSummary(beforeC, hub);

    // まとめたJSONを各自が読み込む
    const backToC = purge(mergeState(C, hub));

    // その後、Aさんが自分の予定を削除して再配布
    const A2 = purge(mergeState(hub, { version:1, members:[], tasks:[
      { id:"a1", memberIds:[], title:"", start:"", end:"", color:"#4F6AF0",
        note:"", deleted:true, updatedAt:T-1000 }]}));
    const afterDelete = purge(mergeState(backToC, A2));

    const titles = s => s.tasks.filter(x => !x.deleted).map(x => x.title).sort().join(",");
    return {
      hubTitles: titles(hub),
      hubMembers: hub.members.filter(m => !m.deleted).map(m => m.name).join(","),
      sumB, sumC,
      cTitles: titles(backToC),
      afterDeleteTitles: titles(afterDelete),
    };
  });

  assert(relay.hubTitles === "A社訪問,B社見積,C社搬入,朝礼（30分繰下げ）",
    "3台ぶんの入力が1つにまとまる (" + relay.hubTitles + ")");
  assert(relay.hubMembers === "Aさん,Bさん,Cさん,Dさん", "各PCで追加したメンバーも合流する");
  assert(relay.sumB.added === 1 && relay.sumB.updated === 1,
    "読み込み時に「追加1件／更新1件」と数えられる (" + JSON.stringify(relay.sumB) + ")");
  assert(relay.sumC.added === 1 && relay.sumC.newMembers === 1,
    "メンバー追加も件数に出る (" + JSON.stringify(relay.sumC) + ")");
  assert(relay.cTitles === relay.hubTitles, "配布されたJSONを読めば各PCの画面が揃う");
  assert(!relay.afterDeleteTitles.includes("A社訪問") && relay.afterDeleteTitles.includes("C社搬入"),
    "誰かが削除した予定は他のPCでも消える (" + relay.afterDeleteTitles + ")");

  // --- 16a. 設定ボタンからの同期フォルダ指定 ---
  const folder = await page.evaluate(async () => {
    const out = {};
    // フォルダ選択ダイアログを模したフェイク（中身のファイルを保持する）
    const files = new Map();
    const mkFile = (name) => {
      if(files.has(name)) return files.get(name);
      const f = { content:"", lastModified:1000 }; let pending = "";
      const h = {
        name, _f:f,
        queryPermission: async () => "granted",
        requestPermission: async () => "granted",
        getFile: async () => ({ lastModified:f.lastModified, text: async () => f.content }),
        createWritable: async () => ({
          write: async d => { pending = d; },
          close: async () => { f.content = pending; f.lastModified++; },
        }),
      };
      files.set(name, h);
      return h;
    };
    const dir = {
      name: "共有スケジュール",
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      getFileHandle: async (n, opt) => {
        if(!files.has(n) && !(opt && opt.create)) throw new Error("not found");
        return mkFile(n);
      },
    };
    window.showDirectoryPicker = async () => dir;

    fileHandle = null; pendingHandle = null; dirHandle = null;
    document.getElementById("setMask").hidden = false;
    await pickFolder();

    out.connected   = !!fileHandle;
    out.usedName    = fileHandle && fileHandle.name;
    out.dirName     = dirHandle && dirHandle.name;
    out.fileCreated = files.has("team-schedule.json");
    out.written     = files.get("team-schedule.json")._f.content.length > 0;
    out.status      = document.getElementById("setNow").textContent;
    out.folderBtn   = document.getElementById("folderBtn").textContent;

    // ファイル名を変えると、同じフォルダの別ファイルにつなぎ直す
    const inp = document.getElementById("fileNameInput");
    inp.value = "A班スケジュール";                    // 拡張子なしでも .json を補う
    inp.dispatchEvent(new Event("change"));
    await new Promise(r => setTimeout(r, 300));
    out.switchedName = fileHandle && fileHandle.name;
    out.switchedFile = files.has("A班スケジュール.json");
    out.savedPref    = JSON.parse(localStorage.getItem("teamGantt.ui.v1")).fileName;

    // 同期をやめる
    window.confirm = () => true;
    await disconnectSync();
    out.afterStop     = !fileHandle && !dirHandle;
    out.afterStopText = document.getElementById("setNow").textContent;
    document.getElementById("setMask").hidden = true;
    return out;
  });

  assert(folder.connected && folder.fileCreated,
    "「同期フォルダを選ぶ」でフォルダ内にファイルが自動作成される");
  assert(folder.written, "作成されたファイルに手元のデータが書き込まれる");
  assert(folder.dirName === "共有スケジュール" && folder.usedName === "team-schedule.json",
    "指定したフォルダとファイル名で接続される (" + folder.dirName + "/" + folder.usedName + ")");
  assert(folder.status.includes("同期中") && folder.status.includes("共有スケジュール"),
    "設定画面に同期中のフォルダ名が出る (" + folder.status.replace(/\s+/g, " ") + ")");
  assert(folder.folderBtn.includes("別のフォルダ"), "接続後はボタンが「別のフォルダを選ぶ」になる");
  assert(folder.switchedName === "A班スケジュール.json" && folder.switchedFile,
    "ファイル名を変えると同じフォルダの別ファイルに切り替わる (" + folder.switchedName + ")");
  assert(folder.savedPref === "A班スケジュール.json", "ファイル名の設定が保存される");
  assert(folder.afterStop && folder.afterStopText.includes("未設定"),
    "「同期をやめる」で未設定に戻る (" + folder.afterStopText.replace(/\s+/g, " ") + ")");

  // --- 16b. 共有フォルダ運用（新規作成・再接続・切断検知） ---
  const share = await page.evaluate(async () => {
    const out = {};
    // 共有フォルダ上のファイルを模したフェイク
    const mkHandle = (name, content, perm) => {
      const f = { content, lastModified: 1000 };
      let pending = "";
      return {
        name, _f: f, _perm: perm || "granted",
        queryPermission: async function(){ return this._perm; },
        requestPermission: async function(){ this._perm = "granted"; return "granted"; },
        getFile: async () => ({ lastModified: f.lastModified, text: async () => f.content }),
        createWritable: async () => ({
          write: async d => { pending = d; },
          close: async () => { f.content = pending; f.lastModified++; },
        }),
      };
    };

    // (1) 最初の1人が「新規作成」→ 空ファイルに手元のデータが書き込まれる
    fileHandle = null; pendingHandle = null;
    const fresh = mkHandle("team-schedule.json", "");
    await connectHandle(fresh, true);
    out.newFileWritten = JSON.parse(fresh._f.content).tasks.length > 0;
    out.labelAfterNew = document.getElementById("syncText").textContent;
    out.newBtnHidden = document.getElementById("newFileBtn").hidden;
    out.openBtnLabel = document.getElementById("openBtn").textContent;

    // (2) 「新規作成」で既存ファイルを選んでも、中身を消さない
    fileHandle = null;
    const existing = mkHandle("team-schedule.json", JSON.stringify({ version:1, members:[], tasks:[{
      id:"keepme", memberIds:[], title:"既にあった予定",
      start:"2026-07-28T09:00", end:"2026-07-28T10:00", color:"#4F6AF0",
      note:"", deleted:false, updatedAt: Date.now() }]}));
    await connectHandle(existing, true);
    out.keptExisting = JSON.parse(existing._f.content).tasks.some(t => t.id === "keepme")
                    && liveTasks().some(t => t.id === "keepme");

    // (3) 権限が戻っていない状態からの再接続
    fileHandle = null; pendingHandle = null;
    const stored = mkHandle("team-schedule.json", existing._f.content, "prompt");
    pendingHandle = stored;
    updateFileButtons();
    out.reconnectLabel = document.getElementById("openBtn").textContent;
    await pickFile();                       // ボタン相当（requestPermission が走る）
    out.reconnected = fileHandle === stored && pendingHandle === null;

    // (4) 共有ドライブ切断の検知と復帰
    const flaky = mkHandle("team-schedule.json", existing._f.content);
    fileHandle = flaky;
    flaky.getFile = async () => { throw new Error("network drive lost"); };
    await pollOnce(); await pollOnce();
    out.disconnectLabel = document.getElementById("syncText").textContent;
    flaky.getFile = async () => ({ lastModified: 2000, text: async () => flaky._f.content });
    await pollOnce();
    out.recoveredLabel = document.getElementById("syncText").textContent;

    fileHandle = null; pendingHandle = null; clearInterval(pollTimer);
    return out;
  });

  assert(share.newFileWritten, "「新規作成」で空ファイルに手元の予定が書き込まれる");
  assert(share.labelAfterNew.includes("保存済み"), "接続後は「保存済み」と表示 (" + share.labelAfterNew + ")");
  assert(share.newBtnHidden && share.openBtnLabel === "別の共有ファイルを開く",
    "接続後はボタン表示が切り替わる (" + share.openBtnLabel + ")");
  assert(share.keptExisting, "「新規作成」で既存ファイルを選んでも中身を消さない");
  assert(share.reconnectLabel.includes("再接続"), "前回のファイルがあると再接続ボタンになる (" + share.reconnectLabel + ")");
  assert(share.reconnected, "ボタン1回で権限を取り直して再接続できる");
  assert(share.disconnectLabel.includes("接続できません"), "共有ドライブ切断を知らせる (" + share.disconnectLabel + ")");
  assert(!share.recoveredLabel.includes("接続できません"), "復帰すると表示が戻る (" + share.recoveredLabel + ")");

  // --- 17. 共有ファイル同期（ハンドルを差し替えて検証） ---
  const sync = await page.evaluate(async (t) => {
    // 共有ファイルの中身を模したフェイクハンドル
    const file = { content: "", lastModified: 1000 };
    let pending = "";
    fileHandle = {
      name: "team-schedule.json",
      getFile: async () => ({
        lastModified: file.lastModified,
        text: async () => file.content,
      }),
      createWritable: async () => ({
        write: async d => { pending = d; },
        close: async () => { file.content = pending; file.lastModified++; },
      }),
    };

    // 他の人がすでに書き込んでいる状態を作る
    const other = { version: 1, members: [], tasks: [{
      id: "other1", memberIds: ["zzz"], title: "他の人の作業",
      start: `${t}T13:00`, end: `${t}T14:00`, color: "#4F6AF0",
      note: "", deleted: false, updatedAt: Date.now(),
    }]};
    file.content = JSON.stringify(other);

    // 自分の保存で、他の人の作業を消していないこと
    await saveToFile(true);
    const afterSave = JSON.parse(file.content).tasks.map(x => x.id);

    // 他の人がこちらの作業を削除 → ポーリング相当の再読込で反映されること
    const mine = JSON.parse(file.content).tasks.find(x => x.id === "x1");
    const remote2 = JSON.parse(file.content);
    remote2.tasks = remote2.tasks.map(x =>
      x.id === "x1" ? { id: "x1", deleted: true, updatedAt: Date.now() + 1000 } : x);
    file.content = JSON.stringify(remote2);
    file.lastModified++;
    await readFromFile(false);

    const res = {
      keptOther: afterSave.includes("other1"),
      keptMine: afterSave.includes("x1") && !!mine,
      deletionPropagated: !liveTasks().some(x => x.id === "x1"),
      dirtyCleared: dirty === false,
    };
    fileHandle = null;   // 以降のテストに影響させない
    return res;
  }, today);
  assert(sync.keptOther, "保存時に他の人の作業を消さない");
  assert(sync.keptMine,  "保存時に自分の作業が書き込まれる");
  assert(sync.deletionPropagated, "他の人の削除が再読込で反映される");
  assert(sync.dirtyCleared, "保存後は未保存フラグが消える");

  await page.click("#todayBtn");
  await page.screenshot({ path: OUT + "/week.png" });
  await page.click('#viewSeg button[data-view="day"]');
  await page.screenshot({ path: OUT + "/day.png" });

  assert(errors.length === 0, "JSエラーなし " + JSON.stringify(errors));

  summary();
  await browser.close();
  server.close();
})();
