'use strict';
// Run: node --test strong.test.js (Node 18+; no packages or network required).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'strong.js'), 'utf8');
const H = 3600000, E = Date.UTC(2026, 9, 3, 8) - 1;
const days = [1, 3, 5, 7];
const plain = v => JSON.parse(JSON.stringify(v));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
function candles(count = 169, end = E, value = age => 200 - age / 2) {
  return Array.from({length: count}, (_, i) => {
    const age = count - i - 1, close = end - age * H;
    return [close + 1 - H, '1', '1', '1', String(value(age)), '1', close];
  });
}
function row(sym, r, vol = null) {
  return {sym, px: 100, ret: {1: r, 3: r, 5: r, 7: r}, vol,
    validBars: 169, missingBars: 0, complete: true, currentValid: true};
}
function element(dataset = {}) {
  const classes = new Set();
  return {dataset, style: {}, innerHTML: '', textContent: '', value: '', disabled: false,
    setAttribute(k, v) { this[k] = v; }, classList: {
      toggle(k, on) { if (on) classes.add(k); else classes.delete(k); },
      contains(k) { return classes.has(k); }
    }};
}
function harness(overrides = {}) {
  const nodes = new Map();
  for (const id of ['stGo', 'stStop', 'stCsv', 'stStat', 'stTime', 'stThreshold',
    'stMinVol', 'stBtc', 'stEnv', 'stMeta', 'stBan', 'stBar', 'stBar i', 'stTbl tbody'])
    nodes.set('#' + id, element());
  const groups = {
    '#stWin button[data-d]': days.map(d => element({d: String(d)})),
    '#stTbl th[data-d]': days.map(d => element({d: String(d)})),
    '#stMode button[data-m]': ['strong', 'relative', 'all'].map(m => element({m})),
    '#stOrder button[data-o]': ['desc', 'asc'].map(o => element({o}))
  };
  const exports = [], jumps = [], toasts = [];
  const c = {S: {}, API: 'https://www.binance.com',
    $: s => nodes.get(s) || null, $$: s => groups[s] || [],
    fP: v => v === null ? '—' : (v * 100).toFixed(2) + '%',
    fC: v => String(v), fPrice: v => String(v),
    clsP: v => v > 0 ? 'up' : v < 0 ? 'down' : '',
    toast: v => toasts.push(v), jumpSym: v => jumps.push(v),
    csvDown: (name, head, rows) => exports.push({name, head, rows}),
    store: {get: (_, d) => d, set() {}},
    jget: async () => { throw new Error('Unexpected request'); },
    loadSyms: async () => ['BTCUSDT', 'AAAUSDT'],
    loadTickers: async () => ({AAAUSDT: {vol: 2000000, px: 99999}}),
    pool: async (items, n, fn, stop) => {
      let i = 0;
      await Promise.all(Array.from({length: Math.max(1, Math.min(n, items.length))}, async () => {
        while (i < items.length) { if (stop && stop()) return; const k = i++; await fn(items[k], k); }
      }));
    }, ...overrides};
  vm.createContext(c);
  vm.runInContext(source, c, {filename: 'strong.js'});
  return {c, nodes, groups, exports, jumps, toasts};
}
function api(c, symbolFn = () => candles(), clock = E + 123456) {
  const urls = [];
  c.jget = async url => {
    urls.push(url);
    const u = new URL(url);
    if (u.pathname.endsWith('/time')) return {serverTime: clock};
    return symbolFn(u.searchParams.get('symbol'), u);
  };
  return urls;
}

 test('load and stBind never trigger automatic scans; repeated bind is safe', () => {
  let requests = 0;
  const h = harness({jget: () => { requests++; throw new Error('automatic'); }});
  assert.equal(h.c.S.st.window, 1);
  assert.equal(h.c.S.st.mode, 'strong');
  assert.equal(h.c.S.st.threshold, 1);
  assert.equal(h.c.S.st.minVol, 0);
  assert.equal(h.nodes.get('#stGo').onclick, undefined);
  h.c.stBind(); h.c.stBind(); h.c.stRender();
  assert.equal(requests, 0);
  assert.match(h.nodes.get('#stTbl tbody').innerHTML, /不会自动扫描/);
  assert.equal(h.nodes.get('#stCsv').disabled, true);
});

