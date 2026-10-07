/* Read-only evidence summary. No requests, scoring or inferred trade direction. */
(function(root){'use strict';
const finite=x=>typeof x==='number'&&Number.isFinite(x),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const utc=t=>finite(t)&&t>0?new Date(t).toISOString().slice(0,19).replace('T',' ')+' UTC':'未知';
const pct=n=>finite(n)?(n>=0?'+':'')+n.toFixed(2)+'%':'缺数';
function build(sym,state,radar,now=Date.now(),funding){
 const result=[],add=(title,value,meta,status)=>result.push({title,value,meta,status:status||'missing'});
 const cap=radar?.getEvidence?.(sym,now),row=cap?.row||cap?.snapshotRow;
 if(row){const kind=cap.fresh?'新鲜快照':'历史快照（不参与当前榜单）';add('1H OI币数变化',pct(row.growth),kind+' · '+utc(cap.window?.start)+' → '+utc(cap.window?.end)+' · Binance官方',cap.fresh?'fresh':'historical');add('OI/流通市值',finite(row.ratio)?row.ratio.toFixed(2)+'%':'未映射或市值缺数',kind+' · OI名义值/流通市值 · 市值 '+utc(row.capTime)+'（独立快照，非同刻）',cap.fresh&&cap.cap?.currentFresh?'fresh':'historical')}
 else{add('1H OI与市值','尚无该币有效快照','先读取信号页同源缓存；未知不补零')}
 const st=state.st,price=st?.rows?.find(x=>x.sym===sym),days=st?.window||1,btc=st?.btc?.ret?.[days];
 if(price&&finite(price.ret?.[days]))add('强势超额',finite(btc)?pct((price.ret[days]-btc)*100)+'（百分点）':'BTC基准缺数',days+'日已收盘窗口 · 截止 '+utc(st.E)+' · Binance K线 · 历史比较，不是当前入场', 'historical');
 else add('强势超额','尚无扫描记录','机会页扫描后可复用；未自动发请求');
 const sc=state.sc?.rows?.find(x=>x.sym===sym);
 if(sc)add('滚动24h OI官方5m / 同窗已闭合5m价格；后验未定义', '币数 '+pct(sc.coinNet)+' · 同窗口价格 '+pct(sc.px), '窗口 '+utc(state.sc.win?.startMs)+' → '+utc(state.sc.win?.endMs)+' · 来源 '+(sc.src==='relay-rolling24-v2'?'Binance openInterestHist 5m精确首末 / fapi klines 同窗已闭合5m close': '未知；非rolling24证据')+' · 各窗口不能拼为同刻证据','historical');
 else add('滚动24h OI官方5m / 同窗已闭合5m价格；后验未定义','尚无该币扫描记录','不补零，不把未扫描当无异动');
 const fr=funding||{status:'missing'};add('资金费率',finite(fr.rawRate)?(fr.rawRate*100).toFixed(4)+'% / '+(fr.intervalHours||'未知')+'h':'未知', '更新时间 '+utc(fr.asOf)+' · '+({fresh:'新鲜（≤15分钟）',stale:'已过期，评分计0',future:'时间异常，评分计0',unknown_time:'时间未知，评分计0',unknown_interval:'周期未知，评分计0',missing:'数据缺失，评分计0'}[fr.status]||'未知'),fr.usable?'fresh':'missing');
 const id=state.id?.rows?.find(x=>x.sym===sym),idFresh=id&&state.id.on&&finite(state.idTime)&&now-state.idTime<=120000&&now-state.idTime>=0;
 if(id)add('日内观察', 'ΔOI '+pct(id.dOi)+' · ΔP '+pct(id.dP)+' · 量比 '+(finite(id.vr)?id.vr.toFixed(1)+'x':'未知')+' · VWAP '+(finite(id.vwap)?String(id.vwap):'未知'),(state.id.win||30)+'分钟闭合窗口 · 端点 '+utc(id.t)+' · 采样 '+utc(state.idTime)+' · '+(idFresh?'有效观察':'历史/已暂停，不作当前确认')+' · 总分是条件分不是概率',idFresh?'fresh':'historical');
 else add('日内观察','未形成有效样本','监测关闭、预热、缺数或该币不在范围；不作方向推断');
 return result;
}
function html(rows){return rows.map(x=>'<div class="evidence-row"><b>'+escape(x.title)+'</b><span>'+escape(x.value)+'</span><small>'+escape(x.meta)+'</small></div>').join('')}
function render(sym){const host=document.querySelector('#dtEvidenceBody');if(!host)return;host.innerHTML=html(build(sym,S,root.capRadar,Date.now(),typeof fundingEvidence==='function'?fundingEvidence(sym):null));}
root.CoinEvidence={build,html};root.renderCoinEvidence=render;if(typeof module!=='undefined'&&module.exports)module.exports=root.CoinEvidence;
})(typeof globalThis!=='undefined'?globalThis:this);
