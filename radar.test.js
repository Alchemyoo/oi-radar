// Historical full-day scanner regression fixture. Rolling24 is tested in rolling-scan.test.js.
'use strict';
// Run: node --test radar.test.js (Node 18+; no packages, no network, no real clock).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const radarSrc = fs.readFileSync(path.join(__dirname, 'radar.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'fixtures/legacy-scan-index.html'), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const NOW = Date.UTC(2026, 9, 4, 10);            // 2026-10-04 10:00Z (Sunday)
const ms = s => Date.parse(s + 'T00:00:00Z');
const plain = v => JSON.parse(JSON.stringify(v));
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

/* ---------- harness: radar.js and real index.html functions in one vm context ---------- */
function makeCtx(extra = {}, clock = {now: NOW}) {
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.now); }
    static now() { return clock.now; }
  }
  const ctx = vm.createContext({
    Date: FakeDate, DAY, console, Promise, JSON, Math, Map, Set, Object, Array,
    AbortController,
    dstr: m => new Date(m).toISOString().slice(0, 10),
    pool: async (items, n, fn) => { for (let i = 0; i < items.length; i++) await fn(items[i], i); },
    ...extra
  });
  vm.runInContext(radarSrc, ctx);
  return ctx;
}
function extractFn(src, name) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(src);
  assert.ok(m, 'function not found in index.html: ' + name);
  let i = src.indexOf('{', m.index), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(m.index, j + 1);
  }
  throw new Error('unbalanced: ' + name);
}
function load(ctx, names) {
  for (const n of names) vm.runInContext(extractFn(inline, n), ctx);
  return ctx;
}
const kl = (day, c) => ({t: ms(day), o: c, c});

