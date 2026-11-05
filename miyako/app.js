"use strict";
// 都名所（iPad）: 家のPCの「都名所アプリ」から持ち出したデータを、iPadの中(IndexedDB)だけで使う。
// ネットが無くても、名所を年代順に見る・引き比べる・翻刻などを打つ・掛詞を直す・Word/Excelに書き出す、ができる。
const APPVER = "2026-11-05p";
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

let META = null, D = {appear: new Map(), book: new Map(), meisho: new Map(), kake: new Map()}, PDF = new Map(), BOOKPDF = [], PDFHAVE = new Set(), PDFINFO = {}, NCHG = 0;
async function loadAll() {
  // PDFはiPadに保存しない(USBが外で読む用の写し。iPadに入れると二重管理になる)。前に保存した分は一度だけ消して空きを戻す
  if (!(await kvGet("pdfs_cleared_1105"))) { const T = tx("pdfs", "readwrite"); T.objectStore("pdfs").clear(); await done(T); await kvSet("pdfinfo", {}); await kvSet("bundles", {}); await kvSet("pdfs_cleared_1105", nowStr()); }
  PDFINFO = {};
  META = await kvGet("meta"); if (!META) return;
  HF = META.hf || HF;
  for (const s of STORES) D[s] = new Map((await getAll(s)).map(r => [r.id, r]));
  PDF = new Map(((await kvGet("pdf")) || []).map(r => [r.id, r])); BOOKPDF = (await kvGet("book_pdf")) || [];
  NCHG = await req(tx("changes").objectStore("changes").count());
}
function foot() {
  $("#cbadge").textContent = NCHG || "";
  $("#foot").innerHTML = META ? `持ち出し ${esc(META.exported_at)}<br>本 ${fmt(D.book.size)}・名所 ${fmt(D.meisho.size)}<br>出てくる所 ${fmt(D.appear.size)}<br>iPadで直した ${fmt(NCHG)} か所<br><span class="ver">画面 ${APPVER}</span>`
    : `まだ持ち出しファイルを取り込んでいません<br><span class="ver">画面 ${APPVER}</span>`;
}
function need() { if (META) return false; main().innerHTML = `<h2>はじめに</h2><div class="card"><p>まだデータが入っていません。「持ち出し・持ち帰り」で、家のPCで作った持ち出しファイルを取り込んでください。</p><button class="btn pri" onclick="go('mochi')">持ち出し・持ち帰りへ</button></div>`; return true; }
const back = to => `<button class="btn" onclick="history.length > 1 ? history.back() : go('${to}')" style="margin-bottom:10px">← 前に戻る</button>`;
const book = id => D.book.get(id) || {};
const apYear = a => book(a.book_id).year;
const byYear = (a, b) => (apYear(a) || 9999) - (apYear(b) || 9999) || (a.sort || 0) - (b.sort || 0);

