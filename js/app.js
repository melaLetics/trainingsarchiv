
(function () {
'use strict';
const DAY = 86400000;
const CATS = ['kraft', 'mob', 'lauf', 'rad'];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Sprache ---------- */
const LANGS = window.I18N || { de: {} };
let LANG = 'de';
try { LANG = localStorage.getItem('ta-lang') || ''; } catch (e) {}
if (!LANGS[LANG]) LANG = /^de\b/i.test(navigator.language || '') ? 'de' : 'en';
if (!LANGS[LANG]) LANG = 'de';
function t(key, ...a) {
  let v = LANGS[LANG][key]; if (v === undefined) v = LANGS.de[key]; if (v === undefined) return key;
  return typeof v === 'function' ? v(...a) : v;
}
let CAT, TYPE, MON, WD, WD_NAME, METRIC, nf, nf1, dateFmt;
function applyLang() {
  CAT = t('cat'); TYPE = t('type'); MON = t('mon'); WD = t('wd'); WD_NAME = t('wdName'); METRIC = t('metric');
  const loc = LANG === 'de' ? 'de-DE' : 'en-GB';
  nf = new Intl.NumberFormat(loc); nf1 = new Intl.NumberFormat(loc, { maximumFractionDigits: 1 });
  dateFmt = LANG === 'de' ? null : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  document.documentElement.lang = LANG;
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}
applyLang();
const exName = (n) => (n === 'Pause' ? t('pause') : n);
const pctF = (r) => t('pct', nf1.format(r * 100));

const dDate = (day) => new Date(day * DAY);
const fDate = (day) => { const d = dDate(day); if (dateFmt) return dateFmt.format(d); return String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + d.getUTCFullYear(); };
const yearOf = (day) => dDate(day).getUTCFullYear();
const fTime = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const fKm = (m) => (m >= 100000 ? nf.format(Math.round(m / 1000)) : nf1.format(m / 1000)) + ' km';
const todayDay = () => { const n = new Date(); return Math.round(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / DAY); };

let M = null, D = null, source = null;

/* ---------- Speicher ---------- */
const DB = {
  open() { return new Promise((res, rej) => { const r = indexedDB.open('trainingsarchiv', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async get(k) { try { const db = await this.open(); return await new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch (e) { return null; } },
  async set(k, v) { try { const db = await this.open(); await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); return true; } catch (e) { return false; } },
  async del(k) { try { const db = await this.open(); await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = res; t.onerror = res; }); } catch (e) {} }
};

/* ---------- Ableitungen ---------- */
function derive(m) {
  const S = m.s, n = S.w.length;
  const wSess = m.w.map(() => []);
  for (let i = 0; i < n; i++) wSess[S.w[i]].push(i);
  const dayMap = new Map();
  for (let i = 0; i < n; i++) { const d = S.day[i]; if (!dayMap.has(d)) dayMap.set(d, []); dayMap.get(d).push(i); }
  const days = [...dayMap.keys()].sort((a, b) => a - b);
  const wInfo = m.w.map((w, wi) => {
    const ss = wSess[wi];
    const info = { count: ss.length, first: ss.length ? S.day[ss[0]] : 0, last: ss.length ? S.day[ss[ss.length - 1]] : 0 };
    const metric = defaultMetric(m, wi, ss);
    info.metric = metric;
    if (metric) {
      const vals = ss.map((i) => mv(m, i, metric)).filter((v) => v > 0);
      if (vals.length) info.best = metric === 'dur' ? Math.min(...vals) : Math.max(...vals);
    }
    return info;
  });
  return { wSess, dayMap, days, wInfo };
}
function mv(m, i, metric) { const S = m.s; return metric === 'dur' ? S.dur[i] : metric === 'reps' ? S.reps[i] : metric === 'dist' ? S.dist[i] : S.pts[i]; }
function defaultMetric(m, wi, ss) {
  const w = m.w[wi], S = m.s;
  if (!ss.length) return null;
  const durs = ss.map((i) => S.dur[i]).filter((v) => v > 0);
  const reps = ss.map((i) => S.reps[i]).filter((v) => v > 0);
  const dist = ss.map((i) => S.dist[i]).filter((v) => v > 0);
  if (w.t === 'free') return dist.length ? 'dist' : durs.length ? 'dur' : 'pts';
  if (durs.length) {
    const mean = durs.reduce((a, b) => a + b, 0) / durs.length;
    const sd = Math.sqrt(durs.reduce((a, b) => a + (b - mean) ** 2, 0) / durs.length);
    const repsVary = reps.length > 1 && Math.max(...reps) !== Math.min(...reps);
    if (sd / mean < 0.02 && repsVary) return 'reps';
    return 'dur';
  }
  if (reps.length) return 'reps';
  return 'pts';
}
const fMetric = (metric, v) => metric === 'dur' ? fTime(v) : metric === 'dist' ? fKm(v) : nf.format(v);

/* ---------- Tooltip ---------- */
const tip = $('tip');
function showTip(html, x, y) { tip.innerHTML = html; tip.hidden = false; const r = tip.getBoundingClientRect(); let L = x + 14, T = y + 14; if (L + r.width > innerWidth - 8) L = x - r.width - 14; if (T + r.height > innerHeight - 8) T = y - r.height - 14; tip.style.left = Math.max(8, L) + 'px'; tip.style.top = Math.max(8, T) + 'px'; }
function hideTip() { tip.hidden = true; }

/* ---------- Überblick ---------- */
let yearMode = 'n';
function streaks() {
  const days = D.days; let best = 1, bs = days[0], cur = 1, cs = days[0], gap = 0, gapFrom = 0;
  for (let i = 1; i < days.length; i++) {
    const g = days[i] - days[i - 1];
    if (g === 1) { cur++; } else { if (g - 1 > gap) { gap = g - 1; gapFrom = days[i - 1]; } cur = 1; cs = days[i]; }
    if (cur > best) { best = cur; bs = cs; }
  }
  const last = days[days.length - 1], t = todayDay();
  const current = (t - last <= 1) ? cur : 0;
  return { best, bestFrom: bs, current, curFrom: cs, last, gap, gapFrom };
}
function overview() {
  const S = M.s, n = S.w.length;
  let secs = 0, reps = 0, pts = 0, run = 0, ride = 0, stars = 0, pbs = 0;
  for (let i = 0; i < n; i++) {
    secs += S.dur[i]; reps += S.reps[i]; pts += S.pts[i];
    const c = M.w[S.w[i]].c;
    if (c === 'lauf') run += S.dist[i]; if (c === 'rad') ride += S.dist[i];
    if (S.f[i] & 1) stars++; if (S.f[i] & 2) pbs++;
  }
  const st = streaks();
  const first = D.days[0], last = D.days[D.days.length - 1];
  const years = (last - first) / 365.25;
  let html = `<section class="sec"><div class="dhead"><h1>${t('ov.h1', nf.format(n), nf1.format(years))}</h1>
    <div class="note">${t('ov.sub', fDate(first), fDate(last), nf.format(D.days.length), nf.format(M.w.length))}</div></div>
    <div class="stats">
      ${stat(t('st.time'), nf.format(Math.round(secs / 3600)) + '<small>h</small>', t('st.timeSub', nf.format(Math.round(secs / 60 / n))))}
      ${stat(t('st.reps'), nf.format(reps), t('st.repsSub'))}
      ${stat(t('st.pts'), nf.format(pts), t('st.ptsSub', nf.format(Math.round(pts / D.days.length))))}
      ${stat(t('st.run'), unit(fKm(run)), t('st.runSub'))}
      ${stat(t('st.ride'), unit(fKm(ride)), t('st.rideSub'))}
      ${stat(t('st.stars'), nf.format(stars), t('st.starsSub', nf.format(pbs)))}
    </div>
    <div class="stats wide">
      ${stat(t('st.longest'), t('days', st.best, nf.format(st.best)), t('st.from', fDate(st.bestFrom)))}
      ${stat(t('st.current'), t('days', st.current, nf.format(st.current)), st.current ? t('st.since', fDate(st.curFrom)) : t('st.lastTraining', fDate(st.last)))}
      ${stat(t('st.gap'), t('days', st.gap, nf.format(st.gap)), t('st.after', fDate(st.gapFrom)))}
    </div></section>`;
  html += `<section class="grid2">
      <div class="panel sec"><div class="sechead"><h2>${t('ov.perYear')}</h2><div class="seg" role="group" aria-label="${t('ov.unit')}"><button type="button" data-ym="n" aria-pressed="${yearMode === 'n'}">${t('ov.sessions')}</button><button type="button" data-ym="h" aria-pressed="${yearMode === 'h'}">${t('ov.hours')}</button></div></div>
        <div id="yearChart">${yearChart()}</div>
        <div class="legend">${CATS.map((c) => `<span><span class="sw c-${c}"></span>${CAT[c]}</span>`).join('')}</div>
        <div class="note">${t('ov.catNote')}</div></div>
      <div class="panel sec"><h2>${t('ov.onThisDay')}</h2>${onThisDay()}</div>
    </section>`;
  html += `<section class="grid2">
      <div class="panel sec"><div class="sechead"><h2>${t('era.h')}</h2></div><div class="note">${t('era.sub')}</div>${erasView()}</div>
      <div class="panel sec"><h2>${t('crazy.h')}</h2>${crazyDay()}</div>
    </section>`;
  html += `<section class="grid2">
      <div class="panel sec"><h2>${t('ov.topW')}</h2><div class="list">${topWorkouts()}</div></div>
      <div class="panel sec"><h2>${t('ov.topX')}</h2>${topExercises()}<div class="note">${t('ov.topXNote', D.ex.minY)} <a href="#exercises">${t('ov.allX')}</a></div></div>
    </section>`;
  html += `<section class="panel sec" id="pbwhen">${pbWhen()}</section>`;
  html += `<section class="grid2"><div class="panel sec"><h2>${t('ov.weekdays')}</h2>${rhythm('wd')}</div><div class="panel sec"><h2>${t('ov.hourOfDay')}</h2>${rhythm('hour')}</div></section>`;
  return html;
}

/* Meine Ären: häufigstes Workout pro Jahr, gleiche Favoriten in Folge zusammengefasst */
function erasView() {
  const S = M.s, by = new Map(), seen = new Set(), fresh = {};
  for (let i = 0; i < S.w.length; i++) {
    const y = yearOf(S.day[i]); if (!by.has(y)) by.set(y, new Map());
    const m = by.get(y); m.set(S.w[i], (m.get(S.w[i]) || 0) + 1);
    if (!seen.has(S.w[i])) { seen.add(S.w[i]); fresh[y] = (fresh[y] || 0) + 1; }
  }
  const years = [...by.keys()].sort((a, b) => a - b).map((y) => {
    const m = by.get(y), sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const alt = M.w[sorted[0][0]].c === 'mob' ? sorted.find(([wi]) => M.w[wi].c !== 'mob') : null;
    return { y, wi: sorted[0][0], n: sorted[0][1], total: [...m.values()].reduce((a, b) => a + b, 0), fresh: fresh[y] || 0, alt };
  });
  const eras = [];
  years.forEach((r) => { const last = eras[eras.length - 1]; if (last && last.wi === r.wi && last.y1 === r.y - 1) { last.y1 = r.y; last.n += r.n; last.years.push(r); } else eras.push({ wi: r.wi, y0: r.y, y1: r.y, n: r.n, years: [r] }); });
  return `<div class="eras">${eras.map((e) => { const w = M.w[e.wi], altR = e.years[e.years.length - 1].alt;
    return `<div class="era"><div class="eyr num">${e.y0}${e.y1 > e.y0 ? '–' + String(e.y1).slice(2) : ''}</div><div class="ebody"><a class="enm" href="#workout-${e.wi}"><span class="sw c-${w.c}"></span>${esc(w.n)}</a><div class="meta">${t('era.times', nf.format(e.n))}${altR ? ' · ' + t('era.also', `<a href="#workout-${altR[0]}">${esc(M.w[altR[0]].n)}</a>`) : ''}</div><div class="meta">${e.years.map((r) => t('era.yearMeta', r.y, nf.format(r.total), nf.format(r.fresh))).join('<br>')}</div></div></div>`; }).join('')}</div>`;
}
/* Der verrückteste Tag: die meisten Einheiten an einem Tag */
function crazyDay() {
  const S = M.s; let best = null, longest = null, mostReps = null;
  for (const [day, ss] of D.dayMap) {
    const secs = ss.reduce((a, i) => a + (S.dur[i] <= 36000 ? S.dur[i] : 0), 0), reps = ss.reduce((a, i) => a + S.reps[i], 0);
    const o = { day, ss, secs, reps };
    if (!best || ss.length > best.ss.length || (ss.length === best.ss.length && secs > best.secs)) best = o;
    if (!longest || secs > longest.secs) longest = o;
    if (!mostReps || reps > mostReps.reps) mostReps = o;
  }
  const wdName = (d) => WD_NAME[(dDate(d).getUTCDay() + 6) % 7];
  const groups = new Map(); best.ss.forEach((i) => groups.set(S.w[i], (groups.get(S.w[i]) || 0) + 1));
  const list = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  let h = `<div class="crazy"><div class="cbig num">${nf.format(best.ss.length)}</div><div><div class="clead">${t('crazy.lead')}</div><div class="meta">${wdName(best.day)}, ${fDate(best.day)} · ${fHours(best.secs)}${best.reps ? ' · ' + t('d.totalReps', nf.format(best.reps)) : ''}</div></div></div>
    <div class="list">${list.map(([wi, n]) => `<a class="row" href="#workout-${wi}"><span class="dot c-${M.w[wi].c}"></span><span class="nm">${esc(M.w[wi].n)}</span><span class="rt"><b>${n}</b>×</span></a>`).join('')}</div>`;
  const extra = [];
  if (longest.day !== best.day) extra.push(`${t('crazy.longest')}: <b>${fHours(longest.secs)}</b> ${t('d.on', fDate(longest.day))}`);
  const skipped = S.dur.some((x) => x > 36000);
  if (mostReps.reps && mostReps.day !== best.day) extra.push(`${t('crazy.mostReps')}: <b>${nf.format(mostReps.reps)}</b> ${t('d.on', fDate(mostReps.day))}`);
  if (extra.length) h += `<div class="crazyfacts">${extra.map((x) => `<div>${x}</div>`).join('')}</div>`;
  if (skipped) h += `<div class="note">${t('crazy.skip')}</div>`;
  return h;
}
const unit = (s) => s.replace(/ (km|h)$/, '<small>$1</small>');
function stat(l, v, s) { return `<div class="stat"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`; }

function yearChart() {
  const y0 = yearOf(D.days[0]), y1 = yearOf(D.days[D.days.length - 1]);
  const rows = [];
  for (let y = y0; y <= y1; y++) rows.push({ y, v: { kraft: 0, mob: 0, lauf: 0, rad: 0 } });
  const S = M.s;
  for (let i = 0; i < S.w.length; i++) { const r = rows[yearOf(S.day[i]) - y0]; r.v[M.w[S.w[i]].c] += yearMode === 'n' ? 1 : S.dur[i] / 3600; }
  const max = Math.max(...rows.map((r) => CATS.reduce((a, c) => a + r.v[c], 0)));
  const ticks = niceTicks(0, max, 4), tmax = ticks[ticks.length - 1];
  const W = 460, H = 220, L = 38, B = 22, T = 8, bw = (W - L) / rows.length;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${t('ov.yearAria')}">`;
  ticks.forEach((t) => { const y = T + (H - B - T) * (1 - t / tmax); s += `<line class="axis" x1="${L}" x2="${W}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${nf.format(t)}</text>`; });
  rows.forEach((r, i) => {
    let acc = 0; const x = L + i * bw + bw * 0.15;
    CATS.forEach((c) => { const v = r.v[c]; if (!v) return; const h = (H - B - T) * v / tmax; const y = T + (H - B - T) * (1 - (acc + v) / tmax); acc += v;
      s += `<rect x="${x}" y="${y}" width="${bw * 0.7}" height="${h}" style="fill:var(--${c})"><title>${r.y} · ${CAT[c]}: ${nf.format(Math.round(v))}${yearMode === 'h' ? ' h' : ''}</title></rect>`; });
    if (rows.length <= 14 || i % 2 === 0) s += `<text x="${x + bw * 0.35}" y="${H - 6}" text-anchor="middle">${String(r.y).slice(2)}</text>`;
  });
  return s + '</svg>';
}
function onThisDay() {
  const td = todayDay(); const d0 = dDate(td); const target = Math.round(Date.UTC(d0.getUTCFullYear() - 1, d0.getUTCMonth(), d0.getUTCDate()) / DAY);
  let out = `<div class="note">${fDate(target)}</div>`;
  const ss = D.dayMap.get(target);
  if (ss) out += `<div class="list">${ss.map((i) => sessRow(i)).join('')}</div>`;
  else {
    let near = null; for (const d of D.days) { if (d <= target) near = d; else break; }
    out += `<div class="empty">${t('otd.none')}${near ? t('otd.before', fDate(near)) : ''}</div>`;
    if (near) out += `<div class="list">${D.dayMap.get(near).map((i) => sessRow(i)).join('')}</div>`;
  }
  // Durch die Jahre
  const years = [];
  for (let k = 2; k <= 12; k++) { const dd = Math.round(Date.UTC(d0.getUTCFullYear() - k, d0.getUTCMonth(), d0.getUTCDate()) / DAY); if (D.dayMap.get(dd)) years.push(dd); }
  if (years.length) out += `<div class="note">${t('otd.years', years.map((d) => yearOf(d)).join(', '))}</div>`;
  return out;
}
function sessRow(i) {
  const S = M.s, wi = S.w[i], w = M.w[wi], m = D.wInfo[wi].metric;
  const v = m ? mv(M, i, m) : 0;
  return `<a class="row" href="#workout-${wi}"><span class="dot c-${w.c}"></span><span><span class="nm">${esc(w.n)}</span> ${S.f[i] & 2 ? `<span class="tag pbtag">${t('tag.pb')}</span>` : ''}<div class="meta">${t('points', nf.format(S.pts[i]))}</div></span><span class="rt">${v ? '<b>' + fMetric(m, v) + '</b>' : ''}</span></a>`;
}
function topWorkouts() {
  const idx = M.w.map((_, i) => i).sort((a, b) => D.wInfo[b].count - D.wInfo[a].count).slice(0, 8);
  return idx.map((wi) => { const w = M.w[wi], inf = D.wInfo[wi];
    return `<a class="row" href="#workout-${wi}"><span class="dot c-${w.c}"></span><span><span class="nm">${esc(w.n)}</span><div class="meta">${fDate(inf.first)} – ${fDate(inf.last)}</div></span><span class="rt"><b>${nf.format(inf.count)}</b>×</span></a>`; }).join('');
}
function topExercises() {
  const idx = M.ex.map((_, i) => i).filter((i) => M.exTot[i][0] > 0 && M.ex[i] !== 'Pause').sort((a, b) => M.exTot[b][0] - M.exTot[a][0]).slice(0, 10);
  const max = M.exTot[idx[0]][0];
  return `<div style="display:grid;gap:6px">${idx.map((i) => `<a class="exbar" href="#exercise-${i}"><span style="overflow-wrap:anywhere">${esc(exName(M.ex[i]))}</span><span class="num" style="font-weight:600;font-size:16px">${nf.format(M.exTot[i][0])}</span><span style="grid-column:1/-1;height:6px;border-radius:3px;background:var(--sunk)"><span style="display:block;height:100%;border-radius:3px;background:var(--accent);width:${(M.exTot[i][0] / max * 100).toFixed(1)}%"></span></span></a>`).join('')}</div>`;
}
/* Wann gelingen Bestleistungen? Anteil der Trainings mit Bestleistung je Wochentag und Zeitfenster */
const PB_WIN = [[0, 9], [9, 12], [12, 15], [15, 18], [18, 21], [21, 24]];
function pbWhen() {
  const S = M.s, n = S.w.length;
  let first = Infinity;
  for (let i = 0; i < n; i++) if (S.f[i] & 2) { first = S.day[i]; break; }
  const head = `<div class="sechead"><h2>${t('pb.h')}</h2></div>`;
  if (first === Infinity) return head + `<div class="empty">${t('pb.none')}</div>`;
  const WL = t('pb.win');
  const cell = Array.from({ length: 7 }, () => PB_WIN.map(() => [0, 0]));
  const wd = Array.from({ length: 7 }, () => [0, 0]), win = PB_WIN.map(() => [0, 0]);
  let tot = 0, pbs = 0;
  for (let i = 0; i < n; i++) {
    if (S.day[i] < first) continue;
    const w = M.w[S.w[i]]; if (w.c === 'mob' || w.t === 'free') continue;
    const d = (dDate(S.day[i]).getUTCDay() + 6) % 7, h = S.hour[i], k = PB_WIN.findIndex((x) => h >= x[0] && h < x[1]);
    const pb = S.f[i] & 2 ? 1 : 0;
    cell[d][k][0]++; cell[d][k][1] += pb; wd[d][0]++; wd[d][1] += pb; win[k][0]++; win[k][1] += pb; tot++; pbs += pb;
  }
  const avg = pbs / tot, MIN = Math.max(40, Math.round(tot * 0.01));
  const rate = (x) => (x[0] >= MIN ? x[1] / x[0] : -1);
  let best = null;
  cell.forEach((r, d) => r.forEach((x, k) => { if (rate(x) > (best ? rate(cell[best[0]][best[1]]) : -1)) best = [d, k]; }));
  const bestWd = wd.reduce((a, x, i) => (rate(x) > rate(wd[a]) ? i : a), 0);
  const bestWin = win.reduce((a, x, i) => (rate(x) > rate(win[a]) ? i : a), 0);
  const pct = pctF;
  const winText = (k) => t('pb.winText', k, PB_WIN[k][0], PB_WIN[k][1], PB_WIN.length - 1);
  const bx = cell[best[0]][best[1]], br = bx[1] / bx[0];
  const maxR = Math.max(...cell.flat().map(rate));
  let h = head + `<p class="pbanswer">${t('pb.answer', t('pb.when', best[0], winText(best[1])), Math.round(1 / br), pct(br), Math.round(1 / avg), pct(avg))}</p>
    <div class="pbfacts"><span>${t('pb.bestWd')}: <b>${WD_NAME[bestWd]}</b> (${pct(wd[bestWd][1] / wd[bestWd][0])})</span><span>${t('pb.bestWin')}: <b>${t('pb.winLabel', WL[bestWin])}</b> (${pct(win[bestWin][1] / win[bestWin][0])})</span></div>
    <div class="scroll"><table class="pbgrid"><thead><tr><th></th>${WL.map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>`;
  cell.forEach((r, d) => {
    h += `<tr><th>${WD[d]}</th>${r.map((x, k) => {
      const tip = t('pb.cellTip', WD_NAME[d], WL[k], x[1], nf.format(x[0]));
      if (x[0] < MIN) return `<td class="few" title="${tip}${t('pb.few')}">${x[0] ? '·' : ''}</td>`;
      const r1 = x[1] / x[0], mix = Math.round(8 + 87 * r1 / maxR);
      const isBest = d === best[0] && k === best[1];
      return `<td title="${tip}" style="background:color-mix(in srgb,var(--pb) ${mix}%,var(--surface));${mix > 55 ? 'color:var(--pb-fg);' : ''}"${isBest ? ' class="best"' : ''}>${nf1.format(r1 * 100)}</td>`;
    }).join('')}</tr>`;
  });
  h += `</tbody></table></div><div class="note">${t('pb.note', fDate(first), nf.format(tot), MIN)}</div>`;
  return h;
}
function rhythm(kind) {
  const S = M.s, n = kind === 'wd' ? 7 : 24, v = new Array(n).fill(0);
  for (let i = 0; i < S.w.length; i++) { if (kind === 'wd') v[(dDate(S.day[i]).getUTCDay() + 6) % 7]++; else v[S.hour[i]]++; }
  const max = Math.max(...v), W = 460, H = 140, B = 18, bw = W / n;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${t('rh.aria', kind === 'wd')}">`;
  v.forEach((x, i) => { const h = (H - B - 4) * x / max; s += `<rect x="${i * bw + bw * 0.12}" y="${H - B - h}" width="${bw * 0.76}" height="${h}" rx="2" style="fill:var(--accent)"><title>${t('rh.title', kind === 'wd' ? WD_NAME[i] : t('rh.hour', i), nf.format(x))}</title></rect>`;
    if (kind === 'wd' || i % 3 === 0) s += `<text x="${i * bw + bw / 2}" y="${H - 4}" text-anchor="middle">${kind === 'wd' ? WD[i] : i}</text>`; });
  return s + '</svg>';
}
function niceTicks(lo, hi, n) {
  if (hi <= lo) hi = lo + 1;
  const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  const out = []; for (let t = Math.floor(lo / step) * step; t < hi + step * 0.999; t += step) out.push(+t.toFixed(10));
  return out;
}
function timeTicks(lo, hi, n) {
  const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
  const raw = (hi - lo) / n; const step = steps.find((s) => s >= raw) || 7200;
  const out = []; for (let t = Math.floor(lo / step) * step; t < hi + step * 0.999; t += step) out.push(t);
  return out;
}

/* ---------- Workout-Liste ---------- */
const LS = { q: '', types: { structured: true, reps: true, distance: true, free: true, none: false }, cat: '', sort: 'count', limit: 150 };
function workoutsView() {
  return `<section class="sec"><div class="dhead"><h1>${t('nav.workouts')}</h1><div class="note">${t('w.sub')}</div></div>
    <div class="tools"><input type="search" id="q" placeholder="${t('w.search')}" value="${esc(LS.q)}" aria-label="${t('search.aria')}">
      <select id="sort" aria-label="${t('sort.aria')}"><option value="count">${t('sort.count')}</option><option value="last">${t('sort.last')}</option><option value="name">${t('sort.name')}</option></select></div>
    <div class="tools" id="typeChips">${Object.keys(TYPE).map((t) => `<button type="button" class="chip" data-type="${t}" aria-pressed="${LS.types[t]}">${TYPE[t]}</button>`).join('')}</div>
    <div class="tools" id="catChips"><button type="button" class="chip" data-cat="" aria-pressed="${LS.cat === ''}">${t('w.allCats')}</button>${CATS.map((c) => `<button type="button" class="chip" data-cat="${c}" aria-pressed="${LS.cat === c}"><span class="sw c-${c}"></span>${CAT[c]}</button>`).join('')}</div>
    <div class="note" id="count"></div><div class="list" id="wlist"></div><div id="more"></div></section>`;
}
function filteredWorkouts() {
  const q = LS.q.trim().toLowerCase();
  let idx = M.w.map((_, i) => i).filter((i) => { const w = M.w[i]; if (!LS.types[w.t]) return false; if (LS.cat && w.c !== LS.cat) return false;
    if (!q) return true; if (w.n.toLowerCase().includes(q)) return true;
    return !!(w.r && w.r.some((r) => r.some((e) => M.ex[e[0]].toLowerCase().includes(q)))); });
  const I = D.wInfo;
  if (LS.sort === 'count') idx.sort((a, b) => I[b].count - I[a].count);
  else if (LS.sort === 'last') idx.sort((a, b) => I[b].last - I[a].last);
  else idx.sort((a, b) => M.w[a].n.localeCompare(M.w[b].n, LANG));
  return idx;
}
function renderList() {
  const idx = filteredWorkouts();
  $('count').textContent = t('w.count', nf.format(idx.length));
  $('wlist').innerHTML = idx.slice(0, LS.limit).map((wi) => { const w = M.w[wi], inf = D.wInfo[wi];
    const best = inf.best && w.c !== 'mob' ? `<b>${fMetric(inf.metric, inf.best)}</b><div class="meta">${inf.metric === 'dist' ? t('w.longest') : t('w.best')}</div>` : '';
    return `<a class="row" href="#workout-${wi}"><span class="dot c-${w.c}"></span><span><span class="nm">${esc(w.n)}</span><div class="meta">${nf.format(inf.count)}× · ${t('w.last', fDate(inf.last))}${w.t === 'structured' ? ' · ' + t('rounds', w.r.length) : ''}${w.tot ? ' · ' + t('repsShort', nf.format(w.tot)) : ''}</div></span><span class="rt">${best}</span></a>`; }).join('') || `<div class="empty">${t('w.empty')}</div>`;
  $('more').innerHTML = idx.length > LS.limit ? `<button type="button" class="btn" id="btnMore">${t('more', nf.format(Math.min(150, idx.length - LS.limit)))}</button>` : '';
}

/* ---------- Workout-Detail ---------- */
let detailMetric = null, detailWi = -1;
function qty(e) {
  const [, rep, dm, wt, dur] = e;
  if (rep != null) return rep + '×';
  if (dm != null) return dm >= 1000 ? nf1.format(dm / 1000) + ' km' : dm + ' m';
  if (dur != null) return dur >= 60 && dur % 60 === 0 ? dur / 60 + ' min' : dur + ' s';
  return '';
}
function detailView(wi) {
  if (wi !== detailWi) { detailMetric = null; detailWi = wi; }
  const w = M.w[wi], inf = D.wInfo[wi], ss = D.wSess[wi], S = M.s;
  if (!w) return `<div class="empty">${t('d.missing')} <a href="#workouts">${t('toList')}</a></div>`;
  const metrics = ['dur', 'reps', 'dist', 'pts'].filter((m) => ss.some((i) => mv(M, i, m) > 0));
  if (!detailMetric || !metrics.includes(detailMetric)) detailMetric = inf.metric && metrics.includes(inf.metric) ? inf.metric : metrics[0];
  const m = detailMetric;
  let html = `<section class="sec"><a class="back" href="#workouts">${t('d.back')}</a>
    <div class="dhead"><div><span class="tag"><span class="sw c-${w.c}"></span>${CAT[w.c]}</span> <span class="tag">${TYPE[w.t]}</span></div><h1>${esc(w.n)}</h1>
    <div class="note">${t('d.meta', nf.format(inf.count), fDate(inf.first), fDate(inf.last))}</div></div>`;
  if (m) {
    const vals = ss.map((i) => [i, mv(M, i, m)]).filter((x) => x[1] > 0);
    const lower = m === 'dur';
    const bestE = vals.reduce((a, b) => (!a || (lower ? b[1] < a[1] : b[1] > a[1])) ? b : a, null);
    const firstE = vals[0], lastE = vals[vals.length - 1];
    const recent = vals.slice(-10); const avg = recent.reduce((a, b) => a + b[1], 0) / recent.length;
    html += `<div class="stats">
      ${stat(t('d.best'), fMetric(m, bestE[1]), t('d.on', fDate(S.day[bestE[0]])))}
      ${stat(t('d.first'), fMetric(m, firstE[1]), fDate(S.day[firstE[0]]))}
      ${stat(t('d.last'), fMetric(m, lastE[1]), fDate(S.day[lastE[0]]))}
      ${stat(t('d.avgN', recent.length), fMetric(m, avg), t('d.avg'))}
    </div>`;
  }
  html += `</section>`;
  if (m) html += `<section class="panel sec"><div class="sechead"><h2>${t('d.progress')}</h2>${metrics.length > 1 ? `<div class="seg" role="group" aria-label="${t('d.metricAria')}">${metrics.map((x) => `<button type="button" data-metric="${x}" aria-pressed="${x === m}">${METRIC[x]}</button>`).join('')}</div>` : ''}</div>
      ${progressChart(wi, m)}
      <div class="legend"><span><span class="sw" style="background:var(--accent);border-radius:50%"></span>${t('leg.session')}</span><span><span class="sw" style="background:var(--pb);border-radius:50%"></span>${t('leg.newBest')}</span><span><span class="sw" style="background:var(--pb);height:2px"></span>${t('leg.bestSoFar')}</span></div></section>`;
  if (w.r) {
    html += `<section class="sec"><div class="sechead"><h2>${t('d.structure')}</h2><span class="note">${t('rounds', w.r.length)}${w.tot ? ' · ' + t('d.totalReps', nf.format(w.tot)) : ''}${w.sv > 1 ? ' · ' + t('d.variants', w.sv) : ''}</span></div>
      <div class="rounds">${w.r.map((r, ri) => `<div class="round"><h3>${t('d.round', ri + 1)}</h3><ol>${r.map((e) => `<li class="${M.ex[e[0]] === 'Pause' ? 'pause' : ''}"><span class="q">${qty(e)}</span><span>${M.ex[e[0]] === 'Pause' ? t('pause') : `<a class="exlink" href="#exercise-${e[0]}">${esc(M.ex[e[0]])}</a>`}${e[3] ? ' <span class="note">(' + esc(e[3]) + ')</span>' : ''}</span></li>`).join('')}</ol></div>`).join('')}</div></section>`;
    const split = splitsChart(wi);
    if (split) html += `<section class="panel sec"><h2>${t('d.splits')}</h2>${split}</section>`;
  }
  html += `<section class="panel sec"><h2>${t('d.recent')}</h2><div class="scroll"><table><thead><tr><th>${t('th.date')}</th><th class="r">${t('th.time')}</th><th class="r">${t('th.reps')}</th><th class="r">${t('th.dist')}</th><th class="r">${t('th.pts')}</th><th></th></tr></thead><tbody>
    ${ss.slice(-15).reverse().map((i) => `<tr><td>${fDate(S.day[i])}</td><td class="r">${S.dur[i] ? fTime(S.dur[i]) : '–'}</td><td class="r">${S.reps[i] ? nf.format(S.reps[i]) : '–'}</td><td class="r">${S.dist[i] ? fKm(S.dist[i]) : '–'}</td><td class="r">${nf.format(S.pts[i])}</td><td>${S.f[i] & 2 ? `<span class="tag pbtag">${t('tag.pb')}</span>` : S.f[i] & 1 ? `<span class="tag">${t('tag.star')}</span>` : ''}</td></tr>`).join('')}
    </tbody></table></div></section>`;
  return html;
}
function progressChart(wi, m) {
  const S = M.s, ss = D.wSess[wi].filter((i) => mv(M, i, m) > 0);
  if (ss.length < 2) return `<div class="empty">${t('pc.few', METRIC[m])}</div>`;
  const lower = m === 'dur';
  const xs = ss.map((i) => S.day[i]), ys = ss.map((i) => mv(M, i, m));
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x1 - x0 < 30) { x0 -= 15; x1 += 15; }
  let lo = Math.min(...ys), hi = Math.max(...ys); const pad = (hi - lo) * 0.08 || hi * 0.1 || 1; lo = Math.max(0, lo - pad); hi += pad;
  const ticks = m === 'dur' ? timeTicks(lo, hi, 4) : niceTicks(lo, hi, 4);
  const t0 = ticks[0], t1 = ticks[ticks.length - 1];
  const W = 900, H = 300, L = 56, R = 12, T = 12, B = 26;
  const X = (d) => L + (W - L - R) * (d - x0) / (x1 - x0), Y = (v) => T + (H - T - B) * (1 - (v - t0) / (t1 - t0));
  let s = `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:520px" role="img" aria-label="${t('pc.aria', METRIC[m])}">`;
  ticks.forEach((t) => s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${L - 8}" y="${Y(t) + 4}" text-anchor="end">${fMetric(m, t).replace(' km', '')}</text>`);
  const ya = yearOf(x0), yb = yearOf(x1), stepY = Math.max(1, Math.ceil((yb - ya + 1) / 12));
  for (let y = ya; y <= yb + 1; y += stepY) { const d = Math.round(Date.UTC(y, 0, 1) / DAY); if (d < x0 || d > x1) continue; s += `<line class="axis" x1="${X(d)}" x2="${X(d)}" y1="${T}" y2="${H - B}" stroke-dasharray="2 3"/><text x="${X(d) + 3}" y="${H - 8}">${y}</text>`; }
  if (yb === ya) s += `<text x="${L}" y="${H - 8}">${ya}</text>`;
  // laufender Bestwert
  let best = null, path = '', recs = [];
  ss.forEach((i, k) => { const v = ys[k]; if (best === null || (lower ? v < best : v > best)) { if (best !== null) path += ` H${X(xs[k]).toFixed(1)}`; best = v; path += (path ? ' V' : 'M' + X(xs[k]).toFixed(1) + ' ') + Y(v).toFixed(1); recs.push(k); } });
  path += ` H${X(x1).toFixed(1)}`;
  s += `<path d="${path}" fill="none" style="stroke:var(--pb)" stroke-width="2" opacity=".8"/>`;
  const recSet = new Set(recs);
  ss.forEach((i, k) => { if (!recSet.has(k)) s += `<circle cx="${X(xs[k]).toFixed(1)}" cy="${Y(ys[k]).toFixed(1)}" r="3.2" style="fill:var(--accent)" opacity=".55"><title>${fDate(xs[k])}: ${fMetric(m, ys[k])}</title></circle>`; });
  recs.forEach((k) => s += `<circle cx="${X(xs[k]).toFixed(1)}" cy="${Y(ys[k]).toFixed(1)}" r="5" style="fill:var(--pb);stroke:var(--surface)" stroke-width="1.5"><title>${t('pc.newBest', fDate(xs[k]))}: ${fMetric(m, ys[k])}</title></circle>`);
  s += '</svg></div>';
  s += `<div class="note">${t('pc.note', recs.length, lower)}</div>`;
  return s;
}
function splitsChart(wi) {
  const S = M.s, w = M.w[wi], nR = w.r.length;
  if (nR < 2) return '';
  const ss = D.wSess[wi].filter((i) => S.rt[i] && S.rt[i].length === nR && S.dur[i] > 0);
  if (ss.length < 1) return '';
  const best = ss.reduce((a, b) => S.dur[b] < S.dur[a] ? b : a);
  const last = ss[ss.length - 1];
  const avg = new Array(nR).fill(0); ss.forEach((i) => S.rt[i].forEach((t, k) => avg[k] += t / ss.length));
  const series = [[t('sp.best', fDate(S.day[best])), S.rt[best], 'var(--pb)'], [t('sp.last', fDate(S.day[last])), S.rt[last], 'var(--accent)'], [t('sp.avg', ss.length), avg, 'var(--muted)']];
  if (best === last) series.splice(1, 1);
  const max = Math.max(...series.flatMap((x) => x[1]));
  let h = `<div class="legend">${series.map((x) => `<span><span class="sw" style="background:${x[2]}"></span>${x[0]}</span>`).join('')}</div><div style="display:grid;gap:10px">`;
  for (let k = 0; k < nR; k++) {
    h += `<div style="display:grid;grid-template-columns:70px minmax(0,1fr);gap:8px;align-items:center"><span class="note">${t('d.round', k + 1)}</span><div style="display:grid;gap:3px">${series.map((x) => `<div style="display:flex;align-items:center;gap:8px"><span style="height:9px;border-radius:2px;background:${x[2]};width:${(x[1][k] / max * 80).toFixed(1)}%"></span><span class="num" style="font-size:14px">${fTime(x[1][k])}</span></div>`).join('')}</div></div>`;
  }
  return h + '</div>';
}


/* ---------- Übungen ---------- */
const XS = { q: '', sort: 'reps', limit: 150 };
function exInfo(m) {
  // Workouts mit dieser Übung (aus dem Aufbau), Jahre
  const inW = m.ex.map(() => []);
  m.w.forEach((w, wi) => { if (!w.r) return; const per = new Map(); w.r.forEach((r) => r.forEach((e) => { const p = per.get(e[0]) || [0, 0]; p[0] += e[1] || 0; p[1] += e[4] || 0; per.set(e[0], p); })); per.forEach((p, ei) => inW[ei].push([wi, p[0], p[1]])); });
  let minY = 9999;
  m.exY.forEach((o) => Object.keys(o || {}).forEach((y) => { if (+y < minY) minY = +y; }));
  return { inW, minY };
}
function exercisesView() {
  return `<section class="sec"><div class="dhead"><h1>${t('x.h1')}</h1><div class="note">${t('x.sub', D.ex.minY)}</div></div>
    <div class="tools"><input type="search" id="xq" placeholder="${t('x.search')}" value="${esc(XS.q)}" aria-label="${t('x.search')}">
      <select id="xsort" aria-label="${t('sort.aria')}"><option value="reps">${t('xsort.reps')}</option><option value="time">${t('xsort.time')}</option><option value="count">${t('sort.count')}</option><option value="name">${t('sort.name')}</option></select></div>
    <div class="note" id="xcount"></div><div class="list" id="xlist"></div><div id="xmore"></div></section>`;
}
function renderExList() {
  const q = XS.q.trim().toLowerCase(), T = M.exTot;
  let idx = M.ex.map((_, i) => i).filter((i) => M.ex[i] !== 'Pause' && T[i][2] > 0 && (!q || M.ex[i].toLowerCase().includes(q)));
  if (XS.sort === 'reps') idx.sort((a, b) => T[b][0] - T[a][0] || T[b][1] - T[a][1]);
  else if (XS.sort === 'time') idx.sort((a, b) => T[b][1] - T[a][1]);
  else if (XS.sort === 'count') idx.sort((a, b) => T[b][2] - T[a][2]);
  else idx.sort((a, b) => M.ex[a].localeCompare(M.ex[b], LANG));
  $('xcount').textContent = t('x.count', nf.format(idx.length));
  $('xlist').innerHTML = idx.slice(0, XS.limit).map((ei) => {
    const tt = T[ei], ys = Object.keys(M.exY[ei] || {}).map(Number);
    const main = tt[0] ? `<b>${nf.format(tt[0])}</b><div class="meta">${t('x.reps')}</div>` : `<b>${fHours(tt[1])}</b><div class="meta">${t('x.time')}</div>`;
    return `<a class="row" href="#exercise-${ei}"><span class="dot" style="background:var(--accent)"></span><span><span class="nm">${esc(M.ex[ei])}</span><div class="meta">${t('x.meta', nf.format(tt[2]), D.ex.inW[ei].length)}${ys.length ? ' · ' + Math.min(...ys) + (Math.max(...ys) !== Math.min(...ys) ? '–' + Math.max(...ys) : '') : ''}</div></span><span class="rt">${main}</span></a>`;
  }).join('') || `<div class="empty">${t('x.empty')}</div>`;
  $('xmore').innerHTML = idx.length > XS.limit ? `<button type="button" class="btn" id="btnXMore">${t('more', nf.format(Math.min(150, idx.length - XS.limit)))}</button>` : '';
}
const fHours = (s) => s >= 36000 ? nf.format(Math.round(s / 3600)) + ' h' : s >= 3600 ? nf1.format(s / 3600) + ' h' : Math.round(s / 60) + ' min';
function exerciseDetail(ei) {
  const name = M.ex[ei];
  if (name === undefined) return `<div class="empty">${t('x.missing')} <a href="#exercises">${t('toList')}</a></div>`;
  const tt = M.exTot[ei], yo = M.exY[ei] || {};
  const years = Object.keys(yo).map(Number).sort((a, b) => a - b);
  const useReps = tt[0] > 0;
  const val = (y) => (yo[y] ? (useReps ? yo[y][0] : yo[y][1] / 60) : 0);
  const topY = years.reduce((a, y) => (a === null || val(y) > val(a) ? y : a), null);
  let html = `<section class="sec"><a class="back" href="#exercises">${t('x.back')}</a><div class="dhead"><h1>${esc(name)}</h1>
    <div class="note">${years.length ? t('x.range', years[0], years[years.length - 1]) : t('x.noRounds')}</div></div>
    <div class="stats">
      ${tt[0] ? stat(t('x.reps'), nf.format(tt[0]), t('x.total')) : ''}
      ${stat(t('x.time'), unit(fHours(tt[1])), t('x.timeSub'))}
      ${stat(t('x.occ'), nf.format(tt[2]) + '×', t('x.inW', D.ex.inW[ei].length))}
      ${topY ? stat(t('x.topY'), String(topY), useReps ? t('d.totalReps', nf.format(yo[topY][0])) : fHours(yo[topY][1])) : ''}
    </div></section>`;
  if (years.length) {
    const y0 = years[0], y1 = years[years.length - 1], rows = [];
    for (let y = y0; y <= y1; y++) rows.push([y, val(y)]);
    html += `<section class="panel sec"><h2>${t('x.perYear', useReps)}</h2>${simpleBars(rows, useReps ? (v) => nf.format(Math.round(v)) : (v) => nf.format(Math.round(v)) + ' min')}</section>`;
  }
  html += weightSection(ei);
  html += exerciseTech(ei);
  const ws = D.ex.inW[ei].slice().sort((a, b) => D.wInfo[b[0]].count - D.wInfo[a[0]].count);
  if (ws.length) html += `<section class="panel sec"><div class="sechead"><h2>${t('x.in')}</h2><span class="note">${t('x.inSub', ws.length)}</span></div><div class="list">${ws.slice(0, 40).map(([wi, reps, secs]) => { const w = M.w[wi];
      return `<a class="row" href="#workout-${wi}"><span class="dot c-${w.c}"></span><span><span class="nm">${esc(w.n)}</span><div class="meta">${t('x.wmeta', nf.format(D.wInfo[wi].count), fDate(D.wInfo[wi].last))}</div></span><span class="rt">${reps ? '<b>' + nf.format(reps) + `</b><div class="meta">${t('x.perW')}</div>` : secs ? '<b>' + fTime(secs) + `</b><div class="meta">${t('x.perW2')}</div>` : ''}</span></a>`; }).join('')}</div>${ws.length > 40 ? `<div class="note">${t('x.andMore', ws.length - 40)}</div>` : ''}</section>`;
  return html;
}
function simpleBars(rows, fmt) {
  const max = Math.max(...rows.map((r) => r[1]), 1), ticks = niceTicks(0, max, 4), tmax = ticks[ticks.length - 1];
  const W = 900, H = 220, L = 56, B = 22, T = 10, bw = (W - L) / rows.length;
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${t('bars.aria')}">`;
  ticks.forEach((t) => { const y = T + (H - B - T) * (1 - t / tmax); s += `<line class="axis" x1="${L}" x2="${W}" y1="${y}" y2="${y}"/><text x="${L - 8}" y="${y + 4}" text-anchor="end">${fmt(t)}</text>`; });
  rows.forEach(([lab, v], i) => { const h = (H - B - T) * v / tmax, x = L + i * bw + bw * 0.18;
    s += `<rect x="${x}" y="${H - B - h}" width="${bw * 0.64}" height="${h}" rx="2" style="fill:var(--accent)"><title>${lab}: ${fmt(v)}</title></rect><text x="${x + bw * 0.32}" y="${H - 6}" text-anchor="middle">${rows.length > 10 ? String(lab).slice(2) : lab}</text>`; });
  return s + '</svg>';
}

/* ---------- Verlauf ---------- */
const TL = { range: 'all', layers: { body: true, meals: true, dist: true }, open: { body: true, meals: true } };
try { const o = JSON.parse(localStorage.getItem('ta-tl-open') || 'null'); if (o) Object.assign(TL.open, o); } catch (e) {}
const foldHead = (key, title, extra) => `<details class="panel fold" data-fold="${key}"${TL.open[key] ? ' open' : ''}><summary><span class="chev" aria-hidden="true"></span><h2>${title}</h2>${extra}</summary><div class="foldbody">`;
function timelineView() {
  const S = M.s, last = D.days[D.days.length - 1];
  const mk = (day) => { const d = dDate(day); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
  const mEnd = mk(last);
  const mStart = TL.range === '12' ? mEnd - 11 : TL.range === '60' ? mEnd - 59 : mk(D.days[0]);
  const n = mEnd - mStart + 1;
  const hours = Array.from({ length: n }, () => ({ kraft: 0, mob: 0, lauf: 0, rad: 0 }));
  const km = Array.from({ length: n }, () => ({ lauf: 0, rad: 0 }));
  for (let i = 0; i < S.w.length; i++) { const k = mk(S.day[i]) - mStart; if (k < 0 || k >= n) continue; const c = M.w[S.w[i]].c; hours[k][c] += S.dur[i] / 3600; if (c === 'lauf' || c === 'rad') km[k][c] += S.dist[i] / 1000; }
  const mealRows = Array.from({ length: n }, (_, k) => { const a = (M.meals || {})[mStart + k]; return { coach: a ? a[0] : 0, frei: a ? a[1] : 0 }; });
  const body = (M.body || []).filter((b) => mk(b[0]) >= mStart && mk(b[0]) <= mEnd);
  const mLabel = (k) => MON[(mStart + k) % 12] + ' ' + Math.floor((mStart + k) / 12);
  const geo = { n, mStart, W: 900, L: 56, R: 12 };
  const allBody = M.body || [], mealKeys = Object.keys(M.meals || {}).map(Number);
  let html = `<section class="sec"><div class="dhead"><h1>${t('nav.timeline')}</h1><div class="note">${t('tl.sub')}</div></div>
    <div class="tools"><div class="seg" role="group" aria-label="${t('tl.range')}">${[['all', t('tl.all')], ['60', t('tl.5y')], ['12', t('tl.12m')]].map(([k, l]) => `<button type="button" data-range="${k}" aria-pressed="${TL.range === k}">${l}</button>`).join('')}</div>
      ${[['body', t('tl.weight')], ['meals', t('tl.nutrition')], ['dist', t('tl.km')]].map(([k, l]) => `<button type="button" class="chip" data-layer="${k}" aria-pressed="${TL.layers[k]}">${l}</button>`).join('')}</div></section>`;
  html += `<section class="panel sec"><div class="sechead"><h2>${t('tl.hours')}</h2><div class="legend">${CATS.map((c) => `<span><span class="sw c-${c}"></span>${CAT[c]}</span>`).join('')}</div></div>
    ${monthBars(geo, hours.map((h) => CATS.map((c) => [c, h[c]])), 200, (v) => nf1.format(v) + ' h', mLabel, true)}</section>`;
  if (TL.layers.body) {
    html += foldHead('body', t('tl.body'), `<span class="note">${allBody.length ? t('tl.bodyNote', allBody.length, fDate(allBody[0][0]), fDate(allBody[allBody.length - 1][0])) : t('tl.noBody')}</span>`) +
      `${body.length ? weightLine(geo, body, mk) : `<div class="empty">${t('tl.noBodyRange')}</div>`}</div></details>`;
  }
  if (TL.layers.meals) {
    html += foldHead('meals', t('tl.meals'), `<div class="legend"><span><span class="sw" style="background:var(--mob)"></span>${t('tl.coach')}</span><span><span class="sw" style="background:var(--lauf)"></span>${t('tl.free')}</span></div>`) + `
      ${mealRows.some((r) => r.coach || r.frei) ? monthBars(geo, mealRows.map((r) => [['mob', r.coach], ['lauf', r.frei]]), 140, (v) => nf.format(Math.round(v)), mLabel, false) : `<div class="empty">${mealKeys.length ? t('tl.noMealsRange') : t('tl.noMeals')}</div>`}</div></details>`;
  }
  if (TL.layers.dist) {
    html += `<section class="panel sec"><div class="sechead"><h2>${t('tl.kmTitle')}</h2><div class="legend"><span><span class="sw c-lauf"></span>${CAT.lauf}</span><span><span class="sw c-rad"></span>${CAT.rad}</span></div></div>
      ${monthBars(geo, km.map((k) => [['lauf', k.lauf], ['rad', k.rad]]), 140, (v) => nf.format(Math.round(v)) + ' km', mLabel, false)}</section>`;
  }
  return html;
}
function monthBars(geo, stacks, H, fmt, mLabel, withAxisYears) {
  const { n, mStart, W, L, R } = geo, T = 8, B = 22;
  const tot = stacks.map((s) => s.reduce((a, x) => a + x[1], 0));
  const max = Math.max(...tot, 0.0001), ticks = niceTicks(0, max, 3), tmax = ticks[ticks.length - 1];
  const bw = (W - L - R) / n;
  let s = `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:520px" role="img" aria-label="${t('mb.aria')}">`;
  ticks.forEach((t) => { const y = T + (H - B - T) * (1 - t / tmax); s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text x="${L - 8}" y="${y + 4}" text-anchor="end">${fmt(t)}</text>`; });
  s += monthAxis(geo, H, B);
  stacks.forEach((st, k) => {
    let acc = 0; const x = L + k * bw + (bw > 4 ? bw * 0.12 : 0), w = bw > 4 ? bw * 0.76 : Math.max(bw - 0.4, 0.6);
    st.forEach(([c, v]) => { if (!v) return; const y = T + (H - B - T) * (1 - (acc + v) / tmax), h = (H - B - T) * v / tmax; acc += v;
      s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" style="fill:var(--${c})"><title>${mLabel(k)}: ${fmt(v)}</title></rect>`; });
    if (tot[k]) s += `<rect x="${(L + k * bw).toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${H - B - T}" fill="transparent"><title>${mLabel(k)}: ${fmt(tot[k])}</title></rect>`;
  });
  return s + '</svg></div>';
}
function monthAxis(geo, H, B) {
  const { n, mStart, W, L, R } = geo, bw = (W - L - R) / n;
  let s = '';
  if (n <= 24) { for (let k = 0; k < n; k++) if (n <= 12 || k % 2 === 0) s += `<text x="${L + (k + 0.5) * bw}" y="${H - 6}" text-anchor="middle">${MON[(mStart + k) % 12]}${(mStart + k) % 12 === 0 ? ' ' + String(Math.floor((mStart + k) / 12)).slice(2) : ''}</text>`; }
  else { const years = Math.ceil(n / 12), step = years > 14 ? 2 : 1;
    for (let k = 0; k < n; k++) if ((mStart + k) % 12 === 0) { const y = Math.floor((mStart + k) / 12); s += `<line class="axis" x1="${L + k * bw}" x2="${L + k * bw}" y1="4" y2="${H - B}" stroke-dasharray="2 3"/>`; if (y % step === 0) s += `<text x="${L + k * bw + 3}" y="${H - 6}">${y}</text>`; } }
  return s;
}
function weightLine(geo, body, mk) {
  const { n, mStart, W, L, R } = geo, H = 160, T = 10, B = 22, bw = (W - L - R) / n;
  const X = (day) => { const d = dDate(day); const frac = (d.getUTCDate() - 1) / 31; return L + (mk(day) - mStart + frac) * bw; };
  const ws = body.map((b) => b[1]); let lo = Math.min(...ws) - 1, hi = Math.max(...ws) + 1;
  const ticks = niceTicks(lo, hi, 3); lo = ticks[0]; hi = ticks[ticks.length - 1];
  const Y = (v) => T + (H - B - T) * (1 - (v - lo) / (hi - lo));
  let s = `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:520px" role="img" aria-label="${t('tl.body')}">`;
  ticks.forEach((t) => s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${L - 8}" y="${Y(t) + 4}" text-anchor="end">${nf.format(t)} kg</text>`);
  s += monthAxis(geo, H, B);
  s += `<path d="${body.map((b, i) => (i ? 'L' : 'M') + X(b[0]).toFixed(1) + ' ' + Y(b[1]).toFixed(1)).join(' ')}" fill="none" style="stroke:var(--accent)" stroke-width="1.5" opacity=".6"/>`;
  body.forEach((b) => s += `<circle cx="${X(b[0]).toFixed(1)}" cy="${Y(b[1]).toFixed(1)}" r="3" style="fill:var(--accent)"><title>${fDate(b[0])}: ${nf1.format(b[1])} kg</title></circle>`);
  return s + '</svg></div>';
}


/* ---------- Fortschritt ---------- */
const PG = { showAllUp: false, showAllDown: false };
const median = (a) => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
function progressData() {
  if (D.prog) return D.prog;
  const S = M.s, rows = [];
  M.w.forEach((w, wi) => {
    if (w.c === 'mob' || w.t === 'free') return;
    const m = D.wInfo[wi].metric; if (m !== 'dur' && m !== 'reps') return;
    const ss = D.wSess[wi].filter((i) => mv(M, i, m) > 0); const n = ss.length; if (n < 10) return;
    const v = ss.map((i) => mv(M, i, m)), lower = m === 'dur', k = Math.min(5, Math.floor(n / 3));
    const first = median(v.slice(0, k)), last = median(v.slice(n - k)), best = lower ? Math.min(...v) : Math.max(...v);
    const change = lower ? (first - last) / first : (last - first) / first;
    const gap = lower ? (last - best) / best : (best - last) / best;
    rows.push({ wi, m, n, k, first, last, best, change, gap, v, lastDay: S.day[ss[n - 1]] });
  });
  const up = rows.filter((r) => r.change > 0.02).sort((a, b) => b.change - a.change);
  const down = rows.filter((r) => r.change < -0.02).sort((a, b) => a.change - b.change);
  let pbLast = null, pbs = 0; const pbYear = {};
  for (let i = 0; i < S.w.length; i++) if (S.f[i] & 2) { pbs++; pbLast = S.day[i]; const y = yearOf(S.day[i]); pbYear[y] = (pbYear[y] || 0) + 1; }
  return (D.prog = { rows, up, down, pbs, pbLast, pbYear });
}
const TECH = ['bad', 'medium', 'good', 'vgood'];
const techColor = { vgood: 'var(--mob)', good: 'color-mix(in srgb,var(--mob) 45%,var(--surface))', medium: 'var(--lauf)', bad: 'var(--pb)' };
function techByYear(filter) {
  const S = M.s, by = {};
  for (let i = 0; i < S.w.length; i++) { const v = S.tf[i]; if (!v || !filter(i)) continue; const y = yearOf(S.day[i]); (by[y] = by[y] || [0, 0, 0, 0])[v - 1]++; }
  return Object.keys(by).map(Number).sort((a, b) => a - b).map((y) => ({ y, c: by[y], n: by[y].reduce((a, b) => a + b, 0) }));
}
const techMin = (rows) => Math.max(20, Math.round(0.1 * Math.max(...rows.map((r) => r.n))));
function techBars(rows) {
  const min = techMin(rows);
  const legend = `<div class="legend">${TECH.slice().reverse().map((k) => `<span><span class="sw" style="background:${techColor[k]}"></span>${t('tech.' + k)}</span>`).join('')}</div>`;
  return legend + `<div class="techbars">${rows.map((r) => `<div class="techrow${r.n < min ? ' thin' : ''}"><span class="ty">${r.y}</span><span class="tbar" title="${r.y}: ${TECH.map((k, j) => t('tech.' + k) + ' ' + r.c[j]).reverse().join(', ')}">${[3, 2, 1, 0].map((j) => r.c[j] ? `<span style="width:${(r.c[j] / r.n * 100).toFixed(2)}%;background:${techColor[TECH[j]]}"></span>` : '').join('')}</span><span class="tn">${t('tech.n', nf.format(r.n))}</span></div>`).join('')}</div>${rows.some((r) => r.n < min) ? `<div class="note">${t('tech.thin', min, rows.filter((r) => r.n >= min).length >= 2)}</div>` : ''}`;
}
function techSummary(rows) {
  const ok = rows.filter((r) => r.n >= techMin(rows)); if (ok.length < 2) return '';
  const a = ok[0], b = ok[ok.length - 1];
  return `<p class="note">${t('tech.trend', a.y, pctF(a.c[3] / a.n), b.y, pctF(b.c[3] / b.n))}</p>`;
}
function progRow(r) {
  const w = M.w[r.wi], fm = (x) => fMetric(r.m, Math.round(x));
  const lab = r.m === 'dur' ? (r.change > 0 ? t('pg.faster') : t('pg.slower')) : (r.change > 0 ? t('pg.more') : t('pg.fewer'));
  return `<a class="row prow" href="#workout-${r.wi}"><span class="dot c-${w.c}"></span><span><span class="nm">${esc(w.n)}</span><div class="meta">${t('pg.meta', r.n, fm(r.best))}</div></span><span class="rt"><span class="ftl">${fm(r.first)} <span class="arr">→</span> <b>${fm(r.last)}</b></span><div class="chg ${r.change > 0 ? 'up' : 'down'}">${pctF(Math.abs(r.change))} ${lab}</div></span></a>`;
}
function progressView() {
  const P = progressData(), S = M.s;
  const today = todayDay();
  const pb12 = (() => { let c = 0; for (let i = 0; i < S.w.length; i++) if ((S.f[i] & 2) && today - S.day[i] <= 365) c++; return c; })();
  const top = P.up[0];
  let html = `<section class="sec"><div class="dhead"><h1>${t('pg.h1')}</h1><div class="note">${t('pg.sub')}</div></div>
    <div class="stats">
      ${stat(t('pg.improved'), t('pg.ofN', nf.format(P.up.length), nf.format(P.rows.length)), t('pg.improvedSub'))}
      ${top ? stat(t('pg.biggest'), pctF(top.change), esc(M.w[top.wi].n)) : ''}
      ${P.pbLast !== null ? stat(t('pg.lastPb'), fDate(P.pbLast), t('pg.daysAgo', nf.format(today - P.pbLast))) : ''}
      ${stat(t('pg.pbs'), nf.format(P.pbs), t('pg.pbs12', nf.format(pb12)))}
    </div></section>`;
  if (P.rows.length) {
    const upList = PG.showAllUp ? P.up : P.up.slice(0, 5);
    html += `<section class="panel sec"><div class="sechead"><h2>${t('pg.upH')}</h2></div>
      <div class="note">${t('pg.upSub', P.up.length)}</div>
      <div class="list">${upList.map(progRow).join('') || `<div class="empty">${t('pg.none')}</div>`}</div>
      ${P.up.length > 5 ? `<div><button type="button" class="btn" data-pg="up">${PG.showAllUp ? t('pg.less') : t('pg.all', P.up.length)}</button></div>` : ''}</section>`;
    if (P.down.length) html += `<details class="panel fold" data-pgdown${PG.showAllDown ? ' open' : ''}><summary><span class="chev" aria-hidden="true"></span><h2>${t('pg.downH')}</h2><span class="note">${t('pg.count', P.down.length)}</span></summary><div class="foldbody">
      <div class="note">${t('pg.downNote')}</div>
      <div class="list">${P.down.map(progRow).join('')}</div></div></details>`;
    html += `<details class="howto"><summary>${t('pg.howH')}</summary><p>${t('pg.method')}</p></details>`;
  } else html += `<div class="empty">${t('pg.noRows')}</div>`;
  html += weightOverview();
  const years = Object.keys(P.pbYear).map(Number);
  if (years.length) {
    const y0 = Math.min(...years), y1 = yearOf(D.days[D.days.length - 1]), rows = [];
    for (let y = y0; y <= y1; y++) rows.push([y, P.pbYear[y] || 0]);
    html += `<section class="panel sec"><h2>${t('pg.pbYear')}</h2>${simpleBars(rows, (v) => nf.format(Math.round(v)))}</section>`;
  }
  html += `<section class="panel sec"><h2>${t('tech.h')}</h2>`;
  if (!S.tf) html += `<div class="empty">${t('tech.reload')}</div>`;
  else {
    const rows = techByYear(() => true);
    html += rows.length ? techSummary(rows) + techBars(rows) + `<div class="note">${t('tech.noteAll')}</div>` : `<div class="empty">${t('tech.none')}</div>`;
  }
  return html + '</section>';
}
function exerciseTech(ei) {
  const S = M.s; if (!S.tf || !S.x1) return '';
  const rows = techByYear((i) => S.x1[i] === ei);
  const n = rows.reduce((a, r) => a + r.n, 0); if (n < 5) return '';
  return `<section class="panel sec"><div class="sechead"><h2>${t('tech.hEx')}</h2><span class="note">${t('tech.nEx', nf.format(n))}</span></div>${techSummary(rows)}${techBars(rows)}<div class="note">${t('tech.noteEx')}</div></section>`;
}

/* ---------- Gewichte (nur wenn der Export Gewichte enthält) ---------- */
const hasWeights = () => !!(M.exW && Object.keys(M.exW).length);
const fKg = (per, n) => per == null ? null : (n > 1 ? n + ' × ' : '') + nf1.format(per) + ' kg';
function weightDays(ei) {
  // pro Tag: schwerstes Gewicht, Sätze, Wiederholungen
  const by = new Map();
  for (const [day, per, n, reps, raw] of (M.exW || {})[ei] || []) {
    const d = by.get(day) || { day, per: null, n: 1, raw, sets: 0, reps: 0 };
    d.sets++; d.reps += reps;
    if (per != null && (d.per == null || per > d.per)) { d.per = per; d.n = n; d.raw = raw; }
    by.set(day, d);
  }
  return [...by.values()].sort((a, b) => a.day - b.day);
}
function weightChart(days) {
  const pts = days.filter((d) => d.per != null); if (pts.length < 2) return '';
  const W = 900, H = 200, L = 56, R = 12, T = 10, B = 24;
  let x0 = pts[0].day, x1 = pts[pts.length - 1].day; if (x1 - x0 < 30) { x0 -= 15; x1 += 15; }
  const hi = Math.max(...pts.map((d) => d.per)), ticks = niceTicks(0, hi * 1.1, 4), tmax = ticks[ticks.length - 1];
  const X = (d) => L + (W - L - R) * (d - x0) / (x1 - x0), Y = (v) => T + (H - T - B) * (1 - v / tmax);
  let s = `<div class="scroll"><svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:520px" role="img" aria-label="${t('wt.h')}">`;
  ticks.forEach((v) => s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${nf1.format(v)} kg</text>`);
  const ya = yearOf(x0), yb = yearOf(x1);
  for (let y = ya; y <= yb + 1; y++) { const d = Math.round(Date.UTC(y, 0, 1) / DAY); if (d < x0 || d > x1) continue; s += `<line class="axis" x1="${X(d)}" x2="${X(d)}" y1="${T}" y2="${H - B}" stroke-dasharray="2 3"/><text x="${X(d) + 3}" y="${H - 8}">${y}</text>`; }
  if (ya === yb) s += `<text x="${L}" y="${H - 8}">${ya}</text>`;
  s += `<path d="${pts.map((d, i) => (i ? 'L' : 'M') + X(d.day).toFixed(1) + ' ' + Y(d.per).toFixed(1)).join(' ')}" fill="none" style="stroke:var(--accent)" stroke-width="1.5" opacity=".6"/>`;
  pts.forEach((d) => s += `<circle cx="${X(d.day).toFixed(1)}" cy="${Y(d.per).toFixed(1)}" r="4" style="fill:var(--accent)"><title>${fDate(d.day)}: ${fKg(d.per, d.n)}</title></circle>`);
  return s + '</svg></div>';
}
function weightSection(ei) {
  const days = weightDays(ei); if (!days.length) return '';
  const parsed = days.filter((d) => d.per != null);
  const label = (d) => fKg(d.per, d.n) || esc(d.raw);
  let html = `<section class="panel sec"><div class="sechead"><h2>${t('wt.h')}</h2><span class="note">${t('wt.count', days.length)}</span></div>`;
  if (parsed.length) {
    const max = parsed.reduce((a, d) => (d.per > a.per ? d : a)), last = parsed[parsed.length - 1], first = parsed[0];
    html += `<div class="stats">
      ${stat(t('wt.max'), fKg(max.per, max.n), t('d.on', fDate(max.day)))}
      ${stat(t('wt.last'), fKg(last.per, last.n), fDate(last.day))}
      ${parsed.length > 1 ? stat(t('wt.change'), `${nf1.format(first.per)} → ${nf1.format(last.per)} kg`, t('wt.changeSub')) : ''}
    </div>${weightChart(days)}`;
  }
  html += `<div class="scroll"><table><thead><tr><th>${t('th.date')}</th><th class="r">${t('wt.th')}</th><th class="r">${t('wt.sets')}</th><th class="r">${t('th.reps')}</th></tr></thead><tbody>
    ${days.slice(-15).reverse().map((d) => `<tr><td>${fDate(d.day)}</td><td class="r">${label(d)}</td><td class="r">${d.sets}</td><td class="r">${d.reps ? nf.format(d.reps) : '–'}</td></tr>`).join('')}
    </tbody></table></div><div class="note">${t('wt.note')}</div></section>`;
  return html;
}
function weightOverview() {
  if (!hasWeights()) return '';
  const rows = Object.keys(M.exW).map(Number).map((ei) => ({ ei, days: weightDays(ei) })).filter((r) => r.days.length)
    .sort((a, b) => b.days[b.days.length - 1].day - a.days[a.days.length - 1].day);
  const item = (r) => {
    const p = r.days.filter((d) => d.per != null), first = p[0], max = p.length ? p.reduce((a, d) => (d.per > a.per ? d : a)) : null, last = r.days[r.days.length - 1];
    const right = !p.length ? '' : p.length > 1 && first.per !== max.per ? `<span class="ftl">${nf1.format(first.per)} <span class="arr">→</span> <b>${nf1.format(max.per)} kg</b></span><div class="meta">${t('wt.firstMax')}</div>` : `<span class="ftl"><b>${fKg(max.per, max.n)}</b></span>${p.length > 1 ? `<div class="meta">${t('wt.heaviest')}</div>` : ''}`;
    return `<a class="row prow" href="#exercise-${r.ei}"><span class="dot" style="background:var(--accent)"></span><span><span class="nm">${esc(M.ex[r.ei])}</span><div class="meta">${t('wt.meta', r.days.length, fDate(last.day))}</div></span><span class="rt">${right}</span></a>`;
  };
  return `<details class="panel fold"><summary><span class="chev" aria-hidden="true"></span><h2>${t('wt.ovH')}</h2><span class="note">${t('wt.ovN', rows.length)}</span></summary><div class="foldbody"><div class="list">${rows.map(item).join('')}</div></div></details>`;
}

/* ---------- Routing ---------- */
const NAV = ['overview', 'progress', 'workouts', 'exercises', 'timeline'];
function route() {
  const h = (location.hash || '#overview').slice(1);
  const view = $('view');
  hideTip();
  let tab = 'overview';
  if (!M) { NAV.forEach((n) => $('nav-' + n).removeAttribute('aria-current')); view.innerHTML = welcome(); return; }
  if (h.startsWith('workout-')) { tab = 'workouts'; view.innerHTML = detailView(+h.slice(8)); }
  else if (h === 'workouts') { tab = 'workouts'; view.innerHTML = workoutsView(); $('sort').value = LS.sort; renderList(); }
  else if (h.startsWith('exercise-')) { tab = 'exercises'; view.innerHTML = exerciseDetail(+h.slice(9)); }
  else if (h === 'exercises') { tab = 'exercises'; view.innerHTML = exercisesView(); $('xsort').value = XS.sort; renderExList(); }
  else if (h === 'timeline') { tab = 'timeline'; view.innerHTML = timelineView(); }
  else if (h === 'progress') { tab = 'progress'; view.innerHTML = progressView(); }
  else view.innerHTML = overview();
  NAV.forEach((n) => n === tab ? $('nav-' + n).setAttribute('aria-current', 'page') : $('nav-' + n).removeAttribute('aria-current'));
  window.scrollTo(0, 0);
}
function welcome() {
  return `<section class="sec welcome"><h1>${t('wel.h1')}</h1>
    <p class="unoff">${t('wel.unoff')}</p>
    <p>${t('wel.p')}</p>
    <ol class="steps"><li>${t('wel.s1')}</li><li>${t('wel.s2')}</li><li>${t('wel.s3')}</li></ol></section>`;
}
addEventListener('hashchange', route);
$('view').addEventListener('toggle', (e) => { if (e.target.hasAttribute && e.target.hasAttribute('data-pgdown')) { PG.showAllDown = e.target.open; return; } }, true);
$('view').addEventListener('toggle', (e) => { const d = e.target; if (!d.dataset || !d.dataset.fold) return; TL.open[d.dataset.fold] = d.open; try { localStorage.setItem('ta-tl-open', JSON.stringify(TL.open)); } catch (err) {} }, true);

$('view').addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.ym) { yearMode = t.dataset.ym; $('yearChart').innerHTML = yearChart(); t.parentNode.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === t)); }
  else if (t.dataset.metric) { detailMetric = t.dataset.metric; const y = scrollY; $('view').innerHTML = detailView(+location.hash.slice(9)); scrollTo(0, y); }
  else if (t.dataset.type) { LS.types[t.dataset.type] = !LS.types[t.dataset.type]; t.setAttribute('aria-pressed', LS.types[t.dataset.type]); LS.limit = 150; renderList(); }
  else if (t.dataset.cat !== undefined) { LS.cat = t.dataset.cat; document.querySelectorAll('#catChips .chip').forEach((b) => b.setAttribute('aria-pressed', b === t)); LS.limit = 150; renderList(); }
  else if (t.id === 'btnMore') { LS.limit += 150; renderList(); }
  else if (t.id === 'btnXMore') { XS.limit += 150; renderExList(); }
  else if (t.dataset.pg) { if (t.dataset.pg === 'up') PG.showAllUp = !PG.showAllUp; else PG.showAllDown = !PG.showAllDown; const y = scrollY; $('view').innerHTML = progressView(); scrollTo(0, y); }
  else if (t.dataset.range) { TL.range = t.dataset.range; const y = scrollY; $('view').innerHTML = timelineView(); scrollTo(0, y); }
  else if (t.dataset.layer) { TL.layers[t.dataset.layer] = !TL.layers[t.dataset.layer]; const y = scrollY; $('view').innerHTML = timelineView(); scrollTo(0, y); }
});
$('view').addEventListener('input', (e) => {
  if (e.target.id === 'q') { LS.q = e.target.value; LS.limit = 150; renderList(); }
  if (e.target.id === 'xq') { XS.q = e.target.value; XS.limit = 150; renderExList(); }
});
$('view').addEventListener('change', (e) => {
  if (e.target.id === 'sort') { LS.sort = e.target.value; renderList(); }
  if (e.target.id === 'xsort') { XS.sort = e.target.value; renderExList(); }
});
$('view').addEventListener('mouseleave', hideTip);
addEventListener('scroll', hideTip, { passive: true });

/* ---------- Laden, Sichern ---------- */
const MODEL_V = 4, MODEL_OK = [2, 3, 4];
const PREVIEW = !!window.TA_PREVIEW;
function setModel(m, src) {
  M = m; source = src; D = derive(m); D.ex = exInfo(m);
  updateSrcLabel();
  $('btnReset').hidden = src === 'seed';
  $('btnBackup').hidden = PREVIEW;
  route();
}
function updateSrcLabel() {
  if (!M) { $('srcLabel').textContent = t('src.none'); return; }
  $('srcLabel').textContent = source === 'seed' ? t('src.seed', fDate(Math.round(Date.UTC(2026, 10, 1) / DAY))) : t('src.data', fDate(Math.round(Date.parse(M.created) / DAY)));
}
const status = (msg, err) => { $('status').textContent = msg; $('status').classList.toggle('err', !!err); };
function toggleUpload(show) { const s = $('uploadSec'); s.hidden = show === undefined ? !s.hidden : !show; $('btnData').setAttribute('aria-expanded', !s.hidden); }
async function handleFile(f) {
  if (!f) return;
  try {
    status(t('stat.reading', f.name));
    let text;
    if (/\.zip$/i.test(f.name) || /zip/.test(f.type)) {
      text = await readZipEntry(f, /(^|\/)data\.json$/i);
      if (text === null) throw Object.assign(new Error(t('err.noData')), { known: true });
    } else text = await f.text();
    status(t('stat.analyzing'));
    await new Promise((r) => setTimeout(r, 20));
    let raw; try { raw = JSON.parse(text); } catch (e) { throw Object.assign(new Error(t('err.json')), { known: true }); }
    let m, kind;
    if (raw && raw.app === 'trainingsarchiv' && raw.model) {
      if (!MODEL_OK.includes(raw.model.v)) throw Object.assign(new Error(t('err.backupVersion')), { known: true });
      m = raw.model; kind = t('kind.backup');
    } else { m = processExport(raw); kind = t('kind.export'); }
    const saved = await DB.set('model', m);
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
    setModel(m, 'upload');
    setTimeout(() => toggleUpload(false), 2500);
    status(t('stat.loaded', kind, nf.format(m.s.w.length), saved));
  } catch (e) {
    let msg = e && e.message || String(e);
    if (e && e.zip && e.code) msg = t('zip.' + e.code, e.arg) + ' ' + t('zip.suffix');
    else if (e && e.code === 'notrainings') msg = t('err.notrainings');
    else if (e && !e.known && (e.name === 'TypeError' || e.name === 'NotReadableError')) msg = t('err.read', msg);
    status(msg, true);
  }
}
$('file').addEventListener('change', (e) => { handleFile(e.target.files[0]); e.target.value = ''; });
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handleFile(e.dataTransfer.files[0]); });
$('btnData').addEventListener('click', () => toggleUpload());
$('btnReset').addEventListener('click', async () => {
  if ($('btnReset').dataset.armed !== '1') { $('btnReset').dataset.armed = '1'; $('btnReset').textContent = t('btn.resetConfirm'); setTimeout(() => { $('btnReset').dataset.armed = ''; $('btnReset').textContent = t('btn.reset'); }, 4000); return; }
  await DB.del('model'); $('btnReset').dataset.armed = ''; $('btnReset').textContent = t('btn.reset');
  const s = seed();
  if (s) { setModel(s, 'seed'); status(t('stat.removedSeed')); }
  else { M = null; D = null; updateSrcLabel(); $('btnReset').hidden = true; $('btnBackup').hidden = true; status(t('stat.removed')); route(); }
});
$('btnBackup').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'trainingsarchiv', saved: new Date().toISOString(), model: M })], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = t('backup.file') + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  status(t('stat.backup', nf1.format(blob.size / 1e6)));
});
function seed() { const el = $('seed'); if (!el) return null; try { return JSON.parse(el.textContent); } catch (e) { return null; } }

/* ---------- Sprachumschalter ---------- */
$('btnLang').addEventListener('click', () => {
  LANG = LANG === 'de' ? 'en' : 'de';
  try { localStorage.setItem('ta-lang', LANG); } catch (e) {}
  applyLang(); updateSrcLabel(); status('');
  const y = scrollY; route(); scrollTo(0, y);
  if ($('btnReset').dataset.armed !== '1') $('btnReset').textContent = t('btn.reset');
});

/* ---------- Installation ---------- */
let installEvt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('btnInstall').hidden = false; });
$('btnInstall').addEventListener('click', async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch (e) {} installEvt = null; $('btnInstall').hidden = true; });
addEventListener('appinstalled', () => { $('btnInstall').hidden = true; });
(function iosHint() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let dismissed = false; try { dismissed = localStorage.getItem('ta-ios-hint') === '1'; } catch (e) {}
  if (PREVIEW || standalone || !ios || dismissed) return;
  $('iosHint').hidden = false;
  $('btnIosHint').addEventListener('click', () => { $('iosHint').hidden = true; try { localStorage.setItem('ta-ios-hint', '1'); } catch (e) {} });
})();
if (!PREVIEW && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

(async function init() {
  const stored = await DB.get('model');
  if (stored && MODEL_OK.includes(stored.v)) { setModel(stored, 'upload'); return; }
  const s = seed();
  if (s) setModel(s, 'seed');
  else { updateSrcLabel(); toggleUpload(true); route(); }
  if (stored) status(t('stat.oldModel'), true);
})();
})();
