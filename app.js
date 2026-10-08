'use strict';
/* VitalApp · Diario Vitale — webapp senza dipendenze. Dati salvati solo sul dispositivo (localStorage). */
const DF = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
const DS = ['dom','lun','mar','mer','gio','ven','sab'];
const MF = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
const MOODS = ['Pesante','Giù','Così così','Bene','Ottimo'];
const HABITS = [['water','Acqua (2 litri)'],['noAlcohol','Niente alcol'],['meditate','Meditazione']];
const STORE = 'vitalapp.v1';
const ACT_GOAL = 60, ACT_DAYS = [1, 3, 4, 5]; // lunedì, mercoledì, giovedì, venerdì
const isActDay = k => ACT_DAYS.includes(parseKey(k).getDay());

const fmt = n => (Math.round(n * 10) / 10).toString().replace('.', ',');
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const title = k => { const d = parseKey(k); return `${DF[d.getDay()]} ${d.getDate()} ${MF[d.getMonth()]}`; };
const esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const has = v => v !== null && v !== undefined && v !== '' && !isNaN(v);

function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
function sample() {
  const r = rng(11), t = new Date(); t.setHours(12, 0, 0, 0); const out = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(t); d.setDate(t.getDate() - i);
    out.push({ date: keyOf(d), sys: Math.round(112 + r() * 32), dia: Math.round(70 + r() * 21), hr: Math.round(56 + r() * 32),
      sleep: Math.round((5.5 + r() * 3.5) * 2) / 2, act: ACT_DAYS.includes(d.getDay()) ? Math.round((35 + r() * 45) / 5) * 5 : (r() < .5 ? 0 : Math.round((10 + r() * 30) / 5) * 5),
      mood: 1 + Math.floor(r() * 5), water: r() > .3, noAlcohol: r() > .25, meditate: r() > .5 });
  }
  return out;
}
// Classificazione ESH
function esh(s, d) {
  const lv = (s >= 180 || d >= 110) ? 5 : (s >= 160 || d >= 100) ? 4 : (s >= 140 || d >= 90) ? 3 : (s >= 130 || d >= 85) ? 2 : (s >= 120 || d >= 80) ? 1 : 0;
  return { ok: lv < 3, label: ['Ottimale','Normale','Normale-alta','Ipertensione 1','Ipertensione 2','Ipertensione 3'][lv] };
}
const METRICS = [
  { key: 'bp', label: 'Pressione', unit: 'mmHg', min: 80, max: 190, band: [90, 139], get: x => x.sys, ref: 'ESH · ottimale sotto 120/80, ipertensione da 140/90', bandLabel: 'Sistolica 90–139 mmHg' },
  { key: 'hr', label: 'Battito a riposo', tab: 'Battito', unit: 'bpm', min: 40, max: 120, band: [60, 100], get: x => x.hr, ref: 'Fascia di riferimento 60–100 bpm', bandLabel: 'Fascia 60–100 bpm' },
  { key: 'sleep', label: 'Sonno', unit: 'ore', min: 0, max: 11, band: [7, 9], get: x => x.sleep, ref: 'Fascia di riferimento 7–9 ore', bandLabel: 'Fascia 7–9 ore' },
  { key: 'act', label: 'Attività fisica', tab: 'Attività', unit: 'min', min: 0, max: 120, band: [ACT_GOAL, Infinity], get: x => x.act, ref: 'Obiettivo 60 min · lun, mer, gio, ven', bandLabel: 'Obiettivo 60 min nei giorni di allenamento' }];
const FIELDS = [
  { k: 'sys', label: 'Sistolica', unit: 'mmHg', min: 70, max: 250, step: 1 },
  { k: 'dia', label: 'Diastolica', unit: 'mmHg', min: 40, max: 150, step: 1 },
  { k: 'hr', label: 'Battito a riposo', unit: 'bpm', min: 30, max: 200, step: 1 },
  { k: 'sleep', label: 'Sonno', unit: 'ore', min: 0, max: 14, step: .5 },
  { k: 'act', label: 'Attività', unit: 'min', min: 0, max: 300, step: 5 }];

/* ---------- stato ---------- */
const S = { view: 'diary', days: [], sample: true, sel: 0, period: 7, metric: 'bp', sheet: false, sync: false, form: null, errors: {}, loading: true, toast: '', busy: '', syncMsg: '' };
function load() {
  try {
    const j = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (j && Array.isArray(j.days)) { S.days = j.days; S.sample = !!j.sample; return; }
  } catch (e) {}
  S.days = sample(); S.sample = true;
}
function persist() { try { localStorage.setItem(STORE, JSON.stringify({ days: S.days, sample: S.sample })); } catch (e) {} }
const sortDays = () => S.days.sort((a, b) => a.date < b.date ? -1 : 1);
let toastT;
function toast(m) { S.toast = m; clearTimeout(toastT); toastT = setTimeout(() => { S.toast = ''; const el = app.querySelector('.toast'); if (el) el.remove(); }, 2800); }