// ------------------------------------------------------------ PDF(重ねて開く。頁を指定して開く)
// 外で読む用の軽いPDFは、USBの「iPad用PDF › 都名所PDF」に、PCと同じフォルダ分けで入っている(PCの ipad_pdf.py が作る。PCが原本、USBが写し)。
// iPadには保存しない(二重管理になるため)。開くときにUSBから選んでもらい、都名所を開いている間だけ SESS に覚えておく。
const pdfName = id => ((PDF.get(id) || PDFINFO[id] || {}).relpath || String(id)).split("\\").pop();
function loadPdfjs() {
  return new Promise((ok, ng) => { if (window.pdfjsLib) return ok(); const s = document.createElement("script"); s.src = "lib/pdfjs/pdf.min.js";
    s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdfjs/pdf.worker.min.js"; ok(); }; s.onerror = () => ng(new Error("PDFを見る部品を読めませんでした")); document.head.append(s); });
}
const PV = {doc: null, id: null, page: 1, zoom: 1, task: null, rot: 0};
const ipadPath = id => ((PDF.get(id) || {}).ipad_path || "");
// USBから選んだファイルを、都名所のPDFの一覧(PCが見つけたPDF)と名前で突き合わせる
function findPdfByName(name) {
  const nm = name.normalize("NFC"); const hit = [...PDF.entries()].filter(([, r]) => ((r.relpath || "").split("\\").pop()).normalize("NFC") === nm);
  hit.sort((a, b) => (b[1].ipad_path ? 1 : 0) - (a[1].ipad_path ? 1 : 0)); return hit.map(([id]) => id);
}
// 本とPDFを結ぶ(iPadで記録し、持ち帰りでPCに入る)。PDFそのものはiPadに保存しない
async function linkBookPdf(bookId, pdfId) {
  if (BOOKPDF.some(x => x.book_id === bookId && x.pdf_id === pdfId)) return false;
  const r = PDF.get(pdfId) || {}, role = r.kind === "翻刻本" ? "翻刻本" : "原文", t = nowStr();
  BOOKPDF.push({book_id: bookId, pdf_id: pdfId, role, memo: "iPadで結んだ", added_at: t}); await kvSet("book_pdf", BOOKPDF);
  const T = tx("changes", "readwrite"); T.objectStore("changes").add({tbl: "book_pdf", id: bookId, field: "_link", label: "PDFを結んだ", old: "", new: r.relpath || String(pdfId), pdf_id: pdfId, role, at: t}); await done(T);
  NCHG++; foot(); return true;
}
async function unlinkBookPdf(bookId, pdfId) {
  const k = BOOKPDF.findIndex(x => x.book_id === bookId && x.pdf_id === pdfId); if (k < 0) return false;
  const r = PDF.get(pdfId) || {}, t = nowStr(); BOOKPDF.splice(k, 1); await kvSet("book_pdf", BOOKPDF);
  const T = tx("changes", "readwrite"); T.objectStore("changes").add({tbl: "book_pdf", id: bookId, field: "_unlink", label: "PDFを外した", old: r.relpath || String(pdfId), new: "", pdf_id: pdfId, at: t}); await done(T);
  NCHG++; foot(); return true;
}
// USBのPDFを選んでもらう(iPadには保存しない。この画面を開いている間だけ、選んだファイルを覚えておく)
const SESS = new Map();
function askPdf(id, page, apId, bookId) {
  const ip = ipadPath(id), parts = ip.split("/"), nm = pdfName(id);
  $("#ov-body").innerHTML = `<div class="ask"><h3>このPDFを開きます。USBの中のこのファイルを選んでください</h3>
    <p class="small" style="color:var(--ok)">${bookId != null && BOOKPDF.some(x => x.book_id === bookId && x.pdf_id === id) ? "この本とPDFの結びつきは記録してあります。" : ""}iPadの決まりで、都名所はUSBを自分で読めないため、開くときだけファイルを選んで渡してもらいます。</p>
    <p class="ask-name">${esc(nm)}</p>
    ${ip ? `<p>下のボタンを押して<br><b>USB › iPad用PDF › ${parts.slice(0, -1).map(esc).join(" › ")}</b><br>を開き、このPDFを選んで「開く」。</p>` : `<p class="muted">（このPDFのUSBでの場所が分かりません。USB用がまだ作られていないか、作れなかったPDFです）</p>`}
    <label for="f-ask" class="btn pri big">📂 USBから選ぶ</label><input type="file" id="f-ask" class="vh">
    <p class="small muted" id="ask-msg">iPadには保存しません。都名所を開いている間は、同じPDFを選び直さずに開けます。</p></div>`;
  $("#ov").hidden = false;
  $("#f-ask").addEventListener("change", () => {
    const f = $("#f-ask").files[0]; if (!f) return;
    if (f.name.normalize() !== nm.normalize() && !confirm(`選んだのは「${f.name}」です。探しているのは「${nm}」です。このまま開きますか？`)) return;
    const ids = findPdfByName(f.name), pid = ids.includes(id) ? id : (ids[0] || id);
    SESS.set(pid, f);
    if (bookId != null && PDF.has(pid)) linkBookPdf(bookId, pid);       // この本のPDFとして記録する
    openPdf(pid, page, apId, bookId);
  });
}
async function openPdf(id, page, apId, bookId) {
  const f = SESS.get(id);
  if (!f) return askPdf(id, page, apId, bookId);
  await loadPdfjs();
  if (PV.doc && PV.id !== id) { try { PV.doc.destroy(); } catch (e) {} PV.doc = null; }
  $("#ov-body").innerHTML = `<div class="pv-bar"><button class="btn" id="pv-p">◀ 前</button><input id="pv-n" type="number" min="1" value="${page || 1}"><span id="pv-t" class="pv-t"></span><button class="btn" id="pv-nx">次 ▶</button>
    <span style="flex:1"></span><button class="btn" id="pv-zo">－</button><span id="pv-z" class="pv-t">100%</span><button class="btn" id="pv-zi">＋</button><button class="btn" id="pv-fit">幅に合わせる</button><button class="btn" id="pv-r">↻</button>${apId != null ? `<button class="btn" id="pv-side-b">✎ 翻刻を並べる</button>` : ""}</div>
    <div class="pv-name">${esc(pdfName(id))}</div><div class="pv-row"><div id="pv-wrap"><canvas id="pv-c"></canvas><div id="pv-msg" class="pv-msg">開いています…</div></div><div id="pv-side" hidden></div></div>`;
  $("#ov").hidden = false;
  try {
    if (!PV.doc) {
      const blob = f, len = blob.size;
      const head = new Uint8Array(await blob.slice(0, Math.min(len, 262144)).arrayBuffer());
      const tr = new pdfjsLib.PDFDataRangeTransport(len, head);
      tr.requestDataRange = (b, e) => { blob.slice(b, e).arrayBuffer().then(ab => tr.onDataRange(b, new Uint8Array(ab))); };
      PV.doc = await pdfjsLib.getDocument({range: tr, length: len, rangeChunkSize: 262144, disableAutoFetch: true, disableStream: true,
        cMapUrl: "lib/pdfjs/cmaps/", cMapPacked: true, isEvalSupported: false}).promise;
      PV.id = id; PV.zoom = 1; PV.rot = 0;
    }
  } catch (ex) { $("#pv-msg").textContent = "開けませんでした：" + ex.message; return; }
  $("#pv-t").textContent = `／ ${PV.doc.numPages}`;
  const goPage = n => { PV.page = Math.max(1, Math.min(PV.doc.numPages, n | 0 || 1)); $("#pv-n").value = PV.page; drawPage(); };
  $("#pv-p").onclick = () => goPage(PV.page - 1); $("#pv-nx").onclick = () => goPage(PV.page + 1);
  $("#pv-n").onchange = () => goPage(Number($("#pv-n").value));
  $("#pv-zi").onclick = () => { PV.zoom = Math.min(4, PV.zoom * 1.25); drawPage(); }; $("#pv-zo").onclick = () => { PV.zoom = Math.max(.5, PV.zoom / 1.25); drawPage(); };
  $("#pv-fit").onclick = () => { PV.zoom = 1; drawPage(); }; $("#pv-r").onclick = () => { PV.rot = (PV.rot + 90) % 360; drawPage(); };
  // 左右に払って頁を送る(拡大していないときだけ)
  let sx = null; const w = $("#pv-wrap");
  w.addEventListener("touchstart", e => { sx = e.touches.length === 1 && PV.zoom <= 1 ? e.touches[0].clientX : null; }, {passive: true});
  w.addEventListener("touchend", e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 80) goPage(PV.page + (dx < 0 ? 1 : -1)); });
  if (apId != null) $("#pv-side-b").onclick = () => toggleSide(apId);
  goPage(page);
}
// PDFの横に、その条の翻刻などの欄を並べて打つ
function toggleSide(apId) {
  const sd = $("#pv-side"); sd.hidden = !sd.hidden; $("#pv-side-b").classList.toggle("pri", !sd.hidden);
  if (!sd.hidden) {
    const a = D.appear.get(apId) || {};
    sd.innerHTML = `<div class="bar" style="margin-bottom:6px"><select id="sd-f">${HF.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select><button class="btn pri" id="sd-s">保存</button><span class="small" id="sd-m"></span></div>
      <textarea id="sd-t" class="mincho"></textarea><p class="small muted">返り点は ｛二｝｛一｝｛レ｝。欄を切り替えると、打った分はその欄に残ります（保存で記録）。</p>`;
    const buf = {}; HF.forEach(([k]) => buf[k] = a[k] || ""); let cur = "honkoku"; $("#sd-t").value = buf[cur];
    $("#sd-f").onchange = () => { buf[cur] = $("#sd-t").value; cur = $("#sd-f").value; $("#sd-t").value = buf[cur]; };
    $("#sd-s").onclick = async () => { buf[cur] = $("#sd-t").value; const n = await saveRow("appear", apId, {...buf}, Object.fromEntries(HF)); $("#sd-m").textContent = n ? `保存しました（${n}か所）` : "変わったところはありません"; SIDE_DIRTY = true; };
  }
  drawPage();
}
let SIDE_DIRTY = false;
async function drawPage() {
  const n = PV.page, pg = await PV.doc.getPage(n); if (n !== PV.page) return;
  const wrap = $("#pv-wrap"); if (!wrap) return;
  const v1 = pg.getViewport({scale: 1, rotation: PV.rot});
  const fit = Math.min((wrap.clientWidth - 8) / v1.width, PV.zoom === 1 ? (wrap.clientHeight - 8) / v1.height : 99);
  const css = fit * PV.zoom, dpr = Math.min(window.devicePixelRatio || 1, 3);
  const scale = Math.min(css * dpr, 4096 / Math.max(v1.width, v1.height));
  const vp = pg.getViewport({scale, rotation: PV.rot});
  const c = $("#pv-c"); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  c.style.width = Math.floor(v1.width * css) + "px"; c.style.height = Math.floor(v1.height * css) + "px";
  $("#pv-z").textContent = Math.round(PV.zoom * 100) + "%"; $("#pv-msg").textContent = "";
  if (PV.task) { try { PV.task.cancel(); } catch (e) {} }
  PV.task = pg.render({canvasContext: c.getContext("2d"), viewport: vp});
  try { await PV.task.promise; } catch (e) { if (e && e.name !== "RenderingCancelledException") $("#pv-msg").textContent = "描けませんでした：" + e.message; }
}
function closeOv() { $("#ov").hidden = true; $("#ov-body").innerHTML = ""; if (PV.doc) { try { PV.doc.destroy(); } catch (e) {} PV.doc = null; PV.id = null; } if (SIDE_DIRTY) { SIDE_DIRTY = false; route(); } }
$("#ov-x").addEventListener("click", closeOv);
document.addEventListener("keydown", e => { if ($("#ov").hidden) return; if (e.key === "Escape") closeOv();
  else if (e.key === "ArrowRight" && $("#pv-nx")) $("#pv-nx").click(); else if (e.key === "ArrowLeft" && $("#pv-p")) $("#pv-p").click(); });
