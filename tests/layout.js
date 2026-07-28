const { OUT, chromiumPath, assert, summary } = require("./lib");
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const ROOT = path.join(__dirname, "..");
const SP = OUT;
const server = http.createServer((req, res) => {
  fs.readFile(path.join(ROOT, "gantt.html"), (e, d) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(d);
  });
});


async function setup(page, memberCount, tasksPerDay) {
  await page.evaluate(({ n, tpd }) => {
    state = { version: 1, members: [], tasks: [] };
    for (let i = 0; i < n; i++)
      state.members.push({ id: "m" + i, name: "メンバー" + (i + 1), order: i, deleted: false, updatedAt: 1 });
    const p = x => String(x).padStart(2, "0");
    const d = new Date();
    const t = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    for (let k = 0; k < tpd; k++)
      state.tasks.push({ id: "t" + k, memberIds: ["m0"], title: "作業" + (k + 1),
        start: `${t}T${p(8 + k)}:00`, end: `${t}T${p(9 + k)}:00`,
        color: "#4F6AF0", note: "", deleted: false, updatedAt: 1 });
    ui.view = "week"; ui.showList = true;
    changed();
  }, { n: memberCount, tpd: tasksPerDay });
}

(async () => {
  await new Promise(r => server.listen(8097, r));
  const browser = await chromium.launch({ executablePath: chromiumPath() });

  for (const [w, h] of [[1366, 620], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, timezoneId: "Asia/Tokyo" });
    await page.goto("http://localhost:8097/");
    await page.waitForSelector(".row");

    // ケースA: メンバーが少なく、予定が多い
    await setup(page, 3, 8);
    let m = await page.evaluate(() => ({
      body: document.body.scrollHeight, win: innerHeight,
      chart: document.getElementById("scroller").getBoundingClientRect().height,
      list: document.getElementById("daylist").getBoundingClientRect().height,
      listBottom: document.getElementById("daylist").getBoundingClientRect().bottom,
      hScroll: document.body.scrollWidth > document.body.clientWidth,
    }));
    assert(m.listBottom <= m.win + 1, `${w}x${h} 少人数: 一覧が画面内に収まる (bottom=${Math.round(m.listBottom)}/${m.win})`);
    assert(m.list > m.chart, `${w}x${h} 少人数: 余白が一覧側に配分される (chart=${Math.round(m.chart)}, list=${Math.round(m.list)})`);
    assert(!m.hScroll, `${w}x${h} 少人数: 画面全体は横スクロールしない`);
    await page.screenshot({ path: `${SP}/layout-${h}-few.png` });

    // ケースB: メンバーが多い
    await setup(page, 14, 3);
    m = await page.evaluate(() => ({
      win: innerHeight,
      chart: document.getElementById("scroller").getBoundingClientRect().height,
      list: document.getElementById("daylist").getBoundingClientRect().height,
      listBottom: document.getElementById("daylist").getBoundingClientRect().bottom,
      canScrollChart: document.getElementById("scroller").scrollHeight > document.getElementById("scroller").clientHeight,
    }));
    assert(m.listBottom <= m.win + 1, `${w}x${h} 多人数: 一覧が画面内に収まる (bottom=${Math.round(m.listBottom)}/${m.win})`);
    assert(m.chart >= 140, `${w}x${h} 多人数: チャートが潰れない (chart=${Math.round(m.chart)})`);
    assert(m.list >= 150, `${w}x${h} 多人数: 一覧も最低限の高さを保つ (list=${Math.round(m.list)})`);
    assert(m.chart <= m.win * 0.6 + 1, `${w}x${h} 多人数: チャートが画面の6割を超えない (chart=${Math.round(m.chart)})`);
    await page.screenshot({ path: `${SP}/layout-${h}-many.png` });

    await page.close();
  }
  summary();
  await browser.close(); server.close();
})();