/* ---------- logica ---------- */
// settimana lun–dom che contiene il giorno i: allenamenti completati sui 4 previsti
function weekGoals(i) {
  const k = S.days[i].date, dow = (parseKey(k).getDay() + 6) % 7, mon = addDays(k, -dow), sun = addDays(mon, 6);
  const done = S.days.filter(x => x.date >= mon && x.date <= sun && isActDay(x.date) && x.act >= ACT_GOAL).length;
  return { done, total: ACT_DAYS.length };
}
function status(m, i) {
  const x = S.days[i];
  if (m.key === 'bp') { if (!has(x.sys) || !has(x.dia)) return { ok: null, text: 'Nessun dato' }; const e = esh(x.sys, x.dia); return { ok: e.ok, text: e.label }; }
  if (m.key === 'act') { if (!isActDay(x.date)) return { ok: true, text: 'Giorno libero' }; if (!has(x.act)) return { ok: null, text: 'Nessun dato' }; const ok = x.act >= ACT_GOAL; return { ok, text: ok ? 'Obiettivo ok' : 'Sotto obiettivo' }; }
  const v = m.get(x); if (!has(v)) return { ok: null, text: 'Nessun dato' };
  if (v < m.band[0]) return { ok: false, text: 'Sotto fascia' }; if (v > m.band[1]) return { ok: false, text: 'Sopra fascia' };
  return { ok: true, text: 'In fascia' };
}
function dailyOk(m, x) {
  if (m.key === 'bp') return has(x.sys) && has(x.dia) && esh(x.sys, x.dia).ok;
  if (m.key === 'act' && !isActDay(x.date)) return true;
  const v = m.get(x); return has(v) && v >= m.band[0] && v <= m.band[1];
}
const todayEntry = () => S.days.find(d => d.date === keyOf(new Date()));

function openSheet() {
  const last = S.days[S.days.length - 1];
  const base = { sys: 120, dia: 80, hr: 70, sleep: 7.5, act: 30, mood: 4, water: true, noAlcohol: true, meditate: false };
  const t = todayEntry();
  S.form = { ...base, ...(last || {}), ...(t || {}) };
  FIELDS.forEach(f => { if (!has(S.form[f.k])) S.form[f.k] = base[f.k]; });
  if (!t) S.form.mood = 4;
  S.sheet = true; S.errors = {}; render();
}
function save() {
  const f = S.form, errors = {};
  FIELDS.forEach(c => { const v = f[c.k]; if (v === '' || isNaN(v)) errors[c.k] = 'Inserisci un valore'; else if (v < c.min || v > c.max) errors[c.k] = `Tra ${fmt(c.min)} e ${fmt(c.max)}`; });
  if (!errors.dia && !errors.sys && f.dia >= f.sys) errors.dia = 'Deve essere minore della sistolica';
  if (Object.keys(errors).length) { S.errors = errors; render(); return; }
  if (S.sample) { S.days = []; S.sample = false; } // il primo salvataggio reale sostituisce l'esempio
  const k = keyOf(new Date()), entry = { ...f, date: k }, i = S.days.findIndex(d => d.date === k);
  if (i >= 0) S.days[i] = entry; else S.days.push(entry);
  sortDays();
  S.sel = S.days.findIndex(d => d.date === k); S.sheet = false; persist(); toast('Scheda di oggi salvata'); render();
}

