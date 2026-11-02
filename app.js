"use strict";
// 東寺百合（iPad版）：家のPCの東寺百合アプリから「持ち出しファイル」を取り込み、ネットが無くても目録を探す・読む・翻刻や自分の確認を打つ。
// 直したところは「持ち帰りファイル」にして家のPCに取り込む。データはこのiPadの中(IndexedDB)だけにあり、インターネット上には置かない。
const APPVER = "2026-11-02";
const $ = s => document.querySelector(s);
const main = () => $("#main");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const fmt = n => Number(n || 0).toLocaleString("ja-JP");
const yr = v => (v === null || v === undefined || v === "") ? "" : String(v).split(".")[0];
const nowStr = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const WEB = "https://hyakugo.pref.kyoto.lg.jp";
const HF = [["honkoku", "翻刻"], ["yomikudashi", "読下し"], ["gendaiyaku", "現代語訳"], ["goi", "語彙"]];
const SEARCH_COLS = ["函/番号", "文書名", "差出人", "宛名書", "端裏書", "事書", "書止", "人名", "地名", "寺社名", "その他事項", "備考"];

// ------------------------------------------------------------ IndexedDB
let IDB = null;
function idbOpen() {
  return new Promise((ok, ng) => {
    const r = indexedDB.open("toji-ipad", 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("kv");
      d.createObjectStore("kakunin", {keyPath: "cat_id"});
      d.createObjectStore("honkoku", {keyPath: "cat_id"});
      const im = d.createObjectStore("images", {keyPath: "key"}); im.createIndex("cat", "cat_id");
      d.createObjectStore("changes", {keyPath: "n", autoIncrement: true});
    };
    r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error);
  });
}
const tx = (stores, mode = "readonly") => IDB.transaction(stores, mode);
const req = r => new Promise((ok, ng) => { r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); });
const done = t => new Promise((ok, ng) => { t.oncomplete = ok; t.onerror = () => ng(t.error); t.onabort = () => ng(t.error || new Error("中断しました")); });
const kvGet = k => req(tx("kv").objectStore("kv").get(k));
const kvSet = (k, v) => { const t = tx("kv", "readwrite"); t.objectStore("kv").put(v, k); return done(t); };
const getAll = s => req(tx(s).objectStore(s).getAll());