test('169 exact hourly candles include all four endpoint returns independent of array order', () => {
  const {c} = harness();
  const r = c.stCalcReturns(candles().reverse(), E);
  assert.equal(r.validBars, 169); assert.equal(r.complete, true);
  assert.equal(r.currentValid, true); assert.equal(r.px, 200);
  for (const d of days) near(r.ret[d], 200 / (200 - d * 12) - 1);
  assert.equal(c.stCalcReturns(candles(), E + 1).px, null);
});

test('new listing produces null long windows, never fabricated zero', () => {
  const {c} = harness();
  for (const [n, available] of [[1, []], [24, []], [25, [1]], [73, [1, 3]],
    [121, [1, 3, 5]], [169, days]]) {
    const r = c.stCalcReturns(candles(n), E);
    assert.equal(r.validBars, n);
    for (const d of days) {
      if (available.includes(d)) assert.equal(typeof r.ret[d], 'number');
      else assert.equal(r.ret[d], null);
    }
  }
});

test('missing baseline is null rather than a nearby candle; internal gaps disclosed', () => {
  const {c} = harness();
  let ks = candles().filter(k => k[6] !== E - 24 * H);
  let r = c.stCalcReturns(ks, E);
  assert.equal(r.ret[1], null); assert.notEqual(r.ret[3], null);
  assert.equal(r.complete, false); assert.equal(r.missingBars, 1);
  ks = candles().filter(k => k[6] !== E - H);
  r = c.stCalcReturns(ks, E);
  assert.equal(r.complete, false);
  assert.equal(days.every(d => r.ret[d] !== null), true);
});

test('stale or missing current bar, future bar, malformed time and duplicates rejected', () => {
  const {c} = harness();
  for (const ks of [candles(169, E - H), candles().slice(0, -1),
    candles().map((k, i) => i === 168 ? [...k.slice(0, 6), E - 1] : k),
    [...candles(), candles().at(-1)]]) {
    const r = c.stCalcReturns(ks, E);
    assert.equal(r.px, null); assert.equal(r.currentValid, false);
    assert.deepEqual(plain(r.ret), {1: null, 3: null, 5: null, 7: null});
  }
  const ks = [...candles(), ...candles(1, E + H, () => 9999)];
  assert.equal(c.stCalcReturns(ks, E).px, 200);
  const shifted = candles().map(k => [k[0] + 1, ...k.slice(1, 6), k[6] + 1]);
  assert.equal(c.stCalcReturns(shifted, E).px, null);
});

test('invalid current/baseline prices and overflow cannot become finite returns', () => {
  const {c} = harness();
  for (const bad of ['0', '-1', '', null, undefined, true, 'NaN', 'Infinity']) {
    const ks = candles(); ks.at(-1)[4] = bad;
    assert.equal(c.stCalcReturns(ks, E).px, null);
    const baseline = candles(); baseline[144][4] = bad;
    assert.equal(c.stCalcReturns(baseline, E).ret[1], null);
  }
  const ks = candles(); ks.at(-1)[4] = '1e308'; ks[144][4] = '1e-308';
  assert.equal(c.stCalcReturns(ks, E).ret[1], null);
  const zero = c.stCalcReturns(candles(169, E, () => 100), E);
  assert.equal(zero.ret[7], 0); // real zero is valid; missing never becomes zero
});

test('BTC regime inclusive +/-1%, derived floating boundaries, zero threshold and null', () => {
  const {c} = harness();
  for (const r of [-0.01, 0.01, 0, 101 / 100 - 1, 99 / 100 - 1])
    assert.equal(c.stRegime(r, 0.01), 'flat');
  assert.equal(c.stRegime(-0.01000001, 0.01), 'down');
  assert.equal(c.stRegime(0.01000001, 0.01), 'up');
  assert.equal(c.stRegime(null, 0.01), 'unknown');
  assert.equal(c.stRegime(NaN, 0.01), 'unknown');
  assert.equal(c.stRegime(0, 0), 'flat');
  assert.equal(c.stRegime(0.001, 0), 'up');
});

