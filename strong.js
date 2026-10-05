/* Classic script: load after index.html's inline script; call stBind() once.
 * Returns are ratios; excess is percentage points. stMinVol UI is M USDT.
 * No fetch or automatic scan occurs on script load, bind, or render.
 */
(function () {
  'use strict';
  const HOUR = 3600000;
  const DAYS = [1, 3, 5, 7];
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const price = v => {
    if (v === null || v === undefined || typeof v === 'boolean' || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const esc = v => String(v).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const utc = ms => new Date(ms).toISOString();

  /* Only exact, aligned, completed hourly bars count. Array order is irrelevant.
   * Missing intermediate bars are disclosed, not silently filled. A window
   * uses its two actual endpoint closes, not an index or an earlier substitute.
   * Duplicate timestamps are ambiguous and excluded, even if prices agree.
   */
  function stCalcReturns(klines, E) {
    const ret = {1: null, 3: null, 5: null, 7: null};
    const result = {px: null, ret, validBars: 0, missingBars: 169,
      complete: false, currentValid: false};
    if (!Number.isSafeInteger(E) || (E + 1) % HOUR !== 0 || !Array.isArray(klines)) return result;
    const bars = new Map(), seen = new Set();
    const firstClose = E - 168 * HOUR;
    for (const k of klines) {
      if (!Array.isArray(k) || k.length < 7) continue;
      const open = k[0], close = k[6];
      if (!Number.isSafeInteger(open) || !Number.isSafeInteger(close) ||
          open % HOUR !== 0 || close !== open + HOUR - 1 ||
          close < firstClose || close > E) continue;
      if (seen.has(close)) { bars.delete(close); continue; }
      seen.add(close);
      const p = price(k[4]);
      if (p !== null) bars.set(close, p);
    }
    result.validBars = bars.size;
    result.missingBars = 169 - bars.size;
    result.complete = bars.size === 169;
    result.px = bars.has(E) ? bars.get(E) : null;
    result.currentValid = result.px !== null;
    if (!result.currentValid) return result;
    for (const d of DAYS) {
      const base = bars.get(E - d * 24 * HOUR);
      if (base !== undefined) {
        const r = result.px / base - 1;
        if (Number.isFinite(r)) ret[d] = r;
      }
    }
    return result;
  }

  function stRegime(ret, threshold) {
    if (!finite(ret)) return 'unknown';
    const t = finite(threshold) ? Math.max(0, threshold) : 0.01;
    const epsilon = Number.EPSILON * Math.max(1, Math.abs(ret), t) * 8;
    return ret < -t - epsilon ? 'down' : ret > t + epsilon ? 'up' : 'flat';
  }

  function btcReturn(btc, d) {
    const value = btc && (btc.ret || btc)[d];
    return finite(value) ? value : null;
  }
  function stCandidates(rows, btc, window, mode, order, minVol) {
    const d = Number(window);
    if (!DAYS.includes(d) || !Array.isArray(rows)) return [];
    const br = btcReturn(btc, d);
    mode = ['strong', 'relative', 'all'].includes(mode) ? mode : 'strong';
    if (mode !== 'all' && br === null) return [];
    const minimum = finite(minVol) ? Math.max(0, minVol) : 0;
    const list = rows.filter(r => {
      const v = r && r.ret && r.ret[d];
      if (!r || r.sym === 'BTCUSDT' || !finite(v)) return false;
      if (minimum > 0 && (!finite(r.vol) || r.vol < minimum)) return false;
      return mode === 'all' || (v > br && (mode === 'relative' || v > 0));
    });
    const sign = order === 'asc' ? 1 : -1;
    return list.slice().sort((a, b) => {
      const delta = sign * (a.ret[d] - b.ret[d]);
      return delta || (a.sym < b.sym ? -1 : a.sym > b.sym ? 1 : 0);
    });
  }
  function stRank(rows, btc, window, mode, order, minVol) {
    return stCandidates(rows, btc, window, mode, order, minVol).slice(0, 30);
  }

  S.st = Object.assign({
    run: false, job: null, rows: [], btc: null, E: null, tickerTime: null,
    stats: null, setupError: '', window: 1, mode: 'strong', order: 'desc',
    threshold: 1, minVol: 0, displayed: []
  }, S.st || {});
  const state = () => S.st;
  const text = (sel, value) => { const el = $(sel); if (el) el.textContent = value; };
  const html = (sel, value) => { const el = $(sel); if (el) el.innerHTML = value; };
  const disable = (sel, value) => { const el = $(sel); if (el) el.disabled = value; };
  const modeName = m => ({strong: '逆势上涨', relative: '跑赢BTC', all: '全部币种'}[m]);
  const orderName = o => o === 'asc' ? '跌幅前30' : '涨幅前30';
  const rateLimited = e => /(?:\b429\b|\b418\b|-1003|-1015)/.test(String(e && (e.status || e.message) || e));
  const errorText = e => String(e && e.message || e || '未知错误');
  function setBanner(messages, bad) {
    const el = $('#stBan');
    if (!el) return;
    el.className = 'banner' + (messages.length ? ' on ' + (bad ? 'err' : 'warn') : '');
    el.textContent = messages.join(' ');
  }
  function statusText(st) {
    const j = st.run ? st.job : st.stats;
    if (st.run && j && !j.committed) return '准备扫描：' + j.phase +
      (j.cancelled ? '；已请求停止，等待已发请求结束。' : '（此前快照暂保留）');
    let label = '';
    if (j && j.committed) {
      const stop = j.rateLimited ? '限流停止（部分结果）' : j.cancelled ? '已停止（部分结果）' :
        st.run ? '扫描中' : '扫描完成';
      label = `${stop}：已完成 ${j.done}/${j.total}；成功 ${j.ok}；失败 ${j.failed}；缺少当前收盘K线 ${j.missing}；历史不完整 ${j.short}；未扫描 ${j.total - j.done}。`;
      if (!st.run && j.total > 0 && j.ok === 0) label += ' 无有效币种数据。';
      if (!st.run && j.total === 0) label += ' 当前没有符合条件的非BTC USDT永续。';
    } else label = '点击「扫描全市场」，扫描全部交易中 USDT 永续（不含BTC），不使用短名单。';
    if (st.setupError) label = '本次准备失败：' + st.setupError + '。此前成功快照未更改。 ' + label;
    if (st.notice) label = st.notice + ' ' + label;
    return label;
  }

  function stRender() {
    const st = state(), d = st.window, br = btcReturn(st.btc, d);
    const regime = stRegime(br, st.threshold / 100);
    const eligible = stCandidates(st.rows, st.btc, d, st.mode, st.order, st.minVol);
    st.displayed = eligible.slice(0, 30);
    disable('#stGo', st.run);
    disable('#stStop', !st.run || !!(st.job && st.job.cancelled));
    disable('#stCsv', st.run || st.displayed.length === 0);
    text('#stTime', st.E === null ? '待扫描' : '收盘快照 UTC ' + utc(st.E));
    text('#stStat', statusText(st));
    $$('#stWin button[data-d]').forEach(b => b.classList.toggle('on', Number(b.dataset.d) === d));
    $$('#stMode button[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === st.mode));
    $$('#stOrder button[data-o]').forEach(b => b.classList.toggle('on', b.dataset.o === st.order));
    $$('#stTbl th[data-d]').forEach(th => {
      const selected = Number(th.dataset.d) === d;
      th.classList.toggle('sd', selected && st.order === 'desc');
      th.classList.toggle('sa', selected && st.order === 'asc');
      th.setAttribute('aria-sort', selected ? (st.order === 'asc' ? 'ascending' : 'descending') : 'none');
    });
    html('#stBtc', DAYS.map(w => `<span class="chip">BTC ${w}天 <b class="${clsP(btcReturn(st.btc, w))}">${fP(btcReturn(st.btc, w))}</b></span>`).join(''));
    text('#stEnv', `BTC环境（${d}天，阈值 ±${st.threshold}%）：` +
      ({unknown: '数据不足', down: '下跌', flat: '震荡', up: '上涨'}[regime]));
    const sample = DAYS.map(w => `<span class="chip">${w}天样本 <b>${st.rows.filter(r => finite(r.ret[w])).length}</b></span>`).join('');
    html('#stMeta', sample + `<span class="chip">符合筛选 <b>${eligible.length}</b></span><span class="chip">展示 <b>${st.displayed.length}</b></span>`);
    const messages = [];
    if (st.run && st.job && !st.job.committed && st.E !== null) messages.push('正在准备新扫描，表格仍为此前快照。');
    if (regime === 'up') messages.push('当前不是BTC弱势周期：BTC所选周期上涨，排名仍可查看，不代表历史弱势条件筛选或逐日回测。');
    if (br === null && st.E !== null) messages.push('BTC所选周期历史不足；逆势上涨/跑赢BTC无可比较排名，全部币种仍可查看自身涨跌幅。');
    const j = st.run ? st.job : st.stats;
    if (j && j.rateLimited) messages.push('收到 Binance 429/418 或请求限流：已停止启动新请求，等待在途请求；以下仅为部分结果。');
    else if (j && j.cancelled && j.committed) messages.push('扫描已取消，已完成数据为部分样本，不是全市场最终排名。');
    if (st.setupError) messages.push('准备失败：' + st.setupError);
    if (st.notice) messages.push(st.notice);
    if (st.order === 'asc' && st.mode !== 'all') messages.push('当前跌幅方向为「' + modeName(st.mode) + '」筛选内排名；全市场跌幅请选「全部币种」。');
    setBanner(messages, !!st.setupError || !!(j && j.rateLimited));
    const bar = $('#stBar');
    if (bar) bar.classList.toggle('on', st.run);
    const fill = $('#stBar i');
    if (fill) fill.style.width = ((j && j.total > 0) ? Math.min(100, j.done / j.total * 100) : 0) + '%';
    const reason = st.E === null ? '点击「扫描全市场」后显示排名；加载标签不会自动扫描。' :
      br === null && st.mode !== 'all' ? 'BTC所选周期缺少历史，无法比较。' :
      st.run && !st.rows.length ? '扫描中，等待有效币种K线…' :
      !st.rows.length ? '无有效币种数据；查看扫描失败/缺失统计。' : '所选周期或筛选条件下无符合币种（缺失数据不以0补齐）。';
    html('#stTbl tbody', st.displayed.map((r, i) => {
      const excess = br === null ? null : (r.ret[d] - br) * 100;
      const pp = excess === null ? '—' : (excess >= 0 ? '+' : '') + excess.toFixed(2);
      return `<tr><td>${i + 1}</td><td><a data-st-sym="${esc(r.sym)}">${esc(r.sym)}</a></td><td>${fPrice(r.px)}</td>` +
        DAYS.map(w => `<td class="${clsP(r.ret[w])}">${fP(r.ret[w])}</td>`).join('') +
        `<td class="${clsP(excess)}">${pp}</td><td>${finite(r.vol) ? fC(r.vol) : '—'}</td></tr>`;
    }).join('') || `<tr><td colspan="9" style="text-align:center;color:var(--dim);padding:22px">${esc(reason)}</td></tr>`);
  }

  function apiError(data) {
    if (data && !Array.isArray(data) && data.code !== undefined && Number(data.code) < 0)
      throw new Error('Binance ' + data.code + ': ' + (data.msg || '请求失败'));
    return data;
  }
  async function hourly(sym, E) {
    const start = E + 1 - 169 * HOUR;
    const data = apiError(await jget(`${API}/fapi/v1/klines?symbol=${encodeURIComponent(sym)}&interval=1h&limit=170&startTime=${start}&endTime=${E}`, 30000));
    if (!Array.isArray(data)) throw new Error('K线响应不是数组');
    return stCalcReturns(data, E);
  }
  async function stScan() {
    const st = state();
    if (st.run) return;
    const job = {phase: '获取币安服务器时间', committed: false, cancelled: false,
      rateLimited: false, total: 0, done: 0, ok: 0, failed: 0, missing: 0, short: 0};
    st.run = true; st.job = job; st.setupError = ''; st.notice = '';
    stRender();
    try {
      const clock = apiError(await jget(API + '/fapi/v1/time', 30000));
      if (job.cancelled) return;
      const serverTime = clock && clock.serverTime;
      if (!Number.isSafeInteger(serverTime) || serverTime < HOUR)
        throw new Error('服务器时间无效');
      const E = Math.floor(serverTime / HOUR) * HOUR - 1;
      job.phase = '获取同一收盘快照的BTC基准'; stRender();
      const btc = await hourly('BTCUSDT', E);
      if (job.cancelled) return;
      if (!btc.currentValid) throw new Error('BTC缺少快照时点的有效已收盘K线');
      job.phase = '刷新全部交易中USDT永续列表'; stRender();
      const raw = await loadSyms();
      if (job.cancelled) return;
      if (!Array.isArray(raw) || !raw.length || raw.some(sym => typeof sym !== 'string' || !sym.endsWith('USDT')))
        throw new Error('全市场合约列表无效或为空');
      const syms = [...new Set(raw)].filter(sym => sym !== 'BTCUSDT');
      job.phase = '刷新滚动24h成交额（仅作背景/成交额筛选）'; stRender();
      const tick = await loadTickers();
      if (job.cancelled) return;
      if (!tick || typeof tick !== 'object' || Array.isArray(tick)) throw new Error('24h行情响应无效');
      const tickerTime = Date.now();
      /* Transaction boundary: never combine old rows/BTC/tickers with a new E.
       * Setup failure/cancellation preserves the entire previous scan instead.
       */
      st.rows = []; st.btc = btc; st.E = E; st.tickerTime = tickerTime;
      job.total = syms.length; job.committed = true; st.stats = job;
      stRender();
      let lastRender = 0;
      await pool(syms, 6, async sym => {
        try {
          const calc = await hourly(sym, E);
          if (!calc.currentValid) job.missing++;
          else {
            const v = tick[sym] && tick[sym].vol;
            const vol = finite(v) && v >= 0 ? v : null;
            st.rows.push(Object.assign({sym, vol}, calc));
            job.ok++;
            if (!calc.complete) job.short++;
          }
        } catch (e) {
          job.failed++;
          if (rateLimited(e)) { job.rateLimited = true; job.cancelled = true; }
          job.lastError = errorText(e);
        } finally {
          job.done++;
          /* Request progress updates immediately; costly table updates <=4/s. */
          text('#stStat', statusText(st));
          const fill = $('#stBar i');
          if (fill) fill.style.width = (job.total ? job.done / job.total * 100 : 0) + '%';
          if (Date.now() - lastRender >= 250 || job.cancelled) {
            lastRender = Date.now(); stRender();
          }
        }
      }, () => job.cancelled);
    } catch (e) {
      if (rateLimited(e)) { job.rateLimited = true; job.cancelled = true; }
      st.setupError = errorText(e);
      if (job.rateLimited) st.setupError += '；限流，已停止新请求';
    } finally {
      st.run = false;
      if (job.committed) st.stats = job;
      else if (job.cancelled && !st.setupError)
        st.notice = '本次扫描已停止（准备阶段，未提交新数据）；此前快照保留。';
      st.job = null;
      stRender();
    }
  }

  function stCsv() {
    const st = state();
    if (st.run) { toast('扫描运行中，不能导出未完成排名'); return false; }
    const ranked = stRank(st.rows, st.btc, st.window, st.mode, st.order, st.minVol);
    if (!ranked.length || st.E === null) { toast('暂无可导出的排名'); return false; }
    const d = st.window, br = btcReturn(st.btc, d), stats = st.stats;
    const coverage = stats && stats.rateLimited ? 'rate_limited_partial' :
      stats && stats.cancelled ? 'cancelled_partial' :
      stats && (stats.failed > 0 || stats.missing > 0) ? 'completed_partial_data' : 'completed';
    const pct = v => finite(v) ? v * 100 : '';
    const head = ['排名', '币种', '收盘快照UTC', '排名周期_天', '筛选模式', '排序',
      '最低24h成交额_USDT', 'BTC震荡阈值_百分比', '快照价格_USDT',
      '1天涨跌幅_百分比', '3天涨跌幅_百分比', '5天涨跌幅_百分比', '7天涨跌幅_百分比',
      'BTC1天涨跌幅_百分比', 'BTC3天涨跌幅_百分比', 'BTC5天涨跌幅_百分比', 'BTC7天涨跌幅_百分比',
      '所选周期超额_百分点', '滚动24h成交额_USDT', '成交额获取时间UTC_非收盘快照',
      '有效小时K线_共169根', '有效收益周期_共4个', '数据完整性', '扫描覆盖',
      '成功币种数', '失败币种数', '缺少当前K线数', '未扫描币种数'];
    const rows = ranked.map((r, i) => [i + 1, r.sym, utc(st.E), d,
      modeName(st.mode), orderName(st.order), st.minVol, st.threshold, r.px,
      ...DAYS.map(w => pct(r.ret[w])), ...DAYS.map(w => pct(btcReturn(st.btc, w))),
      br === null ? '' : (r.ret[d] - br) * 100, r.vol,
      st.tickerTime === null ? '' : utc(st.tickerTime), r.validBars,
      DAYS.filter(w => finite(r.ret[w])).length, r.complete ? 'complete' : 'partial_history',
      coverage, stats ? stats.ok : '', stats ? stats.failed : '', stats ? stats.missing : '',
      stats ? stats.total - stats.done : '']);
    csvDown(`strong-${d}d-${st.mode}-${st.order}-${utc(st.E).replace(/[:.]/g, '-')}.csv`, head, rows);
    return true;
  }

  function stBind(render=true) {
    const st = state();
    const bind = (sel, event, fn) => { const el = $(sel); if (el) el[event] = fn; };
    bind('#stGo', 'onclick', stScan);
    bind('#stStop', 'onclick', () => {
      if (st.run && st.job) { st.job.cancelled = true; stRender(); }
    });
    bind('#stCsv', 'onclick', stCsv);
    $$('#stWin button[data-d]').forEach(b => { b.onclick = () => {
      const d = Number(b.dataset.d); if (DAYS.includes(d)) { st.window = d; stRender(); }
    }; });
    $$('#stTbl th[data-d]').forEach(th => { th.onclick = () => {
      const d = Number(th.dataset.d); if (DAYS.includes(d)) { st.window = d; stRender(); }
    }; });
    $$('#stMode button[data-m]').forEach(b => { b.onclick = () => {
      if (['strong', 'relative', 'all'].includes(b.dataset.m)) { st.mode = b.dataset.m; stRender(); }
    }; });
    $$('#stOrder button[data-o]').forEach(b => { b.onclick = () => {
      if (['asc', 'desc'].includes(b.dataset.o)) {
        st.order = b.dataset.o;
        if (st.order === 'asc') st.mode = 'all';
        stRender();
      }
    }; });
    const threshold = $('#stThreshold'), volume = $('#stMinVol');
    if (threshold) {
      threshold.value = st.threshold;
      threshold.onchange = () => {
        const n = Number(threshold.value);
        st.threshold = Number.isFinite(n) ? Math.max(0, Math.min(20, n)) : 1;
        threshold.value = st.threshold; stRender();
      };
    }
    if (volume) {
      volume.value = st.minVol / 1e6;
      volume.onchange = () => {
        const n = Number(volume.value);
        st.minVol = Number.isFinite(n) ? Math.max(0, Math.min(100000, n)) * 1e6 : 0;
        volume.value = st.minVol / 1e6; stRender();
      };
    }
    bind('#stTbl tbody', 'onclick', e => {
      const link = e.target && e.target.closest && e.target.closest('[data-st-sym]');
      if (link) jumpSym(link.dataset.stSym);
    });
    if (render) stRender();
  }

  /* Globals needed by the parent classic script and Node vm tests. */
  Object.assign(globalThis, {stCalcReturns, stRegime, stRank, stBind, stRender, stScan, stCsv});
})();
