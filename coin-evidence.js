/* Read-only evidence summary. No requests, scoring or inferred trade direction. */
(function(root){'use strict';
const finite=x=>typeof x==='number'&&Number.isFinite(x),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const utc=t=>finite(t)&&t>0?new Date(t).toISOString().slice(0,19).replace('T',' ')+' UTC':'未知';
const pct=n=>finite(n)?(n>=0?'+':'')+n.toFixed(2)+'%':'缺数';
const fmtUsd=v=>{if(!finite(v))return '—';const a=Math.abs(v);return a>=1e9?'$'+(v/1e9).toFixed(2)+'B':a>=1e6?'$'+(v/1e6).toFixed(2)+'M':a>=1e3?'$'+(v/1e3).toFixed(1)+'K':'$'+v.toFixed(0)};
function build(sym,state,radar,now=Date.now(),funding,extra){
 const result=[],add=(title,value,meta,status)=>result.push({title,value,meta,status:status||'missing'});
 const cap=radar?.getEvidence?.(sym,now),row=cap?.row||cap?.snapshotRow;
 if(row){const kind=cap.fresh?'新鲜快照':'历史快照（不参与当前榜单）';add('1H OI币数变化',pct(row.growth),kind+' · '+utc(cap.window?.start)+' → '+utc(cap.window?.end)+' · Binance官方',cap.fresh?'fresh':'historical');add('OI/流通市值',finite(row.ratio)?row.ratio.toFixed(2)+'%':'未映射或市值缺数',kind+' · OI名义值/流通市值 · 市值 '+utc(row.capTime)+'（独立快照，非同刻）',cap.fresh&&cap.cap?.currentFresh?'fresh':'historical')}
 else if(extra&&extra.stockRow){
  const sr=extra.stockRow;
  add('传统金融合约持仓（股票/ETF/商品）','OI '+(finite(sr.oiv)?fmtUsd(sr.oiv):'—')+' · OI/24h成交 '+(finite(sr.turnRatio)?sr.turnRatio.toFixed(1)+'%':'—'),escape(sr.name||'传统金融标的')+'（'+escape(sr.sectorName||'')+'） · '+escape(sr.sessionBadge||'')+' · 已隔离加密同名代币市值','historical');
 }
 else if(extra&&extra.capRow){
  const cr=extra.capRow,rt=finite(cr.ratio)?(cr.ratio*100).toFixed(2)+'%':'未映射市值';
  add('持仓与流通市值','OI '+fmtUsd(cr.oiv)+' · OI/市值 '+rt+(finite(cr.ratio)&&cr.ratio>=0.15?'（高杠杆集中）':''),'市值 '+(finite(cr.mcap)?fmtUsd(cr.mcap):'缺数')+' · 快照 '+utc(extra.capSnapT)+' · 持仓市值页同源缓存（独立快照，非1H增量窗口）','historical');
 }else{add('1H OI与市值','尚无该币有效快照','先读取信号页同源缓存；未知不补零')}
 const st=state.st,price=st?.rows?.find(x=>x.sym===sym),days=st?.window||1,btc=st?.btc?.ret?.[days];
 if(price&&finite(price.ret?.[days]))add('强势超额',finite(btc)?pct((price.ret[days]-btc)*100)+'（百分点）':'BTC基准缺数',days+'日已收盘窗口 · 截止 '+utc(st.E)+' · Binance K线 · 历史比较，不是当前入场', 'historical');
 else add('强势超额','尚无扫描记录','机会页扫描后可复用；未自动发请求');
 const sc=state.sc?.rows?.find(x=>x.sym===sym);
 const scSrcLabel=s=>s==='relay-rolling24-v2'?'Binance openInterestHist 5m精确首末 / fapi klines 同窗已闭合5m close':s==='direct-fapi-5m'?'浏览器直连 Binance openInterestHist 5m精确首末 / 同窗已闭合5m close':s==='archive-utc24h'?'data.binance.vision 官方5m归档日终同端点（已完成UTC日）':'未知；非rolling24证据';
 if(sc)add('滚动24h OI官方5m / 同窗已闭合5m价格；后验未定义', '币数 '+pct(sc.coinNet)+' · 同窗口价格 '+pct(sc.px)+(finite(sc.z)?' · z '+(sc.z>=0?'+':'')+sc.z.toFixed(2)+'σ':''), '窗口 '+utc(sc.startMs||state.sc.win?.startMs)+' → '+utc(sc.endMs||state.sc.win?.endMs)+' · 来源 '+scSrcLabel(sc.src)+' · 各窗口不能拼为同刻证据','historical');
 else add('滚动24h OI官方5m / 同窗已闭合5m价格；后验未定义','尚无该币扫描记录','不补零，不把未扫描当无异动');
 const fr=funding||{status:'missing'};
 const basisTxt=finite(fr.basis)?' · 标记溢价 '+pct(fr.basis):'';
 const nextTxt=finite(fr.nextFundingTime)&&fr.nextFundingTime>now?' · 距结算 '+Math.floor((fr.nextFundingTime-now)/3600000)+'h'+Math.floor(((fr.nextFundingTime-now)%3600000)/60000)+'m':'';
 add('资金费率',finite(fr.rawRate)?(fr.rawRate*100).toFixed(4)+'% / '+(fr.intervalHours||'未知')+'h'+basisTxt:'未知', '更新时间 '+utc(fr.asOf)+nextTxt+' · '+({fresh:'新鲜（≤15分钟）',stale:'已过期，评分计0',future:'时间异常，评分计0',unknown_time:'时间未知，评分计0',unknown_interval:'周期未知，评分计0',missing:'数据缺失，评分计0'}[fr.status]||'未知'),fr.usable?'fresh':'missing');
 const id=state.id?.rows?.find(x=>x.sym===sym),idFresh=id&&state.id.on&&finite(state.idTime)&&now-state.idTime<=120000&&now-state.idTime>=0;
 if(id)add('日内观察', 'ΔOI '+pct(id.dOi)+' · ΔP '+pct(id.dP)+' · 量比 '+(finite(id.vr)?id.vr.toFixed(1)+'x':'未知')+' · VWAP '+(finite(id.vwap)?String(id.vwap):'未知'),(state.id.win||30)+'分钟闭合窗口 · 端点 '+utc(id.t)+' · 采样 '+utc(state.idTime)+' · '+(idFresh?'有效观察':'历史/已暂停，不作当前确认')+' · 总分是条件分不是概率',idFresh?'fresh':'historical');
 else add('日内观察','未形成有效样本','监测关闭、预热、缺数或该币不在范围；不作方向推断');
 if(extra&&extra.whale){
  const w=extra.whale,tot=(w.wl?.vL||0)+(w.wl?.vS||0),lp=tot>0?(w.wl.vL/tot*100).toFixed(1)+'%':'—';
  const nearTxt=[w.nearLong?'最近多单强平 @ '+w.nearLong.px+' ('+pct(w.nearLong.dist)+')':'',w.nearShort?'最近空单强平 @ '+w.nearShort.px+' ('+pct(w.nearShort.dist)+')':''].filter(Boolean).join(' · ');
  add('Hyperliquid 巨鲸持仓','多 '+fmtUsd(w.wl?.vL)+' ('+(w.wl?.l||0)+'户) / 空 '+fmtUsd(w.wl?.vS)+' ('+(w.wl?.s||0)+'户) · 多占 '+lp,(nearTxt?nearTxt+' · ':'')+'快照 '+utc(w.generatedAt)+' · Hyperliquid 大户独立口径','historical');
 }
 if(extra&&extra.alpha){
  const al=extra.alpha;
  add('Alpha 截面记录',(al.label||'—')+' '+(al.score??'—')+' · '+(al.quad||'—')+(al.tags?.length?' · '+al.tags.join('/'):''),'1h OI '+(al.dOi1hPct!=null?pct(+al.dOi1hPct):'—')+' · 4h 量比 '+(al.volX!=null?al.volX+'x':'—')+' · 快照 '+utc(al.generatedAt),'historical');
 }
 return result;
}
function html(rows){return rows.map(x=>'<div class="evidence-row st-'+escape(x.status||'missing')+'"><b>'+escape(x.title)+'</b><span>'+escape(x.value)+'</span><small>'+escape(x.meta)+'</small></div>').join('')}
function collectExtra(sym){
 const out={};
 if(typeof isTradFiSymbol==='function'&&isTradFiSymbol(sym)){
  const m=typeof stockMetaOf==='function'?stockMetaOf(sym):{n:sym,sectorName:'传统金融'};
  const sr=(typeof STOCK!=='undefined'&&Array.isArray(STOCK.rows))?STOCK.rows.find(x=>x.sym===sym):null;
  const cr=(typeof CAP!=='undefined'&&Array.isArray(CAP.rows))?CAP.rows.find(x=>x.sym===sym):null;
  const oiv=sr?.oiv??cr?.oiv??null,vol=sr?.vol??cr?.vol??null;
  const sess=typeof stockMarketSession==='function'?stockMarketSession().badge:'';
  out.stockRow={name:m.n,sectorName:m.sectorName,oiv,turnRatio:(oiv!=null&&vol>0)?oiv/vol*100:null,sessionBadge:sess};
 }else if(typeof CAP!=='undefined'&&Array.isArray(CAP.rows)){
  const cr=CAP.rows.find(r=>r.sym===sym&&!r.isStock);
  if(cr){out.capRow=cr;out.capSnapT=CAP.snapT||null}
 }
 if(typeof WHALE!=='undefined'&&WHALE.data&&Array.isArray(WHALE.data.coins)){
  const base=String(sym||'').replace(/USDT$/,'').replace(/^(1000000|10000|1000)/,'');
  const wc=WHALE.data.coins.find(c=>String(c.coin||'').replace(/-USD$/,'')===base);
  if(wc){
   const cur=wc.mark,hs=(wc.holders||[]).filter(h=>h.lq>0);
   const near=side=>{const list=hs.filter(h=>h.s===side);if(!list.length||!(cur>0))return null;const best=list.reduce((a,b)=>Math.abs(b.lq-cur)<Math.abs(a.lq-cur)?b:a);return {px:best.lq>=100?best.lq.toFixed(1):(+best.lq.toPrecision(4)),dist:(best.lq/cur-1)*100,v:best.v}};
   out.whale={wl:wc.wl,generatedAt:WHALE.data.generatedAt,nearLong:near('L'),nearShort:near('S')};
  }
 }
 if(typeof ALPHA!=='undefined'&&ALPHA.data&&Array.isArray(ALPHA.data.coins)){
  const base=String(sym||'').replace(/USDT$/,'');
  const ac=ALPHA.data.coins.find(c=>c.sym===base||c.sym===sym);
  if(ac)out.alpha={...ac,generatedAt:ALPHA.data.generatedAt};
 }
 return Object.keys(out).length?out:undefined;
}
function render(sym){const host=document.querySelector('#dtEvidenceBody');if(!host)return;host.innerHTML=html(build(sym,S,root.capRadar,Date.now(),typeof fundingEvidence==='function'?fundingEvidence(sym):null,collectExtra(sym)));}
root.CoinEvidence={build,html};root.renderCoinEvidence=render;if(typeof module!=='undefined'&&module.exports)module.exports=root.CoinEvidence;
})(typeof globalThis!=='undefined'?globalThis:this);
