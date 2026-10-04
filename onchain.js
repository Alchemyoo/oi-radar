/* Public cached chain evidence; never changes contract scoring or launches scans. */
(function(root){
 'use strict';
 const TTL=90*60*1000;
 const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const safeUrl=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:''}catch(_){return ''}};
 function identity(a,b){return !!a&&!!b&&a.symbol===b.symbol&&a.chain===b.chain&&a.chainId===b.chainId&&/^0x[0-9a-f]{40}$/i.test(a.address||'')&&String(a.address).toLowerCase()===String(b.address).toLowerCase()}
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
  if(data?.schemaVersion!==1||!Array.isArray(data.tokens)||!data.tokens.length||data.tokens.length>20)throw Error('合约映射格式无效');
  const seen=new Set();
  for(const t of data.tokens){
   if(!t||typeof t.symbol!=='string'||!t.symbol.endsWith('USDT')||seen.has(t.symbol)||t.chain!=='bsc'||t.chainId!==56||!/^0x[0-9a-f]{40}$/i.test(t.address||'')||!Array.isArray(t.sources)||!t.sources.length||t.sources.some(s=>!safeUrl(s.url)))throw Error('合约映射未通过校验');
   seen.add(t.symbol);
  }
  return data.tokens;
 }
 function validateSnapshot(data,registry){
  if(data?.schemaVersion!==1||!data.tokens||typeof data.tokens!=='object'||Array.isArray(data.tokens))throw Error('链上快照格式无效');
  const rows={};
  for(const token of registry){
   const r=data.tokens[token.symbol];
   if(!r)continue;
   if(!identity(r.identity,token))continue;
   rows[token.symbol]=r;
  }
  return rows;
 }
 // Cache-only alert lookup: exact verified identity; never fetch per alert.
 function alertTag(sym,registry=[],rows={},now=Date.now()){
  if(sym==='HYPE'||sym==='HYPEUSDT')return ' · HYPE 行情 API 非链上证据 · 未接入可验证链上数据';
  const t=registry.find(t=>t.symbol===sym);
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
 const Core={TTL,num,escape,safeUrl,identity,freshness,countBias,evidence,validateRegistry,validateSnapshot,alertTag};
 if(typeof module!=='undefined'&&module.exports){module.exports=Core;return}
 const OC={registry:[],rows:{},loading:false,loaded:false,error:'',only:{market:false,watch:false},promise:null};
 const listContext=()=>S.ov.favOnly?'watch':'market';
 root.Onchain=OC;root.OnchainCore=Core;
 const el=s=>document.querySelector(s);
 const fmt=v=>num(v)===null?'暂无':'$'+fC(v);
 const tm=t=>{const d=new Date(t);return Number.isFinite(d.getTime())?d.toLocaleString('zh-CN',{hour12:false}):'暂无'};
 function token(sym){return OC.registry.find(t=>t.symbol===sym)}
 function row(sym){const t=token(sym),r=OC.rows[sym];return identity(r?.identity,t)?r:null}
 function badgeState(sym){
  if(!token(sym)||sym==='HYPE'||sym==='HYPEUSDT')return {text:'未接入可验证链上数据',kind:'neutral',unmapped:true};
  const e=evidence(row(sym));
  return {...e,text:e.state==='unavailable'?'链上快照暂无':e.state==='stale'?'链上旧':e.text};
 }
 function tag(sym){
  const b=badgeState(sym);
  return '<span class="oc-badge '+b.kind+(b.unmapped?' oc-unmapped':'')+'" title="'+escape(alertTag(sym,OC.registry,OC.rows)+' · 点击币种查看证据范围')+'">'+escape(b.text)+'</span>';
 }
 root.onchainBadge=tag;
 root.onchainAlertTag=sym=>alertTag(sym,OC.registry,OC.rows);
 root.onchainFilter=rows=>OC.only[listContext()]?rows.filter(r=>!!token(r.sym)):rows;
 root.onchainDetailChanged=()=>renderDetail();
 function decorate(){
  for(const sel of ['#ovTbl','#scTbl','#qdTbl','#idTbl','#stTbl','#rtTbl']){
   const table=el(sel);if(!table)continue;
   for(const a of table.querySelectorAll('a[data-sym],a[data-st-sym]')){
    const sym=a.dataset.sym||a.dataset.stSym,state=badgeState(sym);
    let b=a.parentNode.querySelector('.oc-badge');
    if(!b){b=document.createElement('span');a.after(b)}
    b.className='oc-badge '+state.kind+(state.unmapped?' oc-unmapped':'');
    b.textContent=state.text;
    b.title=alertTag(sym,OC.registry,OC.rows)+' · 抓取 '+tm(row(sym)?.fetchedAt)+'；笔数≠资金流；不参与合约评分';
   }
  }
 }
 function renderDetail(){
  const box=el('#ocDetail');if(!box)return;
  const sym=S.dt.sym,t=token(sym),r=row(sym),e=evidence(r);
  const opened=box.dataset.renderedSym===sym&&box.querySelector('.oc-pools')?.open;
  box.dataset.renderedSym=sym;
  el('#ocDetailTitle').textContent='链上证据 · '+(sym||'选择币种');
  el('#ocDetailStatus').textContent=!t?'未接入可验证链上数据':e.state==='fresh'?'缓存快照':e.state==='stale'?'旧快照':'暂无数据';
  let html='';
  if(!t){html='<p class="mut">该币尚未核实链与合约地址，不按名称自动匹配。首期支持：</p>'+pilotButtons();}
  else{
   const status=e.state==='fresh'?'数据由服务端缓存，抓取时间不等于链上事件时间。':e.state==='stale'?'旧快照：以下仅供历史参考，不用于当前确认。':'尚无有效快照；不会把缺失数据填为 0。';
   html='<p class="oc-status '+(e.state==='fresh'?'':'down')+'">'+escape(status)+'</p>'+
    '<div class="oc-identity"><span>BSC · chainId 56</span><code>'+escape(t.address)+'</code><a href="https://bscscan.com/token/'+encodeURIComponent(t.address)+'" target="_blank" rel="noopener noreferrer">区块浏览器 ↗</a></div>';
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
   html+='<div class="oc-sources">合约依据：'+t.sources.map(s=>'<a href="'+escape(safeUrl(s.url))+'" target="_blank" rel="noopener noreferrer">'+escape(s.label||'来源')+' ↗</a>').join(' · ')+'</div>';
  }
  if(OC.error)html+='<p class="down">缓存读取失败：'+escape(OC.error)+'。现有旧快照不视作实时数据。</p>';
  html+='<p class="oc-method">口径：仅已核实合约的 API 返回 base 侧池；池间去重，但跨池路由成交可能重复计入。成交额不是独立资金流，池流动性不是可无滑点成交深度。刷新只重读缓存，不触发链上采集；'+(OC.collectionMode==='actions'?'采样由 Actions 执行，计划每 30 分钟，可能延迟。':'当前为手动快照版，定时更新尚未启用。')+'</p><button id="ocRefresh" class="btn mini" '+(OC.loading?'disabled':'')+'>'+(OC.loading?'读取缓存…':'↻ 重读链上缓存')+'</button>';
  el('#ocDetailBody').innerHTML=html;
  const poolsDetails=box.querySelector('.oc-pools');if(poolsDetails)poolsDetails.open=!!opened;
  el('#ocRefresh').onclick=()=>load(true);
  el('#ocDetailBody').querySelectorAll('[data-oc-sym]').forEach(b=>b.onclick=()=>jumpSym(b.dataset.ocSym));
 }
 function metric(label,value){return '<div><span>'+escape(label)+'</span><b>'+escape(value)+'</b></div>'}
 function poolLink(t,p){
  const address=String(p.pairAddress||''),name=String(p.dexId||'DEX')+' · '+address.slice(0,8)+'…';
  return /^0x[0-9a-f]{40}$/i.test(address)?'<a href="https://dexscreener.com/'+encodeURIComponent(t.chain)+'/'+encodeURIComponent(address)+'" target="_blank" rel="noopener noreferrer">'+escape(name)+' ↗</a>':escape(name);
 }
 function coverageText(r){const c=r.coverage||{},f=c.fields?.liquidityUsd;return '纳入 '+(c.selectedPools??r.pools?.length??0)+' / '+(c.acceptedPools??r.pools?.length??0)+' 个合法去重池，API 返回 '+(c.returnedPools??'未知')+' 池；'+(f?'流动性披露 '+f.knownPools+'/'+f.totalPools+' 池'+(!f.complete?'（总额暂无，未披露不补零）':'')+'；':'')+'非全链全 DEX 覆盖'}
 function pilotButtons(){return '<div class="oc-pilots">'+OC.registry.map(t=>'<button class="btn mini" data-oc-sym="'+escape(t.symbol)+'">'+escape(t.symbol.replace(/USDT$/,''))+'</button>').join('')+'</div>'}
 function render(){
  const status=el('#ocSummary');if(status){
   const n=OC.registry.length,fresh=OC.registry.filter(t=>freshness(row(t.symbol))==='fresh').length;
   status.textContent=OC.loading?'链上缓存读取中…':OC.error?'链上缓存暂不可用':n?'链上试点 '+n+' 币 · '+fresh+' 币快照有效'+(OC.collectionMode==='actions'?' · Actions 缓存':' · 手动快照'):'链上试点暂未加载';
  }
  const filter=el('#ocOnly');if(filter){const only=OC.only[listContext()];filter.classList.toggle('pri',only);filter.textContent=only?'✓ 只看链上试点':'链上试点';filter.disabled=!OC.registry.length}
  const pilots=el('#ocPilotList');if(pilots){pilots.innerHTML=pilotButtons();pilots.querySelectorAll('button').forEach(b=>b.onclick=()=>jumpSym(b.dataset.ocSym))}
  const op=el('#ocOpNote');if(op)op.textContent='链上标签仅覆盖 '+OC.registry.length+' 个已核实币种；当前 1h 笔数 / 流动性证据与合约窗口不同，不合并为评分。';
  renderDetail();decorate();
 }
 async function getJson(path,force){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),12000);
  try{
   const res=await fetch(path+(force?'?t='+Date.now():''),{signal:ctl.signal,cache:force?'reload':'default'});
   if(!res.ok)throw Error('HTTP '+res.status);
   const text=await res.text();if(text.length>2000000)throw Error('快照超过读取上限');
   return JSON.parse(text);
  }finally{clearTimeout(timer)}
 }
 async function load(force=false){
  if(OC.promise)return OC.promise;
  if(OC.loaded&&!force){render();return}
  OC.loading=true;render();
  OC.promise=(async()=>{
   try{
    const reg=validateRegistry(await getJson('onchain.registry.json',force));
    const data=await getJson('data/onchain.json',force);
    const snap=validateSnapshot(data,reg);
    OC.collectionMode=data.collectionMode||'manual';
    OC.registry=reg;OC.rows=snap;OC.loaded=true;OC.error='';
   }catch(err){
    OC.error=err.name==='AbortError'?'请求超时':err.message;
    // A failed reload must not present previous data as current evidence.
    OC.rows=Object.fromEntries(Object.entries(OC.rows).map(([k,r])=>[k,{...r,status:'stale'}]));
   }finally{OC.loading=false;OC.promise=null;render();if(S.ov.ready)ovRender();decorate()}
  })();
  return OC.promise;
 }
 function init(){
  const heading=document.createElement('div');heading.className='oc-toolbar';
  heading.innerHTML='<button class="btn mini" id="ocOnly" disabled>链上试点</button><span class="mut" id="ocSummary">链上缓存读取中…</span>';
  el('#ovSearch').parentElement.parentElement.after(heading);
  el('#ocOnly').onclick=()=>{const k=listContext();OC.only[k]=!OC.only[k];S.ov.page=1;ovRender();render()};
  const note=document.createElement('p');note.id='ocOpNote';note.className='workspace-help';el('#opHelp').after(note);
  const box=document.createElement('details');box.id='ocDetail';box.className='fold';
  box.innerHTML='<summary><span id="ocDetailTitle">链上证据</span><span id="ocDetailStatus">读取中</span></summary><div id="ocDetailBody" class="oc-body"></div>';
  el('#v-detail').prepend(box);
  const pilots=document.createElement('div');pilots.id='ocPilotList';pilots.className='oc-pilots';heading.after(pilots);
  const observer=new MutationObserver(muts=>{if(muts.some(m=>m.addedNodes.length&&[...m.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('tr')||n.querySelector?.('a[data-sym],a[data-st-sym]')))))decorate()});
  for(const id of ['ovTbl','scTbl','qdTbl','idTbl','stTbl','rtTbl'])observer.observe(el('#'+id).querySelector('tbody'),{childList:true});
  root.onchainLoad=load;root.onchainRender=render;root.onchainDecorate=decorate;
  setInterval(()=>{if(!document.hidden)render()},60000);
  load();
 }
 root.onchainInit=init;
})(globalThis);
