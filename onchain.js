/* Public cached chain evidence; never changes contract scoring or launches scans. */
(function(root){
 'use strict';
 const TTL=90*60*1000;
 const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const safeUrl=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:''}catch(_){return ''}};
 const Chains=root.ChainAdapters||(typeof module!=='undefined'&&module.exports?require('./chains.js'):null);
 const chainValid=(chain,id,address)=>Chains?Chains.valid({chain,chainId:id,address}):chain==='bsc'&&id===56&&/^0x[0-9a-f]{40}$/i.test(address||'');
 const chainExplorer=t=>Chains?Chains.explorer(t):'';
 function identity(a,b){const norm=t=>Chains?Chains.norm(t?.chain,t?.address):String(t?.address||'').toLowerCase();return !!a&&!!b&&a.symbol===b.symbol&&a.chain===b.chain&&a.chainId===b.chainId&&chainValid(a.chain,a.chainId,a.address)&&chainValid(b.chain,b.chainId,b.address)&&norm(a)===norm(b)}
 // Cache array indexes once; lookup callers (including legacy offline helpers) are O(1).
 const indexes=new WeakMap();
 function symbolIndex(entries){
  if(entries instanceof Map)return entries;
  if(!Array.isArray(entries))return new Map();
  let cached=indexes.get(entries);
  if(!cached||cached.size!==entries.length){cached={size:entries.length,index:new Map(entries.map(t=>[t.symbol,t]))};indexes.set(entries,cached)}
  return cached.index;
 }
 const MAPPING_STATUSES=Object.freeze(['mapped','native_no_dex_contract','no_adapter','ambiguous_identity','pending_verification']);
 const STATUS_INFO=Object.freeze({
  native_no_dex_contract:{text:'原生资产 · 无 DEX 合约',explanation:'目录将其列为原生资产，当前未登记可用 DEX 代币合约；不推测包装币地址，也不代表全链没有交易。'},
  no_adapter:{text:'链上适配器未接入',explanation:'已找到资产线索，但当前链 / 地址适配器未接入；没有可验证的 DEX 快照。'},
  ambiguous_identity:{text:'资产身份有歧义',explanation:'存在多个候选身份或链 / 合约冲突，暂不选定地址；不按名称自动匹配。'},
  pending_verification:{text:'链与合约待核实',explanation:'身份或合约证据尚不充分，等待核实；不按名称或数字前缀猜地址。'}
 });
 const validText=(v,max=128)=>typeof v==='string'&&v.length>0&&v.length<=max&&v.trim()===v&&!/[\u0000-\u001f\u007f]/.test(v);
 function validateUniverse(data){
  if(data?.schemaVersion!==1||!Array.isArray(data.universe)||!data.universe.length||data.universe.length>2000)throw Error('全市场目录格式无效');
  const seen=new Set();
  for(const u of data.universe){
   if(!u||!validText(u.symbol)||seen.has(u.symbol)||!validText(u.baseAsset)||!validText(u.quoteAsset)||!MAPPING_STATUSES.includes(u.mappingStatus)||!['official','provider_matched','unmapped'].includes(u.identityVerification)||u.mappingStatus==='mapped'&&u.identityVerification==='unmapped'||!validText(u.reason,600)||!Array.isArray(u.warnings)||u.warnings.length>40||u.warnings.some(w=>!validText(w,300))||u.denomination!=null&&(!Number.isFinite(u.denomination)||u.denomination<=0||u.denomination>1e12))throw Error('全市场目录未通过校验');
   seen.add(u.symbol);
  }
  return data.universe;
 }
 function mappingEligible(t,u){return !!t&&(!u||u.mappingStatus==='mapped'&&(!t.identityVerification||t.identityVerification===u.identityVerification))}
 function verificationText(t){
  const level=t?.identityVerification;
  const label=level==='official'?'官方元数据依据（official）':level==='provider_matched'?'数据提供方匹配（provider_matched），不是项目方官方合约核验':'历史地址登记，证据层级未声明';
  return label+'；'+(t?.independentlyProjectVerified===true?'已声明项目方独立核验，仍需查看原始依据':'未经项目方独立核验（not independently verified）')+'。身份映射不代表实时 DEX 数据可用。';
 }
 function catalogCounts(universe,registry,rows={},now=Date.now()){
  const catalog=symbolIndex(universe),counts=Object.fromEntries(MAPPING_STATUSES.map(s=>[s,0]));
  let official=0,provider=0,valid=0,fresh=0,stale=0;
  for(const u of catalog.values())counts[u.mappingStatus]++;
  for(const t of symbolIndex(registry).values()){
   if(catalog.size&&!catalog.has(t.symbol)||!mappingEligible(t,catalog.get(t.symbol)))continue;
   valid++;if(t.identityVerification==='official')official++;if(t.identityVerification==='provider_matched')provider++;
   const r=rows[t.symbol],state=freshness(identity(r?.identity,t)?r:null,now);if(state==='fresh')fresh++;if(state==='stale')stale++;
  }
  return {total:catalog.size,mapped:counts.mapped,counts,valid,official,provider,fresh,stale,missing:valid-fresh-stale};
 }
 function poolLink(t,p){
  const address=String(p.pairAddress||''),name=String(p.dexId||'DEX')+' · '+address.slice(0,8)+'…';
  const valid=t?.chain==='sui'?t.chainId==='CT_784'&&/^0x[0-9a-f]{64}$/i.test(address):chainValid(t?.chain,t?.chainId,address);
  return valid?'<a href="https://dexscreener.com/'+encodeURIComponent(t.chain)+'/'+encodeURIComponent(address)+'" target="_blank" rel="noopener noreferrer">'+escape(name)+' ↗</a>':escape(name);
 }
 const MAX_JSON_BYTES=16*1024*1024;
 async function getJson(path,force=false){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),12000);
  try{
   const res=await fetch(path+(force?'?t='+Date.now():''),{signal:ctl.signal,cache:force?'reload':'default'});
   if(!res.ok)throw Error('HTTP '+res.status);
   const declared=Number(res.headers?.get('content-length'));
   if(Number.isFinite(declared)&&declared>MAX_JSON_BYTES){ctl.abort();throw Error('快照超过 16 MiB 读取上限')}
   let text;
   if(res.body?.getReader&&typeof TextDecoder!=='undefined'){
    const reader=res.body.getReader(),decoder=new TextDecoder(),parts=[];let bytes=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_JSON_BYTES){ctl.abort();throw Error('快照超过 16 MiB 读取上限')}parts.push(decoder.decode(value,{stream:true}))}parts.push(decoder.decode());text=parts.join('')}
    finally{reader.releaseLock()}
   }else{
    text=await res.text();const bytes=typeof TextEncoder!=='undefined'?new TextEncoder().encode(text).byteLength:new Blob([text]).size;
    if(bytes>MAX_JSON_BYTES)throw Error('快照超过 16 MiB 读取上限');
   }
   return JSON.parse(text);
  }finally{clearTimeout(timer)}
 }
 function freshness(row,now=Date.now()){
  const t=Date.parse(row?.fetchedAt),age=now-t;
  if(!row||!Number.isFinite(t)||age< -300000||!['ok','stale'].includes(row.status))return 'unavailable';
  return row.status==='stale'||age>TTL?'stale':'fresh';
 }
 function countBias(tx){
  const b=num(tx?.buys),s=num(tx?.sells);
  if(b===null||s===null||!Number.isInteger(b)||!Number.isInteger(s))return {text:'买卖笔数暂无',kind:'neutral',share:null};
  const total=b+s;
  if(!total)return {text:'该窗口无交易',kind:'neutral',share:null};
  const share=b/total;
  if(total<20)return {text:'交易样本较少',kind:'neutral',share};
  return {text:share>=.6?'买入笔数偏多':share<=.4?'卖出笔数偏多':'买卖笔数均衡',kind:share>=.6?'up':share<=.4?'down':'neutral',share};
 }
 function evidence(row,now=Date.now()){
  const state=freshness(row,now);
  if(state==='unavailable')return {state,text:'链上暂无',kind:'neutral'};
  if(state==='stale')return {state,text:'链上待更新',kind:'neutral'};
  const change=row.liquidityChangePct;
  if(typeof change==='number'&&Number.isFinite(change)&&change<=-10&&row.liquidityBaselineAt)return {state,text:'池流动性下降',kind:'down'};
  const bias=countBias(row.txns?.h1);
  return {state,text:bias.share===null?'链上已接入':bias.text,kind:bias.kind};
 }
 function validateRegistry(data){
  if(data?.schemaVersion!==1||!Array.isArray(data.tokens)||!data.tokens.length||data.tokens.length>1000)throw Error('合约映射格式无效');
  const seen=new Set();
  for(const t of data.tokens){
   if(!t||!validText(t.symbol)||seen.has(t.symbol)||!chainValid(t.chain,t.chainId,t.address)||t.mappingStatus!=null&&t.mappingStatus!=='mapped'||t.identityVerification!=null&&!['official','provider_matched'].includes(t.identityVerification)||t.independentlyProjectVerified!=null&&typeof t.independentlyProjectVerified!=='boolean'||!Array.isArray(t.sources)||!t.sources.length||t.sources.length>40||t.sources.some(s=>!s||!safeUrl(s.url)))throw Error('合约映射未通过校验');
   seen.add(t.symbol);
  }
  return data.tokens;
 }
 function validateSnapshot(data,registry){
  if(data?.schemaVersion!==1||!data.tokens||typeof data.tokens!=='object'||Array.isArray(data.tokens))throw Error('链上快照格式无效');
  const rows=Object.create(null);
  for(const token of symbolIndex(registry).values()){
   const r=data.tokens[token.symbol];
   if(!r)continue;
   if(!identity(r.identity,token))continue;
   rows[token.symbol]=r;
  }
  return rows;
 }
 // Cache-only alert lookup: exact verified identity; never fetch per alert.
 function alertTag(sym,registry=[],rows={},now=Date.now()){
  const t=symbolIndex(registry).get(sym);
  if(!t)return ' · 未接入可验证链上数据';
  const r=rows[sym],e=evidence(identity(r?.identity,t)?r:null,now);
  if(e.state==='stale')return ' · 链上暂无可验证异动（旧快照待更新）';
  if(e.state==='unavailable')return ' · 链上暂无可验证异动（有效快照暂无）';
  const pct=r?.liquidityChangePct,current=num(r?.liquidityUsd);
  if(typeof pct==='number'&&Number.isFinite(pct)&&pct>-100&&Math.abs(pct)>=10&&current!==null&&r.liquidityBaselineAt){
   const previous=current/(1+pct/100),delta=current-previous;
   if(Number.isFinite(delta)&&Math.abs(delta)>=100000)return ' · 链上异动:可比池流动性'+(delta>0?'增加':'减少')+' $'+Math.round(Math.abs(delta)).toLocaleString('en-US')+' ('+(pct>0?'+':'')+pct.toFixed(1)+'%；USD估值含价格影响，非资金流)';
  }
  if(e.text==='池流动性下降')return ' · 链上流动性下降证据（未达到大额阈值，非资金流）';
  if(e.kind==='up'||e.kind==='down')return ' · 链上笔数偏向:'+e.text+'（不是大额资金异动）';
  return ' · 链上暂无可验证异动';
 }
 // Optional evidence channels: no fetch, no scoring, and never infer transfers from DEX.
 function transferEvents(channel,t){
  const addr=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v),hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
  const at=v=>typeof v==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;
  if(!channel||!identity(channel.identity,t)||t.chain!=='bsc'||t.chainId!==56||!safeUrl(channel.source)||channel.coverage?.complete!==true||channel.coverage?.finality!=='finalized'||!Array.isArray(channel.events)||channel.events.length>1000)return null;
  const start=at(channel.window?.from),end=at(channel.window?.to),fetched=at(channel.fetchedAt);
  if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isFinite(fetched)||!Number.isFinite(at(channel.lastAttemptAt))||end<=start||end-start>86400000||end>fetched)return null;
  const seen=new Map();
  for(const e of channel.events){
   const block=at(e?.blockTime);
   if(!e||!addr(e.tokenAddress)||e.tokenAddress.toLowerCase()!==t.address.toLowerCase()||!addr(e.from)||!addr(e.to)||!hash(e.transactionHash)||!hash(e.blockHash)||!Number.isSafeInteger(e.blockNumber)||e.blockNumber<0||!Number.isSafeInteger(e.logIndex)||e.logIndex<0||e.finality!=='finalized'||e.removed!==false||!Number.isInteger(e.decimals)||e.decimals<0||e.decimals>255||typeof e.amountRaw!=='string'||!/^(?:0|[1-9][0-9]{0,77})$/.test(e.amountRaw)||!Number.isFinite(block)||block<start||block>=end)return null;
   if(e.usdValue!=null&&(num(e.usdValue)===null||typeof e.valuation?.source!=='string'||!e.valuation.source||e.valuation.source.length>120||at(e.valuation.at)!==block))return null;
   const key=e.transactionHash.toLowerCase()+':'+e.logIndex;
   // Conflicting duplicate logs fail closed; property order is irrelevant.
   const canonical=JSON.stringify([e.tokenAddress.toLowerCase(),e.from.toLowerCase(),e.to.toLowerCase(),e.blockHash.toLowerCase(),e.blockNumber,block,e.decimals,e.amountRaw,e.usdValue??null,e.valuation?.source??null,at(e.valuation?.at)||null]);
   if(seen.has(key)&&seen.get(key).canonical!==canonical)return null;
   seen.set(key,{canonical,event:e});
  }
  return [...seen.values()].map(v=>v.event);
 }
 function channelSummary(row,t,now=Date.now()){
  const valid=identity(row?.identity,t),r=valid?row:null,e=evidence(r,now);
  let dex={state:e.state,text:e.text,anomaly:false};
  const pct=r?.liquidityChangePct,current=num(r?.liquidityUsd),baseline=Date.parse(r?.liquidityBaselineAt),observed=Date.parse(r?.fetchedAt);
  if(e.state==='fresh'&&typeof pct==='number'&&Number.isFinite(pct)&&pct>-100&&Math.abs(pct)>=10&&current!==null&&Number.isFinite(baseline)&&observed-baseline>=1800000&&observed-baseline<=21600000&&/^[a-f0-9]{64}$/.test(r?.poolFingerprint||'')){
   const delta=current-current/(1+pct/100);
   if(Number.isFinite(delta)&&Math.abs(delta)>=100000)dex={state:'fresh',text:'DEX 异动：可比池流动性估值'+(delta>0?'增加':'减少')+' $'+Math.round(Math.abs(delta)).toLocaleString('en-US')+'；含价格影响，非资金流',anomaly:true};
  }
  const c=r?.evidence?.schemaVersion===1?r.evidence.transfers:null;
  let transfers={state:'disabled',text:'大额转账：未接入转账日志数据源',anomaly:false,count:null,events:[]};
  if(c&&c.status!=='disabled'){
   const events=transferEvents(c,t),state=freshness(c,now);
   if(events===null||state==='unavailable')transfers={...transfers,state:'unavailable',text:'大额转账：有效证据暂无'};
   else if(state==='stale'||r.status==='stale'||now-Date.parse(c.window.to)>TTL)transfers={...transfers,state:'stale',text:'大额转账：旧日志待更新，不确认当前异动'};
   else{
    const large=events.filter(e=>num(e.usdValue)!==null&&e.usdValue>=100000),unknown=events.filter(e=>num(e.usdValue)===null).length;
    transfers={state:'fresh',text:'大额转账：已确认 '+large.length+' 笔 ≥ $100,000'+(unknown?'；'+unknown+' 笔缺 USD 估值（不视为零）':''),anomaly:large.length>0,count:large.length,events:large,window:c.window,fetchedAt:c.fetchedAt,source:c.source};
   }
  }
  return {dex,transfers};
 }
 function channelPanel(row,t,now=Date.now()){
  const summary=channelSummary(row,t,now),tr=summary.transfers;
  const links=tr.events.slice(0,5).map(e=>'<li><a href="https://bscscan.com/tx/'+e.transactionHash.toLowerCase()+'" target="_blank" rel="noopener noreferrer">'+escape(e.transactionHash.slice(0,12))+'… · log '+e.logIndex+'</a> · $'+Math.round(e.usdValue).toLocaleString('en-US')+'</li>').join('');
  return '<div class="oc-channels"><section data-oc-channel="dex"><b>DEX 池证据</b><p>'+escape(summary.dex.text)+'</p><small>笔数偏向不是大额资金；成交额与流动性不是转账净流。</small></section><section data-oc-channel="transfers"><b>大额转账证据</b><p>'+escape(tr.text)+'</p>'+(tr.window?'<p>区间 ['+escape(tr.window.from)+', '+escape(tr.window.to)+')<br>抓取 '+escape(tr.fetchedAt)+' · <a href="'+escape(safeUrl(tr.source))+'" target="_blank" rel="noopener noreferrer">日志来源 ↗</a></p>':'')+(links?'<ul>'+links+'</ul>':'')+'<small>地址转账 ≠ 买卖或交易所充值；钱包归属未核验。两个通道独立，不参与合约评分。</small></section></div>';
 }
 const Core={TTL,MAX_JSON_BYTES,MAPPING_STATUSES,STATUS_INFO,num,escape,safeUrl,chainValid,chainExplorer,identity,symbolIndex,validateUniverse,catalogCounts,verificationText,poolLink,getJson,freshness,countBias,evidence,validateRegistry,validateSnapshot,alertTag,transferEvents,channelSummary,channelPanel};
 if(typeof module!=='undefined'&&module.exports){module.exports=Core;return}
 const OC={registry:[],registryBySymbol:new Map(),universe:[],universeBySymbol:new Map(),rows:{},transferCache:null,transferError:'',loading:false,loaded:false,error:'',errors:{},only:{market:false,watch:false},promise:null};
 const listContext=()=>S.ov.favOnly?'watch':'market';
 root.Onchain=OC;root.OnchainCore=Core;
 const el=s=>document.querySelector(s);
 const setText=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value};
 const fmt=v=>num(v)===null?'暂无':'$'+fC(v);
 const tm=t=>{const d=new Date(t);return t&&Number.isFinite(d.getTime())?d.toLocaleString('zh-CN',{hour12:false}):'暂无'};
 function catalog(sym){OC.universeBySymbol=symbolIndex(OC.universe);return OC.universeBySymbol.get(sym)}
 function token(sym){OC.registryBySymbol=symbolIndex(OC.registry);const t=OC.registryBySymbol.get(sym),u=catalog(sym);return (!OC.universe.length||u)&&mappingEligible(t,u)?t:null}
 function row(sym){const t=token(sym),r=OC.rows[sym];return identity(r?.identity,t)?r:null}
 function badgeState(sym){
  const t=token(sym),u=catalog(sym);
  if(!t){
   const info=STATUS_INFO[u?.mappingStatus];
   return {text:info?.text||(u?.mappingStatus==='mapped'?'已映射 · 地址登记暂无':'未接入可验证链上数据'),kind:'neutral',unmapped:true,status:u?.mappingStatus||'not_in_catalog'};
  }
  const state=row(sym)?.status,e=evidence(row(sym)),prefix=t.identityVerification==='provider_matched'?'提供方匹配 · ':t.identityVerification==='official'?'官方依据 · ':'';
  const missing=state==='unsupported'?'该链采集未适配':row(sym)?.error==='no_accepted_base_pools'?'所选链暂无合法池返回':'链上快照暂无';
  return {...e,text:prefix+(e.state==='unavailable'?missing:e.state==='stale'?'链上旧':e.text),status:'mapped'};
 }
 function statusExplanation(sym){
  const t=token(sym),u=catalog(sym),info=STATUS_INFO[u?.mappingStatus];
  return t?verificationText(t):info?.explanation||(u?.mappingStatus==='mapped'?'目录记录为已映射，但地址登记不可用或证据层级不一致；不显示无法精确绑定的快照。':'该币未出现在已加载目录，或目录尚未加载；尚未核实链与合约地址，不按名称自动匹配。');
 }
 function cachedAlertTag(sym){
  if(!token(sym)){const state=badgeState(sym);return state.status==='not_in_catalog'?alertTag(sym,[],OC.rows):' · '+state.text+'（未接入可验证链上数据）'}
  return alertTag(sym,OC.registry,OC.rows);
 }
 function badgeTitle(sym){return statusExplanation(sym)+cachedAlertTag(sym)+' · 抓取 '+tm(row(sym)?.fetchedAt)+'；笔数≠资金流；不参与合约评分'}
 function tag(sym){
  const b=badgeState(sym);
  return '<span class="oc-badge '+b.kind+(b.unmapped?' oc-unmapped':'')+'" data-oc-status="'+escape(b.status)+'" title="'+escape(badgeTitle(sym))+'">'+escape(b.text)+'</span>';
 }
 root.onchainBadge=tag;
 root.onchainAlertTag=cachedAlertTag;
 root.onchainFilter=rows=>OC.only[listContext()]?rows.filter(r=>!!token(r.sym)):rows;
 root.onchainDetailChanged=()=>renderDetail();
 function decorate(){
  const seen=new WeakMap();
  for(const sel of ['#ovTbl','#scTbl','#qdTbl','#idTbl','#stTbl','#rtTbl']){
   const table=el(sel);if(!table)continue;
   for(const a of table.querySelectorAll('a[data-sym],a[data-st-sym]')){
    const sym=a.dataset.sym||a.dataset.stSym,state=badgeState(sym),host=a.closest('td')||a.parentNode,owner=a.closest('tr')||host;
    let symbols=seen.get(owner);if(!symbols){symbols=new Set();seen.set(owner,symbols)}
    if(symbols.has(sym))continue;symbols.add(sym);
    const badges=[...host.querySelectorAll('.oc-badge')].filter(b=>!b.dataset.ocSym||b.dataset.ocSym===sym);
    let b=badges.shift();for(const duplicate of badges)duplicate.remove();
    if(!b){b=document.createElement('span');a.after(b)}
    const className='oc-badge '+state.kind+(state.unmapped?' oc-unmapped':''),title=badgeTitle(sym);
    if(b.className!==className)b.className=className;
    if(b.textContent!==state.text)b.textContent=state.text;
    if(b.title!==title)b.title=title;
    if(b.dataset.ocSym!==sym)b.dataset.ocSym=sym;
    if(b.dataset.ocStatus!==state.status)b.dataset.ocStatus=state.status;
   }
  }
 }
 function renderDetail(){
  const box=el('#ocDetail');if(!box)return;
  const sym=S.dt.sym,t=token(sym),r=row(sym),e=evidence(r);
  const opened=box.dataset.renderedSym===sym&&box.querySelector('.oc-pools')?.open;
  if(box.dataset.renderedSym!==sym)box.dataset.renderedSym=sym;
  setText(el('#ocDetailTitle'),'链上证据 · '+(sym||'选择币种'));
  setText(el('#ocDetailStatus'),!t?badgeState(sym).text:e.state==='fresh'?'缓存快照':e.state==='stale'?'旧快照':'暂无数据');
  const u=catalog(sym),state=badgeState(sym);
  let html='<section class="oc-catalog" data-oc-status="'+escape(state.status)+'"><b>'+escape(t?'地址映射 · '+(t.identityVerification||'历史登记'):state.text)+'</b><p>'+escape(statusExplanation(sym))+'</p>'+(u?'<small>目录币对：'+escape(u.symbol)+' · '+escape(u.baseAsset)+' / '+escape(u.quoteAsset)+'<br>目录原因：<code>'+escape(u.reason)+'</code>'+(u.warnings.length?'<br>目录警告：'+u.warnings.map(escape).join('；'):'')+'</small>':'')+'</section>';
  if(!t){html+='<p class="mut">暂无可验证 DEX 数据；缺失状态不等于已接入，不将暂无值补为 0。</p>';}
  else{
   const status=e.state==='fresh'?'数据由服务端缓存，抓取时间不等于链上事件时间。':e.state==='stale'?'旧快照：以下仅供历史参考，不用于当前确认。':'尚无有效快照；不会把缺失数据填为 0。';
   html+='<p class="oc-status '+(e.state==='fresh'?'':'down')+'">'+escape(status)+(r?.error?' · 采集原因：'+escape(r.error):'')+'</p>'+
    '<div class="oc-identity"><span>'+escape(t.chain)+' · chainId '+escape(t.chainId)+'</span><code>'+escape(t.address)+'</code>'+(chainExplorer(t)?'<a href="'+escape(chainExplorer(t))+'" target="_blank" rel="noopener noreferrer">区块浏览器 ↗</a>':'<span>浏览器链接不可用</span>')+'</div>';
   if(r&&e.state!=='unavailable'){
    const tx=r.txns||{},bias=countBias(tx.h1),change=r.liquidityChangePct;
    const delta=typeof change==='number'&&Number.isFinite(change)&&r.liquidityBaselineAt?(change>=0?'+':'')+change.toFixed(2)+'%':'等待可比快照';
    const sample=tx.h1,counts=sample&&num(sample.buys)!==null&&num(sample.sells)!==null?fN(sample.buys,0)+' / '+fN(sample.sells,0):'暂无';
    html+='<div class="oc-metrics">'+metric('可计量池流动性',fmt(r.liquidityUsd))+metric('1h DEX 成交额',fmt(r.volumeUsd?.h1))+metric('24h DEX 成交额',fmt(r.volumeUsd?.h24))+metric('1h 买 / 卖笔数',counts)+metric('可比池流动性变化',delta)+metric('买卖金额差额','暂无')+'</div>'+
     '<div class="oc-evidence '+e.kind+'">'+escape(e.text)+'<span>仅为辅助证据，不改变合约信号或评分</span></div>'+
     '<p class="mut">1h 买入笔数占比 '+(bias.share===null?'暂无':(bias.share*100).toFixed(1)+'%')+'；笔数不是金额，地址转账不是买卖。大户持仓 / Top10 集中度：暂无。</p>';
    if(r.liquidityBaselineAt)html+='<p class="mut">流动性比较起点：'+escape(tm(r.liquidityBaselineAt))+'；仅比较相同池集合，USD 变化可能受币价影响，不等于注入 / 撤出资金。</p>';
    html+='<p class="mut">抓取：'+escape(tm(r.fetchedAt))+' · 最近尝试：'+escape(tm(r.lastAttemptAt||r.fetchedAt))+'<br>来源：DEX Screener，未提供底层数据更新时间；'+escape(coverageText(r))+'</p>';
    const pools=Array.isArray(r.pools)?r.pools.slice(0,20):[];
    html+='<details class="oc-pools"><summary>查看纳入的 '+pools.length+' 个池子</summary><div class="tblwrap"><table class="tbl"><thead><tr><th>DEX / 池地址</th><th>流动性</th><th>24h成交额</th></tr></thead><tbody>'+pools.map(p=>'<tr><td>'+poolLink(t,p)+'</td><td>'+fmt(p.liquidityUsd)+'</td><td>'+fmt(p.volumeUsd?.h24)+'</td></tr>').join('')+'</tbody></table></div></details>';
   }
   let panel=channelPanel(r,t);
   if(root.TransferEvidence){const transferHtml=root.TransferEvidence.render(OC.transferCache,t);const transferMode=OC.transferCache?.collectionMode==='github_actions'?'Transfer 由 Actions 独立采样，覆盖仅限显示的区块范围。':OC.transferCache?.collectionMode==='manual'?'当前 Transfer 为手动采样；不代表自动扫描已完成。':'Transfer 执行方式尚未确认。';panel=panel.replace(/<section data-oc-channel="transfers">[\s\S]*?<\/section>/,'<section data-oc-channel="transfers">'+transferHtml+'<p class="mut">'+transferMode+'</p></section>')}
   html+=panel;
   html+='<div class="oc-sources">合约依据：'+t.sources.map(s=>'<a href="'+escape(safeUrl(s.url))+'" target="_blank" rel="noopener noreferrer">'+escape(s.label||'来源')+' ↗</a>').join(' · ')+'</div>';
  }
  if(OC.error)html+='<p class="down">缓存读取失败：'+escape(OC.error)+'。现有旧快照不视作实时数据。</p>';
  if(OC.transferError)html+='<p class="down">'+escape(OC.transferError)+'；DEX 与目录状态不受此通道影响。</p>';
  html+='<p class="oc-method">口径：仅精确登记身份的 API 返回 base 侧池；池间去重，但跨池路由成交可能重复计入。成交额不是独立资金流，池流动性不是可无滑点成交深度。刷新只重读缓存，不触发链上采集；'+(OC.collectionMode==='actions'?'采样由 Actions 执行，计划每 30 分钟，可能延迟。':'当前为手动快照版，定时更新尚未启用。')+'</p><button id="ocRefresh" class="btn mini" '+(OC.loading?'disabled':'')+'>'+(OC.loading?'读取缓存…':'↻ 重读链上缓存')+'</button>';
  const body=el('#ocDetailBody');
  if(body&&body.ocRenderedHtml!==html){
   body.innerHTML=html;body.ocRenderedHtml=html;
   const poolsDetails=box.querySelector('.oc-pools');if(poolsDetails)poolsDetails.open=!!opened;
   const refresh=el('#ocRefresh');if(refresh)refresh.onclick=()=>load(true);
  }
 }
 function metric(label,value){return '<div><span>'+escape(label)+'</span><b>'+escape(value)+'</b></div>'}
 function coverageText(r){const c=r.coverage||{},f=c.fields?.liquidityUsd;return '纳入 '+(c.selectedPools??r.pools?.length??0)+' / '+(c.acceptedPools??r.pools?.length??0)+' 个合法去重池，API 返回 '+(c.returnedPools??'未知')+' 池；'+(f?'流动性披露 '+f.knownPools+'/'+f.totalPools+' 池'+(!f.complete?'（总额暂无，未披露不补零）':'')+'；':'')+'非全链全 DEX 覆盖'}
 function render(){
  const c=catalogCounts(OC.universe,OC.registry,OC.rows);OC.counts=c;
  const status=el('#ocSummary');
  const summary=(c.total?'全市场目录 '+c.total+' 个 · 目录已映射 '+c.mapped+' 个':'全市场目录尚未加载')+' · 有效地址 '+c.valid+' 个（official '+c.official+' / provider_matched '+c.provider+'） · DEX 有效快照 '+c.fresh+' 个 / 旧 '+c.stale+' 个 / 暂无 '+c.missing+' 个'+(OC.loading?' · 读取缓存中…':OC.error?' · 部分缓存读取失败，见详情':'')+(OC.collectionMode==='actions'?' · Actions 缓存':' · 手动快照');
  setText(status,summary);
  const filter=el('#ocOnly');if(filter){
   const only=OC.only[listContext()];if(filter.classList.contains('pri')!==only)filter.classList.toggle('pri',only);
   setText(filter,only?'✓ 只看有效映射':'链上筛选');if(filter.disabled!==(c.valid===0))filter.disabled=c.valid===0;
  }
  // No registry-sized shortcuts: use the existing market search and coin detail.
  const pilots=el('#ocPilotList');if(pilots)pilots.remove();
  const cts=c.counts;
  setText(el('#ocOpNote'),c.total?'目录状态（不代表数据已接入）：原生无 DEX 合约 '+cts.native_no_dex_contract+' · 未适配 '+cts.no_adapter+' · 身份歧义 '+cts.ambiguous_identity+' · 待核实 '+cts.pending_verification+'。official 为官方元数据依据，provider_matched 为提供方匹配，不等于项目方独立核验；不补零、不猜地址，不参与合约评分。':'目录尚未加载；有效地址与 DEX / Transfer 缓存独立显示，不把未加载状态当作已覆盖。');
  renderDetail();decorate();
 }
 const readError=err=>err?.name==='AbortError'?'请求超时':String(err?.message||'缓存读取失败');
 const staleRows=rows=>Object.fromEntries(Object.entries(rows).map(([k,r])=>[k,{...r,status:'stale'}]));
 async function load(force=false){
  if(OC.promise)return OC.promise;
  if(OC.loaded&&!force){render();return}
  OC.loading=true;render();
  OC.promise=(async()=>{
   try{
    const read=async path=>{try{return {data:await getJson(path,force)}}catch(error){return {error}}};
    // Start all four cache requests together; one channel failure cannot suppress another.
    const [reg,catalogData,dex,transfers]=await Promise.all([
     read('onchain.registry.json'),read('onchain.universe.json'),read('data/onchain.json'),read('data/transfers.json')
    ]);
    const errors={},decode=(result,validate)=>{if(result.error)throw result.error;return validate(result.data)};
    try{OC.registry=decode(reg,validateRegistry);OC.registryBySymbol=symbolIndex(OC.registry)}catch(err){errors.registry='地址登记：'+readError(err)}
    try{OC.universe=decode(catalogData,validateUniverse);OC.universeBySymbol=symbolIndex(OC.universe)}catch(err){errors.universe='全市场目录：'+readError(err)}
    try{
     if(!OC.registry.length)throw Error('地址登记暂无，无法精确绑定 DEX 快照');
     OC.rows=decode(dex,data=>validateSnapshot(data,OC.registry));
     if(errors.registry)OC.rows=staleRows(OC.rows);
     OC.collectionMode=dex.data.collectionMode==='actions'?'actions':'manual';
    }catch(err){errors.dex='DEX 快照：'+readError(err);OC.rows=staleRows(OC.rows)}
    // Transfer is also independent of DEX; existing renderer performs per-identity validation.
    if(transfers.error){OC.transferCache=null;OC.transferError='转账缓存不可用：'+readError(transfers.error);errors.transfers=OC.transferError}
    else{OC.transferCache=transfers.data;OC.transferError=''}
    OC.errors=errors;OC.error=['registry','universe','dex'].filter(k=>errors[k]).map(k=>errors[k]).join('；');
    OC.loaded=!!(OC.registry.length||OC.universe.length);
   }finally{OC.loading=false;OC.promise=null;render();if(S.ov.ready)ovRender();decorate()}
  })();
  return OC.promise;
 }
 function init(){
  if(OC.initialized)return OC.promise;OC.initialized=true;
  const heading=document.createElement('div');heading.className='oc-toolbar';
  heading.innerHTML='<button class="btn mini" id="ocOnly" disabled>链上筛选</button><span class="mut" id="ocSummary">链上缓存读取中…</span>';
  el('#ovSearch').parentElement.parentElement.after(heading);
  el('#ocOnly').onclick=()=>{const k=listContext();OC.only[k]=!OC.only[k];S.ov.page=1;ovRender();render()};
  const note=document.createElement('p');note.id='ocOpNote';note.className='workspace-help';el('#opHelp').after(note);
  const box=document.createElement('details');box.id='ocDetail';box.className='fold';
  box.innerHTML='<summary><span id="ocDetailTitle">链上证据</span><span id="ocDetailStatus">读取中</span></summary><div id="ocDetailBody" class="oc-body"></div>';
  el('#v-detail').prepend(box);
  let queued=false;
  const observer=new MutationObserver(muts=>{
   const needsRows=muts.some(m=>[...m.addedNodes].some(n=>n.nodeType===1&&!n.matches?.('.oc-badge')&&(n.matches?.('tr,a[data-sym],a[data-st-sym]')||n.querySelector?.('a[data-sym],a[data-st-sym]'))));
   if(needsRows&&!queued){queued=true;Promise.resolve().then(()=>{queued=false;decorate()})}
  });
  for(const id of ['ovTbl','scTbl','qdTbl','idTbl','stTbl','rtTbl']){const body=el('#'+id)?.querySelector('tbody');if(body)observer.observe(body,{childList:true,subtree:true})}
  root.onchainLoad=load;root.onchainRender=render;root.onchainDecorate=decorate;
  setInterval(()=>{if(!document.hidden)render()},60000);
  load();
 }
 root.onchainInit=init;
})(globalThis);
