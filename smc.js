/* SMC 结构分析（移植自 Pine v6 smart-money-concepts，纯函数、无依赖）
   提供：摆动结构 BOS/CHoCH、订单块 OB、FVG、等高等低流动性、溢价/折价、共振评分。 */
'use strict';
const SmcCore=(function(){
  function atr(bars,n){
    n=n||14;const out=new Array(bars.length).fill(null);const trs=[];
    for(let i=0;i<bars.length;i++){
      const b=bars[i],pc=i?bars[i-1].c:b.c;
      trs.push(Math.max(b.h-b.l,Math.abs(b.h-pc),Math.abs(b.l-pc)));
      if(i>=n-1){let s=0;for(let k=i-n+1;k<=i;k++)s+=trs[k];out[i]=s/n}
    }
    return out;
  }
  function pivots(bars,L,kind){
    // ≥ 全邻居且至少严格大于一侧：等高点（平价币常见）不会被整段否决
    const res=[];
    for(let i=L;i<bars.length-L;i++){
      let ok=true,gt=false;
      for(let k=1;k<=L;k++){
        const a=kind==='h'?bars[i].h:bars[i].l;
        const l=kind==='h'?bars[i-k].h:bars[i-k].l;
        const r=kind==='h'?bars[i+k].h:bars[i+k].l;
        if(kind==='h'?(a<l||a<r):(a>l||a>r)){ok=false;break}
        if(kind==='h'?(a>l||a>r):(a<l||a<r))gt=true;
      }
      if(ok&&gt)res.push({i,price:kind==='h'?bars[i].h:bars[i].l,confirmAt:i+L});
    }
    return res;
  }
  function analyze(bars,opts){
    opts=opts||{};
    const sLen=opts.sLen||10,obLookback=opts.obLookback||20;
    const fvgMinAtr=opts.fvgMinAtr!=null?opts.fvgMinAtr:0.15,eqTol=opts.eqTol!=null?opts.eqTol:0.15;
    const n=bars.length;
    if(n<sLen*3+5)return null;
    const A=atr(bars,14);
    const ph=pivots(bars,sLen,'h'),pl=pivots(bars,sLen,'l');
    const events={bos:0,bearBos:0,choch:0,bearChoch:0,sweepBuy:0,sweepSell:0};
    let swingHigh=null,swingLow=null,sDir=0,hiBroken=false,loBroken=false;
    const obs=[],fvgs=[],eq=[];
    let lastSweepBuyBar=-1e9,lastSweepSellBar=-1e9,lastEvent=null;
    let pi=0,pli=0;
    const findOB=(i,bull)=>{
      for(let k=1;k<=Math.min(obLookback,i);k++){
        const c=bars[i-k];
        if(bull?c.c<c.o:c.c>c.o)return{dir:bull?1:-1,top:c.h,bottom:c.l,bar:i-k,state:0};
      }
      return null;
    };
    for(let i=1;i<n;i++){
      while(pi<ph.length&&ph[pi].confirmAt<=i){
        const p=ph[pi++];
        if(swingHigh!=null&&A[i]&&Math.abs(p.price-swingHigh)<=A[i]*eqTol)eq.push({type:'EQH',price:Math.max(p.price,swingHigh),bar:p.i,swept:false});
        swingHigh=p.price;hiBroken=false;
      }
      while(pli<pl.length&&pl[pli].confirmAt<=i){
        const p=pl[pli++];
        if(swingLow!=null&&A[i]&&Math.abs(p.price-swingLow)<=A[i]*eqTol)eq.push({type:'EQL',price:Math.min(p.price,swingLow),bar:p.i,swept:false});
        swingLow=p.price;loBroken=false;
      }
      const b=bars[i];
      if(swingHigh!=null&&!hiBroken&&b.c>swingHigh){
        const isCh=sDir===-1;
        if(isCh){events.choch++;lastEvent={type:'CHoCH↑',bar:i,price:swingHigh}}else{events.bos++;lastEvent={type:'BOS↑',bar:i,price:swingHigh}}
        const ob=findOB(i,true);if(ob)obs.push(ob);
        sDir=1;hiBroken=true;
      }
      if(swingLow!=null&&!loBroken&&b.c<swingLow){
        const isCh=sDir===1;
        if(isCh){events.bearChoch++;lastEvent={type:'CHoCH↓',bar:i,price:swingLow}}else{events.bearBos++;lastEvent={type:'BOS↓',bar:i,price:swingLow}}
        const ob=findOB(i,false);if(ob)obs.push(ob);
        sDir=-1;loBroken=true;
      }
      if(swingHigh!=null&&!hiBroken&&b.h>swingHigh&&b.c<swingHigh){events.sweepBuy++;lastSweepBuyBar=i;hiBroken=true;
        eq.forEach(e=>{if(e.type==='EQH'&&b.h>e.price&&b.c<e.price)e.swept=true})}
      if(swingLow!=null&&!loBroken&&b.l<swingLow&&b.c>swingLow){events.sweepSell++;lastSweepSellBar=i;loBroken=true;
        eq.forEach(e=>{if(e.type==='EQL'&&b.l<e.price&&b.c>e.price)e.swept=true})}
      if(i>=2&&A[i]){
        const gapUp=b.l-bars[i-2].h,gapDn=bars[i-2].l-b.h;
        if(gapUp>0&&gapUp>=A[i]*fvgMinAtr)fvgs.push({dir:1,top:b.l,bottom:bars[i-2].h,bar:i,state:0});
        if(gapDn>0&&gapDn>=A[i]*fvgMinAtr)fvgs.push({dir:-1,top:bars[i-2].l,bottom:b.h,bar:i,state:0});
      }
      for(const o of obs){
        if(o.state===2)continue;
        if(o.dir===1){ if(b.c<o.bottom)o.state=2; else if(o.state===0&&b.l<=o.top)o.state=1 }
        else { if(b.c>o.top)o.state=2; else if(o.state===0&&b.h>=o.bottom)o.state=1 }
      }
      for(const f of fvgs){
        if(f.state===2)continue;
        if(f.state===0&&f.dir===1&&b.c<f.bottom){f.state=1;f.dir=-1}
        else if(f.state===0&&f.dir===-1&&b.c>f.top){f.state=1;f.dir=1}
        else if(f.state===1&&((f.dir===-1&&b.c>f.top)||(f.dir===1&&b.c<f.bottom)))f.state=2;
      }
    }
    const last=n-1,close=bars[last].c,atrNow=A[last]||0;
    const pdPos=(swingHigh!=null&&swingLow!=null&&swingHigh>swingLow)?(close-swingLow)/(swingHigh-swingLow):null;
    let liveObs=obs.filter(o=>o.state!==2).slice(-6);
    if(!liveObs.length)liveObs=obs.slice(-3);  // 全被消化时回退显示最近已失效的，供参考
    const liveFvgs=fvgs.filter(f=>f.state!==2).slice(-6);
    const nearOB=liveObs.filter(o=>atrNow&&(o.dir===1?o.top>=close-atrNow*4:o.bottom<=close+atrNow*4));
    let score=0;const parts=[];
    if(sDir!==0&&pdPos!=null){
      if((sDir===1&&pdPos<0.5)||(sDir===-1&&pdPos>0.5)){score+=25;parts.push('折价区 25')}
      score+=25;parts.push('结构 25');
      if(nearOB.some(o=>o.dir===sDir)){score+=20;parts.push('邻近OB 20')}
      if(liveFvgs.some(f=>f.dir===sDir)){score+=15;parts.push('FVG 15')}
      if(sDir===1?(last-lastSweepSellBar<=30):(last-lastSweepBuyBar<=30)){score+=15;parts.push('扫单 15')}
    }
    return {dir:sDir,lastEvent,swingHigh,swingLow,pdPos,atr:atrNow,obs:liveObs,fvgs:liveFvgs,eq:eq.slice(-6),
      score:Math.min(100,score),scoreParts:parts,events,barCount:n,lastClose:close,lastBar:last,bars};
  }
  return {analyze};
})();

