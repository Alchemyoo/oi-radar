/* HYPE-only public market context. Not chain evidence or trade signals. */
(function(root){
 'use strict';
 const ENDPOINT='https://api.hyperliquid.xyz/info',TTL=90000;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function number(v,signed=false){
  if((typeof v!=='number'&&typeof v!=='string')||(typeof v==='string'&&!v.trim()))return null;
  const n=Number(v);return Number.isFinite(n)&&(signed||n>=0)?n:null;
 }
 function product(a,b){const n=a===null||b===null?null:a*b;return Number.isFinite(n)?n:null}
 function parse(data){
  if(!Array.isArray(data)||data.length!==2||!Array.isArray(data[0]?.universe)||!Array.isArray(data[1])||data[0].universe.length!==data[1].length)throw Error('行情响应格式无效');
  const universe=data[0].universe,indices=universe.flatMap((a,i)=>a?.name==='HYPE'?[i]:[]);
  if(indices.length>1)throw Error('HYPE 市场映射不唯一');
  if(!indices.length)return null;
  const i=indices[0],ctx=data[1][i];
  if(!ctx||typeof ctx!=='object'||Array.isArray(ctx))throw Error('HYPE 行情上下文无效');
  const mark=number(ctx.markPx),oracle=number(ctx.oraclePx),prev=number(ctx.prevDayPx),oi=number(ctx.openInterest);
  const rawReturn=mark!==null&&prev!==null&&prev>0?(mark/prev-1)*100:null;
  return {symbol:'HYPE',delisted:universe[i].isDelisted===true,mark,oracle,prevDayPx:prev,
   return24h:Number.isFinite(rawReturn)?rawReturn:null,openInterest:oi,oiNotional:product(oi,mark),
   funding:number(ctx.funding,true),premium:number(ctx.premium,true),dayNtlVlm:number(ctx.dayNtlVlm),dayBaseVlm:number(ctx.dayBaseVlm)};
 }
 async function request(fetcher=root.fetch){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),12000);
  try{
   const res=await fetcher(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'metaAndAssetCtxs'}),signal:ctl.signal});
   if(!res.ok)throw Error('HTTP '+res.status);
   return parse(await res.json());
  }finally{clearTimeout(timer)}
 }
 const cash=v=>v===null?'未知':'$'+v.toLocaleString('en-US',{maximumFractionDigits:6});
 const units=v=>v===null?'未知':v.toLocaleString('en-US',{maximumFractionDigits:4})+' HYPE';
 const pct=v=>v===null?'未知':(v>=0?'+':'')+v.toFixed(4)+'%';
 const metric=(label,value)=>'<div><span>'+esc(label)+'</span><b>'+esc(value)+'</b></div>';
 function view(s,now=Date.now()){
  const stale=!!s.fetchedAt&&(s.status==='error'||now-s.fetchedAt>TTL),r=s.row;
  const status=s.status==='loading'?'加载中…':s.status==='error'?'读取失败':s.status==='missing'?'API 未提供 HYPE 市场':s.status==='idle'?'尚未加载':stale?'旧行情 · 待刷新':r?.delisted?'HYPE 已下架':'行情快照';
  let html='<div class="hl-heading"><h3>Hyperliquid · HYPE</h3><button id="hlRefresh" class="btn mini" '+(s.status==='loading'?'disabled':'')+'>↻ '+(s.status==='loading'?'加载中':'刷新 HYPE')+'</button></div><p id="hlStatus" role="status">'+esc(status)+'</p>';
  if(s.error)html+='<p class="down">'+esc(s.error)+'；可点击刷新重试。</p>';
  if(r){
   if(stale||s.status==='loading')html+='<p class="mut">以下为上次快照，仅供历史参考，不代表当前行情。</p>';
   html+='<div class="hl-metrics">'+metric('标记价格',cash(r.mark))+metric('预言机价格',cash(r.oracle))+metric('24h 价格变化（标记 / 前日）',pct(r.return24h))+metric('前日价格 prevDayPx',cash(r.prevDayPx))+metric('OI 数量',units(r.openInterest))+metric('OI 名义价值（标记价）',cash(r.oiNotional))+metric('24h 名义成交额 dayNtlVlm',cash(r.dayNtlVlm))+metric('24h 基础成交量 dayBaseVlm',units(r.dayBaseVlm))+metric('资金费率 funding（API 原值 ×100%）',pct(product(r.funding,100)))+metric('溢价 premium（API 原值 ×100%）',pct(product(r.premium,100)))+'</div>';
  }else html+='<p class="mut">'+(s.status==='missing'?'仅按 universe 的精确名称 HYPE 匹配，不用其他代币替代。':'未获取的字段显示未知，不以 0 补缺。')+'</p>';
  html+='<p class="hl-note">来源：<a href="https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint" target="_blank" rel="noopener noreferrer">Hyperliquid 公共 info API ↗</a> · POST metaAndAssetCtxs<br>本机成功读取时间：'+esc(s.fetchedAt?new Date(s.fetchedAt).toLocaleString('zh-CN',{hour12:false}):'未知')+'（不是交易所事件时间）。90 秒后标旧；仅进入本板块或手动刷新时请求。<br>资金费率为接口原值；此响应未返回结算周期，不将其标为 1h / 8h，不换算年化，不与 Binance 费率直接比较。24h 变化按 markPx / prevDayPx − 1 计算；OI 名义值为 openInterest × markPx，非资金流。<br>仅 HYPE 永续市场，不扩展为生态代币清单；行情 API 不是链上异动证据，不参与 Binance 排序、评分、监测和自选。仅供数据观察，不构成交易建议。</p>';
  return html;
 }
 const Core={ENDPOINT,TTL,number,product,parse,request,view};
 if(typeof module!=='undefined'&&module.exports){module.exports=Core;return}
 root.HyperliquidCore=Core;
 const H={status:'idle',row:null,fetchedAt:0,error:'',promise:null};root.Hyperliquid=H;
 const box=()=>document.querySelector('#hlBoard');
 function render(){if(box())box().innerHTML=view(H)}
 function load(force=false){
  if(H.promise)return H.promise;
  if(!force&&H.fetchedAt&&Date.now()-H.fetchedAt<=TTL&&['ready','missing'].includes(H.status)){render();return Promise.resolve()}
  H.status='loading';H.error='';render();
  H.promise=(async()=>{
   try{H.row=await request();H.fetchedAt=Date.now();H.status=H.row?'ready':'missing'}
   catch(e){H.error=e.name==='AbortError'?'请求超时':e.message;H.status='error'}
   finally{H.promise=null;render()}
  })();return H.promise;
 }
 root.hyperliquidLoad=load;
 root.hyperliquidInit=()=>{
  if(document.querySelector('#v-hype'))return;
  const section=document.createElement('section');section.id='v-hype';section.className='op-panel';section.hidden=true;
  section.innerHTML='<div class="card hl-board" id="hlBoard"></div>';document.querySelector('#v-opportunity').append(section);
  section.addEventListener('click',e=>{if(e.target.closest('#hlRefresh'))load(true)});
  render();setInterval(()=>{if(!document.hidden&&box()&&!section.hidden&&H.status!=='loading')render()},15000);
 };
})(globalThis);
