/* Public data only; explicit IDs, no symbol-only provider matching. */
(function(root){
'use strict';
const API='https://www.binance.com',STEP=300000,HOUR=3600000;
const IDS={BTC:'bitcoin',ETH:'ethereum',BNB:'binancecoin',SOL:'solana',XRP:'ripple',DOGE:'dogecoin',ADA:'cardano',AVAX:'avalanche-2',LINK:'chainlink',DOT:'polkadot',LTC:'litecoin',BCH:'bitcoin-cash',TRX:'tron',UNI:'uniswap',AAVE:'aave',SUI:'sui',APT:'aptos',NEAR:'near',ATOM:'cosmos',ETC:'ethereum-classic',FIL:'filecoin',OP:'optimism',ARB:'arbitrum',INJ:'injective-protocol',SEI:'sei-network',TON:'the-open-network',WLD:'worldcoin-wld',ORCA:'orca',AXS:'axie-infinity',GTC:'gitcoin'};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function identity(sym){if(typeof sym!=='string'||!sym.endsWith('USDT'))return null;const base=sym.slice(0,-4);return IDS[base]?{base,id:IDS[base],multiplier:1}:null}
function windowAt(t){if(!finite(t)||t<=0)throw Error('交易所时间无效');const end=Math.floor(t/STEP)*STEP;return {start:end-HOUR,end}}
function sample(rows,w){
 if(!Array.isArray(rows))throw Error('持仓接口响应无效');
 const at=t=>rows.filter(r=>+r.timestamp===t);
 const a=at(w.start),b=at(w.end);if(a.length!==1||b.length!==1)throw Error('1H精确端点缺失');
 const start=Number(a[0].sumOpenInterest),end=Number(b[0].sumOpenInterest),notional=Number(b[0].sumOpenInterestValue);
 if(!finite(start)||start<=0||!finite(end)||end<=0||!finite(notional)||notional<=0)throw Error('持仓数值无效');
 const growth=(end/start-1)*100;if(!finite(growth))throw Error('持仓变化无效');return {growth,notional};
}
function ranks(rows){const growth=rows.filter(r=>finite(r.growth)&&r.growth>0).sort((a,b)=>b.growth-a.growth||a.sym.localeCompare(b.sym)).slice(0,5);
 const ratio=rows.filter(r=>finite(r.ratio)&&r.ratio>=0).sort((a,b)=>b.ratio-a.ratio||a.sym.localeCompare(b.sym)).slice(0,5);
 const set=new Set(ratio.map(r=>r.sym));return {growth,ratio,resonance:growth.filter(r=>set.has(r.sym)).map(r=>r.sym)};}
function validateCache(d,now,range){
 if(!d||d.schemaVersion!==1||!finite(d.generatedAt)||!finite(d.expiresAt)||d.generatedAt>now+60000||d.expiresAt<=now||now-d.generatedAt>900000)throw Error('同源OI缓存缺失或过期');
 const w=d.window;if(!w||!finite(w.start)||!finite(w.end)||w.end-w.start!==HOUR||w.start%STEP||w.end%STEP||w.end>now+60000||now-w.end>900000)throw Error('缓存1H窗口无效或过期');
 if(!d.scope||d.scope.type!=='quoteVolumeTop'||d.scope.limit!==range||!Array.isArray(d.scope.symbols)||d.scope.symbols.length>range||new Set(d.scope.symbols).size!==d.scope.symbols.length)throw Error('缓存范围与当前Top选择不一致');
 if(!Array.isArray(d.rows)||!Array.isArray(d.errors)||!d.sources?.oi?.startsWith('https://www.binance.com/futures/data/openInterestHist'))throw Error('缓存来源或格式无效');
 const seen=new Set();const rows=d.rows.map(r=>{
  if(!r||seen.has(r.sym)||!d.scope.symbols.includes(r.sym)||!finite(r.coinStart)||r.coinStart<=0||!finite(r.coinEnd)||r.coinEnd<=0||!finite(r.notional)||r.notional<=0)throw Error('缓存持仓行无效');seen.add(r.sym);
  const growth=(r.coinEnd/r.coinStart-1)*100;if(!finite(growth)||!finite(r.growth)||Math.abs(growth-r.growth)>1e-7)throw Error('缓存持仓变化不一致');
  const asset=identity(r.sym),ok=asset&&asset.id===r.capId&&finite(r.marketCap)&&r.marketCap>0&&finite(r.capTime)&&r.capTime>0&&r.capTime<=now+60000&&now-r.capTime<=900000;
  const ratio=ok?r.notional/r.marketCap*100:null;return {...r,growth,ratio:finite(ratio)?ratio:null};
 });
 return {rows,w,expiresAt:Math.min(d.expiresAt,d.generatedAt+900000,w.end+900000),total:d.scope.symbols.length,errors:d.errors.map(x=>String(x.sym)+': '+String(x.reason)),updated:d.generatedAt,capError:d.capError||'',source:'官方API → 同源缓存',publicationLagMs:d.publicationLagMs||0};
}
async function request(url,signal){const ctl=new AbortController(),abort=()=>ctl.abort();if(signal?.aborted)throw Object.assign(Error('已停止'),{name:'AbortError'});signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,18000);
 try{const res=await fetch(url,{signal:ctl.signal});if(!res.ok){const e=Error('HTTP '+res.status);e.status=res.status;e.retryAfter=Number(res.headers.get('Retry-After'))||60;throw e}return await res.json()}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
function init(host,deps={}){
 if(!host)return null;let generation=0,ctl=null,cooldown=0,expiryTimer=null;
 function expireSnapshot(){if(state.source==='官方API → 同源缓存'&&state.expiresAt&&Date.now()>=state.expiresAt){state.rows=[];state.capError='官方OI快照已过期，已撤下双榜；请更新，不代表无异动';render();}}
 const state={running:false,range:50,rows:[],errors:[],capError:'',updated:0,w:null,total:0,done:0,source:'浏览器直连',publicationLagMs:0};
 const get=deps.fetchJSON||request;
 const symbol=s=>esc(s.replace(/USDT$/,''));
 function render(){
  const r=ranks(state.rows),set=new Set(r.resonance);
  const line=(x,kind)=>`<li><button type="button" data-cap-symbol="${esc(x.sym)}" class="${set.has(x.sym)?'resonant':''}">${symbol(x.sym)} ${set.has(x.sym)?'<small>共振</small>':''}</button><b class="${kind}">${kind==='growth'?'+':''}${(kind==='growth'?x.growth:x.ratio).toFixed(1)}%</b></li>`;
  const coverage=state.rows.filter(x=>finite(x.ratio)).length;
  host.innerHTML=`<section class="cap-radar"><header><h3>OI / 市值雷达</h3><button data-cap-action="settings" aria-label="榜单设置" title="榜单设置">⚙</button></header><div class="cap-resonance"><strong>${r.resonance.length?r.resonance.map(symbol).join(' · '):'暂无共振'}</strong><span>双榜共振</span></div><details class="cap-settings" ${state.settings?'open':''}><summary>范围与口径</summary><label>成交额范围 <select data-cap-range><option value="50" ${state.range===50?'selected':''}>Top50</option><option value="100" ${state.range===100?'selected':''}>Top100</option></select></label><p>1H增长按持仓币数；占比=窗口终点OI名义USD / 流通市值USD ×100%，不是资金流或投入比例，可超过100%。两榜交集只是排名重合。</p><p>Binance 5m精确端点；CoinGecko明确ID映射，仅${Object.keys(IDS).length}种已登记资产。倍数合约、未登记资产不猜市值。不是全市场排名。</p></details><h4>1H OI 增长 Top 5</h4><ul>${r.growth.map(x=>line(x,'growth')).join('')||'<li class="cap-empty">尚无有效正增长数据</li>'}</ul><h4>OI/市值占比 Top 5</h4><ul>${r.ratio.map(x=>line(x,'ratio')).join('')||'<li class="cap-empty">尚无可靠市值占比数据</li>'}</ul><div class="cap-status" role="status">${state.running?'更新中':'手动更新'} · ${esc(state.source)} · 已处理 ${state.done}/${state.total} · OI有效 ${state.rows.length} · 市值有效 ${coverage} · 失败 ${state.errors.length}${state.updated?' · '+new Date(state.updated).toISOString().slice(11,19)+' UTC':''}</div>${state.w?'<p class="cap-note">1H窗口 '+new Date(state.w.start).toISOString().slice(11,16)+' → '+new Date(state.w.end).toISOString().slice(11,16)+' UTC；官方发布滞后 '+Math.ceil(state.publicationLagMs/60000)+' 分钟；市值为独立快照（≤15分钟），非同刻历史市值。</p>':''}${state.capError?'<p class="cap-error">'+esc(state.capError)+'</p>':''}${state.errors.length?'<details class="cap-errors"><summary>查看缺数/请求失败</summary>'+state.errors.map(s=>'<p>'+esc(s)+'</p>').join('')+'</details>':''}<footer><button data-cap-action="refresh" ${state.running?'disabled':''}>刷新缓存</button><button data-cap-action="collect" ${state.running?'disabled':''}>立即采集</button><button data-cap-action="stop" ${state.running?'':'disabled'}>停止</button></footer></section>`;
 }
 async function refresh(){
  if(state.running)return;clearTimeout(expiryTimer);expiryTimer=null;state.expiresAt=0;if(Date.now()<cooldown){state.capError='接口冷却中，请稍后重试';render();return}
  const id=++generation;ctl=new AbortController();const signal=ctl.signal;const current=()=>id===generation&&!signal.aborted;
  state.running=true;state.rows=[];state.errors=[];state.capError='';state.updated=0;state.w=null;state.done=0;state.source='浏览器直连';state.publicationLagMs=0;
  const universe=(deps.getUniverse?.()||[]).filter(x=>typeof x.sym==='string'&&x.sym.endsWith('USDT')).sort((a,b)=>(b.vol||0)-(a.vol||0)).slice(0,state.range);
  state.total=universe.length;render();
  try{
   if(deps.cacheURL){
    try{const raw=await get(deps.cacheURL+(deps.cacheURL.includes('?')?'&':'?')+'t='+Date.now(),signal);if(!current())return;const cache=validateCache(raw,Date.now(),state.range);
     Object.assign(state,cache,{done:cache.rows.length+cache.errors.length});expiryTimer=setTimeout(expireSnapshot,Math.max(1,cache.expiresAt-Date.now()+1));expiryTimer?.unref?.();render();return;
    }catch(e){if(!current())return;state.cacheFailure=e.message;state.capError='同源缓存不可用：'+e.message+'；尝试官方直连';render()}
   }
   if(!universe.length)throw Error('市场未就绪，请先等待行情加载');
   const clock=await get(API+'/fapi/v1/time',signal);if(!current())return;const w=windowAt(+clock.serverTime);state.w=w;
   const ids=[...new Set(universe.map(x=>identity(x.sym)?.id).filter(Boolean))];let caps={};
   if(ids.length)try{caps=await get('https://api.coingecko.com/api/v3/simple/price?ids='+ids.join(',')+'&vs_currencies=usd&include_market_cap=true&include_last_updated_at=true',signal)}catch(e){if(!current())return;state.capError='市值接口不可用：'+e.message+'；占比榜暂缺，不补零'}
   if(!current())return;let next=0,networkFailures=0;
   await Promise.all(Array.from({length:Math.min(3,universe.length)},async()=>{while(current()&&next<universe.length){const item=universe[next++];
    try{const data=await get(API+'/futures/data/openInterestHist?symbol='+encodeURIComponent(item.sym)+'&period=5m&startTime='+w.start+'&endTime='+w.end+'&limit=13',signal);if(!current())return;
     const s=sample(data,w),asset=identity(item.sym),cap=asset?caps[asset.id]:null,m=Number(cap?.usd_market_cap),t=Number(cap?.last_updated_at)*1000,now=Date.now();
     const usable=finite(m)&&m>0&&finite(t)&&t>0&&t<=now+60000&&now-t<=900000,ratio=usable?s.notional/m*100:null;
     state.rows.push({sym:item.sym,...s,ratio:finite(ratio)?ratio:null,marketCap:usable?m:null,capTime:usable?t:null,capId:asset?.id||null});
    }catch(e){if(!current())return;state.errors.push(item.sym+': '+e.message);if(e.name==='TypeError'&&++networkFailures>=3){state.capError='历史OI接口连续网络/CORS失败，已停止；不能视为无异动。需要可用历史数据源';ctl.abort();}if(e.status===429||e.status===418){cooldown=Date.now()+Math.max(60000,(e.retryAfter||60)*1000);state.capError='Binance限频，已停止本轮；已完成结果仅为部分覆盖';ctl.abort();}}
    finally{if(id===generation){state.done++;render()}}
   }}));
  }catch(e){if(id===generation&&e.name!=='AbortError')state.capError=e.message}
  finally{if(id===generation){state.running=false;if(state.source!=='官方API → 同源缓存')state.updated=Date.now();render()}}
 }
 function stop(){generation++;ctl?.abort();state.running=false;state.capError='已停止，结果仅覆盖已完成币种';render()}
 host.addEventListener('click',e=>{const b=e.target.closest('[data-cap-action],[data-cap-symbol]');if(!b)return;if(b.dataset.capSymbol)deps.onSymbol?.(b.dataset.capSymbol);else if(b.dataset.capAction==='refresh')refresh();else if(b.dataset.capAction==='collect')deps.onCollect?.();else if(b.dataset.capAction==='stop')stop();else{state.settings=!state.settings;render()}});
 host.addEventListener('change',e=>{if(e.target.matches('[data-cap-range]')){if(state.running)stop();state.range=Number(e.target.value)===100?100:50;state.rows=[];state.errors=[];state.done=0;state.total=0;state.w=null;state.updated=0;render()}});
 render();return {refresh,stop,state,expireSnapshot};
}
const api={identity,windowAt,sample,ranks,validateCache,init};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.OiCapRadar=api;
})(typeof globalThis!=='undefined'?globalThis:this);