/* ---------- import dallo smartwatch / da file ---------- */
const ALIAS = {
  date: ['date', 'data', 'day', 'giorno', 'startdate', 'start', 'timestamp', 'time'],
  hr: ['hr', 'heartrate', 'heart', 'bpm', 'battito', 'frequenza', 'restingheartrate', 'restinghr', 'fc'],
  sleep: ['sleep', 'sonno', 'sleephours', 'oresonno', 'sleepduration', 'totalsleep'],
  act: ['act', 'activity', 'attivita', 'exercise', 'exercisetime', 'minutes', 'minuti', 'activeminutes', 'workout'],
  sys: ['sys', 'sistolica', 'systolic', 'bloodpressuresystolic'],
  dia: ['dia', 'diastolica', 'diastolic', 'bloodpressurediastolic']
};
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const EXCL = /variab|max|zon|qualit|score|min(?!ut)|avg|medi/;
function mapHeaders(hs) {
  const out = hs.map(h => { const n = norm(h); for (const k in ALIAS) if (ALIAS[k].includes(n)) return k; return null; });
  hs.forEach((h, i) => { if (out[i]) return; const n = norm(h); if (EXCL.test(n)) return; const k = colOf(h); if (k && !out.includes(k)) out[i] = k; });
  return out;
}
function colOf(h) { const n = norm(h); for (const k in ALIAS) if (ALIAS[k].includes(n)) return k; for (const k in ALIAS) if (k !== 'date' && ALIAS[k].some(a => a.length > 3 && n.includes(a))) return k; return null; }
function toKey(s) {
  s = String(s).trim(); let m;
  const valid = (y, mo, d) => { const t = new Date(y, mo - 1, d, 12); return t.getFullYear() === +y && t.getMonth() === mo - 1 && t.getDate() === +d ? `${y}-${pad(mo)}-${pad(d)}` : null; };
  if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return valid(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/))) return valid(+m[3], +m[2], +m[1]);
  if (/^\d{10,13}$/.test(s)) { const n = +s; return keyOf(new Date(n < 1e12 ? n * 1000 : n)); }
  return null;
}
const num = v => { if (typeof v === 'number') return v; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
function splitCsv(text) {
  const first = text.split(/\r?\n/, 1)[0]; const sep = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
// accumulatore: più righe nello stesso giorno → battito min, sonno e attività sommati, pressione ultima
function acc(map, k, f, v) {
  if (!k || !has(v)) return; const d = map[k] || (map[k] = { date: k, _n: {} });
  if (f === 'hr') d.hr = has(d.hr) ? Math.min(d.hr, v) : v;
  else if (f === 'sleep' || f === 'act') d[f] = (d[f] || 0) + v; else d[f] = v;
}
function parseRows(objs) { // oggetti con chiavi già normalizzate (date,hr,sleep,act,sys,dia)
  const map = {}; objs.forEach(o => { const k = toKey(o.date); for (const f of ['hr', 'sleep', 'act', 'sys', 'dia']) acc(map, k, f, o[f] === undefined || o[f] === '' ? null : num(o[f])); });
  return map;
}
function parseCsv(text) {
  const rows = splitCsv(text); if (rows.length < 2) return {};
  const cols = mapHeaders(rows[0]); if (!cols.includes('date')) return {};
  return parseRows(rows.slice(1).map(r => { const o = {}; cols.forEach((c, i) => { if (c && !(c in o)) o[c] = r[i]; }); return o; }));
}
function parseJson(text) {
  let j = JSON.parse(text); if (!Array.isArray(j)) j = j.days || j.data || j.records || [];
  return parseRows(j.map(x => { const o = {}, ks = Object.keys(x), cs = mapHeaders(ks); ks.forEach((k, i) => { if (cs[i] && !(cs[i] in o)) o[cs[i]] = x[k]; }); return o; }));
}
function parseAppleHealth(text) {
  const map = {}, re = /<Record\b([^>]*?)\/?>/g; let m;
  while ((m = re.exec(text))) {
    const a = {}; m[1].replace(/(\w+)="([^"]*)"/g, (_, k, v) => { a[k] = v; });
    const t = a.type || '', end = a.endDate || a.startDate || '';
    if (t.endsWith('RestingHeartRate')) acc(map, toKey(end), 'hr', num(a.value));
    else if (t.endsWith('AppleExerciseTime')) acc(map, toKey(a.startDate || end), 'act', num(a.value));
    else if (t.endsWith('BloodPressureSystolic')) acc(map, toKey(end), 'sys', num(a.value));
    else if (t.endsWith('BloodPressureDiastolic')) acc(map, toKey(end), 'dia', num(a.value));
    else if (t.endsWith('SleepAnalysis') && /Asleep/.test(a.value || '')) {
      const ms = new Date((a.endDate || '').replace(' ', 'T').replace(' ', '')) - new Date((a.startDate || '').replace(' ', 'T').replace(' ', ''));
      if (ms > 0) acc(map, toKey(end), 'sleep', ms / 3.6e6);
    }
  }
  return map;
}
function parseAny(text) {
  const t = text.trim(); if (!t) return {};
  if (/<HealthData\b|<Record\b/.test(t.slice(0, 5000)) || /<Record\b/.test(t)) return parseAppleHealth(t);
  if (t[0] === '[' || t[0] === '{') return parseJson(t);
  return parseCsv(t);
}
function mergeImport(map) {
  const fmin = Object.fromEntries(FIELDS.map(f => [f.k, f]));
  let days = 0, values = 0, skipped = 0; const ds = Object.values(map).sort((a, b) => a.date < b.date ? -1 : 1);
  const backup = S.days, wasSample = S.sample;
  if (S.sample) { S.days = []; S.sample = false; }
  ds.forEach(d => {
    if (d.sleep > 24) d.sleep = d.sleep / 60; // minuti → ore
    if (has(d.sleep)) d.sleep = Math.round(d.sleep * 2) / 2;
    if (has(d.act)) d.act = Math.round(d.act);
    if (has(d.hr)) d.hr = Math.round(d.hr);
    let e = S.days.find(x => x.date === d.date), add = 0;
    const ns = has(d.sys) ? d.sys : e && e.sys, nd = has(d.dia) ? d.dia : e && e.dia;
    if ((has(d.sys) || has(d.dia)) && has(ns) && has(nd) && nd >= ns) { skipped += 2; delete d.sys; delete d.dia; }
    FIELDS.forEach(f => {
      const v = d[f.k]; if (!has(v)) return;
      if (v < f.min || v > f.max) { skipped++; return; }
      if (!e) { e = { date: d.date }; S.days.push(e); } e[f.k] = v; add++;
    });
    if (add) { days++; values += add; }
  });
  if (!days) { S.days = backup; S.sample = wasSample; return { days, values, skipped }; }
  sortDays(); persist(); return { days, values, skipped };
}
async function importText(text, label) {
  try {
    const r = mergeImport(parseAny(text));
    if (!r.days) { S.syncMsg = 'Nessun dato riconosciuto. Controlla che il file abbia una colonna data e almeno una tra battito, sonno, attività, pressione.'; }
    else { S.syncMsg = `Importati ${r.values} valori su ${r.days} giorni${label ? ' da ' + label : ''}.${r.skipped ? ` ${r.skipped} valori fuori intervallo ignorati.` : ''}`; S.sel = S.days.length - 1; toast('Dati importati'); }
  } catch (e) { S.syncMsg = 'Impossibile leggere i dati: ' + e.message; }
  render();
}
function exportCsv() {
  const head = 'date,sys,dia,hr,sleep,act,mood,water,noAlcohol,meditate';
  const rows = S.days.map(d => head.split(',').map(k => d[k] === undefined || d[k] === null ? '' : (typeof d[k] === 'boolean' ? (d[k] ? 1 : 0) : d[k])).join(','));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([head + '\n' + rows.join('\n')], { type: 'text/csv' }));
  a.download = 'diario-vitale.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- Bluetooth: servizio standard Heart Rate (0x180D) ---------- */
async function measureHr() {
  if (!navigator.bluetooth) { S.syncMsg = 'Questo browser non supporta il Bluetooth web. Usa Chrome su Android o computer.'; render(); return; }
  try {
    S.busy = 'Cerco dispositivi con servizio battito cardiaco…'; render();
    const dev = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }], optionalServices: ['battery_service'] });
    S.busy = `Connessione a ${dev.name || 'dispositivo'}…`; render();
    const srv = await dev.gatt.connect(), svc = await srv.getPrimaryService('heart_rate'), ch = await svc.getCharacteristic('heart_rate_measurement');
    const vals = []; await ch.startNotifications();
    ch.addEventListener('characteristicvaluechanged', e => { const dv = e.target.value, v = (dv.getUint8(0) & 1) ? dv.getUint16(1, true) : dv.getUint8(1); if (v > 30 && v < 220) vals.push(v); S.busy = `Misuro… ${v} bpm (${vals.length} letture)`; render(); });
    await new Promise(r => setTimeout(r, 25000));
    try { await ch.stopNotifications(); dev.gatt.disconnect(); } catch (e) {}
    if (vals.length < 3) { S.syncMsg = 'Nessuna lettura ricevuta. Tieni il watch ben aderente al polso e riprova.'; }
    else {
      vals.sort((a, b) => a - b); const med = vals[Math.floor(vals.length / 2)], k = keyOf(new Date());
      if (S.sample) { S.days = []; S.sample = false; }
      let e = S.days.find(d => d.date === k); if (!e) { e = { date: k }; S.days.push(e); } e.hr = med; sortDays(); S.sel = S.days.findIndex(d => d.date === k); persist();
      S.syncMsg = `Battito registrato: ${med} bpm (mediana di ${vals.length} letture). Misuralo da fermo per un valore a riposo affidabile.`; toast('Battito salvato');
    }
  } catch (e) { S.syncMsg = e.name === 'NotFoundError' ? 'Nessun dispositivo selezionato.' : 'Bluetooth: ' + e.message; }
  S.busy = ''; render();
}