/* ---------- 详情页面板 ---------- */
const SMCUI={cache:new Map(),loading:false,sym:null};
function smcMount(){
  if($('#smcFold'))return;
  const host=$('#lsFold');
  if(!host)return;
  const d=document.createElement('details');
  d.id='smcFold';d.className='fold';d.open=false;
  d.innerHTML='<summary>SMC 结构 <span id="smcStamp">15m · 待加载</span></summary><div id="smcBody" class="fold-body"></div>';
  host.parentNode.insertBefore(d,host.nextSibling);
  d.ontoggle=()=>{if(d.open)smcRender()};
}
async function smcRender(){
  const body=$('#smcBody');if(!body)return;
  const sym=(typeof S!=='undefined'&&S.dt&&S.dt.sym)||null;
  if(!sym){body.innerHTML='<p class="muted hint">先选择币种</p>';return}
  SMCUI.sym=sym;
  const hit=SMCUI.cache.get(sym);
  if(hit&&Date.now()-hit.t<5*60*1000)return smcPaint(hit.res);
  body.innerHTML='<p class="muted hint"><span class="spin"></span> 计算 15m 结构…</p>';
  try{
    const ks=await jget(`${API}/fapi/v1/klines?symbol=${sym}&interval=15m&limit=500`,20000);
    const bars=ks.map(k=>({t:k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}));
    const res=SmcCore.analyze(bars,{sLen:10});
    if(!res)throw new Error('K线不足');
    SMCUI.cache.set(sym,{t:Date.now(),res});
    smcPaint(res);
  }catch(e){
    body.innerHTML='<p class="muted hint">计算失败：'+e.message+'</p>';
  }
}
function smcPaint(r){
  const body=$('#smcBody');if(!body)return;
  const stamp=$('#smcStamp');
  if(stamp)stamp.textContent='15m · '+new Date().toTimeString().slice(0,5);
  const px=v=>v==null?'—':(v>=1000?v.toFixed(1):v.toPrecision(4));
  const dirTxt=r.dir===1?'<span class="up">上升结构</span>':(r.dir===-1?'<span class="down">下降结构</span>':'<span class="muted">未定</span>');
  const ev=r.lastEvent?(r.lastEvent.type+' @ '+px(r.lastEvent.price)):'—';
  const pd=r.pdPos==null?null:Math.max(0,Math.min(1,r.pdPos));
  const sc=r.score,cls=sc>=70?'up':(sc<45?'down':'');
  let h='<div class="row" style="margin-bottom:6px">'+dirTxt+
    '<span class="muted" style="font-size:11px">最近事件 '+ev+'</span>'+
    '<span class="r '+cls+'" style="margin-left:auto;font-weight:700">评分 '+sc+'</span></div>';
  h+='<div class="smc-bar"><i style="width:'+sc+'%"></i></div>';
  h+='<p class="muted hint" style="margin:4px 0 6px;font-size:10.5px">'+r.scoreParts.join(' · ')+'</p>';
  if(pd!=null){
    h+='<div class="smc-pd"><span class="smc-pd-fill" style="left:'+(pd*100).toFixed(1)+'%"></span>'+
      '<span class="smc-pd-l">折价</span><span class="smc-pd-m">平衡</span><span class="smc-pd-r">溢价</span></div>';
    h+='<p class="muted hint" style="font-size:10.5px">当前位置 '+(pd*100).toFixed(0)+'%（0=摆动低点，100=摆动高点）· 摆动区间 '+px(r.swingLow)+'–'+px(r.swingHigh)+'</p>';
  }
  h+='<div class="tblwrap" style="margin-top:6px"><table class="tbl"><thead><tr><th>类型</th><th>区间</th><th>状态</th><th>距现价</th></tr></thead><tbody>';
  const rows=[];
  for(const o of r.obs)rows.push({k:o.dir===1?'需求 OB':'供给 OB',cls:o.dir===1?'up':'down',top:o.top,bottom:o.bottom,state:o.state===0?'新鲜':(o.state===1?'已测试':'已失效'),dir:o.dir});
  for(const f of r.fvgs)rows.push({k:(f.dir===1?'看涨 FVG':'看跌 FVG'),cls:f.dir===1?'up':'down',top:f.top,bottom:f.bottom,state:f.state===0?'未回补':'已反转',dir:f.dir});
  for(const e of r.eq)rows.push({k:e.type,cls:'',top:e.price,bottom:e.price,state:e.swept?'已扫':'挂单',dir:0});
  rows.sort((a,b)=>Math.abs((a.top+a.bottom)/2-r.lastClose)-Math.abs((b.top+b.bottom)/2-r.lastClose));
  if(!rows.length)h+='<tr><td colspan="4" class="muted" style="text-align:center;padding:10px">暂无有效区域</td></tr>';
  for(const x of rows.slice(0,8)){
    const mid=(x.top+x.bottom)/2,d=(mid/r.lastClose-1)*100;
    h+='<tr><td class="'+x.cls+'">'+x.k+'</td><td>'+px(x.bottom)+'–'+px(x.top)+'</td><td class="muted">'+x.state+'</td>'+
      '<td class="'+(d>0?'up':'down')+'">'+(d>=0?'+':'')+d.toFixed(1)+'%</td></tr>';
  }
  h+='</tbody></table></div>';
  h+='<p class="muted hint" style="margin-top:6px">口径：15m K线 500 根（约5天）· 摆动长度 10 · OB 回看 20 · FVG≥0.15×ATR · 评分=结构25+折价25+邻近OB20+FVG15+扫单15（最高100）。仅结构参考，不含成交与资金流。</p>';
  body.innerHTML=h;
}
function smcInit(){
  smcMount();
  if($('#smcFold')&&$('#smcFold').open)smcRender();
}

/* dtLoad 钩子：面板存在且展开时才重算，避免额外请求 */
function smcRefresh(){
  smcMount();
  const f=$('#smcFold');
  if(f&&f.open)smcRender();
}
