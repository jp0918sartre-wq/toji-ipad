"use strict";
// 都名所（iPad）: 家のPCの「都名所アプリ」から持ち出したデータを、iPadの中(IndexedDB)だけで使う。
// ネットが無くても、名所を年代順に見る・引き比べる・翻刻などを打つ・掛詞を直す・Word/Excelに書き出す、ができる。
const APPVER = "2026-11-02";
const $ = s => document.querySelector(s);
const main = () => $("#main");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const fmt = n => Number(n || 0).toLocaleString("ja-JP");
const kt = s => esc(s).replace(/｛([^｛｝]{1,3})｝/g, '<span class="kt">$1</span>');
const nowStr = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
let HF = [["honkoku", "翻刻"], ["hakubun", "白文"], ["yomi", "読下し"], ["gendai", "現代語訳"], ["goi", "語彙"], ["chu", "註"]];
const AP_F = [["bu", "部"], ["maki", "巻・項"], ["page", "叢書の頁"], ["heading", "見出し"]];

// ------------------------------------------------------------ IndexedDB
let IDB = null;
const STORES = ["appear", "book", "meisho", "kake"];
function idbOpen() {
  return new Promise((ok, ng) => {
    const r = indexedDB.open("miyako-ipad", 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("kv"); STORES.forEach(s => d.createObjectStore(s, {keyPath: "id"}));
      d.createObjectStore("pdfs", {keyPath: "id"}); d.createObjectStore("changes", {keyPath: "n", autoIncrement: true}); };
    r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error);
  });
}
const tx = (s, m = "readonly") => IDB.transaction(s, m);
const req = r => new Promise((ok, ng) => { r.onsuccess = () => ok(r.result); r.onerror = () => ng(r.error); });
const done = t => new Promise((ok, ng) => { t.oncomplete = ok; t.onerror = () => ng(t.error); t.onabort = () => ng(t.error || new Error("中断しました")); });
const kvGet = k => req(tx("kv").objectStore("kv").get(k));
const kvSet = (k, v) => { const t = tx("kv", "readwrite"); t.objectStore("kv").put(v, k); return done(t); };
const getAll = s => req(tx(s).objectStore(s).getAll());

let META = null, D = {appear: new Map(), book: new Map(), meisho: new Map(), kake: new Map()}, PDF = new Map(), BOOKPDF = [], PDFHAVE = new Set(), NCHG = 0;
async function loadAll() {
  META = await kvGet("meta"); if (!META) return;
  HF = META.hf || HF;
  for (const s of STORES) D[s] = new Map((await getAll(s)).map(r => [r.id, r]));
  PDF = new Map(((await kvGet("pdf")) || []).map(r => [r.id, r])); BOOKPDF = (await kvGet("book_pdf")) || [];
  PDFHAVE = new Set(await req(tx("pdfs").objectStore("pdfs").getAllKeys()));
  NCHG = await req(tx("changes").objectStore("changes").count());
}
function foot() {
  $("#cbadge").textContent = NCHG || "";
  $("#foot").innerHTML = META ? `持ち出し ${esc(META.exported_at)}<br>本 ${fmt(D.book.size)}・名所 ${fmt(D.meisho.size)}<br>出てくる所 ${fmt(D.appear.size)}<br>PDF ${fmt(PDFHAVE.size)} 個<br>iPadで直した ${fmt(NCHG)} か所<br><span style="opacity:.6">画面 ${APPVER}</span>`
    : `まだ持ち出しファイルを取り込んでいません<br><span style="opacity:.6">画面 ${APPVER}</span>`;
}
function need() { if (META) return false; main().innerHTML = `<h2>はじめに</h2><div class="card"><p>まだデータが入っていません。「持ち出し・持ち帰り」で、家のPCで作った持ち出しファイルを取り込んでください。</p><button class="btn pri" onclick="go('mochi')">持ち出し・持ち帰りへ</button></div>`; return true; }
const back = to => `<button class="btn" onclick="history.length > 1 ? history.back() : go('${to}')" style="margin-bottom:10px">← 前に戻る</button>`;
const book = id => D.book.get(id) || {};
const apYear = a => book(a.book_id).year;
const byYear = (a, b) => (apYear(a) || 9999) - (apYear(b) || 9999) || (a.sort || 0) - (b.sort || 0);