test('ranking uses absolute returns, strict outperform, resistant decliners, asc/desc and top30', () => {
  const {c} = harness();
  const rows = [row('DOWNUSDT', -0.04), row('RESISTUSDT', -0.02), row('EQUALUSDT', -0.03),
    row('POSUSDT', 0.01), row('ZEROUSDT', 0), row('MISSINGUSDT', null), row('BTCUSDT', 1)];
  const syms = list => Array.from(list, r => r.sym);
  assert.deepEqual(syms(c.stRank(rows, {1: -0.03}, 1, 'strong', 'desc', 0)), ['POSUSDT']);
  assert.deepEqual(syms(c.stRank(rows, {1: -0.03}, 1, 'relative', 'desc', 0)),
    ['POSUSDT', 'ZEROUSDT', 'RESISTUSDT']);
  assert.deepEqual(syms(c.stRank(rows, {1: -0.03}, 1, 'all', 'asc', 0)),
    ['DOWNUSDT', 'EQUALUSDT', 'RESISTUSDT', 'ZEROUSDT', 'POSUSDT']);
  assert.deepEqual(syms(c.stRank(rows, {1: 0.02}, 1, 'strong', 'desc', 0)), []);
  const many = Array.from({length: 50}, (_, i) => row('X' + i + 'USDT', i / 100));
  const before = many.map(r => r.sym);
  const top = c.stRank(many, {1: 0}, 1, 'all', 'desc', 0);
  assert.equal(top.length, 30); assert.equal(top[0].ret[1], 0.49);
  assert.equal(top.at(-1).ret[1], 0.2);
  assert.deepEqual(many.map(r => r.sym), before);
});

test('BTC null forbids comparable modes; all mode and minimum-volume semantics remain valid', () => {
  const {c} = harness();
  const rows = [row('NUSDT', 0.05, null), row('LOWUSDT', 0.02, 999999), row('EXACTUSDT', 0.01, 1000000)];
  for (const btc of [null, {1: null}, {1: NaN}]) {
    assert.equal(c.stRank(rows, btc, 1, 'strong', 'desc', 0).length, 0);
    assert.equal(c.stRank(rows, btc, 1, 'relative', 'desc', 0).length, 0);
    assert.equal(c.stRank(rows, btc, 1, 'all', 'desc', 0).length, 3);
  }
  const list = c.stRank(rows, {1: 0}, 1, 'all', 'desc', 1000000);
  assert.deepEqual(Array.from(list, r => r.sym), ['EXACTUSDT']);
});

test('controls switch windows and ascending automatically selects all; threshold/volume units clamp', () => {
  const {c, nodes, groups} = harness(); c.stBind();
  groups['#stTbl th[data-d]'][3].onclick(); assert.equal(c.S.st.window, 7);
  groups['#stWin button[data-d]'][1].onclick(); assert.equal(c.S.st.window, 3);
  groups['#stOrder button[data-o]'][1].onclick();
  assert.equal(c.S.st.order, 'asc'); assert.equal(c.S.st.mode, 'all');
  assert.equal(groups['#stMode button[data-m]'][2].classList.contains('on'), true);
  const t = nodes.get('#stThreshold'), v = nodes.get('#stMinVol');
  t.value = 99; t.onchange(); assert.equal(c.S.st.threshold, 20);
  t.value = -1; t.onchange(); assert.equal(c.S.st.threshold, 0);
  v.value = 2.5; v.onchange(); assert.equal(c.S.st.minVol, 2500000);
  v.value = -1; v.onchange(); assert.equal(c.S.st.minVol, 0);
});