window.addEventListener("resize", () => { if (!$("#ov").hidden && PV.doc) drawPage(); });

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
      <td>${a.honkoku ? `<span class="tag acc">翻刻</span>` : ""}${a.checked === "1" ? `<span class="tag ok">確かめた</span>` : ""}${a.pdf_id && PDF.has(a.pdf_id) ? `<span class="tag">PDF</span>` : ""}</td></tr>`; }).join("")}</table></div><div id="cmpbox"></div>`;
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
  const pdfs = BOOKPDF.filter(x => x.book_id === a.book_id).map(x => x.pdf_id).concat(a.pdf_id ? [a.pdf_id] : []).filter((v, i, s) => s.indexOf(v) === i && PDF.has(v));
  const books = [...D.book.values()].sort((x, y) => (x.year || 9999) - (y.year || 9999));
  main().innerHTML = `${back("meisho/" + a.meisho_id)}<div class="bar"><h2 style="margin:0">${esc(m.name)}　／　${esc(b.title || "")}　<span class="small">${b.year || ""}</span></h2><span style="flex:1"></span>
      ${k > 0 ? `<button class="btn" onclick="go('ap/${sib[k - 1]}')">◀ 前の条</button>` : ""}<span class="small">${k + 1}／${sib.length}</span>${k < sib.length - 1 ? `<button class="btn" onclick="go('ap/${sib[k + 1]}')">次の条 ▶</button>` : ""}</div>
    <p class="small muted">${esc(a.heading || "")}</p>
    ${pdfs.length ? `<div class="card"><div class="bar"><b>PDF</b>${pdfs.map(p => `<button class="btn sm" data-pdf="${p}">${SESS.has(p) ? "" : "📂 "}${esc(pdfName(p))}</button>`).join("")}<span class="small">頁</span><input id="pg" type="number" value="${a.pdf_page || 1}" style="width:70px"></div></div>` : (a.book_id != null ? `<div class="card"><div class="bar"><b>PDF</b><span class="small muted">この条の本に結んだPDFはありません。</span><button class="btn pri" id="b-choose">＋ 一覧から選んで結ぶ</button><label for="f-link" class="btn">📂 USBから選んで結ぶ</label><input type="file" id="f-link" class="vh"><span class="small" id="link-msg"></span></div></div>` : `<p class="small muted">この条は本が決まっていないので、PDFを結べません（下の「本」を選んで保存）。</p>`)}
    <div class="card form">
      <div class="row"><label>本</label><div><select id="book" style="width:100%"><option value="">（選ぶ）</option>${books.map(x => `<option value="${x.id}" ${x.id === a.book_id ? "selected" : ""}>${x.year || "????"}　${esc(x.title)}</option>`).join("")}</select></div></div>
      ${AP_F.map(([f, l]) => `<div class="row"><label>${l}</label><div><input data-a="${f}" value="${esc(a[f] || "")}" style="width:100%"></div></div>`).join("")}
      <p class="small muted">返り点は ｛二｝｛一｝｛レ｝ のように書きます。</p>
      ${HF.map(([f, l]) => `<label class="hl">${l}</label><textarea class="mincho" data-h="${f}" rows="${f === "honkoku" ? 8 : 4}">${esc(a[f] || "")}</textarea>`).join("")}
      <label class="small"><input type="checkbox" id="chk" ${a.checked === "1" ? "checked" : ""}> 原本で確かめた</label>
      <div class="bar"><button class="btn pri" id="b-save">保存</button><button class="btn" id="b-prev">縦書きで見る</button><button class="btn" id="b-w">この条をWordで</button><span class="small" id="msg"></span></div>
      <div id="prev" class="honview" hidden></div></div>`;
  main().querySelectorAll("[data-pdf]").forEach(e => e.addEventListener("click", () => openPdf(Number(e.dataset.pdf), $("#pg").value, id, a.book_id)));
  if ($("#f-link")) $("#f-link").addEventListener("change", () => pickLink(a.book_id, $("#f-link"), () => viewAp(id)));
  if ($("#b-choose")) $("#b-choose").addEventListener("click", () => chooseLink(a.book_id, () => viewAp(id)));
  const val = () => { const o = {book_id: $("#book").value ? Number($("#book").value) : null}; main().querySelectorAll("[data-a]").forEach(e => o[e.dataset.a] = e.value);
    main().querySelectorAll("[data-h]").forEach(e => o[e.dataset.h] = e.value); o.checked = $("#chk").checked ? "1" : ""; return o; };
  const labels = Object.fromEntries([...HF, ...AP_F, ["checked", "原本で確かめた"], ["book_id", "本"]]);
  $("#b-save").addEventListener("click", async () => { const n = await saveRow("appear", id, val(), labels); $("#msg").textContent = n ? `保存しました（${n}か所）` : "変わったところはありません"; });
  $("#b-prev").addEventListener("click", () => { const v = val(), p = $("#prev"); p.hidden = !p.hidden; p.innerHTML = HF.filter(([f]) => v[f]).map(([f, l]) => `<div class="honcol"><b>【${l}】</b><div class="tate">${kt(v[f])}</div></div>`).join(""); });
  $("#b-w").addEventListener("click", async () => { $("#msg").textContent = await share(await docxBlob([D.appear.get(id)], null), `翻刻_${m.name}_${b.title || id}.docx`); });
}