// ------------------------------------------------------------ 読み込んだデータ(画面を開くとき全部メモリに)
let META = null, CAT = [], COL = {}, BYID = new Map(), BYCODE = new Map(), RINJI = [], RBYCODE = new Map(), K = new Map(), H = new Map(), IMGS = new Map(), FIELDS = [], NCHG = 0;
const cv = (r, k) => r[COL[k]];
async function loadAll() {
  META = await kvGet("meta");
  if (!META) return;
  const cat = await kvGet("catalog"); CAT = cat.rows; COL = {}; cat.cols.forEach((c, i) => COL[c] = i);
  BYID = new Map(CAT.map(r => [Number(cv(r, "id")), r])); BYCODE = new Map(CAT.map(r => [cv(r, "函/番号"), r]));
  RINJI = (await kvGet("rinji")) || []; RBYCODE = new Map(RINJI.map(r => [r["函/番号"], r]));
  FIELDS = META.fields || [];
  K = new Map((await getAll("kakunin")).map(r => [Number(r.cat_id), r]));
  H = new Map((await getAll("honkoku")).map(r => [Number(r.cat_id), r]));
  IMGS = new Map();
  const keys = await req(tx("images").objectStore("images").index("cat").getAllKeys());
  // getAllKeys on index returns primary keys; cat_id は key の "images/<id>/" から取る
  keys.forEach(k => { const m = String(k).match(/^images\/(\d+)\//); if (m) { const i = Number(m[1]); if (!IMGS.has(i)) IMGS.set(i, []); IMGS.get(i).push(k); } });
  IMGS.forEach(v => v.sort());
  NCHG = await req(tx("changes").objectStore("changes").count());
}
function foot() {
  $("#cbadge").textContent = NCHG || "";
  const on = navigator.onLine;
  $("#foot").innerHTML = META ? `持ち出し ${esc(META.exported_at)}<br>目録 ${fmt(CAT.length)} 件<br>画像 ${fmt(IMGS.size)} 文書分<br>iPadで直した ${fmt(NCHG)} か所<br><span class="${on ? "online" : "offline"}">${on ? "● ネットあり" : "● ネットなし"}</span><br><span style="opacity:.6">画面 ${APPVER}</span>`
    : `まだ持ち出しファイルを取り込んでいません<br><span style="opacity:.6">画面 ${APPVER}</span>`;
}

// ------------------------------------------------------------ 画像(重ねて開く)
function overlay(url) {
  $("#ov-body").innerHTML = `<img src="${esc(url)}" alt="">`; $("#ov").hidden = false;
}
$("#ov-x").addEventListener("click", () => { $("#ov").hidden = true; $("#ov-body").innerHTML = ""; });
const urlCache = new Map();
async function imgURL(key) {
  if (urlCache.has(key)) return urlCache.get(key);
  const r = await req(tx("images").objectStore("images").get(key)); if (!r) return "";
  const u = URL.createObjectURL(r.blob); urlCache.set(key, u); return u;
}

// ------------------------------------------------------------ 共通の部品
const stTag = s => s ? `<span class="tag ${s === "確認済" || s === "翻刻済" ? "ok" : s === "翻刻中" ? "warn" : "acc"}">${esc(s)}</span>` : "";
const honOf = id => { const h = H.get(id); return h && h.honkoku ? (h.checked === "1" ? "済" : "下案") : ""; };
const honTag = h => h ? `<span class="tag ${h === "済" ? "ok" : "acc"}">${h === "済" ? "翻刻済" : "翻刻下案"}</span>` : "";
const back = to => `<button class="btn" onclick="history.length > 1 ? history.back() : go('${to}')" style="margin-bottom:10px">← 前に戻る</button>`;
function rowObj(r) {
  const id = Number(cv(r, "id")), k = K.get(id) || {};
  return {id, code: cv(r, "函/番号"), title: k.title_fixed || cv(r, "文書名"), date: cv(r, "年月日"), year: cv(r, "年"), year_fixed: k.year_fixed, sender: cv(r, "差出人"), to: cv(r, "宛名書"), status: k.status, hon: honOf(id)};
}
function docRows(rows) {
  return `<table><tr><th>函/番号</th><th>文書名</th><th>年月日</th><th class="num">年</th><th>差出人</th><th>宛名</th><th>確認</th><th>翻刻</th></tr>
    ${rows.map(r => `<tr class="click" data-id="${r.id}"><td class="nw">${esc(r.code)}</td><td>${esc(r.title)}</td><td class="small">${esc(r.date)}</td>
      <td class="num">${r.year_fixed ? `<b>${esc(r.year_fixed)}</b>` : yr(r.year)}</td><td class="small">${esc(r.sender)}</td><td class="small">${esc(r.to)}</td><td>${stTag(r.status)}</td><td>${honTag(r.hon)}</td></tr>`).join("")}</table>`;
}
const bindRows = () => main().querySelectorAll("tr[data-id]").forEach(e => e.addEventListener("click", () => go("doc/" + e.dataset.id)));
function need() {
  if (META) return false;
  main().innerHTML = `<h2>まだデータがありません</h2><div class="card"><p>家のPCの東寺百合アプリで「持ち出しファイル」を作り、このiPadに渡してから、「持ち出し・持ち帰り」で取り込んでください。</p><button class="btn pri" onclick="go('mochi')">持ち出し・持ち帰りへ</button></div>`;
  return true;
}

// ------------------------------------------------------------ はじめに
async function viewHome() {
  const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
  main().innerHTML = `<h2>はじめに</h2>
    <p class="lead">家のPCの東寺百合アプリから持ち出したデータを、このiPadの中だけで使います。ネットが無くても、目録を探す・読む・翻刻や自分の確認を打つことができます。</p>
    ${META ? `<div class="cos">
      <div class="co"><span class="small">持ち出した日時</span><b style="font-size:18px">${esc(META.exported_at)}</b></div>
      <div class="co"><span class="small">目録の件数</span><b style="font-size:22px">${fmt(CAT.length)}</b></div>
      <div class="co"><span class="small">翻刻のある文書</span><b style="font-size:22px">${fmt([...H.values()].filter(h => h.honkoku).length)}</b></div>
      <div class="co"><span class="small">画像を入れた文書</span><b style="font-size:22px">${fmt(IMGS.size)}</b></div>
      <div class="co"><span class="small">iPadで直したところ</span><b style="font-size:22px">${fmt(NCHG)}</b></div>
    </div>` : `<div class="note">まだ持ち出しファイルを取り込んでいません。「持ち出し・持ち帰り」から取り込んでください。</div>`}
    <div class="card"><h3>使い方</h3><ol>
      <li>家のPCのアプリの「Excel・Wordに出力」で「持ち出しファイルを作る」。そのファイルを iCloud Drive などでこのiPadに渡し、ここの「持ち出し・持ち帰り」で取り込む。</li>
      <li>外では、ふつうに探して読み、翻刻や自分の確認を打つ（保存はこのiPadの中）。ネットのある所では、東寺百合文書WEBの原本画像も見られる。</li>
      <li>帰ったら「持ち出し・持ち帰り」で「持ち帰りファイルを作る」。それを家のPCのアプリで取り込む。</li>
      <li>次に持ち出すときは、PCで新しい持ち出しファイルを作って、ここで取り込み直す。</li></ol>
      <p class="small">この画面は、Safariの共有ボタン →「ホーム画面に追加」でアイコンにしておくと、ネットが無くても開けます。iPadの中のデータは、ホーム画面のアイコンから開いている限り消えません。</p>
      ${est ? `<p class="small muted">このiPadで使っている量：およそ ${fmt(Math.round(est.usage / 1e6))} MB</p>` : ""}</div>`;
}

// ------------------------------------------------------------ 目録を探す
function viewSearch(params) {
  if (need()) return;
  const p = Object.fromEntries(new URLSearchParams(params || ""));
  const boxes = [...new Set(CAT.map(r => cv(r, "函")))].filter(Boolean);
  const kinds = [...new Set(CAT.map(r => cv(r, "種類")))].filter(Boolean);
  main().innerHTML = `<h2>目録を探す</h2><p class="lead">函/番号・文書名・差出人・宛名・端裏書・事書・書止・人名・地名・寺社名・その他事項・備考と、翻刻・読下し・現代語訳・語彙から探します。空白で区切ると両方を含むものに絞ります。300件まで出します。</p>
    <div class="card"><div class="bar">
      <input type="search" id="q" placeholder="例：廿一口　大納言法印" style="width:300px" value="${esc(p.q || "")}">
      <select id="box"><option value="">函（すべて）</option>${boxes.map(b => `<option ${p.box === b ? "selected" : ""}>${esc(b)}</option>`).join("")}</select>
      <select id="kind"><option value="">種類（すべて）</option>${kinds.map(b => `<option ${p.kind === b ? "selected" : ""}>${esc(b)}</option>`).join("")}</select>
      <input type="text" inputmode="numeric" id="y1" placeholder="年から" style="width:80px" value="${esc(p.y1 || "")}">〜<input type="text" inputmode="numeric" id="y2" placeholder="年まで" style="width:80px" value="${esc(p.y2 || "")}">
      <label class="small"><input type="checkbox" id="rinji" ${p.rinji === "1" ? "checked" : ""}> 綸旨・院宣だけ</label>
      <label class="small"><input type="checkbox" id="mine" ${p.mine === "1" ? "checked" : ""}> 確かめた文書だけ</label>
      <label class="small"><input type="checkbox" id="hon" ${p.hon === "1" ? "checked" : ""}> 翻刻のある文書だけ</label>
      <label class="small"><input type="checkbox" id="img" ${p.img === "1" ? "checked" : ""}> 画像を入れた文書だけ</label>
      <button class="btn pri" id="b-go">探す</button><button class="btn" id="b-clear">条件を消す</button></div>
      <div id="res"><p class="small muted">語を入れて「探す」を押してください。</p></div></div>`;
  const run = () => {
    const q = {q: $("#q").value.trim(), box: $("#box").value, kind: $("#kind").value, y1: $("#y1").value, y2: $("#y2").value, rinji: $("#rinji").checked ? "1" : "", mine: $("#mine").checked ? "1" : "", hon: $("#hon").checked ? "1" : "", img: $("#img").checked ? "1" : ""};
    const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString();
    history.replaceState(null, "", "#search" + (s ? "?" + s : ""));
    if (!s) { $("#res").innerHTML = `<p class="small muted">条件がありません。</p>`; return; }
    const words = q.q.split(/[\s　]+/).filter(Boolean), y1 = Number(q.y1) || null, y2 = Number(q.y2) || null;
    const out = [];
    for (const r of CAT) {
      const id = Number(cv(r, "id"));
      if (q.box && cv(r, "函") !== q.box) continue;
      if (q.kind && cv(r, "種類") !== q.kind) continue;
      const y = Number(K.get(id)?.year_fixed || cv(r, "年")) || null;
      if ((y1 && (!y || y < y1)) || (y2 && (!y || y > y2))) continue;
      if (q.rinji && !RBYCODE.has(cv(r, "函/番号"))) continue;
      if (q.mine && !K.has(id)) continue;
      if (q.hon && !honOf(id)) continue;
      if (q.img && !IMGS.has(id)) continue;
      if (words.length) {
        const h = H.get(id) || {};
        const text = SEARCH_COLS.map(k => cv(r, k) || "").join("\n") + "\n" + HF.map(([k]) => h[k] || "").join("\n");
        if (!words.every(w => text.includes(w))) continue;
      }
      out.push(r);
    }
    out.sort((a, b) => (Number(cv(a, "年")) || 99999) - (Number(cv(b, "年")) || 99999));
    $("#res").innerHTML = `<p class="small"><b>${fmt(out.length)}</b> 件${out.length > 300 ? "（先頭300件を表示）" : ""}</p>` + docRows(out.slice(0, 300).map(rowObj));
    bindRows();
  };
  $("#b-go").addEventListener("click", run);
  main().querySelectorAll("input").forEach(e => e.addEventListener("keydown", ev => { if (ev.key === "Enter") run(); }));
  $("#b-clear").addEventListener("click", () => go("search"));
  if (Object.keys(p).length) run();
}

// ------------------------------------------------------------ 綸旨・院宣
function viewRinji() {
  if (need()) return;
  const rows = [...RINJI].sort((a, b) => a.No - b.No);
  const tennos = [...new Set(rows.map(r => r["天皇・上皇"]))];
  main().innerHTML = `<h2>綸旨・院宣</h2><p class="lead">統合一覧の ${rows.length} 件です。行を押すと1件の画面になります。</p>
    <div class="card"><div class="bar"><select id="tn"><option value="">天皇・上皇（すべて）</option>${tennos.map(t => `<option>${esc(t)}</option>`).join("")}</select>
      <input type="search" id="q" placeholder="絞り込み"><span class="small" id="cnt"></span></div>
    <table><tr><th class="num">No</th><th>天皇・上皇</th><th>函/番号</th><th>文書名</th><th>年月日</th><th class="num">年次</th><th>奉者</th><th>宛所</th><th>翻刻</th></tr>
    ${rows.map(r => { const c = BYCODE.get(r["函/番号"]); const id = c ? Number(cv(c, "id")) : 0;
      return `<tr class="click" data-id="${id}" data-tn="${esc(r["天皇・上皇"])}"><td class="num">${r.No}</td><td class="nw">${esc(r["天皇・上皇"])}</td><td class="nw">${esc(r["函/番号"])}</td><td>${esc(r.文書名)}</td><td class="small">${esc(r.年月日)}</td><td class="num">${yr(r["年次（比定）"])}</td><td class="small">${esc(r["差出（奉者）"])}</td><td class="small">${esc(r.宛所)}</td><td>${honTag(honOf(id))}</td></tr>`; }).join("")}</table></div>`;
  const f = () => { const tn = $("#tn").value, q = $("#q").value.trim(); let n = 0;
    main().querySelectorAll("tr[data-id]").forEach(tr => { const ok = (!tn || tr.dataset.tn === tn) && (!q || tr.textContent.includes(q)); tr.hidden = !ok; if (ok) n++; }); $("#cnt").textContent = `${n} 件`; };
  ["#tn", "#q"].forEach(s => $(s).addEventListener("input", f)); f(); bindRows();
}

// ------------------------------------------------------------ 1件の画面
function honCard(h) {
  h = h || {};
  if (!HF.some(([k]) => h[k])) return `<div class="card"><h3>翻刻</h3><p class="small muted">まだありません。「翻刻を打つ」で入れられます。</p></div>`;
  return `<div class="card"><h3>翻刻 ${h.checked === "1" ? `<span class="tag ok">原本で確かめた</span>` : `<span class="tag acc">下案（まだ原本で確かめていない）</span>`}</h3>
    <div class="honview">${HF.filter(([k]) => h[k]).map(([k, lab]) => `<div class="honcol"><b>【${lab}】</b><div class="tate">${esc(h[k])}</div></div>`).join("")}</div>
    ${h.src ? `<p class="small muted">出典・メモ：${esc(h.src)}</p>` : ""}</div>`;
}
async function viewDoc(id) {
  if (need()) return;
  const r = BYID.get(id); if (!r) { main().innerHTML = "<p>ありません。</p>"; return; }
  const k = K.get(id) || {}, code = cv(r, "函/番号"), rj = RBYCODE.get(code);
  const kv = (lab, v) => `<dt>${esc(lab)}</dt><dd>${v === "" || v == null ? "<span class='muted'>—</span>" : esc(v)}</dd>`;
  const fixed = FIELDS.filter(f => k[f.key]);
  main().innerHTML = `${back("search")}
    <div class="doc-title"><h2>${esc(code)}　${esc(k.title_fixed || cv(r, "文書名"))}</h2>${stTag(k.status)}<span style="flex:1"></span>
      <button class="btn" id="b-hon">翻刻を打つ</button><button class="btn" id="b-word">この文書をWordで</button><button class="btn pri" id="b-edit">自分の確認を${fixed.length ? "直す" : "入れる"}</button></div>
    <div class="grid2">
      <div class="card"><h3>目録（東寺百合文書WEBのとおり）</h3><dl class="kv">
        ${["文書名", "年月日", "年", "寸法（mm）", "差出人", "宛名書", "端裏書", "事書", "書止", "人名", "地名", "寺社名", "その他事項", "備考"].map(x => kv(x, x === "年" ? yr(cv(r, x)) : cv(r, x))).join("")}
        ${kv("目録のid", id)}</dl>${navigator.onLine ? `<p><a class="btn" href="${WEB}/contents/detail.php?id=${id}" target="_blank" rel="noopener">東寺百合文書WEBで見る</a></p>` : ""}</div>
      <div class="card"><h3>自分の確認</h3>${fixed.length ? `<dl class="kv">${fixed.map(f => kv(f.label, k[f.key])).join("")}</dl><p class="small">更新 ${esc(k.updated_at)}</p>` : `<p class="small muted">まだ入れていません。</p>`}
      ${rj ? `<h3 style="margin-top:16px">綸旨・院宣の統合一覧</h3><dl class="kv">${["No", "天皇・上皇", "区分", "年次（比定）", "比定の根拠", "状況", "翻刻ノート", "対応する正文", "正文との違い", "後続の文書（寺務→東寺）", "後続メモ", "メモ"].filter(x => rj[x]).map(x => kv(x, rj[x])).join("")}</dl>` : ""}</div>
    </div>
    ${honCard(H.get(id))}
    <div class="card"><h3>このiPadに入れた画像</h3><div id="loc" class="thumbs"></div></div>
    ${cv(r, "VOLUME_ID") ? `<div class="card"><h3>原本画像（東寺百合文書WEB）</h3>${navigator.onLine ? `<div id="web" class="thumbs"></div>` : `<p class="small muted">ネットにつながっていないので見られません。</p>`}</div>` : ""}`;
  $("#b-edit").addEventListener("click", () => go("edit/" + id));
  $("#b-hon").addEventListener("click", () => go("honkoku/" + id));
  $("#b-word").addEventListener("click", () => wordOne(id));
  const loc = $("#loc"), ks = IMGS.get(id) || [];
  if (!ks.length) loc.innerHTML = `<p class="small muted">入れていません（PCで持ち出しファイルを作るときに選べます）。</p>`;
  for (const key of ks) { const u = await imgURL(key); const s = document.createElement("span"); s.innerHTML = `<img src="${u}" alt=""><small>${esc(key.split("/").pop())}</small>`; s.addEventListener("click", () => overlay(u)); loc.append(s); }
  const web = $("#web");
  if (web) {
    const base = `${WEB}/contents/images/${cv(r, "VOLUME_ID")}/img/`;
    const next = n => { if (n > 120) return; const p = String(n).padStart(4, "0"), img = new Image();
      img.onload = () => { const s = document.createElement("span"); s.append(img); const sm = document.createElement("small"); sm.textContent = n; s.append(sm); s.addEventListener("click", () => overlay(base + p + "/400_0.jpg")); web.append(s); next(n + 1); };
      img.onerror = () => { if (n === 1) web.innerHTML = `<p class="small muted">読み込めませんでした。</p>`; };
      img.src = base + p + "/200_0.jpg"; };
    next(1);
  }
}

// ------------------------------------------------------------ 保存(直したところは changes に記録して持ち帰る)
async function saveRow(store, id, data, labels) {
  const cur = (store === "kakunin" ? K : H).get(id) || {cat_id: id};
  const ch = Object.keys(data).filter(k => String(cur[k] ?? "") !== String(data[k] ?? ""));
  if (!ch.length) return 0;
  const t = nowStr(), row = {...cur, ...data, updated_at: t};
  if (store === "kakunin" && !cur.created_at) row.created_at = t;
  const T = tx([store, "changes"], "readwrite");
  T.objectStore(store).put(row);
  ch.forEach(k => T.objectStore("changes").add({cat_id: id, tbl: store, field: k, label: labels[k] || k, old: String(cur[k] ?? ""), new: String(data[k] ?? ""), at: t}));
  await done(T);
  (store === "kakunin" ? K : H).set(id, row); NCHG += ch.length; foot();
  return ch.length;
}

function viewEdit(id) {
  if (need()) return;
  const r = BYID.get(id), k = K.get(id) || {};
  const input = f => {
    const v = esc(k[f.key] ?? "");
    if (f.type === "select") return `<select data-k="${f.key}"><option value=""></option>${f.options.map(o => `<option ${k[f.key] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    if (f.type === "textarea") return `<textarea data-k="${f.key}" rows="4" style="width:100%">${v}</textarea>`;
    return `<input data-k="${f.key}" type="text" value="${v}" style="width:100%">`;
  };
  const hint = {title_fixed: cv(r, "文書名"), year_fixed: yr(cv(r, "年")), date_fixed: cv(r, "年月日"), sender_fixed: cv(r, "差出人"), to_fixed: cv(r, "宛名書"), kakidome_fixed: cv(r, "書止")};
  main().innerHTML = `${back("doc/" + id)}<h2>自分の確認　${esc(cv(r, "函/番号"))}　${esc(cv(r, "文書名"))}</h2>
    <p class="lead">確かめた値だけを入れてください。保存はこのiPadの中です（持ち帰りファイルで家のPCに入れます）。</p>
    <div class="card form">${FIELDS.map(f => `<div class="row"><label>${esc(f.label)}</label><div>${input(f)}${hint[f.key] !== undefined ? `<div class="small muted">目録：${esc(hint[f.key] || "—")}</div>` : ""}</div></div>`).join("")}
    <div class="bar" style="margin-top:12px"><button class="btn pri" id="b-save">保存</button><button class="btn" id="b-cancel">やめる</button><span class="small" id="msg"></span></div></div>`;
  $("#b-cancel").addEventListener("click", () => go("doc/" + id));
  $("#b-save").addEventListener("click", async () => {
    const data = {}; main().querySelectorAll("[data-k]").forEach(e => data[e.dataset.k] = e.value.trim());
    const labels = Object.fromEntries(FIELDS.map(f => [f.key, f.label]));
    try { await saveRow("kakunin", id, data, labels); go("doc/" + id); } catch (ex) { $("#msg").textContent = "保存できませんでした：" + ex.message; }
  });
}

// ------------------------------------------------------------ 翻刻を打つ
async function viewHonkoku(id) {
  if (need()) return;
  const r = BYID.get(id), h = H.get(id) || {}, code = cv(r, "函/番号");
  main().innerHTML = `${back("doc/" + id)}<div class="doc-title"><h2>翻刻　${esc(code)}　${esc((K.get(id) || {}).title_fixed || cv(r, "文書名"))}</h2></div>
    <p class="small muted">${esc(cv(r, "年月日") || "")}｜差出：${esc(cv(r, "差出人") || "")}｜宛名：${esc(cv(r, "宛名書") || "")}｜書止：${esc(cv(r, "書止") || "")}</p>
    <div class="honwrap">
      <div class="card honimg">
        <div class="bar"><b id="srcname">原本の画像</b><span style="flex:1"></span><button class="btn sm" id="b-src" hidden></button></div>
        <div class="bar"><button class="btn" id="b-back">◀ 前</button><select id="fsel"></select><button class="btn" id="b-fwd">次 ▶</button>
          <button class="btn sm" id="b-mark">この文書はこのコマ</button><span style="flex:1"></span><input type="range" id="zoom" min="40" max="300" value="100" style="width:100px"></div>
        <p class="small" id="komanote"></p>
        <div class="imgbox"><p class="small muted" id="imgmsg">画像を読んでいます…</p><img id="big" alt=""></div></div>
      <div class="card honform">
        ${HF.map(([k, lab]) => `<label class="hl">${lab}</label><textarea data-h="${k}" rows="${k === "honkoku" ? 9 : 5}">${esc(h[k] || "")}</textarea>`).join("")}
        <label class="small"><input type="checkbox" id="chk" ${h.checked === "1" ? "checked" : ""}> 原本で確かめた</label>
        ${h.src ? `<p class="small muted">下案の出典・メモ：${esc(h.src)}</p>` : ""}
        <div class="bar" style="margin-top:8px"><button class="btn pri" id="b-save">保存</button><button class="btn" id="b-prev">縦書きで見る</button><span class="small" id="msg"></span></div>
        <div id="prev" class="honview" hidden></div></div>
    </div>`;
  const big = $("#big"), sel = $("#fsel"); let frames = [], cur = 0, koma = Number(h.koma || 0), jumped = false;
  const show = i => { if (!frames.length) return; cur = Math.max(0, Math.min(frames.length - 1, i)); Promise.resolve(frames[cur].url()).then(u => { big.src = u; }); sel.value = cur; };
  const fill = () => { sel.innerHTML = frames.map((f, i) => `<option value="${i}">${esc(f.label)}（${i + 1}／${frames.length}）</option>`).join(""); };
  const fnum = f => { const m = f.label.match(/(\d{1,4})(?:コマ目|\.\w+$)/); return m ? Number(m[1]) : null; };
  const jump = () => { if (!koma || jumped) return; const i = frames.findIndex(f => fnum(f) === koma); if (i >= 0) { jumped = true; show(i); } };
  const kn = () => { $("#komanote").innerHTML = koma ? `この文書は <b>${koma}コマ目</b> に写っています。` : ""; }; kn();
  big.onload = () => { $("#imgmsg").hidden = true; };
  sel.addEventListener("change", () => show(Number(sel.value)));
  $("#b-back").addEventListener("click", () => show(cur - 1)); $("#b-fwd").addEventListener("click", () => show(cur + 1));
  const ks = IMGS.get(id) || [];
  const useLocal = () => { frames = ks.map(k => ({label: k.split("/").pop(), url: () => imgURL(k)})); $("#srcname").textContent = "原本の画像（このiPadに入れた分）"; jumped = false; fill(); show(0); jump(); };
  const useWEB = () => {
    frames = []; sel.innerHTML = ""; jumped = false; $("#srcname").textContent = "原本の画像（東寺百合文書WEB）"; $("#imgmsg").hidden = false; $("#imgmsg").textContent = "画像を読んでいます…";
    const base = `${WEB}/contents/images/${cv(r, "VOLUME_ID")}/img/`;
    const next = n => { if (n > 400) return; const p = String(n).padStart(4, "0"), t = new Image();
      t.onload = () => { frames.push({label: `${n}コマ目`, url: () => base + p + "/400_0.jpg"}); fill(); if (frames.length === 1) show(0); else sel.value = cur; jump(); next(n + 1); };
      t.onerror = () => { if (!frames.length) $("#imgmsg").textContent = "画像を読み込めませんでした。"; };
      t.src = base + p + "/tmb.jpg"; };
    next(1);
  };
  const canWeb = cv(r, "VOLUME_ID") && navigator.onLine, sw = $("#b-src");
  if (ks.length && canWeb) { sw.hidden = false; let loc = true; sw.textContent = "東寺百合文書WEBの画像にする";
    sw.addEventListener("click", () => { loc = !loc; loc ? useLocal() : useWEB(); sw.textContent = loc ? "東寺百合文書WEBの画像にする" : "このiPadの画像にする"; }); }
  if (ks.length) useLocal(); else if (canWeb) useWEB();
  else $("#imgmsg").textContent = cv(r, "VOLUME_ID") ? "この文書の画像はiPadに入れていません。ネットのある所では東寺百合文書WEBの画像が見られます。" : "この文書には画像がありません。";
  $("#zoom").addEventListener("input", e => { big.style.width = e.target.value + "%"; });
  big.addEventListener("click", () => { if (big.src) overlay(big.src); });
  $("#b-mark").addEventListener("click", async () => { const f = frames[cur], n = f && fnum(f); if (!n) { $("#komanote").textContent = "このコマの番号が分かりません。"; return; }
    await saveRow("honkoku", id, {koma: String(n)}, {koma: "翻刻：この文書のコマ"}); koma = n; kn(); });
  const val = () => { const o = {}; main().querySelectorAll("[data-h]").forEach(e => o[e.dataset.h] = e.value.replace(/\s+$/, "")); o.checked = $("#chk").checked ? "1" : ""; return o; };
  $("#b-prev").addEventListener("click", () => { const v = val(), p = $("#prev"); p.hidden = !p.hidden;
    p.innerHTML = HF.filter(([k]) => v[k]).map(([k, lab]) => `<div class="honcol"><b>【${lab}】</b><div class="tate">${esc(v[k])}</div></div>`).join("") || "<p class='small muted'>まだ何も入っていません。</p>"; });
  let dirty = false; main().querySelectorAll("[data-h]").forEach(e => e.addEventListener("input", () => { dirty = true; $("#msg").textContent = "まだ保存していません"; }));
  $("#b-save").addEventListener("click", async () => {
    try { const labels = Object.fromEntries(HF.map(([k, l]) => [k, "翻刻：" + l])); labels.checked = "翻刻：原本で確かめた";
      const n = await saveRow("honkoku", id, val(), labels); dirty = false; $("#msg").textContent = n ? `保存しました（${n}か所）` : "変わったところはありません"; }
    catch (ex) { $("#msg").textContent = "保存できませんでした：" + ex.message; }
  });
  window.onbeforeunload = () => dirty ? "保存していません" : undefined;
}

// ------------------------------------------------------------ 一覧
function viewMine() {
  if (need()) return;
  const rows = [...K.keys()].map(i => BYID.get(i)).filter(Boolean).map(rowObj);
  main().innerHTML = `<h2>確かめた文書</h2><p class="lead">${fmt(rows.length)} 件</p><div class="card">${docRows(rows)}</div>`; bindRows();
}
function viewHonlist() {
  if (need()) return;
  const rows = [...H.values()].filter(h => h.honkoku).map(h => BYID.get(Number(h.cat_id))).filter(Boolean).map(rowObj);
  main().innerHTML = `<h2>翻刻のある文書</h2><p class="lead">${fmt(rows.length)} 件</p><div class="card">${docRows(rows)}</div>`; bindRows();
}
async function viewChanges() {
  if (need()) return;
  const ch = await getAll("changes");
  main().innerHTML = `<h2>iPadで直したところ</h2><p class="lead">持ち出してから、このiPadで直したところです（${fmt(ch.length)} か所）。「持ち出し・持ち帰り」で持ち帰りファイルにして、家のPCに入れます。</p>
    <div class="card">${ch.length ? `<table><tr><th>日時</th><th>函/番号</th><th>項目</th><th>前</th><th>後</th></tr>${ch.slice().reverse().map(x => { const r = BYID.get(Number(x.cat_id));
      return `<tr class="click" data-id="${x.cat_id}"><td class="small nw">${esc(x.at)}</td><td class="nw">${esc(r ? cv(r, "函/番号") : x.cat_id)}</td><td>${esc(x.label)}</td><td class="small">${esc(x.old.slice(0, 60))}</td><td class="small">${esc(x.new.slice(0, 60))}</td></tr>`; }).join("")}</table>` : `<p class="small muted">まだありません。</p>`}</div>`;
  bindRows();
}

// ------------------------------------------------------------ 持ち出し・持ち帰り
async function share(blob, name) {
  const file = new File([blob], name, {type: blob.type});
  if (navigator.canShare && navigator.canShare({files: [file]})) { try { await navigator.share({files: [file], title: name}); return "共有しました"; } catch (ex) { if (ex.name === "AbortError") return "やめました"; } }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000); return "保存しました（ダウンロード）";
}
async function viewMochi() {
  const sent = await kvGet("sent_at");
  main().innerHTML = `<h2>持ち出し・持ち帰り</h2>
    <div class="card"><h3>① 持ち出しファイルを取り込む</h3>
      <p>家のPCのアプリで作った「東寺百合_持ち出し_….zip」を選びます（ファイル App の iCloud Drive などから）。</p>
      ${META ? `<p class="small">いま入っているもの：${esc(META.exported_at)} に持ち出した分。取り込むと、いまiPadにあるデータは入れ替わります。</p>` : ""}
      <div class="bar"><input type="file" id="f-in" accept=".zip,application/zip"><button class="btn pri" id="b-in">取り込む</button></div><p class="small" id="in-msg"></p></div>
    <div class="card"><h3>② 持ち帰りファイルを作る</h3>
      <p>このiPadで直したところ（${fmt(NCHG)} か所）を1つのファイルにします。共有の画面が出たら「ファイルに保存」（iCloud Drive など）やメール・AirDropで家のPCに渡し、PCのアプリの「Excel・Wordに出力」→「持ち帰る」で取り込みます。</p>
      ${sent ? `<p class="small muted">前に作ったのは ${esc(sent)}</p>` : ""}
      <div class="bar"><button class="btn pri" id="b-out" ${NCHG ? "" : "disabled"}>持ち帰りファイルを作る</button><span class="small" id="out-msg"></span></div></div>
    <div class="card"><h3>この画面について</h3><p class="small">データはこのiPadの中にだけあり、インターネットには送りません。画面の仕組みだけをインターネット上から読み込み、一度読み込めばネットが無くても開けます。画面 ${APPVER}</p>
      <button class="btn sm" id="b-upd">画面を新しくする（ネットのある所で）</button></div>`;
  $("#b-upd").addEventListener("click", async () => { if (navigator.serviceWorker) { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update(); } location.reload(); });
  $("#b-in").addEventListener("click", async () => {
    const f = $("#f-in").files[0], msg = $("#in-msg"); if (!f) { msg.textContent = "ファイルを選んでください。"; return; }
    if (NCHG && !(sent && (await kvGet("sent_n")) === NCHG) && !confirm(`このiPadで直したところが ${NCHG} か所あり、まだ持ち帰りファイルにしていません。取り込むと消えます。取り込みますか？`)) return;
    try { await importZip(f, t => msg.textContent = t); msg.textContent = "取り込みました。"; await loadAll(); foot(); }
    catch (ex) { msg.textContent = "取り込めませんでした：" + ex.message; }
  });
  $("#b-out").addEventListener("click", async () => {
    const ch = await getAll("changes"), ids = {kakunin: {}, honkoku: {}};
    ch.forEach(x => { (ids[x.tbl][x.cat_id] = ids[x.tbl][x.cat_id] || new Set()).add(x.field); });
    const rows = tbl => Object.entries(ids[tbl]).map(([i, set]) => ({...((tbl === "kakunin" ? K : H).get(Number(i)) || {cat_id: Number(i)}), _changed: [...set]}));
    const d = {format: "toji-mochikaeri", version: 1, based_on: META.exported_at, made_at: nowStr(), kakunin: rows("kakunin"), honkoku: rows("honkoku"), history: ch};
    const stamp = nowStr().replace(/[-: ]/g, "").slice(0, 12);
    const r = await share(new Blob([JSON.stringify(d)], {type: "application/json"}), `東寺百合_持ち帰り_${stamp}.json`);
    await kvSet("sent_at", nowStr()); await kvSet("sent_n", NCHG); $("#out-msg").textContent = r;
  });
}
async function importZip(file, say) {
  say("ファイルを開いています…");
  const z = await JSZip.loadAsync(file);
  const dj = z.file("data.json"); if (!dj) throw new Error("持ち出しファイルではありません（data.json がありません）");
  say("目録を読んでいます…");
  const d = JSON.parse(await dj.async("string"));
  if (d.format !== "toji-mochidashi") throw new Error("持ち出しファイルではありません");
  const imgs = d.images || [];
  // まず全部消してから入れる
  let T = tx(["kv", "kakunin", "honkoku", "images", "changes"], "readwrite");
  ["kv", "kakunin", "honkoku", "images", "changes"].forEach(s => T.objectStore(s).clear());
  T.objectStore("kv").put({cols: d.catalog_cols, rows: d.catalog}, "catalog");
  T.objectStore("kv").put(d.rinji, "rinji");
  d.kakunin.forEach(r => T.objectStore("kakunin").put(r));
  d.honkoku.forEach(r => T.objectStore("honkoku").put(r));
  await done(T);
  for (let i = 0; i < imgs.length; i += 20) {
    const part = imgs.slice(i, i + 20), blobs = [];
    for (const [cat, arc] of part) { const zf = z.file(arc); if (zf) blobs.push([cat, arc, await zf.async("blob")]); }
    T = tx("images", "readwrite");
    blobs.forEach(([cat, arc, b]) => T.objectStore("images").put({key: arc, cat_id: Number(cat), blob: new Blob([b], {type: /\.png$/i.test(arc) ? "image/png" : "image/jpeg"})}));
    await done(T); say(`画像を入れています… ${Math.min(i + 20, imgs.length)}／${imgs.length}`);
  }
  await kvSet("meta", {exported_at: d.exported_at, fields: d.fields, loaded_at: nowStr()});
  await kvSet("sent_at", null); await kvSet("sent_n", 0);
  urlCache.forEach(u => URL.revokeObjectURL(u)); urlCache.clear();
}

// ------------------------------------------------------------ Word(縦書き・A4横)とExcel
const xe = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const RPR = (sz, b, col) => `<w:rPr><w:rFonts w:ascii="游明朝" w:hAnsi="游明朝" w:eastAsia="游明朝"/>${b ? "<w:b/>" : ""}${col ? `<w:color w:val="${col}"/>` : ""}<w:sz w:val="${sz}"/></w:rPr>`;
const P = (t, sz = 21, b = false, col = "") => `<w:p><w:r>${RPR(sz, b, col)}<w:t xml:space="preserve">${xe(t)}</w:t></w:r></w:p>`;
const PBR = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
function pageXML(id) {
  const r = BYID.get(id), k = K.get(id) || {}, h = H.get(id) || {}, rj = RBYCODE.get(cv(r, "函/番号")) || {};
  let x = P(`${cv(r, "函/番号")}　${k.title_fixed || cv(r, "文書名") || ""}`, 26, true);
  x += P(`No.${rj.No || ""}｜${k.date_fixed || cv(r, "年月日") || ""}${(k.year_fixed || yr(cv(r, "年"))) ? `（${k.year_fixed || yr(cv(r, "年"))}）` : ""}｜差出：${k.sender_fixed || cv(r, "差出人") || ""}｜宛所：${k.to_fixed || cv(r, "宛名書") || ""}｜目録id ${id}`, 18, false, "555555");
  HF.forEach(([key, lab]) => { x += P(`【${lab}】`, 22, true); (h[key] || "").split("\n").forEach(l => x += P(l)); });
  if (h.src || h.checked) x += P((h.checked === "1" ? "原本で確かめた　" : "まだ原本で確かめていない　") + (h.src || ""), 18, false, "555555");
  return x;
}
async function docxBlob(ids, title) {
  let body = title ? P(title, 36, true) : "";
  ids.forEach((id, i) => { if (i || title) body += PBR; body += pageXML(id); });
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/><w:textDirection w:val="tbRl"/></w:sectPr></w:body></w:document>`;
  const z = new JSZip();
  z.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file("word/document.xml", doc);
  return z.generateAsync({type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
}
const codeFile = id => String(cv(BYID.get(id), "函/番号")).replace(/\/$/, "").replace(/\//g, "-");
async function wordOne(id) { return share(await docxBlob([id]), `翻刻_${codeFile(id)}.docx`); }
async function wordAll(say) {
  const rows = [...RINJI].sort((a, b) => a.No - b.No), groups = new Map();
  rows.forEach(r => { const c = BYCODE.get(r["函/番号"]); if (!c) return; const g = r["天皇・上皇"] || "その他"; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(Number(cv(c, "id"))); });
  const z = new JSZip(); let i = 0;
  for (const [g, ids] of groups) { i++; say(`作っています… ${i}／${groups.size}`); z.file(`翻刻_${String(i).padStart(2, "0")}_${g}.docx`, await docxBlob(ids, `${g}　翻刻（${ids.length}点）`)); }
  const stamp = nowStr().replace(/[-: ]/g, "").slice(0, 12);
  return share(await z.generateAsync({type: "blob", mimeType: "application/zip"}), `翻刻Word_${stamp}.zip`);
}
function loadXLSX() {
  return new Promise((ok, ng) => { if (window.XLSX) return ok(); const s = document.createElement("script"); s.src = "lib/xlsx.full.min.js"; s.onload = ok; s.onerror = () => ng(new Error("Excelの部品を読めませんでした")); document.head.append(s); });
}
async function excelOut(kind) {
  await loadXLSX();
  const stamp = nowStr().replace(/[-: ]/g, "").slice(0, 12); let aoa, name, sheet;
  if (kind === "hon") {
    aoa = [["目録id", "函/番号", "文書名", "年月日", "年", "差出", "宛所", "翻刻", "読下し", "現代語訳", "語彙", "原本で確かめた", "下案の出典・メモ"]];
    [...H.values()].filter(h => h.honkoku || h.yomikudashi).forEach(h => { const id = Number(h.cat_id), r = BYID.get(id), k = K.get(id) || {}; if (!r) return;
      aoa.push([id, cv(r, "函/番号"), k.title_fixed || cv(r, "文書名"), k.date_fixed || cv(r, "年月日"), k.year_fixed || yr(cv(r, "年")), k.sender_fixed || cv(r, "差出人"), k.to_fixed || cv(r, "宛名書"), h.honkoku, h.yomikudashi, h.gendaiyaku, h.goi, h.checked === "1" ? "済" : "", h.src]); });
    name = `東寺百合_翻刻一覧_${stamp}.xlsx`; sheet = "翻刻";
  } else {
    aoa = [["目録id", "函/番号", "目録の文書名", "目録の年月日", "目録の年", ...FIELDS.map(f => f.label), "更新"]];
    [...K.values()].forEach(k => { const id = Number(k.cat_id), r = BYID.get(id); if (!r) return; aoa.push([id, cv(r, "函/番号"), cv(r, "文書名"), cv(r, "年月日"), yr(cv(r, "年")), ...FIELDS.map(f => k[f.key] || ""), k.updated_at]); });
    name = `東寺百合_自分の確認_${stamp}.xlsx`; sheet = "自分の確認";
  }
  const wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet(aoa); XLSX.utils.book_append_sheet(wb, ws, sheet);
  const buf = XLSX.write(wb, {type: "array", bookType: "xlsx"});
  return share(new Blob([buf], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}), name);
}
function viewExport() {
  if (need()) return;
  main().innerHTML = `<h2>Word・Excelに出力</h2>
    <div class="card"><h3>翻刻を縦書きのWordに</h3><p>家のPCと同じ形（A4横・縦書き・1文書1ページ、【翻刻】【読下し】【現代語訳】【語彙】）で、このiPadにある内容から作ります。1文書だけなら、その文書の画面の「この文書をWordで」。</p>
      <div class="bar"><button class="btn pri" id="b-w">綸旨・院宣を天皇・上皇ごとにWordで（zip）</button><span class="small" id="w-msg"></span></div></div>
    <div class="card"><h3>Excel</h3><div class="bar"><button class="btn" id="b-xh">翻刻の一覧</button><button class="btn" id="b-xk">自分の確認の一覧</button><span class="small" id="x-msg"></span></div></div>
    <p class="small">できたファイルは共有の画面から「ファイルに保存」やメールで渡せます。</p>`;
  $("#b-w").addEventListener("click", async () => { try { $("#w-msg").textContent = await wordAll(t => $("#w-msg").textContent = t); } catch (ex) { $("#w-msg").textContent = ex.message; } });
  $("#b-xh").addEventListener("click", async () => { try { $("#x-msg").textContent = await excelOut("hon"); } catch (ex) { $("#x-msg").textContent = ex.message; } });
  $("#b-xk").addEventListener("click", async () => { try { $("#x-msg").textContent = await excelOut("kak"); } catch (ex) { $("#x-msg").textContent = ex.message; } });
}

// ------------------------------------------------------------ 画面の切り替え
function go(h) { if (location.hash === "#" + h) route(); else location.hash = h; }
async function route() {
  window.onbeforeunload = null;
  const h = decodeURIComponent(location.hash.slice(1)) || "home";
  const [path, params] = h.split("?"); const [v, arg] = path.split("/");
  document.querySelectorAll("nav a[data-view]").forEach(x => x.classList.toggle("on", x.dataset.view === v || (["doc", "edit", "honkoku"].includes(v) && x.dataset.view === "search")));
  try {
    if (v === "doc") await viewDoc(Number(arg)); else if (v === "edit") viewEdit(Number(arg)); else if (v === "honkoku") await viewHonkoku(Number(arg));
    else if (v === "search") viewSearch(params); else if (v === "rinji") viewRinji(); else if (v === "mine") viewMine(); else if (v === "honlist") viewHonlist();
    else if (v === "changes") await viewChanges(); else if (v === "mochi") await viewMochi(); else if (v === "export") viewExport(); else await viewHome();
    window.scrollTo(0, 0);
  } catch (ex) { main().innerHTML = `<div class="note">表示できませんでした: ${esc(ex.message)}</div>`; }
}
document.querySelectorAll("nav a[data-view]").forEach(x => x.addEventListener("click", () => go(x.dataset.view)));
window.addEventListener("hashchange", route);
window.addEventListener("online", foot); window.addEventListener("offline", foot);
(async () => {
  try {
    IDB = await idbOpen(); await loadAll(); foot(); await route();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (ex) { main().innerHTML = `<div class="note">開けませんでした: ${esc(ex.message)}</div>`; }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
