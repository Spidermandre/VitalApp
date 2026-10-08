'use strict';
/* Cartella Clinica: referti di laboratorio, andamento dei parametri, analisi con Claude.
   Usa gli helper globali definiti in app.js (esc, fmt, has, norm, keyOf, parseKey, addDays, title, S, render, toast). */
const CK = { exams: 'vitalapp.exams.v1', ai: 'vitalapp.ai.v1', report: 'vitalapp.report.v1' };
const KINDS = ['Sangue', 'Urine', 'Altro'];
const MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 · il più accurato'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 · più rapido ed economico'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 · il più economico']];
const C = { exams: [], sample: true, ai: { key: '', model: 'claude-opus-5-5' }, report: null, dlg: null, form: null, msg: '', busy: '', aiText: '', aiBusy: false, aiErr: '', del: null };
const pending = {}; // file scelti ma non ancora salvati: id → File

/* ---------- archivio ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
function clinicLoad() {
  const j = lsGet(CK.exams, null);
  if (j && Array.isArray(j.exams)) { C.exams = j.exams; C.sample = !!j.sample; } else { C.exams = sampleExams(); C.sample = true; }
  C.ai = { ...C.ai, ...lsGet(CK.ai, {}) }; C.report = lsGet(CK.report, null);
}
const clinicPersist = () => lsSet(CK.exams, { exams: C.exams, sample: C.sample });
let dbP;
function idb() {
  if (!dbP) dbP = new Promise((ok, ko) => { const r = indexedDB.open('vitalapp', 1); r.onupgradeneeded = () => r.result.createObjectStore('files'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  return dbP;
}
const idbDo = (mode, fn) => idb().then(db => new Promise((ok, ko) => { const tx = db.transaction('files', mode), st = tx.objectStore('files'), r = fn(st); tx.oncomplete = () => ok(r && r.result); tx.onerror = () => ko(tx.error); }));
const fileGet = id => pending[id] ? Promise.resolve(pending[id]) : idbDo('readonly', st => st.get(id));
const filePut = (id, blob) => idbDo('readwrite', st => st.put(blob, id));
const fileDel = id => idbDo('readwrite', st => st.delete(id)).catch(() => {});

function sampleExams() {
  const t = keyOf(new Date()), d = n => addDays(t, -n);
  const blood = (date, v) => ({ id: uid(), date, kind: 'Sangue', title: 'Esami del sangue di routine', lab: 'Laboratorio analisi (esempio)', note: '', files: [], values: [
    { name: 'Colesterolo totale', value: v[0], text: '', unit: 'mg/dL', low: null, high: 200 },
    { name: 'Colesterolo LDL', value: v[1], text: '', unit: 'mg/dL', low: null, high: 115 },
    { name: 'Colesterolo HDL', value: v[2], text: '', unit: 'mg/dL', low: 40, high: null },
    { name: 'Trigliceridi', value: v[3], text: '', unit: 'mg/dL', low: null, high: 150 },
    { name: 'Glucosio', value: v[4], text: '', unit: 'mg/dL', low: 70, high: 99 },
    { name: 'Emoglobina', value: v[5], text: '', unit: 'g/dL', low: 13.5, high: 17.5 },
    { name: 'Creatinina', value: v[6], text: '', unit: 'mg/dL', low: 0.7, high: 1.2 },
    { name: 'Vitamina D (25-OH)', value: v[7], text: '', unit: 'ng/mL', low: 30, high: 100 },
    { name: 'TSH', value: v[8], text: '', unit: 'mUI/L', low: 0.4, high: 4 }] });
  return [
    blood(d(330), [192, 118, 52, 110, 88, 15.1, 0.95, 22, 1.8]),
    { id: uid(), date: d(180), kind: 'Urine', title: 'Esame urine completo', lab: 'Laboratorio analisi (esempio)', note: '', files: [], values: [
      { name: 'pH', value: 6, text: '', unit: '', low: 5, high: 8 },
      { name: 'Peso specifico', value: 1018, text: '', unit: '', low: 1005, high: 1030 },
      { name: 'Proteine', value: null, text: 'assenti', unit: '', low: null, high: null },
      { name: 'Glucosio', value: null, text: 'assente', unit: '', low: null, high: null }] },
    blood(d(175), [204, 129, 50, 128, 93, 14.9, 0.98, 31, 2.1]),
    blood(d(30), [216, 138, 49, 141, 97, 15.2, 1.01, 27, 1.9])];
}

/* ---------- statistiche ---------- */
const DAY = 864e5;
const dnum = k => parseKey(k).getTime() / DAY;
function analytes() {
  const map = {};
  C.exams.forEach(ex => (ex.values || []).forEach(v => {
    if (!v.name) return; const key = ex.kind + '|' + norm(v.name);
    const a = map[key] || (map[key] = { key, name: v.name, kind: ex.kind, unit: v.unit, pts: [], texts: [] });
    if (has(v.value)) a.pts.push({ date: ex.date, v: Number(v.value), low: v.low, high: v.high, unit: v.unit });
    else if (v.text) a.texts.push({ date: ex.date, text: v.text });
  }));
  return Object.values(map).map(a => {
    a.pts.sort((x, y) => x.date < y.date ? -1 : 1); a.texts.sort((x, y) => x.date < y.date ? -1 : 1);
    const last = a.pts[a.pts.length - 1], prev = a.pts[a.pts.length - 2];
    if (last) { a.last = last; a.low = has(last.low) ? +last.low : null; a.high = has(last.high) ? +last.high : null; a.unit = last.unit || a.unit;
      a.state = a.high !== null && last.v > a.high ? 'alto' : a.low !== null && last.v < a.low ? 'basso' : 'ok';
      if (prev) a.delta = last.v - prev.v; a.trend = regress(a); }
    return a;
  }).sort((x, y) => ((x.state && x.state !== 'ok') ? 0 : 1) - ((y.state && y.state !== 'ok') ? 0 : 1) || x.kind.localeCompare(y.kind) || x.name.localeCompare(y.name));
}
// regressione lineare sui valori nel tempo: pendenza annua, proiezione a 6 mesi, eventuale uscita dalla fascia entro un anno
function regress(a) {
  const p = a.pts; if (p.length < 3) return null;
  const xs = p.map(q => dnum(q.date)), ys = p.map(q => q.v), n = p.length, mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0, sxx = 0; xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
  if (!sxx) return null;
  const b = sxy / sxx, at = x => my + b * (x - mx), lastX = xs[n - 1], spanD = xs[n - 1] - xs[0];
  const r = { perYear: b * 365, proj: at(lastX + 182), projDate: addDays(a.last.date, 182), spanD };
  const lim = b > 0 ? a.high : b < 0 ? a.low : null;
  if (lim !== null && a.state === 'ok') { const xc = mx + (lim - my) / b; if (xc > lastX && xc - lastX <= 365) r.cross = { date: keyOf(new Date(xc * DAY)), lim, dir: b > 0 ? 'sopra' : 'sotto' }; }
  return r;
}
const fullDate = k => `${title(k)} ${parseKey(k).getFullYear()}`;
const monthYear = k => { const d = parseKey(k); return `${MF[d.getMonth()]} ${d.getFullYear()}`; };
const shortDate = k => { const d = parseKey(k); return `${d.getDate()} ${MF[d.getMonth()].slice(0, 3)} ${String(d.getFullYear()).slice(2)}`; };
const nf = v => (Math.abs(v) >= 100 ? Math.round(v).toString() : Math.abs(v) < 10 ? String(Math.round(v * 100) / 100) : String(Math.round(v * 10) / 10)).replace('.', ',');
const rangeText = a => a.low !== null && a.high !== null ? `${nf(a.low)}–${nf(a.high)}` : a.high !== null ? `fino a ${nf(a.high)}` : a.low !== null ? `da ${nf(a.low)}` : 'nessuna fascia';

