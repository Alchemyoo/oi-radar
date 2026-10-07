/* Rolling24 relay integration. No daily/archive/ticker fallback. */
(function(root){
'use strict';
const KEY='oif_lastscan_rolling24_v2';
function create(h){
 const {S,$,store,toast,ban,fetchJSON,R,render,filtered,csvDown,relay}=h;
 let request=null;
 function blocked(message){S.sc.state='unsupported';$('#scStat').textContent=message;ban('#scBan','warn',String(message).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])))}
 async function scGo(){
  if(S.sc.run)return;
  if(S.sc.mode==='z'){blocked('σ 不支持：24h 同策略基准未准备；不使用日基准或改阈值');return}
  if(!S.ov.ready||!S.ov.list.length){toast('合约列表未就绪');return}
  const p={oiPct:Number($('#scOiPct').value),pxPct:Number($('#scPxPct').value),minOi:Number($('#scMinOi').value)};
  if(!Object.values(p).every(Number.isFinite)||p.pxPct<0||p.minOi<0){toast('阈值必须为有限数值');return}
  const config={U:S.sc.U,mode:'pct'};
  let list=[...S.ov.list].sort((a,b)=>b.vol-a.vol);if(S.sc.U>0)list=list.slice(0,S.sc.U);
  if(list.length>50){blocked('unsupported：单一共同窗口协议最多50币；Top100/全部不能分批各选端点');return}
  S.sc.run=true;S.sc.stop=false;S.sc.state='checking';$('#scGo').disabled=true;$('#scStop').disabled=false;
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
   S.sc.config=config;
   S.sc.t0=result.receivedAt;S.sc.state='ready';
   scSave();render();scMeta();$('#scStat').textContent=`完成 ${rows.length}/${rows.length} · 24h共同端点`;
  }catch(e){
   if(S.sc.stop){S.sc.state='stopped';$('#scStat').textContent='已停止；没有写入部分结果'}
   else blocked(e.message+'（保留已有结果，但不视为本次成功）');
  }finally{clearTimeout(timer);request=null;S.sc.run=false;$('#scGo').disabled=false;$('#scStop').disabled=true}
 }
 function scSave(){
  if(!S.sc.result)return;
  store.set(KEY,{schemaVersion:2,mode:'rolling24',strategy:'pct',t:S.sc.t0,U:S.sc.config.U,params:S.sc.params,result:S.sc.result});
 }
 function scRestore(last){
  last=last||store.get(KEY,null);
  if(!last||last.schemaVersion!==2||last.mode!=='rolling24'||last.strategy!=='pct')return false;
  try{
   // Historical restore validates against recorded receive clock, not current freshness.
   const rows=R.validateResult(last.result,last.result.symbols,last.result.receivedAt);
   rows.forEach(row=>row.pick=R.pick(row,last.params));
   S.sc.rows=rows;S.sc.win=last.result.window;S.sc.result=last.result;S.sc.params=last.params;
   S.sc.U=last.U??50;S.sc.mode='pct';S.sc.config={U:S.sc.U,mode:'pct'};
   S.sc.t0=last.t;S.sc.state='history';
   $('#scStat').textContent='历史滚动24h记录（非当前信号）';scMeta();return true;
  }catch(e){return false}
 }
 function scMeta(){
  const c=$('#scChips');c.style.display='flex';
  const w=S.sc.win;if(!w){c.textContent='尚无滚动24h结果';return}
  const collected=S.sc.result?.receivedAt;
  const fresh=S.sc.state==='ready'&&Date.now()-w.endMs<=R.LAG&&Date.now()>=collected&&Date.now()-collected<=120000;
  c.textContent=`${fresh?'本次结果':'历史记录（非当前信号）'} · 采集时间 ${new Date(collected).toISOString()} · ${new Date(w.startMs).toISOString()} → ${new Date(w.endMs).toISOString()} · 严格24h · ${S.sc.rows.length}币 · 入选 ${S.sc.rows.filter(x=>x.pick).length} · OI官方5m精确快照 / 价格同窗已闭合5m close · T+1不适用，后验待定义`;
 }
 function scCsv(){
  if(!S.sc.rows.length){toast('无可导出数据');return}
  csvDown('OI异动扫描_rolling24.csv',['币种','窗口起始UTC','窗口截止UTC','模式','OI期初USDT','OI期末USDT','OI期初币数','OI期末币数','名义值变化USDT','名义值%','币数%','价格%','入选','OI证据源','价格证据源','后验','采集时间UTC'],filtered().map(r=>[r.sym,new Date(r.startMs).toISOString(),new Date(r.endMs).toISOString(),'rolling24',r.oiS,r.oiE,r.coinS,r.coinE,r.flow,r.net,r.coinNet,r.px,r.pick?'是':'否',r.src,r.priceSource,'未定义(next=null)',new Date(S.sc.result.receivedAt).toISOString()]));
 }
 function stop(){S.sc.stop=true;request?.abort();$('#scStop').disabled=true}
 return {scGo,scSave,scRestore,scMeta,scCsv,stop};
}
root.RollingScanDraft={create};
})(globalThis);