// 都名所のPDFの一覧から選んで結ぶ(iPadの選ぶ画面を使わない。名前は省略せず大きく出す)
function chooseLink(bookId, after) {
  const b = D.book.get(bookId) || {};
  const guess = [b.sosho && b.sosho.replace("新修", "") + (b.sosho_kan || ""), b.title].filter(Boolean)[0] || "";
  $("#ov-body").innerHTML = `<div class="ask chooser"><h3>「${esc(b.title || "")}」に結ぶPDFを選ぶ</h3>
    <div class="bar"><input id="cq" type="search" enterkeyhint="search" autocomplete="off" value="${esc(guess)}" placeholder="PDFの名前・フォルダ（例：京都叢書3）"><button class="btn pri" id="cq-b">探す</button></div>
    <div id="cq-list"></div></div>`;
  $("#ov").hidden = false;
  const show = () => { const ts = $("#cq").value.normalize("NFKC").split(/\s+/).filter(Boolean);
    const rows = [...PDF.entries()].filter(([, r]) => { const h = (r.relpath || "").normalize("NFKC"); return ts.every(t => h.includes(t)); })
      .sort((x, y) => (x[1].ipad_path ? 0 : 1) - (y[1].ipad_path ? 0 : 1) || (x[1].kind === "翻刻本" ? 0 : 1) - (y[1].kind === "翻刻本" ? 0 : 1) || (x[1].relpath || "").localeCompare(y[1].relpath || "", "ja")).slice(0, 200);   // USBにあるもの・翻刻本を先に
    $("#cq-list").innerHTML = `<p class="small">${rows.length}${rows.length === 200 ? " 以上" : ""} 件。押すと結びます。</p>` + rows.map(([id, r]) => { const parts = (r.relpath || "").split("\\"), nm = parts.pop(); const linked = BOOKPDF.some(x => x.book_id === bookId && x.pdf_id === id);
      return `<div class="cq-row ${linked ? "linked" : ""}" data-cid="${id}"><div class="cq-nm">${esc(nm)}</div><div class="small">${esc(r.root || "")}${parts.length ? " › " + esc(parts.join(" › ")) : ""}${r.ipad_pages ? `　${r.ipad_pages}頁` : ""}${r.kind ? `　<span class="tag">${esc(r.kind)}</span>` : ""}${linked ? `　<b style="color:var(--ok)">結んである</b>` : ""}${r.ipad_path ? "" : `　<span style="color:var(--warn)">USB用なし</span>`}</div></div>`; }).join("");
    $("#cq-list").querySelectorAll("[data-cid]").forEach(e => e.addEventListener("click", async () => { const pid = Number(e.dataset.cid);
      const ok = await linkBookPdf(bookId, pid); closeOv(); after(ok ? `結びました：${pdfName(pid)}` : `もう結んであります：${pdfName(pid)}`); })); };
  $("#cq-b").onclick = show; $("#cq").addEventListener("keydown", e => { if (e.key === "Enter") show(); }); show();
}
// USBからPDFを選んで、その本に結ぶ
async function pickLink(bookId, input, after) {
  const f = input.files[0]; if (!f) return; const msg = $("#link-msg");
  const ids = findPdfByName(f.name);
  if (!ids.length) { msg.innerHTML = `<span style="color:var(--bad)">「${esc(f.name)}」は都名所のPDFの一覧にありません。USBの「iPad用PDF › 都名所PDF」の中から選んでください（PCで新しく足したPDFなら、PCで「iPad用PDFを作る」→ 持ち出しファイルを取り込み直す）。</span>`; return; }
  const ok = await linkBookPdf(bookId, ids[0]); SESS.set(ids[0], f);
  after(); const m = $("#link-msg"); if (m) m.innerHTML = ok ? `<b style="color:var(--ok)">結びました：${esc(f.name)}</b>（持ち帰りでPCにも入ります）` : `もう結んであります：${esc(f.name)}`;
}