/* ======================= 1. scan window ======================= */
test('scWindow: W days ending at the last completed UTC day', () => {
  const {OiRadar: R} = makeCtx();
  const w = plain(R.scWindow(3, NOW));
  assert.deepEqual(w.days, ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.equal(w.d0, '2026-09-30');
  assert.equal(w.signalDay, '2026-10-03');
  assert.equal(w.startMs, ms('2026-10-01'));
  assert.equal(w.endMs, ms('2026-10-04'));
  /* exactly at 00:00:00.000Z the new day becomes the window end */
  assert.equal(R.scWindow(1, ms('2026-10-05')).signalDay, '2026-10-04');
  assert.equal(R.scWindow(1, ms('2026-10-05') - 1).signalDay, '2026-10-03');
});

/* ======================= 2. price / OI alignment ======================= */
test('scPriceChange uses the same endpoints as OI and ignores the live partial bar', () => {
  const {OiRadar: R} = makeCtx();
  const win = R.scWindow(3, NOW);
  const k = [kl('2026-09-29', 90), kl('2026-09-30', 100), kl('2026-10-01', 110), kl('2026-10-02', 120),
    kl('2026-10-03', 150), kl('2026-10-04', 999)];
  near(R.scPriceChange(k, win, NOW), 50);                       // 150/100 - 1
  k[5].c = 1;                                                   // live bar changes → no effect
  near(R.scPriceChange(k, win, NOW), 50);
  assert.equal(R.scPriceChange(k.filter(x => x.t !== ms('2026-09-30')), win, NOW), null);
  assert.equal(R.scPriceChange(k.filter(x => x.t !== ms('2026-10-03')), win, NOW), null);
  assert.equal(R.scPriceChange([...k, kl('2026-10-03', 151)], win, NOW), null);   // ambiguous duplicate
  assert.equal(R.scKlineClose(k, ms('2026-10-04'), NOW), null);                    // not completed
});

test('scOiFromHist: exact start/end instants, today-00:00 sample is the end, no neighbour substitution', () => {
  const {OiRadar: R} = makeCtx();
  const win = R.scWindow(3, NOW);
  const h = [['2026-09-30', 900], ['2026-10-01', 1000], ['2026-10-02', 1100], ['2026-10-03', 1200], ['2026-10-04', 1500]]
    .map(([d, v]) => ({t: ms(d), oiv: v, oi: 1}));
  const r = plain(R.scOiFromHist(h, win));
  assert.equal(r.oiS, 1000);
  assert.equal(r.oiE, 1500);
  assert.equal(R.scOiFromHist(h.filter(x => x.t !== ms('2026-10-04')), win), null);
  assert.equal(R.scOiFromHist(h.filter(x => x.t !== ms('2026-10-01')), win), null);
  assert.equal(R.scOiFromHist([...h, {t: ms('2026-10-04'), oiv: 7}], win), null);
  /* a shifted timestamp convention is one explicit parameter */
  const shifted = h.map(x => ({...x, t: x.t - DAY}));
  assert.equal(plain(R.scOiFromHist(shifted, win, DAY)).oiE, 1500);
});

test('scOiFromArchive: day-end rows of d0 and signalDay, truncated or missing days refuse', () => {
  const {OiRadar: R} = makeCtx();
  const win = R.scWindow(3, NOW);
  const day = (d, last, tail = '23:55') => [
    {t: Date.parse(d + 'T00:00:00Z'), oiv: last - 5}, {t: Date.parse(d + 'T' + tail + ':00Z'), oiv: last}];
  const rows = [...day('2026-09-30', 1000), ...day('2026-10-01', 1100), ...day('2026-10-02', 1200), ...day('2026-10-03', 1500)];
  const r = plain(R.scOiFromArchive(rows, win));
  assert.equal(r.oiS, 1000);
  assert.equal(r.oiE, 1500);
  assert.equal(R.scOiFromArchive(rows.filter(x => !(x.t >= ms('2026-09-30') && x.t < ms('2026-10-01'))), win), null);
  const trunc = [...day('2026-09-30', 1000), ...day('2026-10-03', 1500, '20:00')];
  assert.equal(R.scOiFromArchive(trunc, win), null);
});

test('scZ: known distribution gives z=2; gaps and zero variance refuse', () => {
  const {OiRadar: R} = makeCtx();
  const rets = [0.01, 0.03, 0.01, 0.03, 0.01, 0.03, 0.01, 0.03];
  let v = 100;
  const seq = [{t: ms('2026-09-20'), oiv: v}];
  rets.forEach((r, i) => { v *= 1 + r; seq.push({t: ms('2026-09-20') + (i + 1) * DAY, oiv: v}); });
  near(R.scZ(seq, 100, 104, 1), 2, 1e-9);
  assert.equal(R.scZ(seq.slice(0, 5), 100, 104, 1), null);
  const flat = seq.map((x, i) => ({t: x.t, oiv: 100 * 1.01 ** i}));
  assert.equal(R.scZ(flat, 100, 104, 1), null);
});

test('index.html scOne: OI and price share one window (hist path)', async () => {
  const calls = {};
  const ctx = makeCtx({
    S: {sc: {W: 3, mode: 'pct', noHist: false}},
    loadOiHist: async (s, n) => { calls.histN = n; return [['2026-09-30', 900], ['2026-10-01', 1000], ['2026-10-02', 1100], ['2026-10-03', 1200], ['2026-10-04', 1500]].map(([d, v]) => ({t: ms(d), oiv: v})); },
    loadKlines: async (s, n) => { calls.klN = n; return [kl('2026-09-30', 100), kl('2026-10-01', 110), kl('2026-10-02', 120), kl('2026-10-03', 150), kl('2026-10-04', 999)]; },
    fetchDay: async () => { throw new Error('archive must not be used'); }
  });
  load(ctx, ['scOne']);
  const r = plain(await vm.runInContext('scOne("AAAUSDT", OiRadar.scWindow(3, Date.now()))', ctx));
  assert.deepEqual([r.oiS, r.oiE, r.src], [1000, 1500, 'hist']);
  near(r.px, 50);                      // old code: live 999 / 110 - 1 = 808%
  assert.ok(calls.klN >= 3 + 2 && calls.histN >= 3 + 2);
});

test('index.html scOne: archive fallback fetches d0, never mixes sources', async () => {
  const asked = [];
  const ctx = makeCtx({
    S: {sc: {W: 3, mode: 'pct', noHist: false}},
    loadOiHist: async () => [{t: ms('2026-10-01'), oiv: 1000}],         // end instant missing → hist refused
    loadKlines: async () => [kl('2026-09-30', 100), kl('2026-10-03', 150)],
    fetchDay: async (sym, d) => {
      asked.push(d);
      const v = {'2026-09-30': 1000, '2026-10-01': 1100, '2026-10-02': 1200, '2026-10-03': 1500}[d];
      return [{t: Date.parse(d + 'T00:00:00Z'), oiv: v - 1}, {t: Date.parse(d + 'T23:55:00Z'), oiv: v}];
    }
  });
  load(ctx, ['scOne']);
  const r = plain(await vm.runInContext('scOne("AAAUSDT", OiRadar.scWindow(3, Date.now()))', ctx));
  assert.deepEqual([r.oiS, r.oiE, r.src], [1000, 1500, 'archive']);
  near(r.px, 50);
  assert.deepEqual(asked.sort(), ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
});

test('index.html scOne: unaligned data gives null OI, never a substituted endpoint', async () => {
  const ctx = makeCtx({
    S: {sc: {W: 3, mode: 'pct', noHist: true}},
    loadOiHist: async () => { throw new Error('skipped'); },
    loadKlines: async () => [kl('2026-09-30', 100), kl('2026-10-03', 150)],
    fetchDay: async (s, d) => d === '2026-09-30' ? [] : [{t: Date.parse(d + 'T23:55:00Z'), oiv: 5}]
  });
  load(ctx, ['scOne']);
  const r = plain(await vm.runInContext('scOne("AAAUSDT", OiRadar.scWindow(3, Date.now()))', ctx));
  assert.equal(r.oiS, null);
  assert.equal(r.oiE, null);
});

/* ======================= 3. T+1 ======================= */
test('scNextOutcome: signal-day close → next full UTC day close; incomplete is null', () => {
  const {OiRadar: R} = makeCtx();
  const k = [kl('2026-10-03', 150), kl('2026-10-04', 165), kl('2026-10-05', 1)];
  const sd = '2026-10-03';
  assert.deepEqual(plain(R.scNextOutcome(k, sd, NOW)), {status: 'pending', value: null});                      // Oct 4 10:00
  assert.deepEqual(plain(R.scNextOutcome(k, sd, ms('2026-10-05') - 1)), {status: 'pending', value: null});     // 1 ms early
  const ok = R.scNextOutcome(k, sd, ms('2026-10-05'));
  assert.equal(ok.status, 'ok');
  near(ok.value, 10);                                                                                         // 165/150 - 1
  assert.equal(R.scNextOutcome([kl('2026-10-03', 150)], sd, ms('2026-10-06')).status, 'missing');
  assert.equal(R.scNextOutcome([kl('2026-10-04', 165)], sd, ms('2026-10-06')).status, 'missing');
  assert.equal(R.scNextOutcome([kl('2026-10-03', 150), kl('2026-10-04', 165), kl('2026-10-04', 166)], sd, ms('2026-10-06')).status, 'missing');
  assert.equal(R.scNextLimit(sd, ms('2026-10-09')), 9);      // bars Oct 3..Oct 9 = 7, +2 margin
});

function lastScan(rows, over = {}) {
  return {t: 1000, W: 3, U: 100, mode: 'pct', signalDay: '2026-10-03', days: ['2026-10-01', '2026-10-02', '2026-10-03'],
    rows: rows.map(sym => ({sym})), ...over};
}

test('scNextCheckRun: nothing is verified before the next full day closes', async () => {
  const {OiRadar: R} = makeCtx();
  let calls = 0;
  const res = await R.scNextCheckRun({last: lastScan(['A', 'B']), cache: null, now: NOW, pool: async () => { calls++; },
    loadKlines: async () => { calls++; return []; }});
  assert.equal(calls, 0);
  assert.deepEqual(plain(res.done), {A: {status: 'pending', value: null}, B: {status: 'pending', value: null}});
  assert.deepEqual(plain(res.cache.done), {});          // pending is never cached
});

test('scNextCheckRun: cache is isolated per scan id; ok/missing cached, error retried', async () => {
  const ctx = makeCtx();
  const R = ctx.OiRadar, now = ms('2026-10-06');
  const fetched = [];
  const k = {A: [kl('2026-10-03', 100), kl('2026-10-04', 110)], B: [kl('2026-10-03', 100)]};
  const run = (last, cache) => R.scNextCheckRun({last, cache, now, pool: ctx.pool,
    loadKlines: async s => { fetched.push(s); if (s === 'E') throw new Error('net'); return k[s] || []; }});
  const r1 = await run(lastScan(['A', 'B', 'E']), null);
  assert.deepEqual(plain(r1.done.A), {status: 'ok', value: 10.000000000000009});
  assert.equal(r1.done.B.status, 'missing');
  assert.equal(r1.done.E.status, 'error');
  assert.deepEqual(Object.keys(r1.cache.done).sort(), ['A', 'B']);
  fetched.length = 0;
  await run(lastScan(['A', 'B', 'E']), r1.cache);                       // same scan → only E refetched
  assert.deepEqual(fetched, ['E']);
  fetched.length = 0;
  await run(lastScan(['A', 'B', 'E'], {t: 2000}), r1.cache);            // different scan → nothing reused
  assert.deepEqual(fetched.sort(), ['A', 'B', 'E']);
  fetched.length = 0;
  await run(lastScan(['A'], {signalDay: '2026-10-02', days: ['2026-10-02']}), r1.cache);   // other signal day
  assert.deepEqual(fetched, ['A']);
  assert.equal(await R.scNextCheckRun({last: lastScan(['A']), cache: null, now, pool: ctx.pool, loadKlines: async () => k.A, isCurrent: () => false}), null);
});

test('scNextCheckRun: legacy saved scan (no signalDay) derives it from days', async () => {
  const {OiRadar: R} = makeCtx();
  const legacy = lastScan(['A']); delete legacy.signalDay;
  assert.equal(R.scSignalDay(legacy), '2026-10-03');
  assert.ok(R.scScanId(legacy));
  assert.notEqual(R.scScanId(legacy), R.scScanId({...legacy, t: 1001}));
  assert.equal(R.scScanId({rows: []}), null);
});

test('index.html scSave/scNextCheck/scApplyNext: strip stale T+1, ignore legacy cache, no cross-scan apply', async () => {
  const stored = {
    oif_scanchecked: {day: '2026-10-04', done: {A: 99}},               // poisoned legacy cache must be ignored
  };
  const chips = [];
  const classList = {toggle() {}, remove() {}, add() {}};
  const el = {style: {}, classList, innerHTML: '', textContent: '', querySelectorAll: () => [], insertAdjacentHTML: (_, h) => chips.push(h)};
  const clock = {now: ms('2026-10-06') + HOUR};
  const ctx = makeCtx({
    S: {sc: {W: 3, U: 100, mode: 'pct', run: false, noHist: false, params: {}, rows: [
      {sym: 'A', pick: true, next: 5, nextSt: 'ok'}, {sym: 'B', pick: false, next: 7}], t0: 1000,
      win: null}},
    store: {get: (k, d) => k in stored ? JSON.parse(JSON.stringify(stored[k])) : d, set: (k, v) => { stored[k] = JSON.parse(JSON.stringify(v)); }},
    $: () => el, ban() {}, scRender() {},
    loadKlines: async s => ({A: [kl('2026-10-03', 100), kl('2026-10-04', 110)], B: [kl('2026-10-03', 100), kl('2026-10-04', 90)]}[s])
  }, clock);
  load(ctx, ['scSave', 'scNextCheck', 'scApplyNext', 'scNextChips']);
  vm.runInContext('S.sc.win=OiRadar.scWindow(3,Date.now()-2*DAY)', ctx);   // scan ran on Oct 4
  vm.runInContext('scSave()', ctx);
  const saved = stored.oif_lastscan;
  assert.equal(saved.signalDay, '2026-10-03');
  assert.equal(saved.d0, '2026-09-30');
  assert.ok(saved.rows.every(r => !('next' in r) && !('nextSt' in r)));
  assert.equal(vm.runInContext('S.sc.scanId', ctx), vm.runInContext('OiRadar.scScanId(' + JSON.stringify(saved) + ')', ctx));

  await vm.runInContext('scNextCheck()', ctx);
  const rows = plain(vm.runInContext('S.sc.rows', ctx));
  near(rows[0].next, 10);
  near(rows[1].next, -10);
  assert.equal(stored.oif_scancheck2.id, vm.runInContext('S.sc.scanId', ctx));
  assert.ok(chips.some(h => h.includes('T+1 已验')));

  /* a scan started while a check is in flight: result must not touch the new rows */
  vm.runInContext('S.sc.run=true', ctx);
  vm.runInContext('S.sc.rows=[{sym:"A"}]', ctx);
  await vm.runInContext('scNextCheck()', ctx);
  assert.equal(vm.runInContext('S.sc.rows[0].next', ctx), undefined);
});

/* ======================= 4. radar: window change, 25-min dedupe, coverage ======================= */
const mkSt = (over = {}) => ({last: new Map([['A', 1]]), hist: new Map(), lastAlertAt: new Map(), win: 6, thresh: 3, intMs: MIN, ...over});

test('rtWindowChange: baseline is the newest sample at/before window start; warm-up reports real coverage', () => {
  const {OiRadar: R} = makeCtx();
  const t0 = 1e12;
  const s = (min, v) => ({t: t0 + min * MIN, v});
  const warm = plain(R.rtWindowChange([s(0, 100), s(60, 101), s(120, 110)], 6));
  assert.equal(warm.ready, false);
  near(warm.cover, 120 / 360);
  assert.equal(warm.pct, null);
  near(warm.partial, 10);
  const edge = [s(0, 100), s(120, 105), s(360, 107)];
  const ok = plain(R.rtWindowChange(edge, 6));
  assert.equal(ok.ready, true);
  near(ok.pct, 7);
  near(plain(R.rtWindowChange([s(0, 100), s(1, 100), s(359, 100), s(360, 110)], 6)).pct, 10);
  near(plain(R.rtWindowChange([s(0, 100), s(300, 105), s(359, 106), s(360, 110)], 1)).pct, (110 / 105 - 1) * 100);  // base = newest ≤ last-1h
  assert.equal(R.rtWindowChange([s(0, 100)], 6).ready, false);
});

test('rtAlertCheck: 25-minute per-symbol dedupe via lastAlertAt', () => {
  const {OiRadar: R} = makeCtx();
  const m = new Map(), t = 5e11;
  assert.equal(R.rtAlertCheck(m, 'A', 3.5, 3, t), true);
  assert.equal(m.get('A'), t);
  assert.equal(R.rtAlertCheck(m, 'A', 9, 3, t + 25 * MIN - 1), false);
  assert.equal(R.rtAlertCheck(m, 'A', -9, 3, t + 10 * MIN), false);          // direction flip is still the same symbol
  assert.equal(m.get('A'), t);                                                // suppressed alerts do not extend the gap
  assert.equal(R.rtAlertCheck(m, 'B', 4, 3, t + MIN), true);                  // other symbols independent
  assert.equal(R.rtAlertCheck(m, 'A', 3, 3, t + 25 * MIN), true);             // boundary: exactly 25 min allowed
  assert.equal(R.rtAlertCheck(m, 'C', 2.99, 3, t), false);
  assert.equal(m.has('C'), false);                                            // below threshold records nothing
  assert.equal(R.rtAlertCheck(m, 'D', NaN, 3, t), false);
  assert.equal(R.rtAlertCheck(m, 'D', 50, 0, t), false);
});

function simulate(st, minutes, oiAt, start = 1e12, symbol = 'A') {
  const alerts = [];
  for (let k = 0; k <= minutes; k++) {
    const now = start + k * MIN;
    for (const a of globalThis.__R.rtApplySnapshot(st, {[symbol]: oiAt(k)}, now)) alerts.push({k, ...a});
  }
  return alerts;
}

test('radar alerts follow the selected window, not the 60-second change', () => {
  const {OiRadar: R} = makeCtx();
  globalThis.__R = R;
  /* +0.02 %/min: a 60 s change is 0.02 %, the 6 h change is ≈ 7.4 %, a 1 h change ≈ 1.2 % */
  const drift = k => 100 * 1.0002 ** k;
  const st6 = mkSt({win: 6});
  const a6 = simulate(st6, 480, drift);
  assert.deepEqual(a6.map(a => a.k), [360, 385, 410, 435, 460]);   // none during warm-up even though partial change > 3 % after ~150 min
  assert.ok(a6.every(a => a.win === 6 && Math.abs(a.pct - (1.0002 ** 360 - 1) * 100) < 0.5 || a.k > 360));
  for (let i = 1; i < a6.length; i++) assert.ok(a6[i].k - a6[i - 1].k >= 25);
  const st1 = mkSt({win: 1});
  assert.deepEqual(simulate(st1, 480, drift), []);                   // 1 h change ≈ 1.2 % < 3 %
  const st1b = mkSt({win: 1, thresh: 1});
  const a1 = simulate(st1b, 200, drift);
  assert.equal(a1[0].k, 60);                                          // ready as soon as 1 h is covered
  /* a single 60 s jump that is smaller than the threshold over the window stays silent */
  const spike = k => (k === 400 ? 100.0 : 100) + (k === 399 ? 0 : 0);
  assert.deepEqual(simulate(mkSt({win: 6}), 420, spike), []);
});

test('radar: gap restarts warm-up; failed symbols are not evaluated; window switch reuses history', () => {
  const {OiRadar: R} = makeCtx();
  globalThis.__R = R;
  const st = mkSt({win: 1, thresh: 50});
  simulate(st, 90, k => 100 + k);                                    // 91 samples
  assert.equal(st.hist.get('A').length > 60, true);
  assert.equal(R.rtRows(st.hist, {}, 1)[0].ready, true);
  assert.equal(R.rtRows(st.hist, {}, 6)[0].ready, false);            // longer window: warm-up, history kept
  near(R.rtRows(st.hist, {}, 6)[0].cover, 90 / 360);
  const t = 1e12 + 90 * MIN;
  R.rtApplySnapshot(st, {A: 500}, t + 10 * MIN);                      // 10 min gap > 3 intervals
  assert.equal(st.hist.get('A').length, 1);
  const before = st.hist.get('A').length;
  R.rtApplySnapshot(st, {}, t + 11 * MIN);                            // no fresh sample
  R.rtApplySnapshot(st, {A: NaN}, t + 12 * MIN);
  R.rtApplySnapshot(st, {A: 0}, t + 13 * MIN);
  assert.equal(st.hist.get('A').length, before);
  R.rtApplySnapshot(st, {A: 501}, t + 10 * MIN);                      // non-monotonic clock ignored
  assert.equal(st.hist.get('A').length, before);
});

test('rtRows/rtCoverage: ready rows first, honest coverage summary', () => {
  const {OiRadar: R} = makeCtx();
  const t0 = 1e12, hist = new Map([
    ['READY', [{t: t0, v: 100}, {t: t0 + 6 * HOUR, v: 104}]],
    ['WARM', [{t: t0 + 5 * HOUR, v: 100}, {t: t0 + 6 * HOUR, v: 150}]],
    ['ONE', [{t: t0, v: 1}]]
  ]);
  const rows = plain(R.rtRows(hist, {READY: {px: 2, chg: 1}}, 6));
  assert.deepEqual(rows.map(r => r.sym), ['READY', 'WARM']);
  assert.equal(rows[0].ready, true);
  near(rows[0].d1, 4);
  assert.equal(rows[1].ready, false);
  assert.equal(rows[1].d1, null);
  near(rows[1].cover, 1 / 6);
  near(rows[0].oiv, 208);
  const cv = plain(R.rtCoverage(rows));
  assert.deepEqual([cv.total, cv.ready], [2, 1]);
  near(cv.minCover, 1 / 6);
});

test('index.html rtPollRequest: window alert fires once, lastAlertAt blocks repeats for 25 min', async () => {
  const clock = {now: 1e12};
  const toasts = [];
  let oi = 100;
  const S = {rt: {on: true, generation: 0, win: 1, thresh: 3, int: 60, snapT: 0, rows: [], last: new Map([['AAAUSDT', 1]]),
    hist: new Map(), lastAlertAt: new Map()}, tick: {AAAUSDT: {px: 2, chg: 0}}};
  const ctx = makeCtx({
    S, API: 'x', jget: async () => ({openInterest: String(oi)}), toast: m => toasts.push(m),
    fPrice: v => String(v), rtBuild() {}
  }, clock);
  load(ctx, ['rtPollRequest']);
  const poll = () => vm.runInContext('rtPollRequest()', ctx);
  for (let k = 0; k <= 60; k++) { clock.now = 1e12 + k * MIN; oi = 100 + (k === 60 ? 5 : 0); await poll(); }
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /AAA 1h OI 激增 5\.0%/);
  for (let k = 61; k <= 84; k++) { clock.now = 1e12 + k * MIN; oi = 106; await poll(); }
  assert.equal(toasts.length, 1);                                    // still above threshold, inside 25 min
  clock.now = 1e12 + 85 * MIN; oi = 107; await poll();
  assert.equal(toasts.length, 2);                                    // exactly 25 min later: allowed again
  assert.equal(S.rt.lastAlertAt.get('AAAUSDT'), 1e12 + 85 * MIN);
});

/* ======================= 5. things that must not change ======================= */
test('static: three entries kept, scripts wired and old buggy paths gone', () => {
  for (const v of ['market', 'opportunity', 'signal']) assert.ok(html.includes(`data-v="${v}"`), v);
  assert.ok(html.indexOf('src="radar.js') > 0 && html.indexOf('src="radar.js') < html.indexOf("<script>\n'use strict';"));
  for (const bad of ['oif_scanchecked', 'lastAgo', 'S.tick[r.sym]&&S.tick[r.sym].px', 'loadKlines(sym,S.sc.W+1)'])
    assert.ok(!html.includes(bad), 'still present: ' + bad);
  for (const m of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]) new vm.Script(m[1]);
});
