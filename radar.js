/* Classic script: load BEFORE index.html's inline script. Exposes globalThis.OiRadar.
 * Pure functions only: no fetch, no DOM, no timers, no storage, no Date.now() (callers pass `now`).
 *
 * Time model (UTC instants). A scan window of W days is the interval
 *   [startMs, endMs] with endMs = 00:00 UTC today, startMs = endMs - W*DAY.
 * OI at an instant is the day-end OI of the previous UTC day; price at an instant is the
 * close of the previous UTC day. So OI and price always use the SAME two endpoints:
 *   start = close/day-end of d0 (= day before first scan day), end = close/day-end of signalDay.
 * An endpoint that is missing, duplicated, or not an exact aligned completed bar yields null.
 * Nothing is substituted from a neighbouring day or from the live price.
 */
(function () {
  'use strict';
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const RT_ALERT_GAP = 25 * MIN;   /* same symbol: no second alert within 25 min */
  const RT_RETAIN_H = 6;           /* largest selectable radar window */
  const RT_GAP_X = 3;              /* sample gap > 3 poll intervals restarts that symbol's warm-up */
  const SC_TAIL = 15 * MIN;        /* last 5m archive row must be within 15 min of day end */

  const fin = n => typeof n === 'number' && Number.isFinite(n);
  const pos = v => {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const dstr = ms => new Date(ms).toISOString().slice(0, 10);
  const dayMs = s => Date.parse(s + 'T00:00:00Z');
  const day0 = ms => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

  /* ---------------- scan window ---------------- */
  function scWindow(W, now) {
    W = Math.max(1, Math.floor(W));
    const endMs = day0(now), startMs = endMs - W * DAY, days = [];
    for (let i = 0; i < W; i++) days.push(dstr(startMs + i * DAY));
    return {W, startMs, endMs, days, d0: dstr(startMs - DAY), signalDay: dstr(endMs - DAY)};
  }

  /* Close of the daily bar that opens exactly at openMs; must be completed at `now`. */
  function scKlineClose(klines, openMs, now) {
    if (!Array.isArray(klines) || !fin(openMs) || openMs + DAY > now) return null;
    const hit = klines.filter(k => k && k.t === openMs);
    return hit.length === 1 ? pos(hit[0].c) : null;
  }

  function scPriceChange(klines, win, now) {
    const a = scKlineClose(klines, win.startMs - DAY, now);
    const b = scKlineClose(klines, win.endMs - DAY, now);
    return a != null && b != null ? (b / a - 1) * 100 : null;
  }

  /* openInterestHist(1d). A sample's t is treated as the snapshot instant (+offset).
   * Endpoints must be exactly startMs and endMs. Returns null if either is absent/ambiguous. */
  function scOiFromHist(hist, win, offset) {
    if (!Array.isArray(hist)) return null;
    const off = fin(offset) ? offset : 0;
    const smp = hist.map(x => ({t: x.t + off, oiv: pos(x.oiv), oi: pos(x.oi)})).filter(x => fin(x.t) && x.oiv != null)
      .sort((a, b) => a.t - b.t);
    const pick = t => { const h = smp.filter(x => x.t === t); return h.length === 1 ? h[0].oiv : null; };
    const oiS = pick(win.startMs), oiE = pick(win.endMs);
    if (oiS == null || oiE == null) return null;
    return {oiS, oiE, coinS: smp.find(x => x.t === win.startMs).oi,
      coinE: smp.find(x => x.t === win.endMs).oi, seq: smp.filter(x => x.t <= win.endMs)};
  }

  /* 5-minute archive rows ({t, oiv}) → day-end OI per UTC day, as instants (day start + DAY). */
  function scArchiveSeq(rows) {
    const last = new Map();
    for (const r of rows || []) {
      if (!r || !fin(r.t)) continue;
      const k = day0(r.t), p = last.get(k);
      if (!p || r.t > p.t) last.set(k, r);
    }
    const seq = [];
    for (const [k, r] of last) {
      if (r.t >= k + DAY - SC_TAIL && pos(r.oiv) != null) seq.push({t: k + DAY, oiv: pos(r.oiv), oi: pos(r.oi)});
    }
    return seq.sort((a, b) => a.t - b.t);
  }

  function scOiFromArchive(rows, win) {
    const seq = scArchiveSeq(rows);
    const pick = t => { const h = seq.filter(x => x.t === t); return h.length === 1 ? h[0].oiv : null; };
    const oiS = pick(win.startMs), oiE = pick(win.endMs);
    if (oiS == null || oiE == null) return null;
    return {oiS, oiE, coinS:seq.find(x=>x.t===win.startMs).oi, coinE:seq.find(x=>x.t===win.endMs).oi, seq: seq.filter(x => x.t <= win.endMs)};
  }

  /* z of the net OI change over W days vs. the distribution of daily changes. */
  function scZ(seq, oiS, oiE, W) {
    if (!Array.isArray(seq) || seq.length < 8 || !(oiS > 0) || !(oiE > 0)) return null;
    const rets = [];
    for (let i = 1; i < seq.length; i++) {
      if (seq[i].t - seq[i - 1].t === DAY && seq[i - 1].oiv > 0) rets.push(seq[i].oiv / seq[i - 1].oiv - 1);
    }
    if (rets.length < 7) return null;
    const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mu) ** 2, 0) / rets.length);
    if (!(sd > 1e-9)) return null;
    return (oiE / oiS - 1 - mu * W) / (sd * Math.sqrt(W));
  }

  /* ---------------- T+1 verification ---------------- */
  function scSignalDay(last) {
    if (!last) return null;
    if (typeof last.signalDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(last.signalDay)) return last.signalDay;
    const d = Array.isArray(last.days) ? last.days[last.days.length - 1] : null;
    return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  }

  /* Identity of one scan run. A different scan never reuses another scan's T+1 cache. */
  function scScanId(last) {
    const sd = scSignalDay(last);
    return sd && last && fin(last.t) ? [last.t, sd, last.W, last.U, last.mode || 'pct'].join('|') : null;
  }

  /* T+1 = close of signal day → close of the next full UTC day. Incomplete → value null. */
  function scNextOutcome(klines, signalDay, now) {
    const s = dayMs(signalDay);
    if (!fin(s)) return {status: 'missing', value: null};
    if (now < s + 2 * DAY) return {status: 'pending', value: null};
    const a = scKlineClose(klines, s, now), b = scKlineClose(klines, s + DAY, now);
    if (a == null || b == null) return {status: 'missing', value: null};
    return {status: 'ok', value: (b / a - 1) * 100};
  }

  function scNextLimit(signalDay, now) {
    const s = dayMs(signalDay);
    return Math.max(3, Math.min(1500, Math.floor((day0(now) - s) / DAY) + 3));
  }

  /* Decide T+1 for every row of `last`. `cache` = {id, done} from a previous run; it is used only
   * when its id equals this scan's id. pending/error results are never cached (retried later).
   * isCurrent(id) lets the caller discard the result if a newer scan started meanwhile. */
  async function scNextCheckRun(o) {
    const last = o.last, id = scScanId(last), sd = scSignalDay(last);
    if (!id || !sd || !last.rows || !last.rows.length) return null;
    const prior = o.cache && o.cache.id === id && o.cache.done ? o.cache.done : {};
    const done = {}, need = [];
    for (const r of last.rows) {
      const p = prior[r.sym];
      if (p && (p.status === 'ok' || p.status === 'missing')) done[r.sym] = p; else need.push(r.sym);
    }
    if (o.now < dayMs(sd) + 2 * DAY) {
      for (const s of need) done[s] = {status: 'pending', value: null};
    } else if (need.length) {
      const n = scNextLimit(sd, o.now);
      await o.pool(need, 8, async sym => {
        try { done[sym] = scNextOutcome(await o.loadKlines(sym, n), sd, o.now); }
        catch (e) { done[sym] = {status: 'error', value: null}; }
      });
    }
    if (o.isCurrent && !o.isCurrent(id)) return null;
    const keep = {};
    for (const s of Object.keys(done)) if (done[s].status === 'ok' || done[s].status === 'missing') keep[s] = done[s];
    return {id, signalDay: sd, done, cache: {id, signalDay: sd, done: keep}};
  }

  /* ---------------- realtime radar ---------------- */
  function rtTrim(arr, now, retainH) {
    const cut = now - retainH * HOUR;
    while (arr.length > 1 && arr[1].t <= cut) arr.shift();
  }

  /* Change over the selected window ending at the newest sample. The baseline is the newest sample
   * at or before (newest - window). Without one the series is warming up: ready=false and cover
   * is the real covered fraction of the window. */
  function rtWindowChange(arr, winH) {
    if (!arr || arr.length < 2) return {ready: false, cover: 0, pct: null, partial: null, span: 0};
    const last = arr[arr.length - 1], first = arr[0], winMs = winH * HOUR, cut = last.t - winMs;
    let base = null;
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i].t <= cut) { base = arr[i]; break; }
    if (base && pos(base.v) != null && pos(last.v) != null) {
      const pct = (last.v / base.v - 1) * 100;
      return {ready: true, cover: 1, pct, partial: pct, span: last.t - base.t};
    }
    const ok = pos(first.v) != null && pos(last.v) != null;
    return {ready: false, cover: Math.min(1, (last.t - first.t) / winMs), pct: null,
      partial: ok ? (last.v / first.v - 1) * 100 : null, span: last.t - first.t};
  }

  /* Alert gate: ready window change ≥ threshold, and no alert for this symbol in the last 25 min. */
  function rtAlertCheck(lastAlertAt, sym, pct, thresh, now) {
    const th = Number(thresh);
    if (!fin(pct) || !(th > 0) || Math.abs(pct) < th) return false;
    const prev = lastAlertAt.get(sym);
    if (prev !== undefined && now - prev < RT_ALERT_GAP) return false;
    lastAlertAt.set(sym, now);
    return true;
  }

  /* st: {last:Map(sym→oi, defines tracked set), hist:Map(sym→[{t,v}]), lastAlertAt:Map, win, thresh, intMs}.
   * m: sym→openInterest for this poll. Only symbols with a fresh valid sample are evaluated. */
  function rtApplySnapshot(st, m, now) {
    const alerts = [];
    for (const s of [...st.last.keys()]) {
      const v = pos(m[s]);
      if (v == null) continue;
      let a = st.hist.get(s);
      if (!a) { a = []; st.hist.set(s, a); }
      if (a.length && now - a[a.length - 1].t > RT_GAP_X * st.intMs) a.length = 0;
      if (a.length && now <= a[a.length - 1].t) continue;
      a.push({t: now, v});
      rtTrim(a, now, Math.max(st.win, RT_RETAIN_H));
      st.last.set(s, v);
      const w = rtWindowChange(a, st.win);
      if (w.ready && rtAlertCheck(st.lastAlertAt, s, w.pct, st.thresh, now)) alerts.push({sym: s, pct: w.pct, win: st.win});
    }
    return alerts;
  }

  function rtRows(hist, tick, winH) {
    const rows = [];
    hist.forEach((arr, s) => {
      if (arr.length < 2) return;
      const w = rtWindowChange(arr, winH), last = arr[arr.length - 1];
      const from = last.t - winH * HOUR;
      let maxD = 0;
      for (let i = 1; i < arr.length; i++) {
        if (arr[i - 1].t < from && arr[i].t < from) continue;
        const p = (arr[i].v / arr[i - 1].v - 1) * 100;
        if (Math.abs(p) > Math.abs(maxD)) maxD = p;
      }
      const t = tick && tick[s];
      const px = t ? t.px : null;
      rows.push({sym: s, d1: w.pct, dPart: w.partial, ready: w.ready, cover: w.cover, maxD, n: arr.length,
        px, chg: t ? t.chg : null, oiv: px ? last.v * px : null});
    });
    const key = r => Math.abs(r.ready ? r.d1 : (r.dPart || 0));
    rows.sort((a, b) => (b.ready - a.ready) || (key(b) - key(a)));
    return rows;
  }

  function rtCoverage(rows) {
    const total = rows.length, ready = rows.filter(r => r.ready).length;
    return {total, ready, minCover: total ? Math.min(...rows.map(r => r.cover)) : 0};
  }

  globalThis.OiRadar = {
    DAY, HOUR, RT_ALERT_GAP, RT_RETAIN_H, RT_GAP_X,
    scWindow, scKlineClose, scPriceChange, scOiFromHist, scArchiveSeq, scOiFromArchive, scZ,
    scSignalDay, scScanId, scNextOutcome, scNextLimit, scNextCheckRun,
    rtTrim, rtWindowChange, rtAlertCheck, rtApplySnapshot, rtRows, rtCoverage
  };
})();