// ------------------------------------------------------------ PDF(持ち出しに入れた分だけ。重ねて開く)
const urlCache = new Map();
async function pdfURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const r = await req(tx("pdfs").objectStore("pdfs").get(id)); if (!r) return null;
  const u = URL.createObjectURL(new Blob([r.blob], {type: "application/pdf"})); urlCache.set(id, u); return u;
}
async function openPdf(id, page) {
  const u = await pdfURL(id); if (!u) { alert("このPDFは持ち出しファイルに入っていません。"); return; }
  $("#ov-body").innerHTML = `<iframe src="${u}#page=${page || 1}" style="width:100%;height:100%;border:0"></iframe>`; $("#ov").hidden = false;
}
$("#ov-x").addEventListener("click", () => { $("#ov").hidden = true; $("#ov-body").innerHTML = ""; });

// ------------------------------------------------------------ 保存(直したところは changes に記録して持ち帰る)
let NEWID = -1;
async function saveRow(store, id, data, labels) {
  const isNew = !D[store].has(id); const cur = D[store].get(id) || {id};
  const ch = Object.keys(data).filter(k => String(cur[k] ?? "") !== String(data[k] ?? ""));
  if (!ch.length && !isNew) return 0;
  const t = nowStr(), row = {...cur, ...data, updated_at: t};
  const T = tx([store, "changes"], "readwrite"); T.objectStore(store).put(row);
  ch.forEach(k => T.objectStore("changes").add({tbl: store, id, field: k, label: labels[k] || k, old: String(cur[k] ?? ""), new: String(data[k] ?? ""), at: t}));
  if (isNew) T.objectStore("changes").add({tbl: store, id, field: "_new", label: "新しく足した", old: "", new: "", at: t});
  await done(T); D[store].set(id, row); NCHG += ch.length + (isNew ? 1 : 0); foot(); return ch.length;
}
async function newId(store) { const min = Math.min(0, ...[...D[store].keys()].filter(k => k < 0)); return min - 1; }