function spark(a) {
  const W = 260, H = 64, P = 6, p = a.pts, t = a.trend;
  const x0 = dnum(p[0].date), x1 = t ? dnum(t.projDate) : Math.max(dnum(p[p.length - 1].date), x0 + 1);
  const vals = p.map(q => q.v).concat(t ? [t.proj] : [], a.low !== null ? [a.low] : [], a.high !== null ? [a.high] : []);
  let lo = Math.min(...vals), hi = Math.max(...vals); if (hi === lo) { hi += 1; lo -= 1; } const pad = (hi - lo) * .12; lo -= pad; hi += pad;
  const X = k => P + (dnum(k) - x0) / (x1 - x0 || 1) * (W - 2 * P), Y = v => H - P - (v - lo) / (hi - lo) * (H - 2 * P);
  const bl = a.low !== null ? a.low : lo, bh = a.high !== null ? a.high : hi;
  const band = (a.low !== null || a.high !== null) ? `<rect x="0" y="${Y(bh).toFixed(1)}" width="${W}" height="${Math.max(0, Y(bl) - Y(bh)).toFixed(1)}" style="fill:var(--band)"/>` : '';
  const pts = p.map(q => `${X(q.date).toFixed(1)},${Y(q.v).toFixed(1)}`).join(' '), L = p[p.length - 1];
  const proj = t ? `<line x1="${X(L.date).toFixed(1)}" y1="${Y(L.v).toFixed(1)}" x2="${X(t.projDate).toFixed(1)}" y2="${Y(t.proj).toFixed(1)}" style="stroke:var(--mute);stroke-width:2;stroke-dasharray:4 4"/>` : '';
  const dots = p.map((q, i) => `<circle cx="${X(q.date).toFixed(1)}" cy="${Y(q.v).toFixed(1)}" r="${i === p.length - 1 ? 5 : 3.5}" style="fill:${(a.high !== null && q.v > a.high) || (a.low !== null && q.v < a.low) ? 'var(--red-dd)' : 'var(--red)'};stroke:#fff;stroke-width:2"/>`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${band}${proj}<polyline points="${pts}" style="fill:none;stroke:var(--red);stroke-width:2.5;stroke-linejoin:round"/>${dots}</svg>`;
}

/* ---------- vista ---------- */
function clinicHeader() {
  const n = C.exams.length, last = C.exams.reduce((m, e) => e.date > m ? e.date : m, '');
  return { kick: `Cartella Clinica${C.sample && n ? ' · esempio' : ''}`, title: n ? `${n} ${n === 1 ? 'referto' : 'referti'} · ultimo ${title(last).split(' ').slice(1).join(' ')}` : 'Nessun referto' };
}
function clinicMain() {
  let h = '';
  if (C.sample && C.exams.length) h += `<div class="banner"><p><span class="d" aria-hidden="true"></span>Stai vedendo <strong>${C.exams.length}</strong> referti di esempio, inseriti per mostrarti come funziona.</p><button class="btn" data-a="c-clear">Inizia con i miei esami</button></div>`;
  if (!C.exams.length) return h + `<div class="empty"><h2>La tua cartella è vuota</h2><p>Aggiungi il primo referto: esami del sangue, delle urine o altro. Puoi caricare il PDF o le foto del referto e far leggere i valori a Claude, oppure inserirli a mano.</p><div class="btns"><button class="btn pri lg" data-a="c-add">Aggiungi un esame</button><button class="btn lg" data-a="c-restore">Rivedi l'esempio</button></div></div>`;
  const as = analytes(), num = as.filter(a => a.pts.length), out = num.filter(a => a.state !== 'ok');
  const cards = num.map(a => {
    const t = a.trend, d = has(a.delta) ? `${a.delta > 0 ? '↑' : a.delta < 0 ? '↓' : '='} ${a.delta > 0 ? '+' : ''}${nf(a.delta)} dal precedente` : 'Un solo valore';
    let tr = '';
    if (t) tr = t.cross ? `Se il trend continua, potrebbe andare ${t.cross.dir} ${nf(t.cross.lim)} verso ${monthYear(t.cross.date)}.` : `Tendenza ${Math.abs(t.perYear) < 1e-9 ? 'stabile' : (t.perYear > 0 ? '+' : '') + nf(t.perYear) + ' ' + esc(a.unit) + ' l\'anno'} · a ${monthYear(t.projDate)} ≈ ${nf(t.proj)}`;
    return `<article class="an${a.state !== 'ok' ? ' bad' : ''}"><div class="t"><span><small>${esc(a.kind)}</small>${esc(a.name)}</span><span class="chip${a.state !== 'ok' ? ' bad' : ''}"><span aria-hidden="true">${a.state === 'ok' ? '✓' : '!'}</span>${a.state === 'ok' ? 'In fascia' : a.state === 'alto' ? 'Sopra fascia' : 'Sotto fascia'}</span></div>
<div class="val"><b>${nf(a.last.v)}</b><span>${esc(a.unit || '')}</span></div>${a.pts.length > 1 ? spark(a) : ''}
<span class="sm">${d} · ${shortDate(a.last.date)}</span><span class="sm">Riferimento: ${rangeText(a)}${a.unit ? ' ' + esc(a.unit) : ''}</span>${tr ? `<span class="sm tr">${tr}</span>` : ''}</article>`;
  }).join('');
  const qual = as.filter(a => !a.pts.length && a.texts.length).map(a => { const l = a.texts[a.texts.length - 1]; return `<li><span>${esc(a.name)} <small>${esc(a.kind)}</small></span><b>${esc(l.text)}</b><small>${shortDate(l.date)}</small></li>`; }).join('');
  const exams = [...C.exams].sort((x, y) => x.date < y.date ? 1 : -1).map(e => {
    const bad = (e.values || []).filter(v => has(v.value) && ((has(v.high) && +v.value > +v.high) || (has(v.low) && +v.value < +v.low))).length;
    const files = (e.files || []).map(f => `<button class="fchip" data-a="c-open" data-k="${esc(f.id)}">${f.type === 'application/pdf' ? 'PDF' : 'Foto'} · ${esc(f.name)}</button>`).join('');
    return `<li class="ex"><div class="exh"><div><span class="sm">${esc(fullDate(e.date))}</span><h3>${esc(e.title || e.kind)}</h3><span class="sm">${esc(e.kind)}${e.lab ? ' · ' + esc(e.lab) : ''} · ${(e.values || []).length} valori${bad ? ` · <strong class="warn">${bad} fuori fascia</strong>` : ''}</span></div>
<div class="btns">${C.del === e.id ? `<button class="btn" data-a="c-del-no">Annulla</button><button class="btn pri" data-a="c-del-yes" data-k="${esc(e.id)}">Elimina definitivamente</button>` : `<button class="btn" data-a="c-edit" data-k="${esc(e.id)}">Modifica</button><button class="btn" data-a="c-del" data-k="${esc(e.id)}">Elimina</button>`}</div></div>${e.note ? `<p class="sm">${esc(e.note)}</p>` : ''}${files ? `<div class="opts">${files}</div>` : ''}</li>`;
  }).join('');
  return h + `<section class="sec" aria-labelledby="ai-t"><div class="shead"><h2 id="ai-t">Analisi di Claude</h2><span>${C.report && !C.aiBusy ? `Aggiornata ${esc(title(C.report.date))}` : ''}</span></div>
<div class="aibox">${aiBlock()}</div></section>
<section class="sec" aria-labelledby="an-t"><div class="shead"><h2 id="an-t">Parametri nel tempo</h2><span><strong>${num.length - out.length} di ${num.length}</strong> nella fascia di riferimento</span></div>
<div class="grid">${cards}</div>${qual ? `<div class="qual"><h3>Risultati qualitativi</h3><ul>${qual}</ul></div>` : ''}
<p class="sm">La tendenza è una retta calcolata sui valori disponibili (servono almeno 3 referti). È un'indicazione, non una previsione medica: un singolo valore può dipendere da digiuno, terapia o laboratorio diverso.</p></section>
<section class="sec" aria-labelledby="ex-t"><div class="shead"><h2 id="ex-t">Referti</h2><button class="btn" data-a="c-ai">Impostazioni AI</button></div><ul class="exl">${exams}</ul></section>`;
}
function aiBlock() {
  const hasKey = !!C.ai.key, btn = `<button class="btn pri lg" data-a="c-analyze" ${C.aiBusy ? 'disabled' : ''}>${C.aiBusy ? 'Claude sta analizzando…' : C.report ? 'Aggiorna analisi' : 'Chiedi a Claude un\'analisi'}</button>`;
  const body = C.aiBusy || C.aiText ? md(C.aiText || 'Leggo referti e diario…') : C.report ? md(C.report.text) : `<p>Claude legge tutti i tuoi referti insieme ai dati del diario (pressione, battito, sonno, attività) e ti restituisce una sintesi: cosa va bene, cosa tenere d'occhio, come si muovono i valori nel tempo e quali domande portare al medico. Più referti aggiungi, più l'analisi diventa precisa.</p>`;
  return `<div id="ai-out" class="md" aria-live="polite">${body}</div>${C.aiErr ? `<div class="imp err" role="alert">${esc(C.aiErr)}</div>` : ''}
<div class="btns">${hasKey ? btn : '<button class="btn pri lg" data-a="c-ai">Collega Claude</button>'}${hasKey ? `<span class="sm">Modello: ${esc((MODELS.find(m => m[0] === C.ai.model) || MODELS[0])[1].split(' · ')[0])}</span>` : ''}</div>
<p class="sm">L'analisi è di supporto e non sostituisce il parere del medico.</p>`;
}
// markdown minimo e sicuro: titoli ##/###, elenchi, grassetto, paragrafi
function md(src) {
  const out = []; let list = false;
  const inl = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  src.split(/\r?\n/).forEach(l => {
    const t = l.trim(), m = t.match(/^[-*•]\s+(.*)/), hd = t.match(/^#{1,4}\s+(.*)/);
    if (!m && list) { out.push('</ul>'); list = false; }
    if (hd) out.push(`<h3>${inl(hd[1])}</h3>`); else if (m) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inl(m[1])}</li>`); } else if (t) out.push(`<p>${inl(t)}</p>`);
  });
  if (list) out.push('</ul>');
  return out.join('');
}

function clinicDialog() {
  if (C.dlg === 'ai') return `<div class="ov" data-a="close-bg"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="ai-h" tabindex="-1">
<div class="row" style="flex-wrap:nowrap"><div><span class="sub">Cartella Clinica</span><h2 id="ai-h">Collega Claude</h2></div><button class="x" data-a="close" aria-label="Chiudi">✕</button></div>
<p class="sm" style="margin:0">Per leggere i referti e analizzarli, l'app usa Claude con una tua chiave API di Anthropic. La crei su <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>; il costo dipende dall'uso ed è addebitato sul tuo account Anthropic.</p>
<div class="f"><label for="c-key">Chiave API</label><input id="c-key" data-fk="c-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value="${esc(C.ai.key)}" style="text-align:left;font-size:16px"></div>
<div class="f"><label for="c-model">Modello</label><select id="c-model" data-fk="c-model" class="sel">${MODELS.map(([v, l]) => `<option value="${v}" ${C.ai.model === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
<div class="watch"><h3>Privacy</h3><p class="sm" style="margin:0">La chiave resta solo su questo dispositivo. Quando chiedi di leggere un referto o di fare un'analisi, i referti e i dati del diario vengono inviati ad Anthropic per l'elaborazione. Il resto dell'app funziona anche senza chiave.</p></div>
${C.msg ? `<div class="imp" role="status">${esc(C.msg)}</div>` : ''}
<div class="foot">${C.ai.key ? '<button class="btn" data-a="c-key-del">Rimuovi chiave</button>' : ''}<button class="btn pri lg" data-a="c-key-save">Salva</button></div></div></div>`;
  if (C.dlg !== 'exam') return '';
  const f = C.form, canAi = !!C.ai.key && f.files.length > 0;
  const rows = f.values.map((v, i) => `<tr><td><input data-row="${i}" data-col="name" data-fk="r${i}n" aria-label="Parametro" value="${esc(v.name)}"></td>
<td><input data-row="${i}" data-col="value" data-fk="r${i}v" aria-label="Valore" inputmode="decimal" value="${esc(has(v.value) ? String(v.value).replace('.', ',') : v.text || '')}"></td>
<td><input data-row="${i}" data-col="unit" data-fk="r${i}u" aria-label="Unità" value="${esc(v.unit || '')}"></td>
<td><input data-row="${i}" data-col="low" data-fk="r${i}l" aria-label="Minimo" inputmode="decimal" value="${has(v.low) ? String(v.low).replace('.', ',') : ''}"></td>
<td><input data-row="${i}" data-col="high" data-fk="r${i}h" aria-label="Massimo" inputmode="decimal" value="${has(v.high) ? String(v.high).replace('.', ',') : ''}"></td>
<td><button class="step sm2" data-a="c-row-del" data-i="${i}" aria-label="Rimuovi ${esc(v.name || 'riga')}">✕</button></td></tr>`).join('');
  const files = f.files.map(x => `<span class="fchip">${x.type === 'application/pdf' ? 'PDF' : 'Foto'} · ${esc(x.name)}<button data-a="c-file-del" data-k="${esc(x.id)}" aria-label="Rimuovi ${esc(x.name)}">✕</button></span>`).join('');
  return `<div class="ov" data-a="close-bg"><div class="dlg wide" role="dialog" aria-modal="true" aria-labelledby="ex-h" tabindex="-1">
<div class="row" style="flex-wrap:nowrap"><div><span class="sub">Cartella Clinica</span><h2 id="ex-h">${f.id ? 'Modifica referto' : 'Nuovo referto'}</h2></div><button class="x" data-a="close" aria-label="Chiudi">✕</button></div>
<div class="watch"><h3>Referto</h3><p class="sm" style="margin:0">Carica il PDF o le foto del referto. ${C.ai.key ? 'Claude può leggerli e compilare i valori per te.' : 'Con Claude collegato, i valori vengono letti in automatico.'}</p>
${files ? `<div class="opts">${files}</div>` : ''}
<div class="btns"><button class="btn" data-a="c-pick">Scegli file</button><input type="file" id="c-file" accept="application/pdf,image/*" multiple hidden>
${C.ai.key ? `<button class="btn pri" data-a="c-extract" ${canAi && !C.busy ? '' : 'disabled'}>Leggi i valori con Claude</button>` : '<button class="btn" data-a="c-ai">Collega Claude</button>'}</div>
${C.busy ? `<div class="imp" role="status">${esc(C.busy)}</div>` : ''}${C.msg ? `<div class="imp" role="status">${esc(C.msg)}</div>` : ''}</div>
<div class="fgrid"><div class="f"><label for="c-date">Data del prelievo</label><input id="c-date" data-fk="c-date" data-ff="date" type="date" value="${esc(f.date)}" style="font-size:17px"></div>
<div class="f"><label for="c-kind">Tipo</label><select id="c-kind" data-fk="c-kind" data-ff="kind" class="sel">${KINDS.map(k => `<option ${f.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
<div class="f"><label for="c-title">Descrizione</label><input id="c-title" data-fk="c-title" data-ff="title" value="${esc(f.title)}" placeholder="Es. Emocromo e profilo lipidico" style="font-size:16px;text-align:left"></div>
<div class="f"><label for="c-lab">Laboratorio</label><input id="c-lab" data-fk="c-lab" data-ff="lab" value="${esc(f.lab)}" placeholder="Facoltativo" style="font-size:16px;text-align:left"></div></div>
<fieldset><legend>Valori</legend><div class="tw"><table class="vt"><thead><tr><th>Parametro</th><th>Valore</th><th>Unità</th><th>Min</th><th>Max</th><th><span class="vh">Azioni</span></th></tr></thead><tbody>${rows}</tbody></table></div>
<div class="btns" style="margin-top:10px"><button class="btn" data-a="c-row-add">+ Aggiungi valore</button></div>
<p class="sm">Per i risultati non numerici (es. "assente") scrivi il testo nel campo Valore. Min e Max vengono dal referto: lascia vuoto se manca un limite.</p></fieldset>
<div class="f"><label for="c-note">Note</label><textarea id="c-note" data-fk="c-note" data-ff="note" class="paste" placeholder="Es. a digiuno, in terapia con…">${esc(f.note)}</textarea></div>
${C.err ? `<div class="imp err" role="alert">${esc(C.err)}</div>` : ''}
<div class="foot"><button class="btn lg" data-a="close">Annulla</button><button class="btn pri lg" data-a="c-save">Salva referto</button></div></div></div>`;
}

/* ---------- Claude ---------- */
let sdkP;
const sdk = () => sdkP || (sdkP = import('./vendor/anthropic-sdk-0.132.1.mjs').then(m => m.default));
async function claude() { const Anthropic = await sdk(); return { Anthropic, client: new Anthropic({ apiKey: C.ai.key, dangerouslyAllowBrowser: true }) }; }
function aiParams(p) {
  const out = { model: C.ai.model, ...p };
  if (C.ai.model !== 'claude-haiku-5-5') { out.betas = ['server-side-fallback-2026-07-01']; out.fallbacks = 'default'; } // in caso di rifiuto riprova su un altro modello
  return out;
}
function aiError(Anthropic, e) {
  if (e instanceof Anthropic.AuthenticationError) return 'La chiave API non è valida. Controllala in Impostazioni AI.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'La chiave non ha accesso a questo modello. Prova un altro modello in Impostazioni AI.';
  if (e instanceof Anthropic.RateLimitError) return 'Troppe richieste in poco tempo. Riprova tra un minuto.';
  if (e instanceof Anthropic.BadRequestError) return 'Richiesta non accettata: ' + (e.error?.error?.message || e.message);
  if (e instanceof Anthropic.APIConnectionError) return 'Connessione non riuscita. Controlla la rete e riprova.';
  if (e instanceof Anthropic.APIError) return `Errore del servizio (${e.status || '?'}). Riprova tra poco.`;
  return e.message || String(e);
}
const b64 = blob => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => ko(r.error); r.readAsDataURL(blob); });
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const nullNum = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const EXTRACT_SCHEMA = { type: 'object', additionalProperties: false, required: ['date', 'kind', 'title', 'lab', 'values'], properties: {
  date: { type: 'string', description: 'Data del prelievo AAAA-MM-GG, stringa vuota se assente' },
  kind: { type: 'string', enum: KINDS }, title: { type: 'string' }, lab: { type: 'string' },
  values: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'value', 'text', 'unit', 'low', 'high'], properties: {
    name: { type: 'string' }, value: nullNum, text: { type: 'string' }, unit: { type: 'string' }, low: nullNum, high: nullNum } } } } };

async function extractValues() {
  const f = C.form; if (!f.files.length) return;
  C.busy = 'Claude sta leggendo il referto…'; C.msg = ''; render();
  let Anthropic;
  try {
    const c = await claude(); Anthropic = c.Anthropic;
    const blocks = [];
    for (const x of f.files) {
      const blob = await fileGet(x.id); if (!blob) continue;
      if (x.type === 'application/pdf') blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await b64(blob) } });
      else if (IMG_TYPES.includes(x.type)) blocks.push({ type: 'image', source: { type: 'base64', media_type: x.type, data: await b64(blob) } });
    }
    if (!blocks.length) throw new Error('Formato non supportato: usa PDF, JPG, PNG o WebP.');
    blocks.push({ type: 'text', text: `Questo è un referto di esami di laboratorio di una persona che tiene il proprio diario di salute (può avere più pagine o più foto). Estrai tutti i parametri misurati.
Per ciascun parametro:
- name: il nome come scritto nel referto, in italiano, senza aggiungere abbreviazioni;
- value: il risultato numerico con il punto come separatore decimale; se il risultato non è numerico (es. "assente", "positivo", "tracce") metti value a null e il testo in text, altrimenti text è una stringa vuota;
- unit: l'unità di misura come nel referto (stringa vuota se non c'è);
- low e high: i limiti dell'intervallo di riferimento; null per un limite che manca (es. "< 200" ha low null e high 200).
date è la data del prelievo (o del referto se manca) nel formato AAAA-MM-GG. kind è Sangue, Urine o Altro. title è una descrizione breve dell'esame. lab è il nome del laboratorio o della struttura.
Riporta solo ciò che leggi con chiarezza: se un valore è illeggibile, non includerlo.` });
    const res = await c.client.beta.messages.create(aiParams({ max_tokens: 16000, output_config: { effort: 'medium', format: { type: 'json_schema', schema: EXTRACT_SCHEMA } }, messages: [{ role: 'user', content: blocks }] }));
    if (res.stop_reason === 'refusal') throw new Error('Claude non ha potuto leggere questo referto. Inserisci i valori a mano.');
    if (res.stop_reason === 'max_tokens') throw new Error('Il referto è troppo lungo per una sola lettura. Prova a caricarlo in più parti.');
    const txt = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const j = JSON.parse(txt), vals = (j.values || []).filter(v => v.name);
    if (j.date && /^\d{4}-\d{2}-\d{2}$/.test(j.date)) f.date = j.date;
    if (KINDS.includes(j.kind)) f.kind = j.kind;
    if (j.title) f.title = j.title; if (j.lab) f.lab = j.lab;
    f.values = vals.map(v => ({ name: v.name, value: has(v.value) ? v.value : null, text: v.text || '', unit: v.unit || '', low: v.low ?? null, high: v.high ?? null }));
    C.msg = `Claude ha letto ${vals.length} valori. Controllali con il referto prima di salvare.`;
  } catch (e) { C.msg = Anthropic ? aiError(Anthropic, e) : (e.message || String(e)); }
  C.busy = ''; render();
}

function diarySummary() {
  const today = keyOf(new Date()), win = n => S.sample ? [] : S.days.filter(d => d.date > addDays(today, -n));
  const avg = (ds, k) => { const v = ds.map(d => d[k]).filter(has); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null; };
  const block = n => { const ds = win(n), td = ds.filter(d => isActDay(d.date)); return { giorni_registrati: ds.length, sistolica_media: avg(ds, 'sys'), diastolica_media: avg(ds, 'dia'), battito_riposo_medio: avg(ds, 'hr'), sonno_medio_ore: avg(ds, 'sleep'), attivita_media_min: avg(ds, 'act'), allenamenti_da_60_min_completati: `${td.filter(d => d.act >= ACT_GOAL).length} su ${td.length} giorni previsti` }; };
  return { nota: S.sample ? 'Il diario contiene solo dati di esempio: non usarlo.' : undefined, ultimi_30_giorni: block(30), ultimi_90_giorni: block(90) };
}
async function analyze() {
  C.aiBusy = true; C.aiText = ''; C.aiErr = ''; render();
  let Anthropic;
  try {
    const c = await claude(); Anthropic = c.Anthropic;
    const as = analytes();
    const data = {
      oggi: keyOf(new Date()),
      referti_di_esempio: C.sample || undefined,
      referti: [...C.exams].sort((a, b) => a.date < b.date ? -1 : 1).map(e => ({ data: e.date, tipo: e.kind, descrizione: e.title, laboratorio: e.lab, note: e.note || undefined, valori: e.values.map(v => ({ parametro: v.name, valore: has(v.value) ? v.value : v.text, unita: v.unit, min: v.low, max: v.high })) })),
      tendenze_calcolate: as.filter(a => a.trend).map(a => ({ parametro: a.name, tipo: a.kind, unita: a.unit, variazione_annua: Math.round(a.trend.perYear * 100) / 100, stima_tra_6_mesi: Math.round(a.trend.proj * 100) / 100, uscita_dalla_fascia_stimata: a.trend.cross ? a.trend.cross.date : null })),
      diario: diarySummary(),
      obiettivo_attivita: 'Allenamento da 60 minuti il lunedì, mercoledì, giovedì e venerdì'
    };
    const system = `Aiuti una persona a capire i propri esami di laboratorio e il proprio diario di salute (pressione, battito a riposo, sonno, attività fisica). Scrivi in italiano, in modo chiaro e diretto, come un professionista sanitario che spiega senza paternalismo. Non fai diagnosi e non prescrivi terapie: indichi cosa merita attenzione e cosa chiedere al medico.
Basati solo sui dati forniti e cita valori e date quando servono. Le tendenze e le stime tra 6 mesi sono rette calcolate sui referti disponibili: usale come indizio, spiega quanto sono affidabili (numero di referti, distanza nel tempo) e non presentarle come certezze. Se i referti sono di esempio, dillo all'inizio in una riga.
Struttura la risposta con questi titoli markdown di secondo livello, in quest'ordine: "## In sintesi" (2-3 frasi), "## Cosa va bene", "## Da tenere d'occhio", "## Andamenti e previsioni", "## Legami con il diario", "## Domande per il medico". Usa elenchi puntati brevi, grassetto solo per i nomi dei parametri, niente tabelle. Resta sotto le 600 parole.`;
    const stream = c.client.beta.messages.stream(aiParams({ max_tokens: 32000, output_config: { effort: 'high' }, system, messages: [{ role: 'user', content: 'Ecco i miei dati in JSON. Analizzali.\n\n' + JSON.stringify(data, null, 1) }] }));
    let t0 = 0;
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
        C.aiText += ev.delta.text;
        if (Date.now() - t0 > 120) { t0 = Date.now(); const o = document.getElementById('ai-out'); if (o) o.innerHTML = md(C.aiText); }
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') throw new Error('Claude non ha completato l\'analisi. Riprova o cambia modello in Impostazioni AI.');
    const text = final.content.filter(b => b.type === 'text').map(b => b.text).join('');
    if (!text.trim()) throw new Error('Claude non ha restituito testo. Riprova.');
    C.report = { date: keyOf(new Date()), text, model: C.ai.model }; lsSet(CK.report, C.report);
    toast('Analisi aggiornata');
  } catch (e) { C.aiErr = Anthropic ? aiError(Anthropic, e) : (e.message || String(e)); }
  C.aiBusy = false; C.aiText = ''; render();
}

/* ---------- azioni ---------- */
const parseNum = s => { s = String(s).trim().replace(/\s/g, ''); if (!s) return null; const n = Number(s.replace(',', '.')); return isNaN(n) ? NaN : n; };
function openExam(id) {
  const e = id && C.exams.find(x => x.id === id);
  C.form = e ? JSON.parse(JSON.stringify(e)) : { date: keyOf(new Date()), kind: 'Sangue', title: '', lab: '', note: '', files: [], values: [{ name: '', value: null, text: '', unit: '', low: null, high: null }] };
  C.form.removed = []; C.dlg = 'exam'; C.msg = ''; C.err = ''; C.busy = ''; render();
}
async function saveExam() {
  const f = C.form; C.err = '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '')) C.err = 'Inserisci la data del prelievo.';
  const vals = f.values.filter(v => (v.name || '').trim());
  if (!C.err && vals.some(v => has(v.low) && has(v.high) && +v.low > +v.high)) C.err = 'In una riga il minimo è più alto del massimo.';
  if (!C.err && !vals.length && !f.files.length) C.err = 'Aggiungi almeno un valore o un file del referto.';
  if (C.err) { render(); return; }
  try { for (const x of f.files) if (pending[x.id]) { await filePut(x.id, pending[x.id]); delete pending[x.id]; } }
  catch (e) { C.err = 'Non riesco a salvare i file su questo dispositivo: ' + e.message; render(); return; }
  f.removed.forEach(fileDel);
  const exam = { id: f.id || uid(), date: f.date, kind: f.kind, title: (f.title || '').trim(), lab: (f.lab || '').trim(), note: (f.note || '').trim(), files: f.files, values: vals.map(v => ({ ...v, name: v.name.trim() })) };
  if (C.sample) { C.exams = []; C.sample = false; }
  const i = C.exams.findIndex(x => x.id === exam.id); if (i >= 0) C.exams[i] = exam; else C.exams.push(exam);
  if (!clinicPersist()) { C.err = 'Spazio di archiviazione esaurito sul dispositivo.'; render(); return; }
  C.dlg = null; C.form = null; toast('Referto salvato'); render();
}
function clinicAction(a, t) {
  const f = C.form;
  const A = {
    'c-add': () => openExam(), 'c-edit': () => openExam(t.dataset.k),
    'c-del': () => { C.del = t.dataset.k; render(); }, 'c-del-no': () => { C.del = null; render(); },
    'c-del-yes': () => { const e = C.exams.find(x => x.id === t.dataset.k); if (e) (e.files || []).forEach(x => fileDel(x.id)); C.exams = C.exams.filter(x => x.id !== t.dataset.k); C.del = null; clinicPersist(); toast('Referto eliminato'); render(); },
    'c-clear': () => { C.exams = []; C.sample = false; clinicPersist(); render(); },
    'c-restore': () => { C.exams = sampleExams(); C.sample = true; clinicPersist(); render(); },
    'c-ai': () => { C.dlg = 'ai'; C.msg = ''; render(); },
    'c-key-save': () => { const k = document.getElementById('c-key').value.trim(), m = document.getElementById('c-model').value; if (k && !k.startsWith('sk-ant-')) { C.msg = 'La chiave dovrebbe iniziare con "sk-ant-". Controlla di averla copiata per intero.'; render(); return; } C.ai = { key: k, model: m }; lsSet(CK.ai, C.ai); C.dlg = null; toast(k ? 'Claude collegato' : 'Impostazioni salvate'); render(); },
    'c-key-del': () => { C.ai = { ...C.ai, key: '' }; lsSet(CK.ai, C.ai); C.msg = 'Chiave rimossa da questo dispositivo.'; render(); },
    'c-analyze': () => { if (!C.aiBusy) analyze(); },
    'c-pick': () => document.getElementById('c-file').click(),
    'c-extract': () => { if (!C.busy) extractValues(); },
    'c-file-del': () => { const id = t.dataset.k; if (pending[id]) delete pending[id]; else f.removed.push(id); f.files = f.files.filter(x => x.id !== id); render(); },
    'c-row-add': () => { f.values.push({ name: '', value: null, text: '', unit: '', low: null, high: null }); render(); const e = document.querySelector(`[data-fk="r${f.values.length - 1}n"]`); if (e) e.focus(); },
    'c-row-del': () => { f.values.splice(+t.dataset.i, 1); render(); },
    'c-save': saveExam,
    'c-open': async () => { const b = await fileGet(t.dataset.k).catch(() => null); if (!b) { toast('File non trovato su questo dispositivo'); render(); return; } const u = URL.createObjectURL(b), w = window.open(u, '_blank'); if (!w) location.href = u; setTimeout(() => URL.revokeObjectURL(u), 60000); }
  };
  if (!A[a]) return false; A[a](); return true;
}
function clinicInput(t) {
  const f = C.form; if (!f) return false;
  if (t.dataset.ff) { f[t.dataset.ff] = t.value; return true; }
  if (t.dataset.row !== undefined) {
    const v = f.values[+t.dataset.row], col = t.dataset.col; if (!v) return true;
    if (col === 'value') { const n = parseNum(t.value); if (n === null) { v.value = null; v.text = ''; } else if (isNaN(n)) { v.value = null; v.text = t.value.trim(); } else { v.value = n; v.text = ''; } }
    else if (col === 'low' || col === 'high') { const n = parseNum(t.value); v[col] = n === null || isNaN(n) ? null : n; }
    else v[col] = t.value;
    return true;
  }
  return false;
}
function clinicFiles(t) {
  if (t.id !== 'c-file' || !t.files.length) return false;
  const ok = [...t.files].filter(x => x.type === 'application/pdf' || IMG_TYPES.includes(x.type)), bad = t.files.length - ok.length;
  ok.forEach(x => { const id = uid(); pending[id] = x; C.form.files.push({ id, name: x.name, type: x.type, size: x.size }); });
  C.msg = bad ? `${bad} file ignorati: usa PDF, JPG, PNG o WebP.` : ''; render(); return true;
}