/* ---------- rendering ---------- */
const btn = (cls, act, label, extra = '') => `<button class="${cls}" data-a="${act}" ${extra}>${label}</button>`;
function view() {
  const days = S.days, n = days.length, sel = Math.max(0, Math.min(S.sel, n - 1)), d = days[sel], todayK = keyOf(new Date());
  const cut = n ? addDays(days[n - 1].date, -(S.period - 1)) : '', fi = days.findIndex(x => x.date >= cut), start = fi < 0 ? n : fi, vis = days.slice(start);
  const strip = vis.map((x, k) => {
    const i = start + k, on = i === sel, out = METRICS.some(m => status(m, i).ok === false), dt = parseKey(x.date);
    return `<button class="day glass${out ? ' out' : ''}" data-a="sel" data-i="${i}" ${on ? 'aria-current="date"' : ''} aria-label="${title(x.date)}${out ? ', con valori fuori fascia' : ''}"><small>${DS[dt.getDay()]}</small><b>${dt.getDate()}</b><em></em></button>`;
  }).join('');
  let main = '';
  const clinic = S.view === 'clinic', modal = S.sheet || S.sync || !!C.dlg, ch = clinic ? clinicHeader() : null;
  if (S.loading) main = `<div class="panel" role="status"><b style="font-size:18px">Carico i tuoi dati…</b><div class="sk" style="width:60%"></div><div class="sk" style="width:40%"></div></div>`;
  else {
    if (S.sample && n) main += `<div class="banner"><p><span class="d" aria-hidden="true"></span>Stai vedendo <strong>${n}</strong> giorni di dati di esempio, inseriti per mostrarti come funziona.</p>${btn('btn', 'clear', 'Inizia con i miei dati')}</div>`;
    if (!n) main += `<div class="empty"><h2>Il tuo diario è vuoto</h2><p>Registra la prima scheda: bastano pressione, battito, sonno e attività. Umore e abitudini sono facoltativi. Puoi anche importare i dati dal tuo smartwatch.</p><div class="btns">${btn('btn pri lg', 'open', 'Registra il primo giorno')}${btn('btn lg', 'sync', 'Sincronizza smartwatch')}${btn('btn lg', 'restore', "Rivedi l'esempio")}</div></div>`;
    else main += cards(sel, d) + trend(start, vis, sel);
  }
  if (clinic && !S.loading) main = clinicMain();
  const t = clinic ? ch.kick : d ? `${d.date === todayK ? 'Oggi' : 'Scheda del'}${S.sample ? ' · esempio' : ''}` : 'Nessuna scheda';
  return `<div class="wrap"><div class="blobs" aria-hidden="true"><i></i><i></i></div>
<header class="top" ${modal ? 'inert' : ''}><i class="o" aria-hidden="true" style="width:280px;height:280px;background:rgba(255,255,255,.16);right:6%;top:-90px"></i><i class="o" aria-hidden="true" style="width:180px;height:180px;background:rgba(255,255,255,.12);left:38%;bottom:-70px"></i><i class="o" aria-hidden="true" style="width:90px;height:90px;background:rgba(120,0,10,.35);right:30%;top:120px"></i>
<div class="in"><div class="row"><div class="brand"><div class="logo" aria-hidden="true"><i></i><i></i></div>VitalApp</div>
<nav class="seg" aria-label="Sezioni"><button class="pill" data-a="view" data-p="diary" aria-pressed="${!clinic}">Diario</button><button class="pill" data-a="view" data-p="clinic" aria-pressed="${clinic}">Cartella Clinica</button></nav></div>
${clinic ? '' : `<div class="row" style="gap:10px;justify-content:flex-start"><button class="pill" data-a="sync">⌚ Smartwatch</button><div class="seg" role="group" aria-label="Periodo"><span>Periodo</span>${[7, 14, 30].map(p => `<button class="pill" data-a="period" data-p="${p}" aria-pressed="${S.period === p}">${p} gg</button>`).join('')}</div></div>`}
<h1 class="hello">Ciao, Andrea</h1>
<div class="row" style="align-items:flex-end"><div><span class="kick">${t}</span><span class="dtitle${clinic ? ' plain' : ''}" aria-live="polite">${clinic ? esc(ch.title) : d ? title(d.date) : 'Inizia il tuo diario'}</span></div>
${clinic ? '' : `<div class="arrows"><button class="arrow" data-a="prev" aria-label="Giorno precedente" ${!d || sel <= 0 ? 'disabled' : ''}>‹</button><button class="arrow" data-a="next" aria-label="Giorno successivo" ${!d || sel >= n - 1 ? 'disabled' : ''}>›</button></div>`}</div>
${clinic ? '' : `<div class="strip" aria-label="Giorni del periodo">${strip}</div>`}</div></header>
<main ${modal ? 'inert' : ''}>${main}
<footer><p>Le fasce di riferimento sono indicative e valgono per adulti: pressione secondo la classificazione ESH, battito a riposo 60–100 bpm, 7–9 ore di sonno, 60 minuti di attività il lunedì, mercoledì, giovedì e venerdì. <strong>Questo diario non fa diagnosi:</strong> se un valore fuori norma si ripete, parlane con il tuo medico. I dati restano sul tuo dispositivo.</p></footer></main>
<button class="fab" data-a="${clinic ? 'c-add' : 'open'}" ${modal ? 'inert' : ''}><i aria-hidden="true">+</i>${clinic ? 'Aggiungi esame' : 'Registra oggi'}</button>
${S.toast ? `<div class="toast" role="status" aria-live="polite">${esc(S.toast)}</div>` : ''}${S.sheet ? sheet() : ''}${S.sync ? syncDlg() : ''}${C.dlg ? clinicDialog() : ''}</div>`;
}
function cards(sel, d) {
  let ok = 0;
  const cs = METRICS.map(m => {
    const st = status(m, sel); if (st.ok) ok++; const on = S.metric === m.key, w = weekGoals(sel);
    const value = m.key === 'bp' ? (has(d.sys) && has(d.dia) ? `${d.sys}/${d.dia}` : '–') : (has(m.get(d)) ? fmt(m.get(d)) : '–');
    return `<button class="card" data-a="metric" data-m="${m.key}" aria-pressed="${on}" aria-label="${m.label}: ${value} ${m.unit}, ${st.text}. Mostra andamento">
<div class="t"><span>${m.label}</span><span class="chip${st.ok === false ? ' bad' : ''}"><span aria-hidden="true">${st.ok ? '✓' : st.ok === false ? '!' : '–'}</span>${st.text}</span></div>
<div class="val"><b>${value}</b><span>${m.unit}</span></div>
${m.key === 'act' ? `<div><div class="bar"><i style="width:${w.done / w.total * 100}%"></i></div><span class="sm">Questa settimana: ${w.done} di ${w.total} allenamenti da ${ACT_GOAL} min</span></div>` : ''}
<span class="sm">${m.ref}</span></button>`;
  }).join('');
  const mood = d.mood ? `<div class="dots" aria-hidden="true">${[1, 2, 3, 4, 5].map(n => `<i class="${n <= d.mood ? 'on' : ''}"></i>`).join('')}</div><span class="ml">${MOODS[d.mood - 1]}</span>` : `<span class="ml">–</span>`;
  const habits = HABITS.map(([k, l]) => `<li><span>${l}</span><b class="${d[k] ? '' : 'no'}">${d[k] === undefined ? '–' : d[k] ? 'Sì' : 'No'}</b></li>`).join('');
  return `<section class="sec" aria-labelledby="st"><div class="shead"><h2 id="st">Scheda del giorno</h2><span><strong>${ok} di 4</strong> parametri in fascia</span></div>
<div class="grid">${cs}<div class="mood"><span class="lb">Umore</span><div class="row" style="justify-content:flex-start;gap:12px">${mood}</div><hr><span class="lb">Abitudini</span><ul>${habits}</ul></div></div></section>`;
}
function trend(start, vis, sel) {
  const m = METRICS.find(x => x.key === S.metric), span = m.max - m.min, pct = v => Math.max(3, Math.min(100, (v - m.min) / span * 100));
  const valOf = x => m.key === 'bp' ? (has(x.sys) && has(x.dia) ? `${x.sys}/${x.dia}` : '–') : (has(m.get(x)) ? fmt(m.get(x)) : '–');
  const every = S.period <= 14 ? 1 : 5, gap = S.period > 14 ? '4px' : '10px';
  const bars = vis.map((x, k) => {
    const i = start + k, ok = dailyOk(m, x), on = i === sel, v = valOf(x), dt = parseKey(x.date);
    const rest = m.key === 'act' && !isActDay(x.date);
    return `<button class="b${rest ? ' rest' : ok ? '' : ' out'}${on ? ' on' : ''}" data-a="sel" data-i="${i}" style="height:${has(m.get(x)) ? pct(m.get(x)) : 3}%" aria-label="${title(x.date)}: ${v} ${m.unit}${rest ? ', giorno libero' : ok ? '' : ', fuori fascia'}"><span>${on ? v : ''}</span></button>`;
  }).join('');
  const labs = vis.map((x, k) => { const dt = parseKey(x.date); return `<span>${(k % every === 0 || start + k === sel) ? (S.period <= 7 ? DS[dt.getDay()] : dt.getDate()) : ''}</span>`; }).join('');
  const withV = vis.filter(x => m.key === 'bp' ? has(x.sys) : has(m.get(x)));
  let mean = '–', inR = '–';
  if (withV.length) {
    const avg = f => withV.reduce((a, x) => a + f(x), 0) / withV.length;
    mean = m.key === 'bp' ? (() => { const a = vis.filter(x => has(x.sys)), b = vis.filter(x => has(x.dia)); return a.length && b.length ? `${Math.round(a.reduce((t, x) => t + x.sys, 0) / a.length)}/${Math.round(b.reduce((t, x) => t + x.dia, 0) / b.length)}` : '–'; })() : fmt(avg(m.get)); inR = `${vis.filter(x => dailyOk(m, x)).length} su ${vis.length}`;
  }
  const hi = Math.min(m.band[1], m.max);
  return `<section class="trend" aria-labelledby="tt"><div class="row"><h2 id="tt">${m.label} · ultimi ${S.period} giorni</h2>
<div class="tabs" role="group" aria-label="Parametro del grafico">${METRICS.map(x => `<button class="tab" data-a="metric" data-m="${x.key}" aria-pressed="${x.key === S.metric}">${x.tab || x.label}</button>`).join('')}</div></div>
<div class="stats"><div><span>Media</span><b>${mean} <small>${m.unit}</small></b></div><div><span>Giorni in fascia</span><b>${inR}</b></div></div>
<div class="chart" role="group" aria-label="Grafico ${m.label}, media ${mean}, giorni in fascia ${inR}" style="gap:${gap}"><div class="band" aria-hidden="true" style="top:${(m.max - hi) / span * 100}%;height:${(hi - m.band[0]) / span * 100}%"></div>${bars}</div>
<div class="labs" aria-hidden="true" style="gap:${gap}">${labs}</div>
<div class="legend"><span><i></i>In fascia</span><span><i class="o"></i>Fuori fascia (tratteggiato)</span><span><i class="l"></i>${m.bandLabel}</span>${m.key === 'act' ? '<span><i class="r"></i>Giorno libero</span>' : ''}</div></section>`;
}
function sheet() {
  const f = S.form || {};
  const fields = FIELDS.map(c => { const err = S.errors[c.k] || '';
    return `<div class="f"><label for="f-${c.k}">${c.label} <span>· ${c.unit}</span></label><div class="c">
<button class="step" data-a="dec" data-k="${c.k}" aria-label="Diminuisci ${c.label}">−</button>
<input id="f-${c.k}" data-fk="f-${c.k}" data-k="${c.k}" type="number" inputmode="decimal" value="${f[c.k] ?? ''}" min="${c.min}" max="${c.max}" step="${c.step}" aria-invalid="${!!err}" ${err ? `aria-describedby="e-${c.k}"` : ''}>
<button class="step" data-a="inc" data-k="${c.k}" aria-label="Aumenta ${c.label}">+</button></div><span class="e" id="e-${c.k}" role="alert">${err}</span></div>`; }).join('');
  const moods = MOODS.map((l, i) => `<button class="opt" data-a="mood" data-v="${i + 1}" aria-pressed="${f.mood === i + 1}">${l}</button>`).join('');
  const habs = HABITS.map(([k, l]) => `<button class="opt" data-a="habit" data-k="${k}" aria-pressed="${!!f[k]}"><span aria-hidden="true">${f[k] ? '✓' : '+'}</span>${l}</button>`).join('');
  return `<div class="ov" data-a="close-bg"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="sh" tabindex="-1">
<div class="row" style="flex-wrap:nowrap"><div><span class="sub">${title(keyOf(new Date()))}</span><h2 id="sh">Scheda di oggi</h2></div><button class="x" data-a="close" aria-label="Chiudi">✕</button></div>
<div class="fgrid">${fields}</div>
<fieldset><legend>Come ti senti?</legend><div class="opts">${moods}</div></fieldset>
<fieldset><legend>Abitudini</legend><div class="opts">${habs}</div></fieldset>
<div class="foot">${btn('btn lg', 'close', 'Annulla')}${btn('btn pri lg', 'save', 'Salva scheda')}</div></div></div>`;
}
function syncDlg() {
  return `<div class="ov" data-a="close-bg"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="sy" tabindex="-1">
<div class="row" style="flex-wrap:nowrap"><div><span class="sub">FitPolo iDW28 · VeryFit</span><h2 id="sy">Sincronizza smartwatch</h2></div><button class="x" data-a="close" aria-label="Chiudi">✕</button></div>
<p class="sm" style="margin:0">Il watch iDW28 si sincronizza solo con l'app VeryFit, che non offre un collegamento diretto a una webapp. Ci sono tre strade, tutte sul tuo dispositivo, senza account né cloud.</p>
<div class="watch"><h3>1 · Importa un file di dati</h3>
<ol class="steps"><li>In VeryFit sincronizza il watch, poi attiva <em>Profilo → Impostazioni → Collega Salute / Google Fit</em> (le voci possono cambiare con la versione).</li>
<li><strong>iPhone:</strong> app Salute → tua foto → <em>Esporta tutti i dati</em>, decomprimi lo zip e scegli <code>export.xml</code> qui sotto.</li>
<li><strong>Android / altri:</strong> esporta i dati in CSV (da VeryFit, se disponibile, o con un'app come Health Sync) e scegli il file.</li></ol>
<p class="sm" style="margin:0">Formati letti: CSV, JSON, Apple Health <code>export.xml</code>. Colonne riconosciute: data, battito, sonno, attività, sistolica, diastolica. Vengono aggiornati solo i campi presenti.</p>
<div class="btns"><button class="btn lg pri" data-a="pick">Scegli file</button><input type="file" id="file" accept=".csv,.json,.xml,.txt,text/csv,application/json,text/xml" hidden></div></div>
<div class="watch"><h3>2 · Incolla i dati</h3><textarea class="paste" id="paste" aria-label="Dati incollati" placeholder="data,battito,sonno,attività&#10;2026-10-05,62,7.5,35"></textarea><div class="btns">${btn('btn', 'paste', 'Importa testo incollato')}</div></div>
<div class="watch"><h3>3 · Battito via Bluetooth</h3><p class="sm" style="margin:0">Legge il battito se il watch espone il servizio standard "Heart Rate". Molti watch lo fanno solo se non sono collegati a VeryFit: chiudi l'app, attiva sul watch la schermata battito e avvia la misura (25 secondi, da fermo). Richiede Chrome/Edge.</p>
<div class="btns">${btn('btn', 'bt', 'Misura ora', S.busy ? 'disabled' : '')}</div>${S.busy ? `<div class="imp" role="status">${esc(S.busy)}</div>` : ''}</div>
${S.syncMsg ? `<div class="imp" role="status">${esc(S.syncMsg)}</div>` : ''}
<div class="foot">${btn('btn', 'export', 'Esporta i miei dati (CSV)')}${btn('btn pri lg', 'close', 'Fatto')}</div></div></div>`;
}

