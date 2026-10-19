/* Long/short ratio card for v-detail. Data source: Binance daily metrics archive rows already
 * loaded into S.dt.rows by the detail loader (5m granularity, T-1). No extra requests.
 * Exposes globalThis.lsRender(); called from dtLoad/dtOpen hooks in index.html. */
'use strict';
(function () {
  const f4 = v => (v == null || !isFinite(v)) ? '—' : (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(4));
  const pct1 = v => (v == null || !isFinite(v)) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

  function series(rows, key) {
    return rows.filter(r => r[key] != null && isFinite(r[key])).map(r => ({ t: r.t, v: r[key] }));
  }

  /* change vs the newest sample at or before (latest - 24h); null when unavailable */
  function chg24(rows, key, lastT) {
    const s = series(rows, key);
    if (s.length < 2) return null;
    const cur = s[s.length - 1].v;
    const cut = lastT - 86400000;
    let prev = null;
    for (let i = s.length - 1; i >= 0; i--) if (s[i].t <= cut) { prev = s[i].v; break; }
    if (prev == null || !isFinite(prev) || prev === 0 || !isFinite(cur)) return null;
    return (cur / prev - 1) * 100;
  }

  function spark(s, w, h) {
    w = w || 320; h = h || 46;
    if (!s || s.length < 2) return '<p class="mut" style="margin:8px 0 0">近 72h 无足够样本</p>';
    const vs = s.map(p => p.v);
    const mn = Math.min(...vs), mx = Math.max(...vs), sp = (mx - mn) || 1;
    const pts = s.map((p, i) =>
      `${(i / (s.length - 1) * w).toFixed(1)},${(h - 4 - (p.v - mn) / sp * (h - 10)).toFixed(1)}`).join(' ');
    const flat = mx === mn;
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;display:block;margin-top:8px"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" stroke="var(--line)" stroke-width="1"/><polyline points="${pts}" fill="none" stroke="var(--blue)" stroke-width="1.6" stroke-linejoin="round"/></svg>`
      .replace('stroke-width="1.6"', flat ? 'stroke-width="1"' : 'stroke-width="1.6"');
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
    const last = rows[rows.length - 1];
    const d = new Date(last.t);
    if (stamp) stamp.textContent = `Binance 归档 · 最新 UTC ${('0' + (d.getMonth() + 1)).slice(-2)}-${('0' + d.getDate()).slice(-2)} ${('0' + d.getHours()).slice(-2)}:${('0' + d.getMinutes()).slice(-2)}`;
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
    const main = series(rows, 'ret');
    const mainV = last.ret;
    const html = `
      <div class="lsMain">
        <div class="row" style="align-items:baseline;gap:8px;margin-bottom:2px">
          <b class="lsBig">${f4(mainV)}</b>
          <span class="mut">全网账户多空比</span>
          <em class="${chg24(rows,'ret',last.t) == null ? '' : (chg24(rows,'ret',last.t) > 0 ? 'up' : 'down')}" style="font-style:normal;font-size:12px;font-weight:600">${pct1(chg24(rows, 'ret', last.t))} / 24h</em>
        </div>
        ${bar(mainV)}
        ${spark(dsampled('ret'))}
      </div>
      <div class="lsGrid">
        ${cell('大户账户多空比', last.top, chg24(rows, 'top', last.t))}
        ${cell('大户持仓多空比', last.pos, chg24(rows, 'pos', last.t))}
        ${cell('Taker 主动买卖比', last.taker, chg24(rows, 'taker', last.t))}
      </div>
      <p class="mut" style="margin-top:8px">口径：Binance 单所归档（5 分钟粒度，T-1 出数）。全网/大户账户比为账户数比，大户持仓比为持仓量比，Taker 为主动买卖量比；&gt;1 表示做多侧占优。CoinGlass 的「全网多空比」为跨交易所聚合值，此处为 Binance 单所口径，不可直接对齐。</p>`;
    el.innerHTML = html;
  };
})();