// ------------------------------------------------------------ はじめに
function viewHome() {
  if (need()) return;
  const ms = [...D.meisho.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
  main().innerHTML = `<h2>都名所（iPad）</h2><p class="lead">${esc(META.exported_at)} に家のPCから持ち出したデータです。ここで直したところは「持ち帰りファイル」にしてPCに戻します。</p>
    <div class="card"><h3>名所</h3>${ms.map(m => `<span class="mtile" onclick="go('meisho/${m.id}')"><b>${esc(m.name)}</b><br><span class="small">${[...D.appear.values()].filter(a => a.meisho_id === m.id).length} 条</span></span>`).join("")}</div>`;
}

// ------------------------------------------------------------ 名所
function viewMeisho(id) {
  if (need()) return;
  const m = D.meisho.get(id); if (!m) { main().innerHTML = "<p>ありません。</p>"; return; }
  const aps = [...D.appear.values()].filter(a => a.meisho_id === id).sort(byYear);
  main().innerHTML = `${back("home")}<h2>${esc(m.name)}</h2><p class="lead">${aps.length} 条。刊年の順。印を付けて「引き比べる」で縦書きで並べます。</p>
    <div class="card"><div class="bar"><b>出てくる所</b><span style="flex:1"></span><button class="btn pri" id="b-cmp">引き比べる</button><button class="btn" id="b-new">条を足す</button><button class="btn" id="b-w">Wordで</button></div>
    <table class="tb"><tr><th></th><th>刊年</th><th>書名</th><th>巻・項</th><th>頁</th><th></th></tr>
    ${aps.map(a => { const b = book(a.book_id); return `<tr class="click" data-id="${a.id}"><td><input type="checkbox" data-c="${a.id}"></td><td>${b.year || ""}</td><td><b>${esc(b.title || "（本なし）")}</b></td><td class="small">${esc(a.maki || "")}</td><td class="small">${esc(a.page || "")}</td>
      <td>${a.honkoku ? `<span class="tag acc">翻刻</span>` : ""}${a.checked === "1" ? `<span class="tag ok">確かめた</span>` : ""}${a.pdf_id && PDFHAVE.has(a.pdf_id) ? `<span class="tag">PDF</span>` : ""}</td></tr>`; }).join("")}</table></div><div id="cmpbox"></div>`;
  main().querySelectorAll("[data-c]").forEach(e => e.addEventListener("click", ev => ev.stopPropagation()));
  main().querySelectorAll("tr[data-id]").forEach(e => e.addEventListener("click", () => go("ap/" + e.dataset.id)));
  $("#b-cmp").addEventListener("click", () => {
    const ids = [...main().querySelectorAll("[data-c]:checked")].map(x => Number(x.dataset.c)).slice(0, 4); if (!ids.length) return;
    $("#cmpbox").innerHTML = `<div class="card"><div class="bar"><h3 style="margin:0">引き比べ（右から古い順）</h3><span style="flex:1"></span><select id="cmpf">${HF.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div><div class="cmp" id="cmpin"></div></div>`;
    const fill = () => { const k = $("#cmpf").value; $("#cmpin").innerHTML = ids.map(i => D.appear.get(i)).sort(byYear).map(a => { const b = book(a.book_id);
      return `<div class="cmpcol"><div class="hd">${esc(b.year || "")}　${esc(b.title || "")}　${esc(a.maki || "")}</div><div class="tate">${kt(a[k] || "（なし）")}</div></div>`; }).join(""); };
    $("#cmpf").addEventListener("change", fill); fill();
  });
  $("#b-new").addEventListener("click", async () => { const i = await newId("appear"); await saveRow("appear", i, {meisho_id: id, sort: 9999, src: "iPadで足した"}, {}); go("ap/" + i); });
  $("#b-w").addEventListener("click", async () => { alert(await share(await docxMeisho(id), `${m.name}_翻刻集成.docx`)); });
}

// ------------------------------------------------------------ 条(翻刻などを打つ)
function viewAp(id) {
  if (need()) return;
  const a = D.appear.get(id); if (!a) { main().innerHTML = "<p>ありません。</p>"; return; }
  const b = book(a.book_id), m = D.meisho.get(a.meisho_id) || {};
  const sib = [...D.appear.values()].filter(x => x.meisho_id === a.meisho_id).sort(byYear).map(x => x.id); const k = sib.indexOf(id);
  const pdfs = BOOKPDF.filter(x => x.book_id === a.book_id).map(x => x.pdf_id).concat(a.pdf_id ? [a.pdf_id] : []).filter((v, i, s) => s.indexOf(v) === i && PDFHAVE.has(v));
  const books = [...D.book.values()].sort((x, y) => (x.year || 9999) - (y.year || 9999));
  main().innerHTML = `${back("meisho/" + a.meisho_id)}<div class="bar"><h2 style="margin:0">${esc(m.name)}　／　${esc(b.title || "")}　<span class="small">${b.year || ""}</span></h2><span style="flex:1"></span>
      ${k > 0 ? `<button class="btn" onclick="go('ap/${sib[k - 1]}')">◀ 前の条</button>` : ""}<span class="small">${k + 1}／${sib.length}</span>${k < sib.length - 1 ? `<button class="btn" onclick="go('ap/${sib[k + 1]}')">次の条 ▶</button>` : ""}</div>
    <p class="small muted">${esc(a.heading || "")}</p>
    ${pdfs.length ? `<div class="card"><div class="bar"><b>PDF</b>${pdfs.map(p => `<button class="btn sm" data-pdf="${p}">${esc((PDF.get(p) || {}).relpath?.split("\\").pop() || p)}</button>`).join("")}<span class="small">頁</span><input id="pg" type="number" value="${a.pdf_page || 1}" style="width:70px"></div></div>` : `<p class="small muted">この条のPDFは持ち出しファイルに入っていません。</p>`}
    <div class="card form">
      <div class="row"><label>本</label><div><select id="book" style="width:100%"><option value="">（選ぶ）</option>${books.map(x => `<option value="${x.id}" ${x.id === a.book_id ? "selected" : ""}>${x.year || "????"}　${esc(x.title)}</option>`).join("")}</select></div></div>
      ${AP_F.map(([f, l]) => `<div class="row"><label>${l}</label><div><input data-a="${f}" value="${esc(a[f] || "")}" style="width:100%"></div></div>`).join("")}
      <p class="small muted">返り点は ｛二｝｛一｝｛レ｝ のように書きます。</p>
      ${HF.map(([f, l]) => `<label class="hl">${l}</label><textarea class="mincho" data-h="${f}" rows="${f === "honkoku" ? 8 : 4}">${esc(a[f] || "")}</textarea>`).join("")}
      <label class="small"><input type="checkbox" id="chk" ${a.checked === "1" ? "checked" : ""}> 原本で確かめた</label>
      <div class="bar"><button class="btn pri" id="b-save">保存</button><button class="btn" id="b-prev">縦書きで見る</button><button class="btn" id="b-w">この条をWordで</button><span class="small" id="msg"></span></div>
      <div id="prev" class="honview" hidden></div></div>`;
  main().querySelectorAll("[data-pdf]").forEach(e => e.addEventListener("click", () => openPdf(Number(e.dataset.pdf), $("#pg").value)));
  const val = () => { const o = {book_id: $("#book").value ? Number($("#book").value) : null}; main().querySelectorAll("[data-a]").forEach(e => o[e.dataset.a] = e.value);
    main().querySelectorAll("[data-h]").forEach(e => o[e.dataset.h] = e.value); o.checked = $("#chk").checked ? "1" : ""; return o; };
  const labels = Object.fromEntries([...HF, ...AP_F, ["checked", "原本で確かめた"], ["book_id", "本"]]);
  $("#b-save").addEventListener("click", async () => { const n = await saveRow("appear", id, val(), labels); $("#msg").textContent = n ? `保存しました（${n}か所）` : "変わったところはありません"; });
  $("#b-prev").addEventListener("click", () => { const v = val(), p = $("#prev"); p.hidden = !p.hidden; p.innerHTML = HF.filter(([f]) => v[f]).map(([f, l]) => `<div class="honcol"><b>【${l}】</b><div class="tate">${kt(v[f])}</div></div>`).join(""); });
  $("#b-w").addEventListener("click", async () => { $("#msg").textContent = await share(await docxBlob([D.appear.get(id)], null), `翻刻_${m.name}_${b.title || id}.docx`); });
}

// ------------------------------------------------------------ 本の台帳
function viewBooks(params) {
  if (need()) return;
  const q = new URLSearchParams(params || "").get("q") || "";
  const rows = [...D.book.values()].filter(b => !q || [b.title, b.author, b.yomi, b.memo].join(" ").includes(q)).sort((a, b) => (a.year || 9999) - (b.year || 9999));
  main().innerHTML = `<h2>本の台帳</h2><div class="card"><div class="bar"><input id="q" value="${esc(q)}" placeholder="書名・著者"><button class="btn pri" id="b-q">絞る</button><span class="small">${rows.length} 冊</span></div>
    <table class="tb"><tr><th>刊年</th><th>書名</th><th>著者</th><th>種類</th><th>叢書</th></tr>${rows.map(b => `<tr class="click" data-id="${b.id}"><td>${b.year || ""}</td><td><b>${esc(b.title)}</b></td><td class="small">${esc(b.author || "")}</td><td class="small">${esc(b.genre || "")}</td><td class="small">${esc(b.sosho || "")} ${esc(b.sosho_kan || "")}</td></tr>`).join("")}</table></div>`;
  $("#b-q").addEventListener("click", () => go("books?q=" + encodeURIComponent($("#q").value)));
  main().querySelectorAll("tr[data-id]").forEach(e => e.addEventListener("click", () => go("book/" + e.dataset.id)));
}
function viewBook(id) {
  const b = D.book.get(id); if (!b) return;
  const F = META.book_f || [];
  const aps = [...D.appear.values()].filter(a => a.book_id === id);
  main().innerHTML = `${back("books")}<h2>${esc(b.title)}</h2><div class="card form">${F.map(([k, l]) => `<div class="row"><label>${l}</label><div>${k === "memo" ? `<textarea data-k="${k}" rows="3">${esc(b[k] || "")}</textarea>` : `<input data-k="${k}" value="${esc(b[k] ?? "")}" style="width:100%">`}</div></div>`).join("")}
    <div class="bar"><button class="btn pri" id="b-save">保存</button><span class="small" id="msg"></span></div></div>
    <div class="card"><h3>出てくる名所</h3>${aps.map(a => `<div class="link" onclick="go('ap/${a.id}')">${esc((D.meisho.get(a.meisho_id) || {}).name)}　${esc(a.maki || "")}　${esc(a.page || "")}</div>`).join("") || "<p class='small muted'>ありません。</p>"}</div>`;
  $("#b-save").addEventListener("click", async () => { const o = {}; main().querySelectorAll("[data-k]").forEach(e => o[e.dataset.k] = e.dataset.k === "year" ? (parseInt(e.value) || null) : e.value);
    const n = await saveRow("book", id, o, Object.fromEntries(F)); $("#msg").textContent = n ? `保存しました（${n}か所）` : "変わったところはありません"; });
}

// ------------------------------------------------------------ 探す
function viewSearch(params) {
  if (need()) return;
  const q = (new URLSearchParams(params || "").get("q") || "").trim();
  let rows = [];
  if (q) { const ts = q.split(/\s+/); rows = [...D.appear.values()].filter(a => { const s = [...HF.map(([k]) => a[k] || ""), a.heading || "", book(a.book_id).title || "", (D.meisho.get(a.meisho_id) || {}).name || ""].join("\n"); return ts.every(t => s.includes(t)); }).sort(byYear); }
  main().innerHTML = `<h2>翻刻から探す</h2><div class="card"><div class="bar"><input id="q" value="${esc(q)}" placeholder="例：衣笠"><button class="btn pri" id="b-q">探す</button>${q ? `<span class="small">${rows.length} 件</span>` : ""}</div>
    <table class="tb">${rows.slice(0, 400).map(a => { const s = HF.map(([k]) => a[k] || "").join(" "); const j = s.indexOf(q.split(/\s+/)[0]);
      return `<tr class="click" data-id="${a.id}"><td>${book(a.book_id).year || ""}</td><td>${esc((D.meisho.get(a.meisho_id) || {}).name)}</td><td><b>${esc(book(a.book_id).title || "")}</b></td><td class="small">${kt(j >= 0 ? "…" + s.slice(Math.max(0, j - 15), j + 25) + "…" : "")}</td></tr>`; }).join("")}</table></div>`;
  $("#b-q").addEventListener("click", () => go("search?q=" + encodeURIComponent($("#q").value)));
  $("#q").addEventListener("keydown", e => { if (e.key === "Enter") go("search?q=" + encodeURIComponent($("#q").value)); });
  main().querySelectorAll("tr[data-id]").forEach(e => e.addEventListener("click", () => go("ap/" + e.dataset.id)));
}

// ------------------------------------------------------------ 掛詞
function viewKake() {
  if (need()) return;
  const F = META.kake_f || [["no", "番号"], ["kana", "かな"], ["words", "掛けている語"], ["stars", "重さ（★の数）"], ["rei", "用例（歌・文）"], ["meisho", "名所・地名"], ["memo", "メモ"]];
  const rows = [...D.kake.values()].sort((a, b) => (a.no || 0) - (b.no || 0));
  main().innerHTML = `<h2>掛詞</h2><div class="card"><div class="bar"><button class="btn" id="b-new">掛詞を足す</button></div><table class="tb"><tr><th>番号</th><th>かな</th><th>語</th><th>★</th><th>用例</th></tr>
    ${rows.map(k => `<tr class="click" data-id="${k.id}"><td>${k.no ?? ""}</td><td><b>${esc(k.kana)}</b></td><td>${esc(k.words)}</td><td>${"★".repeat(k.stars || 0)}</td><td class="small">${esc(k.rei || "")}</td></tr>`).join("")}</table></div><div id="ke"></div>`;
  const edit = async id => { const k = D.kake.get(id) || {no: Math.max(0, ...rows.map(x => x.no || 0)) + 1};
    $("#ke").innerHTML = `<div class="card form">${F.map(([f, l]) => `<div class="row"><label>${l}</label><div>${f === "rei" || f === "memo" ? `<textarea data-f="${f}" rows="3">${esc(k[f] ?? "")}</textarea>` : `<input data-f="${f}" value="${esc(k[f] ?? "")}" style="width:100%">`}</div></div>`).join("")}<div class="bar"><button class="btn pri" id="k-s">保存</button></div></div>`;
    $("#ke").scrollIntoView(); $("#k-s").addEventListener("click", async () => { const o = {}; $("#ke").querySelectorAll("[data-f]").forEach(e => o[e.dataset.f] = (e.dataset.f === "no" || e.dataset.f === "stars") ? (parseInt(e.value) || 0) : e.value);
      await saveRow("kake", id, o, Object.fromEntries(F)); viewKake(); }); };
  main().querySelectorAll("tr[data-id]").forEach(e => e.addEventListener("click", () => edit(Number(e.dataset.id))));
  $("#b-new").addEventListener("click", async () => edit(await newId("kake")));
}

// ------------------------------------------------------------ 直したところ
async function viewChanges() {
  if (need()) return;
  const ch = await getAll("changes");
  main().innerHTML = `<h2>iPadで直したところ</h2><p class="lead">持ち出してから、このiPadで直したところです（${fmt(ch.length)} か所）。</p><div class="card"><table class="tb"><tr><th>日時</th><th>表</th><th>項目</th><th>前</th><th>後</th></tr>
    ${ch.slice().reverse().map(x => `<tr><td class="small">${esc(x.at)}</td><td class="small">${esc(x.tbl)} ${x.id}</td><td>${esc(x.label)}</td><td class="small">${esc(x.old.slice(0, 50))}</td><td class="small">${esc(x.new.slice(0, 50))}</td></tr>`).join("") || "<tr><td>まだありません。</td></tr>"}</table></div>`;
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
    <div class="card"><h3>① 持ち出しファイルを取り込む</h3><p>家のPCの都名所アプリで作った「都名所_持ち出し_….zip」を選びます。</p>
      ${META ? `<p class="small">いま入っているもの：${esc(META.exported_at)} に持ち出した分。取り込むと入れ替わります。</p>` : ""}
      <div class="bar"><input type="file" id="f-in" accept=".zip,application/zip"><button class="btn pri" id="b-in">取り込む</button></div><p class="small" id="in-msg"></p></div>
    <div class="card"><h3>② 持ち帰りファイルを作る</h3><p>このiPadで直したところ（${fmt(NCHG)} か所）を1つのファイルにします。家のPCの都名所アプリの「Excel・Wordに出力」→「持ち帰る」で取り込みます。</p>
      ${sent ? `<p class="small muted">前に作ったのは ${esc(sent)}</p>` : ""}<div class="bar"><button class="btn pri" id="b-out" ${NCHG ? "" : "disabled"}>持ち帰りファイルを作る</button><span class="small" id="out-msg"></span></div></div>
    <div class="card"><h3>この画面について</h3><p class="small">データはこのiPadの中にだけあり、インターネットには送りません。画面の仕組みだけを読み込みます。画面 ${APPVER}</p><button class="btn sm" id="b-upd">画面を新しくする（ネットのある所で）</button></div>`;
  $("#b-upd").addEventListener("click", async () => { if (navigator.serviceWorker) { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update(); } location.reload(); });
  $("#b-in").addEventListener("click", async () => {
    const f = $("#f-in").files[0], msg = $("#in-msg"); if (!f) { msg.textContent = "ファイルを選んでください。"; return; }
    if (NCHG && !(sent && (await kvGet("sent_n")) === NCHG) && !confirm(`このiPadで直したところが ${NCHG} か所あり、まだ持ち帰りファイルにしていません。取り込むと消えます。取り込みますか？`)) return;
    try { await importZip(f, t => msg.textContent = t); msg.textContent = "取り込みました。"; await loadAll(); foot(); } catch (ex) { msg.textContent = "取り込めませんでした：" + ex.message; }
  });
  $("#b-out").addEventListener("click", async () => {
    const ch = await getAll("changes"), ids = {}; STORES.forEach(s => ids[s] = {});
    ch.forEach(x => { (ids[x.tbl][x.id] = ids[x.tbl][x.id] || new Set()).add(x.field); });
    const d = {format: "miyako-mochikaeri", version: 1, based_on: META.exported_at, made_at: nowStr(), history: ch};
    STORES.forEach(s => d[s] = Object.entries(ids[s]).map(([i, set]) => ({...(D[s].get(Number(i)) || {id: Number(i)}), _changed: [...set].filter(f => f !== "_new")})));
    const stamp = nowStr().replace(/[-: ]/g, "").slice(0, 12);
    $("#out-msg").textContent = await share(new Blob([JSON.stringify(d)], {type: "application/json"}), `都名所_持ち帰り_${stamp}.json`);
    await kvSet("sent_at", nowStr()); await kvSet("sent_n", NCHG);
  });
}
async function importZip(file, say) {
  say("ファイルを開いています…");
  const z = await JSZip.loadAsync(file); const dj = z.file("data.json"); if (!dj) throw new Error("持ち出しファイルではありません");
  const d = JSON.parse(await dj.async("string")); if (d.format !== "miyako-mochidashi") throw new Error("都名所の持ち出しファイルではありません");
  let T = tx(["kv", ...STORES, "pdfs", "changes"], "readwrite");
  ["kv", ...STORES, "pdfs", "changes"].forEach(s => T.objectStore(s).clear());
  STORES.forEach(s => (d[s] || []).forEach(r => T.objectStore(s).put(r)));
  T.objectStore("kv").put(d.pdf || [], "pdf"); T.objectStore("kv").put(d.book_pdf || [], "book_pdf");
  await done(T);
  for (const [i, pid] of (d.pdf_files || []).entries()) {
    const zf = z.file(`pdfs/${pid}.pdf`); if (!zf) continue; say(`PDFを入れています… ${i + 1}／${d.pdf_files.length}`);
    const b = await zf.async("blob"); T = tx("pdfs", "readwrite"); T.objectStore("pdfs").put({id: pid, blob: b}); await done(T);
  }
  await kvSet("meta", {exported_at: d.exported_at, hf: d.hf, book_f: d.book_f, kake_f: d.kake_f, loaded_at: nowStr()});
  await kvSet("sent_at", null); await kvSet("sent_n", 0);
  urlCache.forEach(u => URL.revokeObjectURL(u)); urlCache.clear();
}

// ------------------------------------------------------------ Word(縦書き・A4横、返り点は小さく左下)とExcel
const xe = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const RPR = (sz, b, col, pos) => `<w:rPr><w:rFonts w:ascii="游明朝" w:hAnsi="游明朝" w:eastAsia="游明朝"/>${b ? "<w:b/>" : ""}${col ? `<w:color w:val="${col}"/>` : ""}${pos ? `<w:position w:val="${pos}"/>` : ""}<w:sz w:val="${sz}"/></w:rPr>`;
const R = (t, sz, b, col, pos) => `<w:r>${RPR(sz, b, col, pos)}<w:t xml:space="preserve">${xe(t)}</w:t></w:r>`;
const P = (t, sz = 21, b = false, col = "") => `<w:p>${R(t, sz, b, col)}</w:p>`;
const PK = t => `<w:p>${t.split(/(｛[^｛｝]{1,3}｝)/).map(s => /^｛.*｝$/.test(s) ? R(s.slice(1, -1), 12, false, "", -6) : s ? R(s, 21) : "").join("")}</w:p>`;
function apXML(a) {
  const b = book(a.book_id); let x = P(a.heading || [b.title, a.maki, b.year, b.author].filter(Boolean).join("　"), 24, true);
  HF.forEach(([k, l]) => { if (!(a[k] || "").trim()) return; x += P(`【${l}】`, 21, true); a[k].split("\n").forEach(ln => x += PK(ln)); });
  return x + P((a.checked === "1" ? "原本で確かめた" : "まだ原本で確かめていない") + `　出てくる所id ${a.id}`, 18, false, "555555");
}
async function docxBlob(aps, title, sub) {
  let body = title ? P(title, 36, true) + (sub ? P(sub, 18, false, "555555") : "") : ""; let bu = null;
  aps.forEach(a => { if (title && a.bu && a.bu !== bu) { bu = a.bu; body += P(bu, 28, true); } body += apXML(a); });
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/><w:textDirection w:val="tbRl"/></w:sectPr></w:body></w:document>`;
  const z = new JSZip();
  z.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file("word/document.xml", doc);
  return z.generateAsync({type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"});
}
function docxMeisho(id) { const m = D.meisho.get(id); const aps = [...D.appear.values()].filter(a => a.meisho_id === id).sort(byYear); return docxBlob(aps, m.name, `翻刻集成　${aps.length}条（都名所iPadから書き出し・成立年代順）`); }
function loadXLSX() { return new Promise((ok, ng) => { if (window.XLSX) return ok(); const s = document.createElement("script"); s.src = "lib/xlsx.full.min.js"; s.onload = ok; s.onerror = () => ng(new Error("Excelの部品を読めませんでした")); document.head.append(s); }); }
async function excelOut() {
  await loadXLSX(); const wb = XLSX.utils.book_new();
  const add = (nm, aoa) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), nm);
  add("名所×本", [["名所", "刊年", "書名", "巻・項", "頁", ...HF.map(x => x[1]), "原本で確かめた", "id"], ...[...D.appear.values()].sort(byYear).map(a => [(D.meisho.get(a.meisho_id) || {}).name, book(a.book_id).year, book(a.book_id).title, a.maki, a.page, ...HF.map(([k]) => a[k] || ""), a.checked === "1" ? "済" : "", a.id])]);
  add("本の台帳", [["id", ...(META.book_f || []).map(x => x[1])], ...[...D.book.values()].map(b => [b.id, ...(META.book_f || []).map(([k]) => b[k] ?? "")])]);
  add("掛詞", [["番号", "かな", "語", "★", "用例", "名所", "メモ"], ...[...D.kake.values()].map(k => [k.no, k.kana, k.words, k.stars, k.rei, k.meisho, k.memo])]);
  const stamp = nowStr().replace(/[-: ]/g, "").slice(0, 12);
  return share(new Blob([XLSX.write(wb, {type: "array", bookType: "xlsx"})], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}), `都名所_一覧_${stamp}.xlsx`);
}
function viewExport() {
  if (need()) return;
  const ms = [...D.meisho.values()];
  main().innerHTML = `<h2>Word・Excelに出力</h2><div class="card"><h3>名所の翻刻集成をWord（縦書き）で</h3><div class="bar"><select id="wm">${ms.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}</select><button class="btn pri" id="b-w">Wordで</button><span class="small" id="w-msg"></span></div></div>
    <div class="card"><h3>Excel</h3><div class="bar"><button class="btn" id="b-x">名所×本・本の台帳・掛詞</button><span class="small" id="x-msg"></span></div></div>`;
  $("#b-w").addEventListener("click", async () => { const id = Number($("#wm").value); $("#w-msg").textContent = await share(await docxMeisho(id), `${D.meisho.get(id).name}_翻刻集成.docx`); });
  $("#b-x").addEventListener("click", async () => { try { $("#x-msg").textContent = await excelOut(); } catch (ex) { $("#x-msg").textContent = ex.message; } });
}

