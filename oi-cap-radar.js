/* Public data only; explicit IDs, no symbol-only provider matching. */
(function(root){
'use strict';
const COLLECTOR='https://oi-radar-collector.shen123lan.workers.dev',RELAY='https://oi-history-relay.shen123lan.workers.dev',STEP=300000,HOUR=3600000,FRESH=900000,HISTORY=2*HOUR;
const OI_SOURCE='https://www.binance.com/futures/data/openInterestHist',CAP_SOURCE='https://api.coingecko.com/api/v3/simple/price';
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
 return {growth,ratio};}
function capFresh(r,at){const asset=identity(r.sym);return !!(asset&&asset.id===r.capId&&finite(r.marketCap)&&r.marketCap>0&&finite(r.capTime)&&r.capTime>0&&r.capTime<=at+60000&&at-r.capTime<=FRESH)}
// History is verified at generation time; expired data never passes validateCache.
function validateSnapshot(d,now,range){
 if(!finite(now)||!d||d.schemaVersion!==1||!finite(d.generatedAt)||d.generatedAt<=0||d.generatedAt>now||now-d.generatedAt>HISTORY||!finite(d.expiresAt)||d.expiresAt<=d.generatedAt)throw Error('同源历史快照缺失、未来或超过2小时');
 const w=d.window;if(!w||!finite(w.start)||w.start<=0||!finite(w.end)||w.end-w.start!==HOUR||w.start%STEP||w.end%STEP||w.end>d.generatedAt||d.generatedAt-w.end>FRESH)throw Error('缓存生成时1H窗口无效');
 if(![50,100].includes(range)||!d.scope||d.scope.type!=='quoteVolumeTop'||d.scope.limit!==range||!Array.isArray(d.scope.symbols)||d.scope.symbols.length>range||d.scope.symbols.some(s=>typeof s!=='string'||!s.endsWith('USDT')||s.length>40)||new Set(d.scope.symbols).size!==d.scope.symbols.length)throw Error('缓存范围与当前Top选择不一致');
 if(!Array.isArray(d.rows)||!Array.isArray(d.errors)||d.sources?.oi!==OI_SOURCE||(d.sources?.marketCap&&d.sources.marketCap!==CAP_SOURCE))throw Error('缓存来源或格式无效');
 const seen=new Set();const rows=d.rows.map(r=>{
  if(!r||seen.has(r.sym)||!d.scope.symbols.includes(r.sym)||!finite(r.coinStart)||r.coinStart<=0||!finite(r.coinEnd)||r.coinEnd<=0||!finite(r.notional)||r.notional<=0)throw Error('缓存持仓行无效');seen.add(r.sym);
  const growth=(r.coinEnd/r.coinStart-1)*100;if(!finite(growth)||!finite(r.growth)||Math.abs(growth-r.growth)>1e-7)throw Error('缓存持仓变化不一致');
  if((r.marketCap!=null&&(!finite(r.marketCap)||r.marketCap<=0))||(r.capTime!=null&&(!finite(r.capTime)||r.capTime<=0||r.capTime>d.generatedAt+60000)))throw Error('缓存市值数值或时刻无效');
  const ok=capFresh(r,d.generatedAt),ratio=ok?r.notional/r.marketCap*100:null;
  if(ok&&!finite(ratio))throw Error('缓存市值占比无效');
  return {...r,growth,ratio,capFreshAtGeneration:ok};
 });
 if(d.errors.some(e=>!e||!d.scope.symbols.includes(e.sym)||typeof e.reason!=='string'))throw Error('缓存错误范围无效');
 if(d.publicationLagMs!=null&&(!finite(d.publicationLagMs)||d.publicationLagMs<0))throw Error('缓存发布滞后无效');
 return {rows,w:{...w},expiresAt:Math.min(d.expiresAt,d.generatedAt+FRESH,w.end+FRESH),historyExpiresAt:d.generatedAt+HISTORY,total:d.scope.symbols.length,scope:{...d.scope,symbols:[...d.scope.symbols]},errors:d.errors.map(x=>x.sym+': '+x.reason),updated:d.generatedAt,generatedAt:d.generatedAt,capError:String(d.capError||''),source:'官方API → 同源缓存',sources:{...d.sources},publicationLagMs:d.publicationLagMs||0};
}
function validateCache(d,now,range){
 const cache=validateSnapshot(d,now,range);
 if(now>=cache.expiresAt)throw Error('同源OI缓存缺失或过期');
 return {...cache,rows:cache.rows.map(r=>({...r,ratio:capFresh(r,now)?r.ratio:null}))};
}
async function request(url,signal){const ctl=new AbortController(),abort=()=>ctl.abort();if(signal?.aborted)throw Object.assign(Error('已停止'),{name:'AbortError'});signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,18000);
 try{const res=await fetch(url,{signal:ctl.signal});if(!res.ok){const e=Error('HTTP '+res.status);e.status=res.status;e.retryAfter=Number(res.headers.get('Retry-After'))||60;throw e}return await res.json()}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}
