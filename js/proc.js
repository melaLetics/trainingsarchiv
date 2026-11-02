/* Freeletics-Export -> kompaktes Modell. Läuft im Browser und in Node. */
(function (root) {
  const DAY = 86400000;
  const fmtCache = {};
  function fmt(tz) {
    if (!fmtCache[tz]) {
      try {
        fmtCache[tz] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
      } catch (e) { fmtCache[tz] = fmt('Europe/Berlin'); }
    }
    return fmtCache[tz];
  }
  function localParts(iso, tz) {
    const d = new Date(iso.replace(' UTC', 'Z').replace(' ', 'T'));
    const p = {};
    for (const x of fmt(tz || 'Europe/Berlin').formatToParts(d)) p[x.type] = x.value;
    const day = Math.round(Date.UTC(+p.year, +p.month - 1, +p.day) / DAY);
    return { day, hour: +p.hour % 24 };
  }
  function hms(t) {
    if (!t || typeof t !== 'string') return 0;
    const a = t.split(':').map(Number);
    return a.length === 3 ? a[0] * 3600 + a[1] * 60 + a[2] : 0;
  }
  function category(name) {
    const n = name.toLowerCase();
    if (/cycling|\bride\b|bike|\brad\b|zwift/.test(n)) return 'rad';
    if (/\brun\b|running|lauf|treadmill|walk|sprint/.test(n)) return 'lauf';
    if (/mobility|mobilis|stretch|foam|yoga|regener|cooldown|warm ?up|lymph|^rec \d/.test(n)) return 'mob';
    return 'kraft';
  }
  function mode(arr) {
    const c = new Map(); let best = null, bn = 0;
    for (const v of arr) { const k = c.get(v) + 1 || 1; c.set(v, k); if (k > bn) { bn = k; best = v; } }
    return best;
  }
  function roundsOf(x) {
    return (x.rounds || []).slice().sort((a, b) => (a.round || 0) - (b.round || 0));
  }

  function processExport(raw) {
    const T = (raw.training && raw.training.trainings) || [];
    if (!T.length) throw new Error('In der Datei wurden keine Trainings gefunden.');
    const exIdx = new Map(), exNames = [];
    const ex = (n) => { if (!exIdx.has(n)) { exIdx.set(n, exNames.length); exNames.push(n); } return exIdx.get(n); };

    const byName = new Map();
    T.forEach((x) => { if (!byName.has(x.workout)) byName.set(x.workout, []); byName.get(x.workout).push(x); });

    const workouts = [], wIdx = new Map();
    for (const [name, xs] of byName) {
      const struct = xs.filter((x) => roundsOf(x).some((r) => (r.exercises || []).length));
      const w = { n: name, c: category(name) };
      const reps = xs.map((x) => x.repetitions).filter(Boolean);
      const dist = xs.map((x) => x.distance).filter(Boolean);
      if (name.startsWith('Free ')) w.t = 'free';
      else if (struct.length) {
        const sigOf = (x) => JSON.stringify(roundsOf(x).map((r) => (r.exercises || []).map((e) => [e.exercise, e.repetitions ?? null, e.distance_in_meters ?? null, e.weight ?? null])));
        const counts = new Map();
        struct.forEach((x) => { const s = sigOf(x); counts.set(s, (counts.get(s) || 0) + 1); });
        let best = null, bn = 0;
        for (const [s, n] of counts) if (n > bn) { best = s; bn = n; }
        const inst = struct.filter((x) => sigOf(x) === best);
        const sig = JSON.parse(best);
        w.t = 'structured';
        w.sv = counts.size;
        w.r = sig.map((r, ri) => r.map(([e, rep, dm, wt], ei) => {
          let dur = null;
          if (rep === null && dm === null) {
            const secs = inst.map((x) => (((roundsOf(x)[ri] || {}).exercises || [])[ei] || {}).time_in_seconds).filter((v) => v != null);
            if (secs.length) dur = mode(secs);
          }
          return [ex(e), rep, dm, wt, dur];
        }));
        w.tot = w.r.flat().reduce((a, e) => a + (e[1] || 0), 0);
      } else if (dist.length) w.t = 'distance';
      else if (reps.length) { w.t = 'reps'; w.tot = mode(reps); }
      else w.t = 'none';
      wIdx.set(name, workouts.length);
      workouts.push(w);
    }

    const S = { w: [], day: [], hour: [], dur: [], pts: [], reps: [], dist: [], f: [], rt: [] };
    const exTot = exNames.map(() => [0, 0, 0]);
    const sorted = T.slice().sort((a, b) => (a.performed_at < b.performed_at ? -1 : 1));
    for (const x of sorted) {
      const lp = localParts(x.performed_at, x.time_zone);
      const rs = roundsOf(x);
      let dur = hms(x.time);
      if (!dur && rs.length) dur = rs.reduce((a, r) => a + (r.time_in_seconds || 0), 0);
      S.w.push(wIdx.get(x.workout)); S.day.push(lp.day); S.hour.push(lp.hour);
      S.dur.push(dur); S.pts.push(x.points || 0); S.reps.push(x.repetitions || 0); S.dist.push(x.distance || 0);
      S.f.push((x.star ? 1 : 0) | (x.personal_best ? 2 : 0));
      S.rt.push(rs.length > 1 ? rs.map((r) => r.time_in_seconds || 0) : 0);
      for (const r of rs) for (const e of r.exercises || []) {
        const t = exTot[ex(e.exercise)] || (exTot[ex(e.exercise)] = [0, 0, 0]);
        t[0] += e.repetitions || 0; t[1] += e.time_in_seconds || 0; t[2] += 1;
      }
    }
    while (exTot.length < exNames.length) exTot.push([0, 0, 0]);

    // Übungen pro Jahr: exY[ex] = { jahr: [wdh, sekunden, vorkommen] }
    const exY = exNames.map(() => ({}));
    sorted.forEach((x, k) => {
      const y = new Date(S.day[k] * DAY).getUTCFullYear();
      for (const r of roundsOf(x)) for (const e of r.exercises || []) {
        const o = exY[ex(e.exercise)] || (exY[ex(e.exercise)] = {});
        const a = o[y] || (o[y] = [0, 0, 0]);
        a[0] += e.repetitions || 0; a[1] += e.time_in_seconds || 0; a[2] += 1;
      }
    });

    // Körpergewicht (nur Datum und kg)
    const act = (raw.nutrition && raw.nutrition.activities) || {};
    const body = (act.athlete_data || []).filter((a) => a.weight && a.created_at)
      .map((a) => [localParts(a.created_at.replace('T', ' ').replace(/\.\d+Z$|Z$/, ' UTC'), 'Europe/Berlin').day, a.weight_unit === 'lbs' ? Math.round(a.weight * 0.4536 * 10) / 10 : a.weight])
      .sort((a, b) => a[0] - b[0]);

    // Ernährung pro Monat: meals[monat] = [coach, frei, kcal]
    const meals = {};
    const cm = act.cooked_meals || {};
    const addMeal = (m, i) => {
      if (!m.completed_at) return;
      const d = new Date(m.completed_at); const key = d.getUTCFullYear() * 12 + d.getUTCMonth();
      const a = meals[key] || (meals[key] = [0, 0, 0]); a[i] += 1; a[2] += m.calories || 0;
    };
    (cm.coach_buckets || []).forEach((m) => addMeal(m, 0));
    (cm.free_buckets || []).forEach((m) => addMeal(m, 1));

    return { v: 2, created: new Date().toISOString().slice(0, 10), w: workouts, ex: exNames, exTot, exY, body, meals, s: S };
  }

  root.processExport = processExport;
  if (typeof module !== 'undefined') module.exports = { processExport };
})(typeof window !== 'undefined' ? window : globalThis);