// ------------------------------------------------------------ 画面の切り替え
function go(h) { if (location.hash === "#" + h) route(); else location.hash = h; }
async function route() {
  const h = decodeURIComponent(location.hash.slice(1)) || "home"; const [path, params] = h.split("?"); const [v, arg] = path.split("/");
  document.querySelectorAll("nav a[data-view]").forEach(x => x.classList.toggle("on", x.dataset.view === ({ap: "home", meisho: "home", book: "books"}[v] || v)));
  try {
    if (v === "meisho") viewMeisho(Number(arg)); else if (v === "ap") viewAp(Number(arg)); else if (v === "books") viewBooks(params); else if (v === "book") viewBook(Number(arg));
    else if (v === "search") viewSearch(params); else if (v === "kake") viewKake(); else if (v === "changes") await viewChanges(); else if (v === "mochi") await viewMochi(); else if (v === "export") viewExport(); else viewHome();
    window.scrollTo(0, 0);
  } catch (ex) { main().innerHTML = `<div class="note">表示できませんでした: ${esc(ex.message)}</div>`; }
}
document.querySelectorAll("nav a[data-view]").forEach(x => x.addEventListener("click", () => go(x.dataset.view)));
window.addEventListener("hashchange", route);
(async () => {
  IDB = await idbOpen(); await loadAll(); foot(); route();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})().catch(ex => { main().innerHTML = `<div class="note">読み込めませんでした: ${esc(ex.message)}</div>`; });
