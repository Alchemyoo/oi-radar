/* Pure rolling24 v2; separate from legacy UTC-day algorithms. No IO or clock. */
(function(root){
  'use strict';
  const STEP=300000,DAY=86400000,LAG=600000;
  const SOURCE='https://www.binance.com/futures/data/openInterestHist';
  const PRICE_SOURCE='https://www.binance.com/fapi/v1/klines';
  function fail(code){const e=new Error(code);e.code=code;throw e}
  const integer=x=>Number.isSafeInteger(x)&&x>0;
  function positive(x){
    if(typeof x!=='number'&&typeof x!=='string')fail('invalid_number');
    if(typeof x==='string'&&!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(x))fail('invalid_number');
    const n=Number(x);if(!Number.isFinite(n)||n<=0)fail('invalid_number');return n;
  }
  function symbols(xs){
    if(!Array.isArray(xs)||!xs.length||xs.length>50||new Set(xs).size!==xs.length||xs.some(s=>typeof s!=='string'||s.length>40||!s.endsWith('USDT')||/[\u0000-\u0020\u007f/?#&\\]/.test(s)))fail('invalid_symbols');return xs;
  }
  function clock(now){if(!integer(now))fail('invalid_now')}
  function timestamp(t,now){if(!integer(t)||t%STEP)fail('unaligned_5m');if(t>now)fail('future_5m')}
  function windowCheck(w,now){
    clock(now);if(!w||w.mode!=='rolling24'||w.period!=='5m'||w.durationMs!==DAY)fail('invalid_window');
    timestamp(w.startMs,now);timestamp(w.endMs,now);
    if(w.endMs-w.startMs!==DAY)fail('not_exact_24h');
    if(now-w.endMs>LAG)fail('stale_end');return w;
  }
  function candidates(items,wanted,now){
    symbols(wanted);clock(now);if(!Array.isArray(items)||items.length!==wanted.length)fail('missing_symbol');
    const seen=new Set(),sets=[];
    for(const x of items){
      if(!x||!wanted.includes(x.symbol)||seen.has(x.symbol))fail('duplicate_or_missing_symbol');seen.add(x.symbol);
      if(!Array.isArray(x.timestamps)||!x.timestamps.length||x.timestamps.length>16)fail('invalid_candidates');
      let last=0;for(const t of x.timestamps){timestamp(t,now);if(t<=last)fail('duplicate_or_unsorted_timestamp');last=t}
      sets.push(new Set(x.timestamps));
    }
    const common=[...sets[0]].filter(t=>sets.every(s=>s.has(t)));if(!common.length)fail('no_common_end');
    const endMs=Math.max(...common);return windowCheck({mode:'rolling24',period:'5m',durationMs:DAY,startMs:endMs-DAY,endMs},now);
  }
  function commonWindow(items,wanted,now){
    if(!Array.isArray(items))fail('missing_symbol');
    return candidates(items.map(x=>{
      if(!x||!Array.isArray(x.data)||!x.data.length)fail('invalid_history');
      for(const r of x.data){if(!r||r.symbol!==x.symbol)fail('missing_symbol');positive(r.sumOpenInterest);positive(r.sumOpenInterestValue)}
      return {symbol:x.symbol,timestamps:x.data.map(r=>r.timestamp)};
    }),wanted,now);
  }
  function oiPair(item,w,now){
    windowCheck(w,now);
    if(!item||typeof item.symbol!=='string'||!Array.isArray(item.data)||item.data.length!==2||item.sampleCount!==2)fail('invalid_endpoint_count');
    const a=item.data[0],b=item.data[1];
    if(!a||!b||a.symbol!==item.symbol||b.symbol!==item.symbol)fail('missing_symbol');
    if(a.timestamp!==w.startMs||b.timestamp!==w.endMs)fail('missing_exact_endpoint');
    return {oiS:positive(a.sumOpenInterestValue),oiE:positive(b.sumOpenInterestValue),coinS:positive(a.sumOpenInterest),coinE:positive(b.sumOpenInterest)};
  }
  function pricePair(item,w,now){
    windowCheck(w,now);if(!item||!Array.isArray(item.prices)||item.prices.length!==2)fail('invalid_price_count');
    const vals=item.prices.map((p,i)=>{
      const t=i?w.endMs:w.startMs;
      if(!p||p.source!==PRICE_SOURCE||p.timestamp!==t||p.openTime!==t-STEP||p.closeTime!==t-1||p.closeTime>=now)fail('price_not_closed_same_window');
      return positive(p.close);
    });return {priceS:vals[0],priceE:vals[1],px:(vals[1]/vals[0]-1)*100};
  }
  function validateResult(r,wanted,now){
    symbols(wanted);clock(now);
    if(!r||r.schemaVersion!==2||r.mode!=='rolling24'||r.period!=='5m'||r.source!==SOURCE||JSON.stringify(r.symbols)!==JSON.stringify(wanted)||'limit' in r)fail('contract_mismatch');
    if(!integer(r.serverTime)||!integer(r.receivedAt)||r.serverTime>now||r.receivedAt>now||r.receivedAt<r.serverTime||r.receivedAt-r.serverTime>55000||now-r.receivedAt>120000)fail('invalid_result_time');
    windowCheck(r.window,now);windowCheck(r.window,r.serverTime);
    if(!Array.isArray(r.results)||r.results.length!==wanted.length||!Array.isArray(r.errors)||r.errors.length)fail('incomplete_universe');
    const selected=candidates(r.results.map(x=>({symbol:x.symbol,timestamps:x.candidateTimestamps})),wanted,r.serverTime);
    if(selected.endMs!==r.window.endMs)fail('not_latest_common_end');
    const seen=new Set();return r.results.map(x=>{
      if(!x||!wanted.includes(x.symbol)||seen.has(x.symbol))fail('duplicate_or_missing_symbol');seen.add(x.symbol);
      if(!integer(x.fetchedAt)||x.fetchedAt>r.receivedAt||x.fetchedAt<r.serverTime)fail('invalid_fetched_at');
      const a=oiPair(x,r.window,now),p=pricePair(x,r.window,now);
      const out={sym:x.symbol,...a,...p,flow:a.oiE-a.oiS,net:(a.oiE/a.oiS-1)*100,coinNet:(a.coinE/a.coinS-1)*100,z:null,next:null,src:'relay-rolling24-v2',priceSource:PRICE_SOURCE,startMs:r.window.startMs,endMs:r.window.endMs};
      if(![out.flow,out.net,out.coinNet,out.px].every(Number.isFinite))fail('nonfinite_change');return out;
    });
  }
  function pick(row,p,mode='pct'){
    if(mode!=='pct')fail('sigma_unsupported');
    if(!p||![p.oiPct,p.pxPct,p.minOi].every(Number.isFinite)||p.pxPct<0||p.minOi<0)fail('invalid_thresholds');
    if(!row||![row.oiS,row.coinNet,row.px].every(Number.isFinite))fail('incomplete_row');
    return row.coinNet>=p.oiPct&&Math.abs(row.px)<=p.pxPct&&row.oiS>=p.minOi;
  }
  const api={STEP,DAY,LAG,SOURCE,PRICE_SOURCE,commonWindow,windowCheck,oiPair,pricePair,validateResult,pick};
  root.RollingOI=Object.freeze(api);if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:this);