// ------------------------------------------------------------ 本の台帳
const bookPdfs = id => BOOKPDF.filter(x => x.book_id === id).map(x => x.pdf_id).filter((v, i, s) => s.indexOf(v) === i && PDF.has(v));
const bookUsb = id => { const ps = bookPdfs(id); return {n: ps.length, ok: ps.filter(p => ipadPath(p)).length}; };
function viewBooks(params) {
  if (need()) return;
  const sp = new URLSearchParams(params || ""), q = sp.get("q") || "", lk = sp.get("lk") || "";
  // 書名・よみ・著者・版元・刊年・叢書と巻・メモ・結んだPDFのファイル名で探す(空白で区切ると、すべてを含むもの)
  const hay = b => [b.title, b.yomi, b.author, b.publisher, b.year, b.wareki, b.genre, b.sosho, b.sosho ? b.sosho + (b.sosho_kan || "") : "", b.memo, ...bookPdfs(b.id).map(pdfName)].join(" ").normalize("NFKC");
  const ts = q.normalize("NFKC").split(/\s+/).filter(Boolean);
  const rows = [...D.book.values()].filter(b => { const n = bookPdfs(b.id).length; if (lk === "yes" && !n) return false; if (lk === "no" && n) return false;
    if (!ts.length) return true; const h = hay(b); return ts.every(t => h.includes(t)); }).sort((a, b) => (a.year || 9999) - (b.year || 9999));
  const nYes = [...D.book.values()].filter(b => bookPdfs(b.id).length).length;
  main().innerHTML = `<h2>本の台帳</h2><div class="card"><div class="bar"><input id="q" type="search" enterkeyhint="search" autocomplete="off" value="${esc(q)}" placeholder="書名・著者・叢書・PDFの名前（例：新撰京都叢書1）"><button class="btn pri" id="b-q">絞る</button><span style="flex:1"></span><button class="btn" id="b-new">＋ 本を足す</button></div>
    <div class="seg">${[["", `すべて（${D.book.size}）`], ["yes", `PDFを結んだ本（${nYes}）`], ["no", `PDFがまだの本（${D.book.size - nYes}）`]].map(([k, l]) => `<button class="${lk === k ? "on" : ""}" data-lk="${k}">${l}</button>`).join("")}</div>
    <p class="small">${rows.length} 冊${q ? `（「${esc(q)}」で絞った）` : ""}</p>
    <table class="tb"><tr><th>刊年</th><th>書名</th><th>叢書</th><th style="width:34%">PDF</th></tr>${rows.map(b => { const ps = bookPdfs(b.id);
      return `<tr class="click" data-id="${b.id}"><td>${b.year || ""}</td><td><b>${esc(b.title)}</b>${b.id < 0 ? ` <span class="tag acc">iPadで足した</span>` : ""}<div class="small">${esc(b.author || "")}</div></td><td class="small">${esc(b.sosho || "")} ${esc(b.sosho_kan || "")}</td>
      <td>${ps.length ? `<span class="pdfst yes">PDF：結んだ ${ps.length}</span><div class="small">${ps.slice(0, 3).map(p => esc(pdfName(p))).join("<br>")}${ps.length > 3 ? "<br>…" : ""}</div>` : `<span class="pdfst no">PDF：まだ</span>`}</td></tr>`; }).join("")}</table></div>`;
  main().querySelectorAll("[data-lk]").forEach(e => e.addEventListener("click", () => go("books?" + new URLSearchParams({q: $("#q").value, lk: e.dataset.lk}).toString())));
  $("#b-new").addEventListener("click", async () => { const i = await newId("book"); await saveRow("book", i, {title: "（新しい本）"}, {title: "書名"}); go("book/" + i); });
  const goB = () => go("books?" + new URLSearchParams({q: $("#q").value, lk}).toString());
  $("#b-q").addEventListener("click", goB); $("#q").addEventListener("keydown", e => { if (e.key === "Enter") goB(); });
  main().querySelectorAll("tr[data-id]").forEach(e => e.addEventListener("click", () => go("book/" + e.dataset.id)));
}
function viewBook(id) {
  const b = D.book.get(id); if (!b) return;
  const F = META.book_f || [];
  const aps = [...D.appear.values()].filter(a => a.book_id === id);
  main().innerHTML = `${back("books")}<h2>${esc(b.title)}</h2><div class="card form">${F.map(([k, l]) => `<div class="row"><label>${l}</label><div>${k === "memo" ? `<textarea data-k="${k}" rows="3">${esc(b[k] || "")}</textarea>` : `<input data-k="${k}" value="${esc(b[k] ?? "")}" style="width:100%">`}</div></div>`).join("")}
    <div class="bar"><button class="btn pri" id="b-save">保存</button><span class="small" id="msg"></span></div></div>
    <div class="card"><div class="bar"><h3 style="margin:0">PDF（USBでの置き場所）</h3><span style="flex:1"></span>${bookPdfs(id).length ? `<button class="btn sm" id="b-choose">＋ ほかのPDFも結ぶ</button><label for="f-link" class="btn sm" style="display:none">USB</label>` : `<button class="btn pri" id="b-choose">＋ 一覧から選んで結ぶ</button><label for="f-link" class="btn">📂 USBから選んで結ぶ</label>`}<input type="file" id="f-link" class="vh"></div>
    ${bookPdfs(id).length ? `<p class="small">PDFの名前のボタンを押すと開きます。</p>` : ""}<p class="small" id="link-msg"></p>${bookPdfs(id).map(p => { const ip = ipadPath(p), lk = BOOKPDF.find(x => x.book_id === id && x.pdf_id === p) || {}; return `<div class="pdfrow"><button class="btn sm" data-pdf="${p}">📂 ${esc(pdfName(p))}</button>${lk.memo === "自動で結んだ" ? `<span class="tag warn">自動で結んだ（確かめて）</span>` : lk.memo === "iPadで結んだ" ? `<span class="tag acc">iPadで結んだ</span>` : ""}<span style="flex:1"></span><button class="btn sm danger" data-unlink="${p}">外す</button><div class="small" style="width:100%">${ip ? "USB › iPad用PDF › " + esc(ip.split("/").slice(0, -1).join(" › ")) + ((PDF.get(p) || {}).ipad_pages ? `（${PDF.get(p).ipad_pages}頁）` : "") : `<span style="color:var(--warn)">USB用なし（作れなかったか、まだ作っていない）</span>`}</div></div>`; }).join("") || `<p class="small muted">この本に結んだPDFはありません。右上の「＋ 一覧から選んで結ぶ」で結べます。</p>`}</div>
    <div class="card"><h3>出てくる名所</h3>${aps.map(a => `<div class="link" onclick="go('ap/${a.id}')">${esc((D.meisho.get(a.meisho_id) || {}).name)}　${esc(a.maki || "")}　${esc(a.page || "")}</div>`).join("") || "<p class='small muted'>ありません。</p>"}</div>`;
  main().querySelectorAll("[data-pdf]").forEach(e => e.addEventListener("click", () => openPdf(Number(e.dataset.pdf), 1, null, id)));
  $("#f-link").addEventListener("change", () => pickLink(id, $("#f-link"), () => viewBook(id)));
  $("#b-choose").addEventListener("click", () => chooseLink(id, m => { viewBook(id); const e = $("#link-msg"); if (e) e.innerHTML = `<b style="color:var(--ok)">${esc(m)}</b>（持ち帰りでPCにも入ります）`; }));
  main().querySelectorAll("[data-unlink]").forEach(e => e.addEventListener("click", async () => { const p = Number(e.dataset.unlink);
    if (!confirm(`「${pdfName(p)}」をこの本から外しますか？（PDFは消えません。持ち帰りでPCでも外れます）`)) return;
    await unlinkBookPdf(id, p); viewBook(id); const m = $("#link-msg"); if (m) m.innerHTML = `<b>外しました：${esc(pdfName(p))}</b>`; }));
  $("#b-save").addEventListener("click", async () => { const o = {}; main().querySelectorAll("[data-k]").forEach(e => o[e.dataset.k] = e.dataset.k === "year" ? (parseInt(e.value) || null) : e.value);
    const n = await saveRow("book", id, o, Object.fromEntries(F)); $("#msg").textContent = n ? `保存しました（${n}か所）` : "変わったところはありません"; });
}