test('full 528-symbol universe refreshed; BTC first, common E, 169h start, encoded symbols, pool six', async () => {
  const h = harness(), c = h.c;
  const syms = ['BTCUSDT', '中文USDT', 'CTUSDT', ...Array.from({length: 525}, (_, i) => `A${i}USDT`)];
  let symsCalls = 0, tickCalls = 0, active = 0, max = 0, poolN;
  c.loadSyms = async () => { symsCalls++; return [...syms, 'A0USDT']; };
  c.loadTickers = async () => { tickCalls++; return Object.fromEntries(syms.map(s => [s, {vol: 1e7, px: 999999}])); };
  const oldPool = c.pool;
  c.pool = async (items, n, fn, stop) => { poolN = n; return oldPool(items, n, fn, stop); };
  const urls = api(c, async sym => {
    if (sym === 'BTCUSDT') return candles(169, E, () => 100);
    active++; max = Math.max(max, active); await Promise.resolve(); active--;
    return sym === 'CTUSDT' ? candles(49) : candles();
  });
  await c.stScan();
  assert.equal(symsCalls, 1); assert.equal(tickCalls, 1); assert.equal(poolN, 6); assert.equal(max, 6);
  assert.equal(urls.length, 529); assert.match(urls[0], /\/time$/);
  assert.equal(new URL(urls[1]).searchParams.get('symbol'), 'BTCUSDT');
  for (const url of urls.slice(1)) {
    const u = new URL(url);
    assert.equal(u.searchParams.get('endTime'), String(E));
    assert.equal(u.searchParams.get('startTime'), String(E + 1 - 169 * H));
    assert.equal(u.searchParams.get('interval'), '1h'); assert.equal(u.searchParams.get('limit'), '170');
  }
  assert.equal(urls.some(u => u.includes(encodeURIComponent('中文USDT'))), true);
  assert.equal(c.S.st.rows.length, 527); assert.equal(c.S.st.stats.total, 527);
  assert.equal(c.S.st.stats.done, 527); assert.equal(c.S.st.stats.short, 1);
  assert.equal(c.S.st.rows.find(r => r.sym === 'CTUSDT').ret[3], null);
  assert.equal(c.S.st.rows[0].px, 200); // never ticker lastPrice
  assert.equal(c.S.st.displayed.length, 30);
  assert.equal(h.nodes.get('#stCsv').disabled, false);
  await c.stScan(); assert.equal(symsCalls, 2); assert.equal(tickCalls, 2);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return {promise, resolve, reject};
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('stop halts launches, lets six inflight finish and labels partial; CSV disabled while running', async () => {
  const h = harness(), c = h.c, gates = [], started = [];
  c.stBind();
  c.loadSyms = async () => ['BTCUSDT', ...Array.from({length: 20}, (_, i) => `X${i}USDT`)];
  api(c, sym => {
    if (sym === 'BTCUSDT') return candles(169, E, () => 100);
    const gate = deferred(); gates.push(gate); started.push(sym); return gate.promise;
  });
  const pending = c.stScan(); await flush();
  assert.equal(started.length, 6); assert.equal(h.nodes.get('#stCsv').disabled, true);
  assert.equal(c.stCsv(), false);
  h.nodes.get('#stStop').onclick();
  for (const g of gates) g.resolve(candles());
  await pending;
  assert.equal(started.length, 6); assert.equal(c.S.st.stats.done, 6);
  assert.equal(c.S.st.stats.ok, 6); assert.equal(c.S.st.stats.cancelled, true);
  assert.equal(c.S.st.stats.total, 20);
  assert.match(h.nodes.get('#stStat').textContent, /已停止（部分结果）/);
  assert.match(h.nodes.get('#stStat').textContent, /未扫描 14/);
  assert.equal(c.S.st.run, false);
});

test('429 and 418 stop queue instead of treating rate limit as ordinary per-symbol failure', async () => {
  for (const code of [429, 418]) {
    const h = harness(), c = h.c, gates = [];
    c.loadSyms = async () => ['BTCUSDT', ...Array.from({length: 20}, (_, i) => `X${i}USDT`)];
    api(c, sym => {
      if (sym === 'BTCUSDT') return candles();
      const gate = deferred(); gates.push(gate); return gate.promise;
    });
    const pending = c.stScan(); await flush();
    assert.equal(gates.length, 6);
    gates[0].reject(new Error('HTTP ' + code)); await flush();
    assert.equal(c.S.st.job.rateLimited, true);
    for (const gate of gates.slice(1)) gate.resolve(candles());
    await pending;
    assert.equal(gates.length, 6); assert.equal(c.S.st.stats.failed, 1);
    assert.equal(c.S.st.stats.ok, 5); assert.equal(c.S.st.stats.done, 6);
    assert.match(h.nodes.get('#stStat').textContent, /限流停止/);
    assert.match(h.nodes.get('#stBan').textContent, /停止启动新请求/);
  }
});

test('setup failures at time/BTC/list/tickers preserve previous snapshot rows and metadata atomically', async () => {
  for (const stage of ['time', 'btc', 'list', 'tickers']) {
    const h = harness(), c = h.c, oldRows = [row('OLDUSDT', 0.5)], oldBtc = {ret: {1: 0.1}};
    Object.assign(c.S.st, {rows: oldRows, btc: oldBtc, E: E - H, tickerTime: 123456});
    api(c, sym => stage === 'btc' && sym === 'BTCUSDT' ? candles(169, E - H) : candles());
    if (stage === 'time') c.jget = async () => { throw new Error('HTTP 503'); };
    if (stage === 'list') c.loadSyms = async () => { throw new Error('list failed'); };
    if (stage === 'tickers') c.loadTickers = async () => { throw new Error('ticker failed'); };
    await c.stScan();
    assert.equal(c.S.st.rows, oldRows); assert.equal(c.S.st.btc, oldBtc);
    assert.equal(c.S.st.E, E - H); assert.equal(c.S.st.tickerTime, 123456);
    assert.equal(c.S.st.run, false); assert.notEqual(c.S.st.setupError, '');
    assert.match(h.nodes.get('#stStat').textContent, /此前成功快照未更改/);
  }
});

test('stop during setup preserves old scan, has stopped label and launches no BTC request', async () => {
  const h = harness(), c = h.c, gate = deferred(), rows = [row('OLDUSDT', 0.3)];
  c.stBind(); c.S.st.rows = rows; c.S.st.E = E - H;
  let requests = 0;
  c.jget = () => { requests++; return gate.promise; };
  const pending = c.stScan(); h.nodes.get('#stStop').onclick();
  gate.resolve({serverTime: E + 123456}); await pending;
  assert.equal(requests, 1); assert.equal(c.S.st.rows, rows); assert.equal(c.S.st.E, E - H);
  assert.match(h.nodes.get('#stStat').textContent, /已停止（准备阶段/);
});

test('new committed scan clears old successes; failed requests and missing current separately counted', async () => {
  const h = harness(), c = h.c;
  c.S.st.rows = [row('OLDUSDT', 9)]; c.S.st.E = E - H;
  c.loadSyms = async () => ['BTCUSDT', 'GOODUSDT', 'FAILEDUSDT', 'STALEUSDT'];
  api(c, sym => {
    if (sym === 'FAILEDUSDT') throw new Error('HTTP 500');
    if (sym === 'STALEUSDT') return candles(169, E - H);
    return candles();
  });
  await c.stScan();
  assert.deepEqual(Array.from(c.S.st.rows, r => r.sym), ['GOODUSDT']);
  assert.equal(c.S.st.stats.ok, 1); assert.equal(c.S.st.stats.failed, 1);
  assert.equal(c.S.st.stats.missing, 1); assert.equal(c.S.st.stats.done, 3);
  assert.equal(c.S.st.E, E);
});

test('total failure and zero eligible states are explicit, export disabled', async () => {
  const h = harness(), c = h.c;
  api(c, sym => { if (sym !== 'BTCUSDT') throw new Error('HTTP 500'); return candles(); });
  await c.stScan();
  assert.match(h.nodes.get('#stStat').textContent, /无有效币种数据/);
  assert.equal(h.nodes.get('#stCsv').disabled, true);
  api(c, sym => candles(169, E, age => sym === 'BTCUSDT' ? 200 - age : 100));
  await c.stScan();
  assert.equal(c.S.st.rows.length, 1); assert.equal(c.S.st.displayed.length, 0);
  assert.match(h.nodes.get('#stTbl tbody').innerHTML, /无符合币种/);
  assert.equal(h.nodes.get('#stCsv').disabled, true);
});

test('BTC up is warning only; missing BTC window removes comparable rankings but not all', () => {
  const h = harness(), c = h.c;
  Object.assign(c.S.st, {E, rows: [row('UPUSDT', 0.04)], btc: {ret: {1: 0.02, 3: null}}});
  c.stRender(); assert.equal(c.S.st.displayed.length, 1);
  assert.match(h.nodes.get('#stBan').textContent, /当前不是BTC弱势周期/);
  c.S.st.window = 3; c.stRender(); assert.equal(c.S.st.displayed.length, 0);
  assert.match(h.nodes.get('#stTbl tbody').innerHTML, /BTC所选周期缺少历史/);
  c.S.st.mode = 'all'; c.stRender(); assert.equal(c.S.st.displayed.length, 1);
  assert.match(h.nodes.get('#stTbl tbody').innerHTML, /<td class="">—<\/td>/);
});

test('symbols are HTML escaped, clicks dispatch original symbol, table has exactly nine cells', () => {
  const h = harness(), c = h.c, sym = '中文<"&\'USDT';
  c.stBind(); Object.assign(c.S.st, {E, btc: {1: -0.02}, rows: [row(sym, 0.03)]});
  c.stRender();
  const markup = h.nodes.get('#stTbl tbody').innerHTML;
  assert.equal(markup.includes(sym), false); assert.match(markup, /&lt;&quot;&amp;&#39;/);
  assert.equal((markup.match(/<td(?:\s|>)/g) || []).length, 9);
  h.nodes.get('#stTbl tbody').onclick({target: {closest: () => ({dataset: {stSym: sym}})}});
  assert.deepEqual(h.jumps, [sym]);
  assert.match(markup, /\+5\.00/); // +3% minus -2% = +5 percentage points, not ratio
});

test('CSV exports exactly displayed top30 order with UTC, BTC, relative pp, completeness and partial labels', () => {
  const h = harness(), c = h.c;
  const rows = Array.from({length: 40}, (_, i) => row(`X${i}USDT`, i / 100, 1e7));
  rows[39].ret[7] = null; rows[39].complete = false; rows[39].validBars = 49;
  Object.assign(c.S.st, {E, tickerTime: E + 3600001, rows, btc: {ret: {1: -0.02, 3: 0.01, 5: 0, 7: null}},
    stats: {committed: true, cancelled: true, rateLimited: false, total: 50, done: 40, ok: 40, failed: 0, missing: 0}});
  c.stRender(); assert.equal(c.stCsv(), true);
  const out = h.exports[0], find = key => out.head.indexOf(key);
  assert.equal(out.rows.length, 30);
  assert.deepEqual(Array.from(out.rows, r => r[1]), Array.from(c.S.st.displayed, r => r.sym));
  assert.equal(out.rows[0][find('收盘快照UTC')], new Date(E).toISOString());
  near(out.rows[0][find('所选周期超额_百分点')], 41);
  assert.equal(out.rows[0][find('BTC7天涨跌幅_百分比')], '');
  assert.equal(out.rows[0][find('7天涨跌幅_百分比')], '');
  assert.equal(out.rows[0][find('数据完整性')], 'partial_history');
  assert.equal(out.rows[0][find('扫描覆盖')], 'cancelled_partial');
  assert.equal(out.rows[0][find('未扫描币种数')], 10);
  c.S.st.run = true; assert.equal(c.stCsv(), false); assert.equal(h.exports.length, 1);
  c.S.st.run = false; c.S.st.rows = []; c.stRender();
  assert.equal(c.stCsv(), false); assert.equal(h.exports.length, 1);
});
