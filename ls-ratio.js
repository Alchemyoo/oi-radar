/* Long/short ratio card for v-detail + Smart-Money vs Retail Divergence metric.
 * Data source: Binance daily metrics archive rows in S.dt.rows + live ls-relay.
 * Exposes globalThis.lsRender(); called from dtLoad/dtOpen hooks in index.html. */
'use strict';
(function () {
  const f4 = v => (v == null || !isFinite(v)) ? '—' : (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(4));
  const pct1 = v => (v == null || !isFinite(v)) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

  const RELAYS = ['https://ls-relay.shen123lan.workers.dev/ls'];
  const RT = { inFlight: null, cache: new Map(), timer: null, retry: 0 };

  function scheduleRefresh(sym) {
    clearTimeout(RT.timer);
    RT.timer = setTimeout(() => {
      if (document.querySelector('#lsBody') && typeof S !== 'undefined' && S.dt && S.dt.sym === sym) lsRender();
    }, 50000);
  }

  function scheduleRetry() {
    if (RT.retry) return;
    RT.retry = 1;
    setTimeout(() => { RT.retry = 0; if (document.querySelector('#lsBody')) lsRender(); }, 12000);
  }

  async function fetchLive(sym) {
    const hit = RT.cache.get(sym);
    if (hit && Date.now() - hit.at < 45000) return { j: hit.j, at: hit.at };
    if (RT.inFlight) return RT.inFlight;
    RT.inFlight = (async () => {
      for (const base of RELAYS) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            if (attempt) await new Promise(r => setTimeout(r, 1500));
            const r = await fetch(base + '?symbol=' + encodeURIComponent(sym), { signal: AbortSignal.timeout(7000) });
            if (!r.ok) continue;
            const j = await r.json();
            if (j && (j.global || j.topAccount || j.topPosition)) {
              const d = { j, at: Date.now() };
              RT.cache.set(sym, d);
              return d;
            }
          } catch (e) { /* retry */ }
        }
      }
      return null;
    })().finally(() => { RT.inFlight = null; });
    return RT.inFlight;
  }

  function series(rows, key) {
    return rows.filter(r => r[key] != null && isFinite(r[key])).map(r => ({ t: r.t, v: r[key] }));
  }

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

  function bar(r) {
    if (!isFinite(r) || r == null || r < 0) return '';
    const lg = r / (1 + r) * 100;
    return `<div class="lsBar"><i style="width:${lg.toFixed(2)}%"></i></div>
      <div class="mut" style="display:flex;justify-content:space-between;font-size:11px;margin-top:2px">多 ${lg.toFixed(2)}%<span>空 ${(100 - lg).toFixed(2)}%</span></div>`;
  }

  function cell(label, v, chg, extraHtml) {
    const cls = chg == null ? '' : (chg > 0 ? 'up' : chg < 0 ? 'down' : '');
    return `<div class="lsCell"><span class="mut">${label}</span><b>${f4(v)} <em class="${cls}" style="font-style:normal;font-size:11px;font-weight:600">${chg == null ? '' : pct1(chg) + ' 24h'}</em></b>${extraHtml || ''}</div>`;
  }

  function pickVal(live, liveKey, last, archKey) {
    const d = live && live[liveKey];
    if (d && isFinite(+d.longShortRatio)) return { v: +d.longShortRatio, t: +d.timestamp, live: true };
    const v = last ? last[archKey] : null;
    return { v: (v == null || !isFinite(v)) ? null : v, t: last ? last.t : 0, live: false };
  }

  function lsBadge(isLive, ts) {
    if (!isLive) return '<span class="mut" style="font-size:11px">归档 T-1</span>';
    const d = new Date(ts || Date.now());
    return `<span class="lsLive"><i></i>实时 · Binance fapi · UTC ${('0' + d.getUTCHours()).slice(-2)}:${('0' + d.getUTCMinutes()).slice(-2)}</span>`;
  }

  function divergenceHtml(tpVal, gVal, takerVal) {
    if (!(tpVal > 0 && gVal > 0)) return '';
    const ratio = tpVal / gVal;
    let cls = 'mut', desc = '大户持仓与全网账户多空倾向接近';
    if (ratio >= 1.20) { cls = 'up'; desc = '正背离：大户持仓偏多而全网散户偏空（主力多头集中）'; }
    else if (ratio <= 0.82) { cls = 'down'; desc = '负背离：全网散户扎堆做多而大户持仓偏空（警惕多头拥挤）'; }
    const takerNote = takerVal != null && isFinite(takerVal)
      ? ` · 主动买卖比 <b class="${takerVal > 1.04 ? 'up' : (takerVal < 0.96 ? 'down' : '')}">${takerVal.toFixed(2)}</b>` : '';
    return `<div class="lsDivBox"><div class="row" style="justify-content:space-between;gap:6px"><span class="mut">主力/全网多空背离度（大户持仓比 ÷ 全网账户比）</span><b class="${cls}" style="font-size:14px">${ratio.toFixed(2)}x</b></div><div class="mut" style="font-size:11px;margin-top:2px"><span class="${cls}">${desc}</span>${takerNote}</div></div>`;
  }

  window.lsRender = function () {
    const el = document.querySelector('#lsBody');
    if (!el) return;
    const stamp = document.querySelector('#lsStamp');
    const dt = (typeof S !== 'undefined') ? S.dt : {};
    const rows = dt.rows || [];
    const sym = dt.sym || '';
    const hit = sym ? RT.cache.get(sym) : null;
    const live = hit ? hit.j : null;
    const stale = sym && (!hit || (Date.now() - hit.at >= 45000));
    if (stale) {
      fetchLive(sym).then(d => { if (d) lsRender(); else scheduleRetry(sym); }).catch(() => scheduleRetry(sym));
    }
    if (!rows.length && !live) {
      if (stamp) stamp.textContent = 'Binance 归档/实时 · 加载中';
      el.innerHTML = '<p class="mut">正在获取实时多空比与 72 小时归档走势…</p>';
      return;
    }
    const last = rows.length ? rows[rows.length - 1] : null;
    const g = pickVal(live, 'global', last, 'ret');
    const ta = pickVal(live, 'topAccount', last, 'top');
    const tp = pickVal(live, 'topPosition', last, 'pos');
    const refDate = new Date(last ? last.t : (g.t || Date.now()));
    if (stamp) stamp.textContent = (g.live ? '实时值 · ' : '') + `最新 UTC ${('0' + (refDate.getUTCMonth() + 1)).slice(-2)}-${('0' + refDate.getUTCDate()).slice(-2)} ${('0' + refDate.getUTCHours()).slice(-2)}:${('0' + refDate.getUTCMinutes()).slice(-2)}`;
    const cut = (last ? last.t : Date.now()) - 72 * 3600000;
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
    const cg = (p, key) => rows.length ? chgMix(rows, key, p.t, p.v) : null;
    const takerCur = last ? last.taker : null;
    const html = `
      <div class="lsMain">
        <div class="row" style="align-items:center;gap:8px;margin-bottom:2px">
          <b class="lsBig">${f4(g.v)}</b>
          <span class="mut">全网账户多空比</span>
          <em class="${cg(g, 'ret') == null ? 'mut' : (cg(g, 'ret') > 0 ? 'up' : 'down')}" style="font-style:normal;font-size:12px;font-weight:600">${cg(g, 'ret') == null ? '' : pct1(cg(g, 'ret')) + ' / 24h'}</em>
          <span style="margin-left:auto">${lsBadge(g.live, g.t)}</span>
        </div>
        ${bar(g.v)}
        ${spark(sp)}
      </div>
      ${divergenceHtml(tp.v, g.v, takerCur)}
      <div class="lsGrid">
        ${cell('大户账户多空比', ta.v, cg(ta, 'top'))}
        ${cell('大户持仓多空比', tp.v, cg(tp, 'pos'))}
        ${cell('Taker 主动买卖比', takerCur, last ? chgMix(rows, 'taker', last.t, takerCur) : null)}
      </div>
      <p class="mut" style="margin-top:8px">口径：Binance 单所；实时值经 vps-01 中继（5m 粒度、40s 缓存），背离度 = 大户持仓多空比 ÷ 全网账户多空比（客观集中度比值）。</p>`;
    el.innerHTML = html;
    if (g.live) scheduleRefresh(sym);
  };
})();