// ------------------------------------------------------------ 探す
function viewSearch(params) {
  if (need()) return;
  const q = (new URLSearchParams(params || "").get("q") || "").trim();
  let rows = [];
  if (q) { const ts = q.split(/\s+/); rows = [...D.appear.values()].filter(a => { const s = [...HF.map(([k]) => a[k] || ""), a.heading || "", book(a.book_id).title || "", (D.meisho.get(a.meisho_id) || {}).name || ""].join("\n"); return ts.every(t => s.includes(t)); }).sort(byYear); }
  main().innerHTML = `<h2>翻刻から探す</h2><div class="card"><div class="bar"><input id="q" type="search" enterkeyhint="search" autocomplete="off" value="${esc(q)}" placeholder="例：衣笠"><button class="btn pri" id="b-q">探す</button>${q ? `<span class="small">${rows.length} 件</span>` : ""}</div>
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

// ------------------------------------------------------------ 本とPDFの結びつき(見るだけ。PDFは開かない)
function viewLinks(params) {
  if (need()) return;
  const sp = new URLSearchParams(params || ""), q = sp.get("q") || "", how = sp.get("how") || "";
  const howOf = x => x.memo === "自動で結んだ" ? "auto" : x.memo === "iPadで結んだ" ? "ipad" : "pc";
  const HOW = {auto: ["自動", "warn"], ipad: ["iPadで", "acc"], pc: ["PCで", "ok"]};
  const ts = q.normalize("NFKC").split(/\s+/).filter(Boolean);
  const rows = BOOKPDF.filter(x => D.book.has(x.book_id) && PDF.has(x.pdf_id)).map(x => ({x, b: D.book.get(x.book_id), r: PDF.get(x.pdf_id)}))
    .filter(({x, b, r}) => (!how || howOf(x) === how) && (!ts.length || ts.every(t => [b.title, b.author, b.sosho, b.sosho_kan, r.relpath].join(" ").normalize("NFKC").includes(t))))
    .sort((a, c) => (a.b.year || 9999) - (c.b.year || 9999) || (a.b.title || "").localeCompare(c.b.title || "", "ja") || (a.r.relpath || "").localeCompare(c.r.relpath || "", "ja"));
  const cnt = k => BOOKPDF.filter(x => D.book.has(x.book_id) && PDF.has(x.pdf_id) && (!k || howOf(x) === k)).length;
  const nb = new Set(rows.map(o => o.x.book_id)).size;
  main().innerHTML = `<h2>本とPDFの結びつき</h2><p class="lead">どの本に、どのPDFを結んであるかの一覧です（見るだけ。PDFは開きません）。書名を押すと本の画面へ。</p>
    <div class="card"><div class="bar"><input id="q" type="search" enterkeyhint="search" autocomplete="off" value="${esc(q)}" placeholder="書名・叢書・PDFの名前"><button class="btn pri" id="b-q">絞る</button></div>
    <div class="seg">${[["", `すべて（${cnt("")}）`], ["auto", `自動で結んだ（${cnt("auto")}）`], ["pc", `PCで結んだ（${cnt("pc")}）`], ["ipad", `iPadで結んだ（${cnt("ipad")}）`]].map(([k, l]) => `<button class="${how === k ? "on" : ""}" data-how="${k}">${l}</button>`).join("")}</div>
    <p class="small">${nb} 冊・${rows.length} 件</p>
    <table class="tb"><tr><th>刊年</th><th>書名</th><th>結んだPDF</th><th>USBでの場所</th><th class="num">頁</th><th>結び方</th></tr>
    ${rows.slice(0, 600).map(({x, b, r}, i) => { const first = i === 0 || rows[i - 1].x.book_id !== x.book_id; const ip = (r.ipad_path || "").split("/"); ip.pop();
      return `<tr${first ? ' class="grp1"' : ""}><td>${first ? (b.year || "") : ""}</td><td>${first ? `<span class="link" data-book="${b.id}"><b>${esc(b.title)}</b></span><div class="small">${esc(b.sosho || "")} ${esc(b.sosho_kan || "")}</div>` : ""}</td>
        <td><b>${esc(pdfName(x.pdf_id))}</b>${r.kind ? ` <span class="tag">${esc(r.kind)}</span>` : ""}</td><td class="small">${r.ipad_path ? esc(ip.join(" › ")) : `<span style="color:var(--warn)">USB用なし</span>`}</td>
        <td class="num">${r.ipad_pages || ""}</td><td><span class="tag ${HOW[howOf(x)][1]}">${HOW[howOf(x)][0]}</span></td></tr>`; }).join("")}</table>
    ${rows.length > 600 ? `<p class="small muted">はじめの600件を出しています。絞ってください。</p>` : ""}</div>`;
  const goL = (h = how) => go("links?" + new URLSearchParams({q: $("#q").value, how: h}).toString());
  $("#b-q").addEventListener("click", () => goL()); $("#q").addEventListener("keydown", e => { if (e.key === "Enter") goL(); });
  main().querySelectorAll("[data-how]").forEach(e => e.addEventListener("click", () => goL(e.dataset.how)));
  main().querySelectorAll("[data-book]").forEach(e => e.addEventListener("click", () => go("book/" + e.dataset.book)));
}

// ------------------------------------------------------------ PDFの一覧(どのPDFがUSBのどこにあるか)
const gbs = n => n >= 1e9 ? (n / 1e9).toFixed(1) + "GB" : (n / 1e6).toFixed(0) + "MB";
async function viewPdf(params) {
  const sp = new URLSearchParams(params || ""), q = sp.get("q") || "", mine = sp.get("mine") === "1";
  const rows = [...PDF.entries()].filter(([id, r]) => (!mine || r.ipad_path) && (!q || q.split(/\s+/).every(t => (r.relpath || "").includes(t))))
    .sort((a, b) => (a[1].root || "").localeCompare(b[1].root || "") || (a[1].relpath || "").localeCompare(b[1].relpath || "", "ja"));
  const noPath = [...PDF.values()].filter(r => !r.ipad_path).length;
  main().innerHTML = `<h2>PDF</h2>
    <div class="card"><p>外で読む用のPDFは<b>USBの「iPad用PDF › 都名所PDF」</b>に、PCと同じフォルダ分け・同じ名前で入っています（PCが原本、USBはその写し）。iPadには保存しません。<br>
      PDFの行（条や本の画面のPDFのボタンも同じ）を押すと、USBのどこにあるかが出るので、USBから選んで開きます。都名所を開いている間は、同じPDFを選び直さずに開けます。</p>
      <p class="small muted">PDF ${fmt(PDF.size)} 個のうち、USBに入っている ${fmt(PDF.size - noPath)} 個${noPath && PDF.size ? `・USB用なし ${fmt(noPath)} 個` : ""}。</p></div>
    <div class="card"><h3>PDFの一覧</h3><div class="bar"><input id="q" type="search" enterkeyhint="search" autocomplete="off" value="${esc(q)}" placeholder="ファイル名・フォルダ名（例：京都叢書）"><button class="btn pri" id="b-q">絞る</button>
      <label class="small"><input type="checkbox" id="c-mine" ${mine ? "checked" : ""}> USBに入っているものだけ</label><span class="small">${fmt(rows.length)} 個</span></div>
      ${PDF.size ? "" : `<p class="small muted">持ち出しファイルを取り込むと、PDFの一覧が出ます。</p>`}
      <table class="tb"><tr><th>ファイル</th><th>USBの「iPad用PDF」の中の場所</th><th class="num">頁</th><th></th></tr>
      ${rows.slice(0, 500).map(([id, r]) => { const ip = (r.ipad_path || "").split("/"); const nm = ip.length > 1 ? ip.pop() : (r.relpath || "").split("\\").pop();
        return `<tr class="click" data-id="${id}"><td><b>${esc(nm)}</b>${r.kind ? ` <span class="tag">${esc(r.kind)}</span>` : ""}</td><td class="small">${ip.length && r.ipad_path ? esc(ip.join(" › ")) : `<span class="muted">（iPad用がない）</span>`}</td>
          <td class="num">${r.ipad_pages || ""}</td><td>${SESS.has(id) ? `<span class="tag ok">選んである</span>` : ""}</td></tr>`; }).join("")}</table>
      ${rows.length > 500 ? `<p class="small muted">はじめの500個を出しています。絞ってください。</p>` : ""}</div>`;
  const goQ = () => go("pdf?" + new URLSearchParams({q: $("#q").value, ...($("#c-mine").checked ? {mine: "1"} : {})}).toString());
  $("#b-q").addEventListener("click", goQ); $("#c-mine").addEventListener("change", goQ); $("#q").addEventListener("keydown", e => { if (e.key === "Enter") goQ(); });
  main().querySelectorAll("tr.click[data-id]").forEach(e => e.addEventListener("click", () => openPdf(Number(e.dataset.id), 1)));
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
    <div class="card"><h3>① 持ち出しファイルを取り込む</h3><p>家のPCの都名所アプリで作った「都名所_持ち出し_….zip」を選びます。iPadに入れたPDFは消えません。</p>
      ${META ? `<p class="small">いま入っているもの：${esc(META.exported_at)} に持ち出した分。取り込むと入れ替わります。</p>` : ""}
      <div class="bar"><label for="f-in" class="btn pri big">📂 持ち出しファイルを選ぶ</label><input type="file" id="f-in" class="vh"></div><p class="small muted">選ぶと自動で取り込みます。</p><p class="small" id="in-msg"></p></div>
    <div class="card"><h3>② 持ち帰りファイルを作る</h3><p>このiPadで直したところ（${fmt(NCHG)} か所）を1つのファイルにします。家のPCの都名所アプリの「Excel・Wordに出力」→「持ち帰る」で取り込みます。</p>
      ${sent ? `<p class="small muted">前に作ったのは ${esc(sent)}</p>` : ""}<div class="bar"><button class="btn pri" id="b-out" ${NCHG ? "" : "disabled"}>持ち帰りファイルを作る</button><span class="small" id="out-msg"></span></div></div>
    <div class="card"><h3>この画面について</h3><p class="small">データはこのiPadの中にだけあり、インターネットには送りません。画面の仕組みだけを読み込みます。画面 ${APPVER}</p><button class="btn sm" id="b-upd">画面を新しくする（ネットのある所で）</button></div>`;
  $("#b-upd").addEventListener("click", async () => { if (navigator.serviceWorker) { const r = await navigator.serviceWorker.getRegistration(); if (r) await r.update(); } location.reload(); });
  $("#f-in").addEventListener("change", async () => {          // 選んだら自動で取り込む(iPadでは選ぶ画面がボタンにかぶるため)
    const f = $("#f-in").files[0], msg = $("#in-msg"); if (!f) return; msg.textContent = "取り込んでいます…";
    if (NCHG && !(sent && (await kvGet("sent_n")) === NCHG) && !confirm(`このiPadで直したところが ${NCHG} か所あり、まだ持ち帰りファイルにしていません。取り込むと消えます。取り込みますか？`)) return;
    try { await importZip(f, t => msg.textContent = t); await loadAll(); foot(); msg.textContent = "取り込みました。"; } catch (ex) { msg.textContent = "取り込めませんでした：" + ex.message; }
  });
  $("#b-out").addEventListener("click", async () => {
    const ch = await getAll("changes"), ids = {}; STORES.forEach(s => ids[s] = {});
    ch.forEach(x => { if (!ids[x.tbl]) return; (ids[x.tbl][x.id] = ids[x.tbl][x.id] || new Set()).add(x.field); });
    const d = {format: "miyako-mochikaeri", version: 1, based_on: META.exported_at, made_at: nowStr(), history: ch};
    STORES.forEach(s => d[s] = Object.entries(ids[s]).map(([i, set]) => ({...(D[s].get(Number(i)) || {id: Number(i)}), _changed: [...set].filter(f => f !== "_new")})));
    d.book_pdf_ops = ch.filter(x => x.tbl === "book_pdf").map(x => ({op: x.field === "_unlink" ? "del" : "add", book_id: x.id, pdf_id: x.pdf_id, role: x.role, relpath: x.field === "_unlink" ? x.old : x.new, root: (PDF.get(x.pdf_id) || {}).root, at: x.at}));
    const stamp = nowStr().replace(/[-: ]/g, "").slice(0, 12);
    $("#out-msg").textContent = await share(new Blob([JSON.stringify(d)], {type: "application/json"}), `都名所_持ち帰り_${stamp}.json`);
    await kvSet("sent_at", nowStr()); await kvSet("sent_n", NCHG);
  });
}
async function importZip(file, say) {
  say("ファイルを開いています…");
  const z = await JSZip.loadAsync(file); const dj = z.file("data.json"); if (!dj) throw new Error("持ち出しファイルではありません");
  const d = JSON.parse(await dj.async("string")); if (d.format !== "miyako-mochidashi") throw new Error("都名所の持ち出しファイルではありません");
  // PDF(pdfs と pdfinfo)は消さない。PDFの束で入れたものを持ち出しのたびに入れ直さなくてよいように
  const keep = {pdfinfo: await kvGet("pdfinfo")};
  let T = tx(["kv", ...STORES, "changes"], "readwrite");
  ["kv", ...STORES, "changes"].forEach(s => T.objectStore(s).clear());
  if (keep.pdfinfo) T.objectStore("kv").put(keep.pdfinfo, "pdfinfo");
  STORES.forEach(s => (d[s] || []).forEach(r => T.objectStore(s).put(r)));
  T.objectStore("kv").put(d.pdf || [], "pdf"); T.objectStore("kv").put(d.book_pdf || [], "book_pdf");
  await done(T);
  for (const [i, pid] of (d.pdf_files || []).entries()) {
    const zf = z.file(`pdfs/${pid}.pdf`); if (!zf) continue; say(`PDFを入れています… ${i + 1}／${d.pdf_files.length}`);
    const b = await zf.async("blob"); T = tx("pdfs", "readwrite"); T.objectStore("pdfs").put({id: pid, blob: b}); await done(T);
    const info = (await kvGet("pdfinfo")) || {}; const r = (d.pdf || []).find(x => x.id === pid) || {};
    info[pid] = {root: r.root, relpath: r.relpath, size: b.size, bundle: "持ち出しファイル", made_at: d.exported_at}; await kvSet("pdfinfo", info);
  }
  await kvSet("meta", {exported_at: d.exported_at, hf: d.hf, book_f: d.book_f, kake_f: d.kake_f, loaded_at: nowStr()});
  await kvSet("sent_at", null); await kvSet("sent_n", 0);
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
    else if (v === "search") viewSearch(params); else if (v === "kake") viewKake(); else if (v === "changes") await viewChanges(); else if (v === "mochi") await viewMochi(); else if (v === "export") viewExport(); else if (v === "pdf") await viewPdf(params); else if (v === "links") viewLinks(params); else viewHome();
    window.scrollTo(0, 0);
  } catch (ex) { main().innerHTML = `<div class="note">表示できませんでした: ${esc(ex.message)}</div>`; }
}
document.querySelectorAll("nav a[data-view]").forEach(x => x.addEventListener("click", () => go(x.dataset.view)));
window.addEventListener("hashchange", route);
(async () => {
  IDB = await idbOpen(); await loadAll(); foot(); route();
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js", {updateViaCache: "none"}).then(r => r.update()).catch(() => {});
    // 新しい画面の仕組みが入ったら、1回だけ読み込み直して新しい画面にする
    let re = false; navigator.serviceWorker.addEventListener("controllerchange", () => { if (!re) { re = true; location.reload(); } });
  }
})().catch(ex => { main().innerHTML = `<div class="note">読み込めませんでした: ${esc(ex.message)}</div>`; });