function init(host,deps={}){
 if(!host)return null;let generation=0,ctl=null,cooldown=0,expiryTimer=null,pollTimer=null;
 const sleep=deps.sleep||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
 const collectFetch=deps.collectFetch||fetch;
 let checking=false,collectEpoch=0;
 async function collectAPI(path,body){
  const r=await collectFetch(COLLECTOR+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  const d=await r.json();if(!r.ok)throw Error(d.error||'采集服务请求失败');return d;
 }
 function finishCollect(message){clearInterval(pollTimer);pollTimer=null;state.collecting=false;state.collectMessage=message;render()}
 async function collect(){
  if(state.collecting||state.running)return;
  const epoch=++collectEpoch;state.collecting=true;state.collectStartedAt=Date.now();state.collectMessage='即时采集：向官方历史 OI 请求…';state.activeRunId=0;state.previousRunId=0;state.beforeCollect=state.updated;render();
  try{
   /* 优先走即时中继：秒级返回 5m 历史；失败自动回退 Actions 链路 */
   const q=await collectFetch(RELAY+'/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbols:deps.relaySymbols?deps.relaySymbols():[],period:'5m',limit:16}),signal:AbortSignal.timeout(20000)});
   if(!q.ok)throw Error('即时中继入队失败 HTTP '+q.status);
   const {jobId}=await q.json();if(epoch!==collectEpoch)return;
   const t0=Date.now();
   while(Date.now()-t0<60000){
    const r=await collectFetch(RELAY+'/result/'+jobId,{signal:AbortSignal.timeout(20000)});if(epoch!==collectEpoch)return;
    if(r.status===200){const d=await r.json();applyRelaySnapshot(d);finishCollect('即时采集成功 · 榜单已更新');return}
    if(r.status===410)throw Error('即时结果过期');
    if(r.status===502){const e=await r.json();throw Error('即时任务失败：'+(e.error||'未知'))}
    state.collectMessage='即时采集中…';render();await sleep(1500);
   }
   throw Error('即时采集等待超时');
  }catch(e){
   if(epoch!==collectEpoch)return;
   state.collectMessage='即时中继不可用，改走云端 Actions…';render();
   try{
    const d=await collectAPI('/collect',{limit:state.range});if(epoch!==collectEpoch)return;
    state.previousRunId=d.previousRunId||0;state.acceptedAt=d.acceptedAt||state.collectStartedAt;state.collectMessage='已提交，等待任务排队…';render();
    clearInterval(pollTimer);pollTimer=setInterval(checkRun,4000);pollTimer?.unref?.();await checkRun();
   }catch(e2){if(epoch===collectEpoch)finishCollect('采集触发失败：'+e2.message)}
  }
 }
 function applyRelaySnapshot(d){
  /* 5m 历史 → 1H 精确端点榜单；与 Actions 缓存同一套严格校验 */
  const end=Math.max(...d.results.flatMap(x=>x.data.map(r=>r.timestamp)));
  const w={start:end-HOUR,end};
  const rows=d.results.map(item=>{
   const byT=new Map(item.data.map(r=>[r.timestamp,r]));
   const a=byT.get(w.start),b=byT.get(w.end);
   if(!a||!b)return null;
   const coinS=+a.sumOpenInterest,coinE=+b.sumOpenInterest,notional=+b.sumOpenInterestValue;
   if(!(coinS>0&&coinE>0&&notional>0))return null;
   const growth=(coinE/coinS-1)*100;
   return {sym:item.symbol,growth,notional,coinS,coinE,ratio:null,marketCap:null,capTime:null,capId:null,source:'即时中继'};
  }).filter(Boolean);
  const now=Date.now();
  Object.assign(state,{rows,w,errors:(d.errors||[]).map(e=>e.symbol+': '+(e.error||'失败')),total:d.symbols.length,done:rows.length+(d.errors||[]).length,updated:now,expiresAt:now+FRESH,publicationLagMs:d.serverTime-end,source:'官方API → 即时中继',collectMessage:''});
  state.relayOnly=true;   /* 即时快照无市值：占比榜显示提示，不冒充 */
  armExpiry();
 }
 async function checkRun(){
  if(checking||!state.collecting)return;checking=true;const epoch=collectEpoch;
  try{
   if(Date.now()-state.collectStartedAt>12*60000){finishCollect('等待超时：云端任务可能仍运行，请稍后刷新缓存；未自动重发');return}
   if(!state.activeRunId){
    const d=await collectAPI('/status/latest');if(epoch!==collectEpoch)return;
    const candidates=d.runs||[d.run].filter(Boolean),run=candidates.find(x=>x.id>state.previousRunId&&x.event==='workflow_dispatch'&&Date.parse(x.created_at)>=Math.floor(state.acceptedAt/1000)*1000);
    if(!run){state.collectMessage='已提交，等待任务排队…';render();return}state.activeRunId=run.id;
   }
   const d=await collectAPI('/status?run='+state.activeRunId);if(epoch!==collectEpoch)return;const run=d.run;
   if(!run||run.id!==state.activeRunId)throw Error('任务编号不一致');
   if(run.status!=='completed'){state.collectMessage='采集中 · '+(run.status==='queued'?'排队中':'运行中');render();return}
   if(run.conclusion!=='success'){finishCollect('采集未成功：'+(run.conclusion||'未知'));return}
   state.collectMessage='采集完成，等待网页新缓存发布…';render();
   const raw=await get(cacheURL());if(epoch!==collectEpoch)return;
   if(!finite(raw.generatedAt)||raw.generatedAt<state.acceptedAt||raw.generatedAt<=state.beforeCollect){render();return}
   const now=Date.now(),snapshot=validateSnapshot(raw,now,state.range);
   saveSnapshot(snapshot); // Valid history may be shown, but cannot complete a current collection.
   const cache=validateCache(raw,now,state.range);
   applyFresh(cache);finishCollect('采集成功 · 榜单已更新');
  }catch(e){if(epoch===collectEpoch){state.collectMessage='等待重试 · '+e.message;render()}}
  finally{checking=false}
 }
 const state={running:false,range:50,rows:[],snapshotRows:[],snapshot:null,errors:[],capError:'',updated:0,w:null,expiresAt:0,total:0,done:0,source:'官方API → 同源缓存',publicationLagMs:0};
 const get=deps.fetchJSON||request;
 function cacheURL(){const url=deps.cacheURL||'oi-radar-live.json';return url+(url.includes('?')?'&':'?')+'t='+Date.now()}
 function saveSnapshot(s){
  if(state.snapshot&&state.snapshot.scope.limit===state.range&&s.generatedAt<state.snapshot.generatedAt)return false;
  const {rows,...info}=s;state.snapshotRows=rows.map(r=>({...r}));state.snapshot=info;return true;
 }
 function applyFresh(cache){
  Object.assign(state,cache,{done:cache.rows.length+cache.errors.length,collectMessage:''});armExpiry();
 }
 function maintain(now){
  if(state.snapshot&&(now>state.snapshot.historyExpiresAt||state.snapshot.scope.limit!==state.range)){state.snapshotRows=[];state.snapshot=null}
  if(state.expiresAt&&now>=state.expiresAt){
   state.rows=[];state.w=null;state.expiresAt=0;
   state.collectMessage='';state.capError='官方OI快照已过期，已撤下榜单；仅供历史查阅，不代表无异动';
  }
  for(const row of state.rows)if(!capFresh(row,now))row.ratio=null;
 }
 function armExpiry(){
  clearTimeout(expiryTimer);const now=Date.now(),deadlines=[];
  if(state.expiresAt>now)deadlines.push(state.expiresAt);
  if(state.snapshot)deadlines.push(state.snapshot.historyExpiresAt+1);
  for(const r of state.rows)if(finite(r.ratio))deadlines.push(r.capTime+FRESH+1);
  if(deadlines.length){expiryTimer=setTimeout(expireSnapshot,Math.max(1,Math.min(...deadlines)-now));expiryTimer?.unref?.()}
 }
 function expireSnapshot(){maintain(Date.now());render()}
 function getEvidence(sym,now=Date.now()){
  if(!finite(now))throw Error('证据查询时间无效');maintain(now);
  const row=state.rows.find(r=>r.sym===sym)||null,snapshotRow=state.snapshotRows.find(r=>r.sym===sym)||null,s=state.snapshot;
  const capStatus=(r,at)=>!r?'missing':!identity(r.sym)||identity(r.sym).id!==r.capId?'unmapped':!finite(r.marketCap)||!finite(r.capTime)?'missing':capFresh(r,at)?'fresh':'stale';
  const info=s?{window:{...s.w},generatedAt:s.generatedAt,expiresAt:s.expiresAt,historyExpiresAt:s.historyExpiresAt,expired:now>=s.expiresAt,historical:true,source:s.source,sources:{...s.sources},scope:{...s.scope,symbols:[...s.scope.symbols]},publicationLagMs:s.publicationLagMs}:null;
  return {sym,row:row?{...row}:null,snapshotRow:snapshotRow?{...snapshotRow}:null,snapshot:info,historical:info,fresh:!!row,current:!!row,window:row&&state.w?{...state.w}:info?.window||null,generatedAt:row?state.updated:info?.generatedAt||null,expiresAt:row?state.expiresAt:info?.expiresAt||null,cap:{status:capStatus(row,now),currentFresh:!!row&&capFresh(row,now),snapshotStatus:capStatus(snapshotRow,s?.generatedAt||now),snapshotFreshAtGeneration:!!snapshotRow&&capFresh(snapshotRow,s.generatedAt),snapshotCurrentStatus:capStatus(snapshotRow,now),capTime:(row||snapshotRow)?.capTime||null,ageMs:finite((row||snapshotRow)?.capTime)?now-(row||snapshotRow).capTime:null,asynchronous:true}};
 }
 const symbol=s=>esc(s.replace(/USDT$/,''));
 function render(){
  maintain(Date.now());armExpiry();
  const r=ranks(state.rows);
  const line=(x,kind)=>`<li><button type="button" data-cap-symbol="${esc(x.sym)}">${symbol(x.sym)}</button><b class="${kind}">${kind==='growth'?'+':''}${(kind==='growth'?x.growth:x.ratio).toFixed(1)}%</b></li>`;
  const coverage=state.rows.filter(x=>finite(x.ratio)).length;
  host.innerHTML=`<section class="cap-radar"><header><h3>OI / 市值榜单</h3><button data-cap-action="settings" aria-label="榜单设置" title="榜单设置">⚙</button></header><details class="cap-settings" ${state.settings?'open':''}><summary>范围与口径</summary><label>成交额范围 <select data-cap-range><option value="50" ${state.range===50?'selected':''}>Top50</option><option value="100" ${state.range===100?'selected':''}>Top100</option></select></label><p>1H增长按持仓币数；占比=窗口终点OI名义USD / 流通市值USD ×100%，不是资金流或投入比例，可超过100%。两个榜单独立排序，不生成合并信号。</p><p>Binance 5m精确端点；CoinGecko明确ID映射，仅${Object.keys(IDS).length}种已登记资产。倍数合约、未登记资产不猜市值。不是全市场排名。</p></details><p class="cap-note">新鲜数据：15分钟内有效；过期后撤下当前榜单，仅保留历史记录。</p><h4>1H OI 增长 Top 5</h4><ul>${r.growth.map(x=>line(x,'growth')).join('')||'<li class="cap-empty">尚无有效正增长数据</li>'}</ul><h4>OI/市值占比 Top 5</h4><ul>${state.relayOnly?'<li class="cap-empty">即时快照不含市值；点击「刷新缓存」读取含市值的每小时缓存，或等待下一轮自动采集</li>':r.ratio.map(x=>line(x,'ratio')).join('')||'<li class="cap-empty">尚无可靠市值占比数据</li>'}</ul><div class="cap-status" role="status">${esc(state.collecting?state.collectMessage:state.running?'更新中':state.collectMessage||'手动更新')} · ${esc(state.source)} · 已处理 ${state.done}/${state.total} · OI有效 ${state.rows.length} · 市值有效 ${coverage} · 失败 ${state.errors.length}${state.updated?' · '+new Date(state.updated).toISOString().slice(11,19)+' UTC':''}</div>${state.w?'<p class="cap-note">1H窗口 '+new Date(state.w.start).toISOString().slice(11,16)+' → '+new Date(state.w.end).toISOString().slice(11,16)+' UTC；官方发布滞后 '+Math.ceil(state.publicationLagMs/60000)+' 分钟；市值为独立快照（≤15分钟），非同刻历史市值。</p>':''}${state.capError?'<p class="cap-error">'+esc(state.capError)+'</p>':''}${state.errors.length?'<details class="cap-errors"><summary>查看缺数/请求失败</summary>'+state.errors.map(s=>'<p>'+esc(s)+'</p>').join('')+'</details>':''}${historyHTML()}<footer><button data-cap-action="refresh" ${state.running||state.collecting?'disabled':''}>刷新缓存</button><button data-cap-action="collect" ${state.collecting||state.running?'disabled':''}>${state.collecting?'采集任务运行中':'立即采集'}</button><button data-cap-action="stop" ${state.running||state.collecting?'':'disabled'}>停止</button></footer></section>`;
 }
 function historyHTML(){
  const snap=state.snapshot;if(!snap)return '<details class="cap-history"><summary>最近小时快照 · 暂无可回看记录</summary><p>仅保存本页读取的、生成时间不超过2小时的官方缓存。</p></details>';
  const h=ranks(state.snapshotRows),utc=t=>new Date(t).toISOString().slice(0,19).replace('T',' ')+' UTC';
  const rows=(list,key)=>list.map(r=>'<li><button data-cap-symbol="'+esc(r.sym)+'">'+symbol(r.sym)+'</button><b>'+r[key].toFixed(1)+'%</b></li>').join('')||'<li>该次快照无有效记录</li>';
  return '<details class="cap-history"><summary>最近小时快照 · '+(Date.now()>=snap.expiresAt?'已过期，仅回看':'新鲜快照副本')+'</summary><p>生成 '+utc(snap.generatedAt)+'；窗口 '+utc(snap.w.start)+' → '+utc(snap.w.end)+'</p><p>OI '+state.snapshotRows.length+'/'+snap.total+'；当时市值有效 '+state.snapshotRows.filter(r=>finite(r.ratio)).length+'。历史排行仅供回看，不参与当前榜单；市值为生成时的独立快照。</p><h4>该次1H OI增长</h4><ul>'+rows(h.growth,'growth')+'</ul><h4>该次OI/流通市值</h4><ul>'+rows(h.ratio,'ratio')+'</ul><p>自动采集计划每小时17分（可能延迟）；立即采集可请求新数据。</p></details>';
 }
 async function refresh(){
  if(state.running||state.collecting)return;
  if(Date.now()<cooldown){state.capError='接口限频冷却中';render();return}
  const id=++generation;ctl=new AbortController();const signal=ctl.signal;const current=()=>id===generation&&!signal.aborted;
  state.running=true;state.capError='';state.relayOnly=false;render();
  try{
   const raw=await get(cacheURL(),signal);if(!current())return;
   const now=Date.now(),snap=validateSnapshot(raw,now,state.range);saveSnapshot(snap);
   try{applyFresh(validateCache(raw,now,state.range));}
   catch{state.rows=[];state.w=null;state.expiresAt=0;state.updated=0;state.total=snap.total;state.done=snap.rows.length+snap.errors.length;state.errors=snap.errors;state.capError='快照已过期：仅供历史回看，请立即采集新数据';}
  }catch(e){if(current()){if(e.status===429||e.status===418){cooldown=Date.now()+60000;state.capError='接口限频冷却中';return}maintain(Date.now());state.capError='缓存读取失败：'+e.message+'；不会用失败数据替代，已验证历史快照可回看';}}
  finally{if(current()){state.running=false;render()}}
 }
 function stop(){if(state.collecting){collectEpoch++;finishCollect('已停止等待；已提交的云端采集未取消')}generation++;ctl?.abort();state.running=false;state.capError='已停止，结果仅覆盖已完成币种';render()}
 host.addEventListener('click',e=>{const b=e.target.closest('[data-cap-action],[data-cap-symbol]');if(!b)return;if(b.dataset.capSymbol)deps.onSymbol?.(b.dataset.capSymbol);else if(b.dataset.capAction==='refresh')refresh();else if(b.dataset.capAction==='collect')collect();else if(b.dataset.capAction==='stop')stop();else{state.settings=!state.settings;render()}});
 host.addEventListener('change',e=>{if(e.target.matches('[data-cap-range]')){if(state.running||state.collecting)stop();state.snapshot=null;state.snapshotRows=[];state.range=Number(e.target.value)===100?100:50;state.rows=[];state.errors=[];state.done=0;state.total=0;state.w=null;state.updated=0;render()}});
 render();return {refresh,stop,state,expireSnapshot,collect,checkRun,getEvidence};
}
const api={identity,windowAt,sample,ranks,validateCache,validateSnapshot,init};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.OiCapRadar=api;
})(typeof globalThis!=='undefined'?globalThis:this);