/* ---------- eventi ---------- */
const app = document.getElementById('app');
const sig = el => ['a', 'i', 'p', 'm', 'k', 'v'].map(x => el.dataset[x] || '').join('|');
function render() {
  const a = document.activeElement, inApp = a && app.contains(a), fk = inApp && a.dataset.fk, as = inApp && a.dataset.a ? sig(a) : '', pasteOn = a && a.id === 'paste';
  const dl = app.querySelector('.dlg'), st = app.querySelector('.strip'), hadDlg = !!dl;
  const ds = dl ? dl.scrollTop : 0, ss = st ? st.scrollLeft : 0, txt = document.getElementById('paste'), tv = txt ? txt.value : '';
  app.innerHTML = view();
  const dl2 = app.querySelector('.dlg'); if (dl2) dl2.scrollTop = ds; const st2 = app.querySelector('.strip'); if (st2) st2.scrollLeft = ss;
  const t2 = document.getElementById('paste'); if (t2) { t2.value = tv; if (pasteOn) t2.focus(); }
  let target = null;
  if (fk) target = app.querySelector(`[data-fk="${fk}"]`);
  else if (as) target = [...app.querySelectorAll('[data-a]')].find(e => sig(e) === as && e.dataset.a === a.dataset.a && !e.disabled);
  if (target && !(pasteOn)) target.focus();
  else if (dl2 && !hadDlg) dl2.focus();
  else if (!dl2 && hadDlg && !target) { const f = app.querySelector('.fab'); if (f) f.focus(); }
}
function closeAll() { S.sheet = S.sync = false; C.dlg = null; C.form = null; C.busy = ''; render(); }
const clamp = (c, n) => Math.round(Math.max(c.min, Math.min(c.max, n)) / c.step) * c.step;
const field = k => FIELDS.find(c => c.k === k);
app.addEventListener('click', e => {
  const t = e.target.closest('[data-a]'); if (!t) return; const a = t.dataset.a;
  if (a === 'close-bg') { if (e.target === t && downOv) closeAll(); return; }
  if (clinicAction(a, t)) return;
  const set = (k, v) => { S.form[k] = v; S.errors[k] = ''; render(); };
  const actions = {
    sel: () => { S.sel = +t.dataset.i; render(); }, period: () => { S.period = +t.dataset.p; render(); },
    prev: () => { S.sel = Math.max(0, S.sel - 1); render(); }, next: () => { S.sel = Math.min(S.days.length - 1, S.sel + 1); render(); },
    metric: () => { S.metric = t.dataset.m; render(); },
    clear: () => { S.days = []; S.sample = false; S.sel = 0; persist(); render(); },
    restore: () => { S.days = sample(); S.sample = true; S.sel = S.days.length - 1; persist(); render(); },
    open: openSheet, close: closeAll, save,
    view: () => { S.view = t.dataset.p; try { localStorage.setItem('vitalapp.view', S.view); } catch (e) {} window.scrollTo(0, 0); render(); },
    dec: () => { const c = field(t.dataset.k); set(c.k, clamp(c, (Number(S.form[c.k]) || 0) - c.step)); },
    inc: () => { const c = field(t.dataset.k); set(c.k, clamp(c, (Number(S.form[c.k]) || 0) + c.step)); },
    mood: () => set('mood', +t.dataset.v), habit: () => set(t.dataset.k, !S.form[t.dataset.k]),
    sync: () => { S.sync = true; S.syncMsg = ''; render(); },
    pick: () => document.getElementById('file').click(), paste: () => importText(document.getElementById('paste').value, 'testo incollato'), bt: measureHr, export: exportCsv
  };
  if (actions[a]) actions[a]();
});
app.addEventListener('input', e => { const t = e.target; if (clinicInput(t)) return; if (t.dataset.k && t.type === 'number' && S.form) S.form[t.dataset.k] = t.value === '' ? '' : Number(t.value); });
let downOv = false;
app.addEventListener('pointerdown', e => { downOv = e.target.classList.contains('ov'); });
app.addEventListener('change', e => {
  const t = e.target;
  if (clinicFiles(t) || clinicInput(t)) return;
  if (t.id === 'file' && t.files[0]) { const f = t.files[0]; f.text().then(x => importText(x, f.name)); }
  else if (t.dataset.k && t.type === 'number') { S.form[t.dataset.k] = t.value === '' ? '' : Number(t.value); S.errors[t.dataset.k] = ''; }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && (S.sheet || S.sync || C.dlg)) closeAll(); });

load(); sortDays(); S.sel = S.days.length - 1; clinicLoad();
try { if (localStorage.getItem('vitalapp.view') === 'clinic' || location.hash === '#cartella') S.view = 'clinic'; } catch (e) {}
render();
setTimeout(() => { S.loading = false; render(); }, 600);
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
