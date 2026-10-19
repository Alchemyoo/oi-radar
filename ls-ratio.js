/* Long/short ratio card for v-detail. Data source: Binance daily metrics archive rows already
 * loaded into S.dt.rows by the detail loader (5m granularity, T-1) — sparkline & 24h change.
 * Latest snapshot: ls-relay (vps-01 live relay via https://ls-relay.shen123lan.workers.dev,
 * direct http://3.107.187.97:3435 as fallback); falls back to archive when unreachable.
 * Exposes globalThis.lsRender(); called from dtLoad/dtOpen hooks in index.html. */
'use strict';
(function () {
  const f4 = v => (v == null || !isFinite(v)) ? '—' : (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(4));
  const pct1 = v => (v == null || !isFinite(v)) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

  const RELAYS = ['https://ls-relay.shen123lan.workers.dev/ls',
                  'http://3.107.187.97:3435/ls'];
  const RT = { inFlight: null, cache: new Map() };   /* sym → {j, at} */

  async function fetchLive(sym) {
    const hit = RT.cache.get(sym);
    if (hit && Date.now() - hit.at < 45000) return { j: hit.j, at: hit.at };
    if (RT.inFlight) return RT.inFlight;
    RT.inFlight = (async () => {
      for (const base of RELAYS) {
        try {
          const r = await fetch(base + '?symbol=' + encodeURIComponent(sym), { signal: AbortSignal.timeout(7000) });
          if (!r.ok) continue;
          const j = await r.json();
          if (j && (j.global || j.topAccount || j.topPosition)) {
            const d = { j, at: Date.now() };
            RT.cache.set(sym, d);
            return d;
          }
        } catch (e) { /* try next relay */ }
      }
      return null;
    })().finally(() => { RT.inFlight = null; });
    return RT.inFlight;
  }

  function series(rows, key) {
    return rows.filter(r => r[key] != null && isFinite(r[key])).map(r => ({ t: r.t, v: r[key] }));
  }

  /* change of `cur` value vs the archive sample ~24h before refT */
  function chgMix(rows, archKey, refT, cur) {
    const s = series(rows, archKey);
    if (cur == null || !isFinite(cur)) return null;
    const cut = refT - 86400000;
    let prev = null;
    for (let i = s.length - 1; i >= 0; i--) if (s[i].t <= cut) { prev = s[i].v; break; }
    if (prev == null || !isFinite(prev) || prev === 0) return null;
    return (cur / prev - 1) * 100;
  }

  function spark(s, w, h) {
    w = w || 320; h = h || 46;
    if (!s || s.length < 2) return '<p class="mut" style="margin:8px 0 0">近 72h 无足够样本</p>';
    const vs = s.map(p => p.v);
    const mn = Math.min(...vs), mx = Math.max(...vs), sp = (mx - mn) || 1;
    const pts = s.map((p, i) =>
      `${(i / (s.length - 1) * w).toFixed(1)},${(h - 4 - (p.v - mn) / sp * (h - 10)).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;display:block;margin-top:8px"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" stroke="var(--line)" stroke-width="1"/><polyline points="${pts}" fill="none" stroke="var(--blue)" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }

  /* long/short share bar from an account ratio r: long% = r/(1+r) */
  function bar(r) {
    if (!isFinite(r) || r == null || r < 0) return '';
    const lg = r / (1 + r) * 100;
    return `<div class="lsBar"><i style="width:${lg.toFixed(2)}%"></i></div>
      <div class="mut" style="display:flex;justify-content:space-between;font-size:11px;margin-top:2px">多 ${lg.toFixed(2)}%<span>空 ${(100 - lg).toFixed(2)}%</span></div>`;
  }

  function cell(label, v, chg) {
    const cls = chg == null ? '' : (chg > 0 ? 'up' : chg < 0 ? 'down' : '');
    return `<div class="lsCell"><span class="mut">${label}</span><b>${f4(v)} <em class="${cls}" style="font-style:normal;font-size:11px;font-weight:600">${chg == null ? '' : pct1(chg) + ' 24h'}</em></b></div>`;
  }

  /* One value: live snapshot preferred, archive as fallback. */
  function pickVal(live, liveKey, last, archKey) {
    const d = live && live[liveKey];
    if (d && isFinite(+d.longShortRatio)) return { v: +d.longShortRatio, t: +d.timestamp, live: true };
    const v = last[archKey];
    return { v: (v == null || !isFinite(v)) ? null : v, t: last.t, live: false };
  }

  function lsBadge(isLive, ts) {
    if (!isLive) return '<span class="mut" style="font-size:11px">归档 T-1</span>';
    const d = new Date(ts || Date.now());
    return `<span class="lsLive"><i></i>实时 · Binance fapi · UTC ${('0' + d.getUTCHours()).slice(-2)}:${('0' + d.getUTCMinutes()).slice(-2)}</span>`;
  }

  window.lsRender = function () {
    const el = document.querySelector('#lsBody');
    if (!el) return;
    const stamp = document.querySelector('#lsStamp');
    const dt = (typeof S !== 'undefined') ? S.dt : {};
    const rows = dt.rows || [];
    if (!rows.length) {
      if (stamp) stamp.textContent = 'Binance 归档 · 待加载';
      el.innerHTML = '<p class="mut">加载单币明细后，显示 Binance 全网账户多空比、大户账户/持仓多空比的最新值与 72 小时走势。</p>';
      return;
    }
    const sym = dt.sym || '';
    const live = (RT.cache.get(sym) || {}).j || null;
    if (!live) fetchLive(sym).then(d => { if (d) lsRender(); }).catch(() => {});
    const last = rows[rows.length - 1];
    const d = new Date(last.t);
    const g = pickVal(live, 'global', last, 'ret');
    const ta = pickVal(live, 'topAccount', last, 'top');
    const tp = pickVal(live, 'topPosition', last, 'pos');
    if (stamp) stamp.textContent = (g.live ? '实时值 · ' : '') + `Binance 归档 · 最新 UTC ${('0' + (d.getMonth() + 1)).slice(-2)}-${('0' + d.getDate()).slice(-2)} ${('0' + d.getHours()).slice(-2)}:${('0' + d.getMinutes()).slice(-2)}`;
    const cut = last.t - 72 * 3600000;
    const dsampled = key => {
      const s = series(rows, key), out = [];
      let bucket = -1;
      for (const p of s) {
        if (p.t < cut) continue;
        const b = Math.floor(p.t / 1800000);
        if (b !== bucket) { out.push(p); bucket = b; } else out[out.length - 1] = { t: p.t, v: p.v };
      }
      return out;
    };
    let sp = dsampled('ret');
    if (g.live && g.t > (sp.length ? sp[sp.length - 1].t : 0)) sp = sp.concat([{ t: g.t, v: g.v }]);
    const cg = (p, key) => chgMix(rows, key, p.t, p.v);
    const html = `
      <div class="lsMain">
        <div class="row" style="align-items:center;gap:8px;margin-bottom:2px">
          <b class="lsBig">${f4(g.v)}</b>
          <span class="mut">全网账户多空比</span>
          <em class="${cg(g, 'ret') == null ? 'mut' : (cg(g, 'ret') > 0 ? 'up' : 'down')}" style="font-style:normal;font-size:12px;font-weight:600">${pct1(cg(g, 'ret'))} / 24h</em>
          <span style="margin-left:auto">${lsBadge(g.live, g.t)}</span>
        </div>
        ${bar(g.v)}
        ${spark(sp)}
      </div>
      <div class="lsGrid">
        ${cell('大户账户多空比', ta.v, cg(ta, 'top'))}
        ${cell('大户持仓多空比', tp.v, cg(tp, 'pos'))}
        ${cell('Taker 主动买卖比', last.taker, chgMix(rows, 'taker', last.t, last.taker))}
      </div>
      <p class="mut" style="margin-top:8px">口径：Binance 单所。全网/大户账户比为账户数比，大户持仓比为持仓量比，Taker 为主动买卖量比；&gt;1 表示做多侧占优。实时值经 vps-01 中继直读 Binance fapi（5 分钟粒度，40s 缓存）；走势与 24h 变化基于 daily 归档。CoinGlass 的「全网多空比」为跨交易所聚合，此处为 Binance 单所口径，不可直接对齐。</p>`;
    el.innerHTML = html;
  };
})();
