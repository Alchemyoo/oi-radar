/* Rolling24 relay integration + browser direct official 5m / archive fallback. */
(function(root){
'use strict';
const KEY='oif_lastscan_rolling24_v2';
const KEY_DIRECT='oif_lastscan_direct_v1';
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function calc5mZ(series){
 if(!Array.isArray(series)||series.length<30)return null;
 const rets=[];
 for(let i=1;i<series.length;i++){
  const a=+series[i-1].sumOpenInterest,b=+series[i].sumOpenInterest;
  if(a>0&&b>0&&Number.isFinite(a)&&Number.isFinite(b))rets.push(b/a-1);
 }
 if(rets.length<24)return null;
 const mu=rets.reduce((s,x)=>s+x,0)/rets.length;
 const sd=Math.sqrt(rets.reduce((s,x)=>s+(x-mu)**2,0)/rets.length);
 if(!(sd>1e-9))return null;
 const total=+series[series.length-1].sumOpenInterest/+series[0].sumOpenInterest-1;
 return (total-mu*rets.length)/(sd*Math.sqrt(rets.length));
}
function create(h){
 const {S,$,store,toast,ban,fetchJSON,R,render,filtered,csvDown,relay}=h;
 let request=null;
 function blocked(message,allowDirect){
  S.sc.state='unsupported';
  $('#scStat').textContent=message;
  const extra=allowDirect&&typeof h.directScan==='function'
   ?' <button type="button" class="btn mini pri" id="scFallbackDirect" style="margin-left:8px">⚡ 切换浏览器直连扫描</button>':'';
  ban('#scBan','warn',esc(message)+extra);
  if(extra&&typeof document!=='undefined'){
   const btn=document.getElementById('scFallbackDirect');
   if(btn)btn.onclick=()=>scGoDirect();
  }
 }
 async function scGo(){
  if(S.sc.run)return;
  if(S.sc.mode==='z'){blocked('σ 不支持：24h 同策略基准未准备；不使用日基准或改阈值',false);return}
  if(!S.ov.ready||!S.ov.list.length){toast('合约列表未就绪');return}
  const p={oiPct:Number($('#scOiPct').value),pxPct:Number($('#scPxPct').value),minOi:Number($('#scMinOi').value)};
  if(!Object.values(p).every(Number.isFinite)||p.pxPct<0||p.minOi<0){toast('阈值必须为有限数值');return}
  const config={U:S.sc.U,mode:'pct'};
  let list=[...S.ov.list].sort((a,b)=>b.vol-a.vol);if(S.sc.U>0)list=list.slice(0,S.sc.U);
  if(list.length>50){blocked('unsupported：单一共同窗口协议最多50币；Top100/全部不能分批各选端点',false);return}
  S.sc.run=true;S.sc.stop=false;S.sc.state='checking';$('#scGo').disabled=true;$('#scStop').disabled=false;
  if($('#scDirectGo'))$('#scDirectGo').disabled=true;
  request=new AbortController();const current=request;const timer=setTimeout(()=>current.abort(),70000);
  const checkStopped=()=>{if(S.sc.stop||current.signal.aborted)throw Error('stopped')};
  try{
   const health=await fetchJSON(relay+'/health',{signal:request.signal});
   checkStopped();
   const cap=health?.capabilities?.rolling24;
   if(!cap?.ready||cap.schemaVersion!==2||cap.maxSymbols<list.length)throw Error('unsupported：后台未声明 rolling24 v2 可用；不退回日线');
   const wanted=list.map(x=>x.sym),requestId=crypto.randomUUID().replace(/-/g,'');
   const queued=await fetchJSON(relay+'/query',{method:'POST',signal:request.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'rolling24',symbols:wanted,requestId})});
   checkStopped();
   if(!/^[a-f0-9]{32}$/.test(queued.jobId))throw Error('invalid_job_id');
   S.sc.state='loading';$('#scStat').textContent='滚动24h共同端点查询中…';
   let result=null;
   for(let i=0;i<46;i++){
    if(S.sc.stop)throw Error('stopped');
    const value=await fetchJSON(relay+'/result/'+queued.jobId,{signal:request.signal});
    if(value.status==='error')throw Error(value.error||'relay_error');
    if(value.schemaVersion===2){result=value;break}
    if(!['queued','running'].includes(value.status))throw Error('invalid_result');
    await new Promise(resolve=>setTimeout(resolve,1500));
   }
   if(!result)throw Error('timeout');
   const rows=R.validateResult(result,wanted,Date.now());
   if(S.sc.stop)throw Error('stopped');
   rows.forEach(row=>row.pick=R.pick(row,p));
   // Atomic full-universe replacement: failed requests never relabel previous rows.
   S.sc.rows=rows;S.sc.win=result.window;S.sc.result=result;S.sc.params=p;S.sc.mode='pct';
   S.sc.config=config;S.sc.directMeta=null;
   S.sc.t0=result.receivedAt;S.sc.state='ready';
   scSave();render();scMeta();$('#scStat').textContent=`完成 ${rows.length}/${rows.length} · 24h共同端点`;
  }catch(e){
   if(S.sc.stop){S.sc.state='stopped';$('#scStat').textContent='已停止；没有写入部分结果'}
   else blocked(e.message+'（保留已有结果，但不视为本次成功）',true);
  }finally{clearTimeout(timer);request=null;S.sc.run=false;$('#scGo').disabled=false;$('#scStop').disabled=true;if($('#scDirectGo'))$('#scDirectGo').disabled=false}
 }
 async function scGoDirect(){
  if(S.sc.run)return;
  if(typeof h.directScan!=='function'){toast('当前环境未启用浏览器直连器');return}
  if(!S.ov.ready||!S.ov.list.length){toast('合约列表未就绪，请稍候');return}
  const p={oiPct:Number($('#scOiPct').value),pxPct:Number($('#scPxPct').value),minOi:Number($('#scMinOi').value)};
  if(!Object.values(p).every(Number.isFinite)||p.pxPct<0||p.minOi<0){toast('阈值必须为有限数值');return}
  let list=[...S.ov.list].sort((a,b)=>b.vol-a.vol);
  const limit=S.sc.U>0?Math.min(S.sc.U,80):50;
  list=list.slice(0,limit);
  S.sc.run=true;S.sc.stop=false;S.sc.state='loading';
  $('#scGo').disabled=true;$('#scStop').disabled=false;if($('#scDirectGo'))$('#scDirectGo').disabled=true;
  ban('#scBan','',null);
  const bar=$('#scBar'),fill=$('#scBar i');
  if(bar)bar.classList.add('on');if(fill)fill.style.width='0%';
  request=new AbortController();const current=request;
  try{
   const out=await h.directScan({
    list,params:p,signal:current.signal,
    isStopped:()=>S.sc.stop||current.signal.aborted,
    calcZ:calc5mZ,
    onProgress:(done,total,phase)=>{
     $('#scStat').textContent=`${phase||'直连扫描'} ${done}/${total}…`;
     if(fill&&total>0)fill.style.width=Math.min(100,done/total*100).toFixed(1)+'%';
    }
   });
   if(S.sc.stop||current.signal.aborted)throw Error('stopped');
   if(!out||!Array.isArray(out.rows)||!out.rows.length)throw Error('直连未获取到有效同端点样本');
   out.rows.forEach(row=>{row.pick=R.pick(row,p)});
   S.sc.rows=out.rows;
   S.sc.win=out.window;
   S.sc.result=null;
   S.sc.directMeta={receivedAt:out.receivedAt,sourceLabel:out.sourceLabel,failed:out.failed||0,total:list.length,src:out.src};
   S.sc.params=p;S.sc.mode='pct';S.sc.config={U:limit,mode:'pct'};
   S.sc.t0=out.receivedAt;S.sc.state='ready';
   store.set(KEY_DIRECT,{schemaVersion:1,t:out.receivedAt,U:limit,params:p,window:out.window,directMeta:S.sc.directMeta,rows:out.rows});
   render();scMeta();
   $('#scStat').textContent=`直连完成 ${out.rows.length}/${list.length}`+(out.failed?` · 缺档/失败 ${out.failed}`:'')+` · 入选 ${out.rows.filter(x=>x.pick).length}`;
  }catch(e){
   if(S.sc.stop||e.message==='stopped'){S.sc.state='stopped';$('#scStat').textContent='已停止；没有写入部分结果'}
   else blocked('直连扫描失败：'+(e.message||e)+'（保留已有结果）',false);
  }finally{
   if(bar)bar.classList.remove('on');
   request=null;S.sc.run=false;$('#scGo').disabled=false;$('#scStop').disabled=true;if($('#scDirectGo'))$('#scDirectGo').disabled=false;
  }
 }
 function scSave(){
  if(!S.sc.result)return;
  store.set(KEY,{schemaVersion:2,mode:'rolling24',strategy:'pct',t:S.sc.t0,U:S.sc.config.U,params:S.sc.params,result:S.sc.result});
 }
 function scRestore(last){
  last=last||store.get(KEY,null);
  if(last&&last.schemaVersion===2&&last.mode==='rolling24'&&last.strategy==='pct'){
   try{
    // Historical restore validates against recorded receive clock, not current freshness.
    const rows=R.validateResult(last.result,last.result.symbols,last.result.receivedAt);
    rows.forEach(row=>row.pick=R.pick(row,last.params));
    S.sc.rows=rows;S.sc.win=last.result.window;S.sc.result=last.result;S.sc.params=last.params;
    S.sc.U=last.U??50;S.sc.mode='pct';S.sc.config={U:S.sc.U,mode:'pct'};S.sc.directMeta=null;
    S.sc.t0=last.t;S.sc.state='history';
    $('#scStat').textContent='历史滚动24h记录（非当前信号）';scMeta();return true;
   }catch(e){return false}
  }
  if(!last){
   const d=store.get(KEY_DIRECT,null);
   if(d&&d.schemaVersion===1&&Array.isArray(d.rows)&&d.rows.length&&d.window){
    S.sc.rows=d.rows;S.sc.win=d.window;S.sc.result=null;S.sc.directMeta=d.directMeta||null;
    S.sc.params=d.params;S.sc.U=d.U??50;S.sc.mode='pct';S.sc.config={U:S.sc.U,mode:'pct'};
    S.sc.t0=d.t;S.sc.state='history';
    $('#scStat').textContent='历史直连24h记录（非当前信号）';scMeta();return true;
   }
  }
  return false;
 }
 function scMeta(){
  const c=$('#scChips');c.style.display='flex';
  const w=S.sc.win;if(!w){c.textContent='尚无滚动24h结果';return}
  if(S.sc.directMeta&&!S.sc.result){
   const dm=S.sc.directMeta,collected=dm.receivedAt||S.sc.t0||Date.now();
   const fresh=S.sc.state==='ready'&&Date.now()-collected<=300000;
   c.textContent=`${fresh?'本次直连结果':'历史直连记录（非当前信号）'} · 采集时间 ${new Date(collected).toISOString()} · ${new Date(w.startMs).toISOString()} → ${new Date(w.endMs).toISOString()} · ${dm.sourceLabel||'官方直连'} · 有效 ${S.sc.rows.length}/${dm.total||S.sc.rows.length}币 · 入选 ${S.sc.rows.filter(x=>x.pick).length}`;
   return;
  }
  const collected=S.sc.result?.receivedAt;
  const fresh=S.sc.state==='ready'&&Date.now()-w.endMs<=R.LAG&&Date.now()>=collected&&Date.now()-collected<=120000;
  c.textContent=`${fresh?'本次结果':'历史记录（非当前信号）'} · 采集时间 ${new Date(collected).toISOString()} · ${new Date(w.startMs).toISOString()} → ${new Date(w.endMs).toISOString()} · 严格24h · ${S.sc.rows.length}币 · 入选 ${S.sc.rows.filter(x=>x.pick).length} · OI官方5m精确快照 / 价格同窗已闭合5m close · T+1不适用，后验待定义`;
 }
 function scCsv(){
  if(!S.sc.rows.length){toast('无可导出数据');return}
  const collectedAt=S.sc.result?.receivedAt||S.sc.directMeta?.receivedAt||S.sc.t0||Date.now();
  csvDown('OI异动扫描_rolling24.csv',['币种','窗口起始UTC','窗口截止UTC','模式','OI期初USDT','OI期末USDT','OI期初币数','OI期末币数','名义值变化USDT','名义值%','币数%','价格%','入选','OI证据源','价格证据源','后验','采集时间UTC'],filtered().map(r=>[r.sym,new Date(r.startMs).toISOString(),new Date(r.endMs).toISOString(),'rolling24',r.oiS,r.oiE,r.coinS,r.coinE,r.flow,r.net,r.coinNet,r.px,r.pick?'是':'否',r.src,r.priceSource,'未定义(next=null)',new Date(collectedAt).toISOString()]));
 }
 function stop(){S.sc.stop=true;request?.abort();$('#scStop').disabled=true}
 return {scGo,scGoDirect,scSave,scRestore,scMeta,scCsv,stop};
}
root.RollingScanDraft={create,calc5mZ};
})(globalThis);
