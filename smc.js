/* SMC 结构分析（移植自 Pine v6 smart-money-concepts，纯函数、无依赖）
   提供：摆动结构 BOS/CHoCH、订单块 OB、FVG、等高等低流动性与未扫前高前低(BSL/SSL)、溢价/折价、共振评分，
   以及单币作战室近端过滤、实战 K 线结构图层数据与「以损定量」风控仓位速算器。 */
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
    const obs=[],fvgs=[],eq=[],swingsH=[],swingsL=[];
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
        swingsH.push({price:p.price,bar:p.i,swept:false});
        swingHigh=p.price;hiBroken=false;
      }
      while(pli<pl.length&&pl[pli].confirmAt<=i){
        const p=pl[pli++];
        if(swingLow!=null&&A[i]&&Math.abs(p.price-swingLow)<=A[i]*eqTol)eq.push({type:'EQL',price:Math.min(p.price,swingLow),bar:p.i,swept:false});
        swingsL.push({price:p.price,bar:p.i,swept:false});
        swingLow=p.price;loBroken=false;
      }
      const b=bars[i];
      /* 持续更新所有历史 EQH/EQL 与摆动高低点的扫除/突破状态，杜绝价格已越过仍标挂单 */
      for(const e of eq){
        if(!e.swept){
          if(e.type==='EQH'&&b.h>e.price)e.swept=true;
          else if(e.type==='EQL'&&b.l<e.price)e.swept=true;
        }
      }
      for(const sh of swingsH){if(!sh.swept&&b.h>sh.price)sh.swept=true}
      for(const sl of swingsL){if(!sl.swept&&b.l<sl.price)sl.swept=true}
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
      if(swingHigh!=null&&!hiBroken&&b.h>swingHigh&&b.c<swingHigh){events.sweepBuy++;lastSweepBuyBar=i;hiBroken=true}
      if(swingLow!=null&&!loBroken&&b.l<swingLow&&b.c>swingLow){events.sweepSell++;lastSweepSellBar=i;loBroken=true}
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
    let liveObs=obs.filter(o=>o.state!==2).slice(-8);
    if(!liveObs.length)liveObs=obs.slice(-3);
    const liveFvgs=fvgs.filter(f=>f.state!==2).slice(-8);
    const nearOB=liveObs.filter(o=>atrNow&&(o.dir===1?o.top>=close-atrNow*4:o.bottom<=close+atrNow*4));
    const unsweptBsl=swingsH.filter(x=>!x.swept&&x.price>close).sort((a,b)=>a.price-b.price);
    const unsweptSsl=swingsL.filter(x=>!x.swept&&x.price<close).sort((a,b)=>b.price-a.price);
    let score=0;const parts=[];
    if(sDir!==0&&pdPos!=null){
      if((sDir===1&&pdPos<0.5)||(sDir===-1&&pdPos>0.5)){score+=25;parts.push('折价区 25')}
      score+=25;parts.push('结构 25');
      if(nearOB.some(o=>o.dir===sDir)){score+=20;parts.push('邻近OB 20')}
      if(liveFvgs.some(f=>f.dir===sDir)){score+=15;parts.push('FVG 15')}
      if(sDir===1?(last-lastSweepSellBar<=30):(last-lastSweepBuyBar<=30)){score+=15;parts.push('扫单 15')}
    }
    return {dir:sDir,lastEvent,swingHigh,swingLow,pdPos,atr:atrNow,obs:liveObs,fvgs:liveFvgs,eq:eq.slice(-8),
      bsl:unsweptBsl.slice(0,3),ssl:unsweptSsl.slice(0,3),
      score:Math.min(100,score),scoreParts:parts,events,barCount:n,lastClose:close,lastBar:last,bars};
  }

  /* RegimeSwitch 双态数学核心：EMA200 ± 1σ/2σ/3σ 波动轨 + 吊灯通道(22,3.0) + 前一根4H成交重心POC */
  function calcRegimeSwitch(bars,pocBars){
    const n=Array.isArray(bars)?bars.length:0;
    if(n<40)return null;
    const closes=bars.map(b=>b.c);
    const e200=new Array(n).fill(closes[0]);
    const k200=2/201;
    for(let i=1;i<n;i++)e200[i]=closes[i]*k200+e200[i-1]*(1-k200);

    /* 滚动残差标准差 σ（窗口100根） */
    const sigma=new Array(n).fill(0);
    for(let i=0;i<n;i++){
      const s=Math.max(0,i-99),cnt=i-s+1;
      if(cnt<20)continue;
      let sum=0;for(let k=s;k<=i;k++)sum+=(closes[k]-e200[k]);
      const mean=sum/cnt;
      let vSum=0;for(let k=s;k<=i;k++){const d=(closes[k]-e200[k])-mean;vSum+=d*d}
      sigma[i]=Math.sqrt(vSum/cnt);
    }

    /* Wilder ATR(22) 与 吊灯趋势止损带 Chandelier(22, 3.0) */
    const atr22=new Array(n).fill(0);
    for(let i=0;i<n;i++){
      if(i===0){atr22[i]=bars[0].h-bars[0].l;continue}
      const pc=bars[i-1].c;
      const tr=Math.max(bars[i].h-bars[i].l,Math.abs(bars[i].h-pc),Math.abs(bars[i].l-pc));
      atr22[i]=(atr22[i-1]*21+tr)/22;
    }
    const chanLo=new Array(n).fill(0),chanHi=new Array(n).fill(0),chanDir=new Array(n).fill(1);
    for(let i=0;i<n;i++){
      const s=Math.max(0,i-21);
      let hh=-1e18,ll=1e18;
      for(let k=s;k<=i;k++){if(bars[k].c>hh)hh=bars[k].c;if(bars[k].c<ll)ll=bars[k].c}
      const ls=hh-atr22[i]*3.0,ss=ll+atr22[i]*3.0;
      if(i===0){chanLo[i]=ls;chanHi[i]=ss;chanDir[i]=1}
      else{
        const pls=chanLo[i-1],pss=chanHi[i-1];
        chanLo[i]=bars[i-1].c>pls?Math.max(ls,pls):ls;
        chanHi[i]=bars[i-1].c<pss?Math.min(ss,pss):ss;
        if(bars[i].c>pss)chanDir[i]=1;
        else if(bars[i].c<pls)chanDir[i]=-1;
        else chanDir[i]=chanDir[i-1];
      }
    }

    /* 14周期 ADX 序列（与 decision.js 对齐） */
    const adx=new Array(n).fill(20);
    if(n>=30){
      let trS=0,pdmS=0,ndmS=0;const dxs=[];
      for(let i=1;i<n;i++){
        const up=bars[i].h-bars[i-1].h,dn=bars[i-1].l-bars[i].l;
        const pdm=(up>dn&&up>0)?up:0,ndm=(dn>up&&dn>0)?dn:0;
        const pc=bars[i-1].c;
        const tr=Math.max(bars[i].h-bars[i].l,Math.abs(bars[i].h-pc),Math.abs(bars[i].l-pc));
        if(i<=14){
          trS+=tr;pdmS+=pdm;ndmS+=ndm;
          if(i===14&&trS>0){const pdi=100*pdmS/trS,ndi=100*ndmS/trS;dxs.push([i,100*Math.abs(pdi-ndi)/Math.max(1e-9,pdi+ndi)])}
        }else{
          trS=trS-trS/14+tr;pdmS=pdmS-pdmS/14+pdm;ndmS=ndmS-ndmS/14+ndm;
          const pdi=100*pdmS/Math.max(1e-9,trS),ndi=100*ndmS/Math.max(1e-9,trS);
          dxs.push([i,100*Math.abs(pdi-ndi)/Math.max(1e-9,pdi+ndi)]);
        }
      }
      if(dxs.length>=14){
        let cur=0;for(let k=0;k<14;k++)cur+=dxs[k][1];cur/=14;
        adx[dxs[13][0]]=cur;
        for(let k=14;k<dxs.length;k++){cur=(cur*13+dxs[k][1])/14;adx[dxs[k][0]]=cur}
      }
    }

    /* 前一根已闭合 4H K 线成交分布重心 POC（由子周期棒近似构建 12 分箱分布，零额外网络请求） */
    const srcPoc=Array.isArray(pocBars)&&pocBars.length?pocBars:bars;
    const buckets=new Map();
    for(const b of srcPoc){
      const b4t=Math.floor(b.t/14400000)*14400000;
      let arr=buckets.get(b4t);
      if(!arr){arr=[];buckets.set(b4t,arr)}
      arr.push(b);
    }
    const bucketPoc=new Map();
    for(const [b4t,subs] of buckets.entries()){
      let lo=1e18,hi=-1e18;
      for(const x of subs){if(x.l<lo)lo=x.l;if(x.h>hi)hi=x.h}
      if(!(hi>lo)){bucketPoc.set(b4t,subs[subs.length-1].c);continue}
      const bins=new Array(12).fill(0),step=(hi-lo)/12;
      for(const x of subs){
        const vol=(x.q>0?x.q:(x.v>0?x.v*x.c:1));
        const typ=(x.h+x.l+x.c)/3;
        const pts=[[x.l+(x.h-x.l)*0.25,0.2],[typ,0.6],[x.l+(x.h-x.l)*0.75,0.2]];
        for(const [px,wt] of pts){
          const bi=Math.min(11,Math.max(0,Math.floor((px-lo)/step)));
          bins[bi]+=vol*wt;
        }
      }
      let best=0;for(let bi=1;bi<12;bi++)if(bins[bi]>bins[best])best=bi;
      bucketPoc.set(b4t,lo+(best+0.5)*step);
    }
    const poc4h=bars.map(b=>{
      const prev4t=Math.floor(b.t/14400000)*14400000-14400000;
      return bucketPoc.get(prev4t)??null;
    });

    const last=n-1,cNow=closes[last],mNow=e200[last],sNow=sigma[last];
    const zNow=sNow>0?(cNow-mNow)/sNow:0;
    const pocNow=poc4h[last];
    const pocZ=(pocNow!=null&&sNow>0)?(pocNow-mNow)/sNow:null;
    let avgV20=0,vNow=bars[last].q||bars[last].v*cNow||1;
    const vs=Math.max(0,last-20);
    for(let k=vs;k<last;k++)avgV20+=(bars[k].q||bars[k].v*bars[k].c||0);
    avgV20=last>vs?avgV20/(last-vs):vNow;
    const volRatio=avgV20>0?vNow/avgV20:1;
    const bws=[];for(let k=Math.max(20,last-100);k<=last;k++)if(sigma[k]>0&&closes[k]>0)bws.push(sigma[k]/closes[k]);
    bws.sort((a,b)=>a-b);
    const medBw=bws.length?bws[Math.floor(bws.length/2)]:(sNow/Math.max(1e-9,cNow));
    const bwRatio=medBw>0?(sNow/Math.max(1e-9,cNow))/medBw:1;
    const slopeDir=e200[last]<e200[Math.max(0,last-10)]?-1:1;

    return {
      e200,sigma,chanLo,chanHi,chanDir,adx,poc4h,
      last,cNow,mNow,sNow,zNow,pocNow,pocZ,volRatio,bwRatio,slopeDir,
      state:adx[last]<28?'chop':'trend',
      chanDirNow:chanDir[last],
      chanStopNow:chanDir[last]===1?chanLo[last]:chanHi[last]
    };
  }
  return {analyze,calcRegimeSwitch};
})();

/* ---------- 详情页面板 + 以损定量风控速算 ---------- */
const SMCUI={cache:new Map(),loading:false,sym:null,showFar:false,tf:'15m'};
const RISK={sym:null,side:'long',entry:'',sl:'',tp:'',tp2:'',riskUsd:100,feePct:0.08,note:''};
try{
  const savedRisk=JSON.parse(localStorage.getItem('oif_risk_cfg')||'null');
  if(savedRisk){
    if(Number.isFinite(+savedRisk.riskUsd)&&+savedRisk.riskUsd>0)RISK.riskUsd=+savedRisk.riskUsd;
    if(Number.isFinite(+savedRisk.feePct)&&+savedRisk.feePct>=0)RISK.feePct=+savedRisk.feePct;
  }
}catch(e){}

function smcFmtPx(v){
  if(v==null||!isFinite(v))return '—';
  const a=Math.abs(v);
  if(a>=1000)return (+v).toFixed(1);
  if(a>=10)return (+v).toFixed(3);
  return (+(+v).toPrecision(4)).toString();
}
function smcRawPx(v){
  if(v==null||!isFinite(v)||v<=0)return '';
  const a=Math.abs(v);
  return a>=1000?(+v).toFixed(2):a>=1?(+v).toFixed(4):(+v).toPrecision(5);
}

function smcMount(){
  const host=$('#lsFold');
  if(!host)return;
  if(!$('#smcFold')){
    const d=document.createElement('details');
    d.id='smcFold';d.className='fold';d.open=true;
    d.innerHTML='<summary>SMC 结构与近端关键位 <span id="smcStamp">15m · 待加载</span></summary><div id="smcBody" class="fold-body"></div>';
    host.parentNode.insertBefore(d,host.nextSibling);
    d.ontoggle=()=>{if(d.open)smcRender()};
  }
  if(!$('#riskFold')){
    const r=document.createElement('details');
    r.id='riskFold';r.className='fold';r.open=true;
    r.innerHTML='<summary>以损定量 · 止损与盈亏比速算 <span id="riskStamp">按结构失效位测算仓位</span></summary><div id="riskBody" class="fold-body"></div>';
    const smcEl=$('#smcFold')||host;
    smcEl.parentNode.insertBefore(r,smcEl.nextSibling);
    riskRender();
  }
}

async function smcEnsureData(sym,tf){
  tf=tf||SMCUI.tf||'15m';
  const key=sym+'|'+tf;
  const hit=SMCUI.cache.get(key);
  if(hit&&Date.now()-hit.t<3*60*1000)return hit.res;
  const ks=await jget(`${API}/fapi/v1/klines?symbol=${encodeURIComponent(sym)}&interval=${tf}&limit=320`,20000);
  const bars=ks.map(k=>({t:k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}));
  const res=SmcCore.analyze(bars,{sLen:10});
  if(!res)throw new Error('K线不足');
  SMCUI.cache.set(key,{t:Date.now(),res});
  return res;
}

async function smcRender(){
  const body=$('#smcBody');if(!body)return;
  const sym=(typeof S!=='undefined'&&S.dt&&S.dt.sym)||null;
  if(!sym){body.innerHTML='<p class="muted hint">先选择币种</p>';return}
  SMCUI.sym=sym;
  const key=sym+'|'+(SMCUI.tf||'15m');
  const hit=SMCUI.cache.get(key);
  if(hit&&Date.now()-hit.t<3*60*1000){
    smcPaint(hit.res);
    riskAutoSeed(sym,hit.res);
    if(typeof dtTacticalDraw==='function')dtTacticalDraw();
    return;
  }
  body.innerHTML='<p class="muted hint"><span class="spin"></span> 计算 '+SMCUI.tf+' 结构与关键流动性位…</p>';
  try{
    const res=await smcEnsureData(sym,SMCUI.tf);
    if(S.dt&&S.dt.sym!==sym)return;
    smcPaint(res);
    riskAutoSeed(sym,res);
    if(typeof dtTacticalDraw==='function')dtTacticalDraw();
  }catch(e){
    body.innerHTML='<p class="muted hint">计算失败：'+e.message+'</p>';
  }
}

function smcBuildRows(r){
  const rows=[];
  for(const o of r.obs){
    if(o.state===2)continue;
    rows.push({k:o.dir===1?'需求 OB':'供给 OB',cls:o.dir===1?'up':'down',top:o.top,bottom:o.bottom,state:o.state===0?'新鲜':'已测试',dir:o.dir,kind:'ob'});
  }
  for(const f of r.fvgs){
    if(f.state===2)continue;
    rows.push({k:(f.dir===1?'看涨 FVG':'看跌 FVG'),cls:f.dir===1?'up':'down',top:f.top,bottom:f.bottom,state:f.state===0?'未回补':'失衡翻转',dir:f.dir,kind:'fvg'});
  }
  for(const e of r.eq){
    if(e.swept)continue;
    const isUp=e.price>=r.lastClose;
    rows.push({k:e.type+(isUp?' (上方BSL)':' (下方SSL)'),cls:isUp?'down':'up',top:e.price,bottom:e.price,state:'未扫挂单',dir:0,kind:'liq'});
  }
  for(const b of (r.bsl||[]).slice(0,2)){
    if(!rows.some(x=>x.kind==='liq'&&Math.abs(x.top-b.price)/r.lastClose<0.002))
      rows.push({k:'前高流动性 (BSL)',cls:'down',top:b.price,bottom:b.price,state:'未扫前高',dir:0,kind:'liq'});
  }
  for(const s of (r.ssl||[]).slice(0,2)){
    if(!rows.some(x=>x.kind==='liq'&&Math.abs(x.top-s.price)/r.lastClose<0.002))
      rows.push({k:'前低流动性 (SSL)',cls:'up',top:s.price,bottom:s.price,state:'未扫前低',dir:0,kind:'liq'});
  }
  rows.sort((a,b)=>Math.abs((a.top+a.bottom)/2-r.lastClose)-Math.abs((b.top+b.bottom)/2-r.lastClose));
  return rows;
}

function smcPaint(r){
  const body=$('#smcBody');if(!body)return;
  const stamp=$('#smcStamp');
  if(stamp)stamp.textContent=SMCUI.tf+' · 评分 '+r.score+' · '+new Date().toTimeString().slice(0,5);
  const px=smcFmtPx;
  const dirTxt=r.dir===1?'<span class="up">上升结构</span>':(r.dir===-1?'<span class="down">下降结构</span>':'<span class="muted">未定</span>');
  const ev=r.lastEvent?(r.lastEvent.type+' @ '+px(r.lastEvent.price)):'—';
  const pd=r.pdPos==null?null:Math.max(0,Math.min(1,r.pdPos));
  const sc=r.score,cls=sc>=70?'up':(sc<45?'down':'');
  const tfBtns=['15m','1h','4h'].map(t=>'<button type="button" data-smc-tf="'+t+'"'+(SMCUI.tf===t?' class="on"':'')+'>'+t+'</button>').join('');
  let h='<div class="row" style="margin-bottom:6px"><div class="seg">'+tfBtns+'</div>'+dirTxt+
    '<span class="muted" style="font-size:11px">最近 '+ev+'</span>'+
    '<span class="r '+cls+'" style="margin-left:auto;font-weight:700">共振 '+sc+'/100</span></div>';
  h+='<div class="smc-bar"><i style="width:'+sc+'%"></i></div>';
  h+='<p class="muted hint" style="margin:4px 0 6px;font-size:10.5px">'+(r.scoreParts.length?r.scoreParts.join(' · '):'结构等待明确方向')+' · ATR '+px(r.atr)+' ('+(r.lastClose>0?(r.atr/r.lastClose*100).toFixed(2):'—')+'%)</p>';
  if(pd!=null){
    h+='<div class="smc-pd"><span class="smc-pd-fill" style="left:'+(pd*100).toFixed(1)+'%"></span>'+
      '<span class="smc-pd-l">折价区 (&lt;50%)</span><span class="smc-pd-m">平衡</span><span class="smc-pd-r">溢价区 (&gt;50%)</span></div>';
    h+='<p class="muted hint" style="font-size:10.5px">当前位置 '+(pd*100).toFixed(0)+'% · 摆动区间 '+px(r.swingLow)+'–'+px(r.swingHigh)+'</p>';
  }
  const allRows=smcBuildRows(r);
  const maxDist=Math.max(r.atr*4,r.lastClose*0.08);
  const nearRows=allRows.filter(x=>Math.abs((x.top+x.bottom)/2-r.lastClose)<=maxDist);
  const shown=(SMCUI.showFar?allRows:nearRows).slice(0,10);
  const hiddenCount=Math.max(0,allRows.length-nearRows.length);
  h+='<div class="row" style="margin:6px 0 4px;justify-content:space-between"><span class="mut">关键结构位（点按钮一键填入下方风控算仓）</span>'+
    (hiddenCount>0?'<button type="button" class="btn mini" id="smcToggleFar">'+(SMCUI.showFar?'仅看近端实战位 (±8%/4ATR)':'展开远端结构 (+'+hiddenCount+'条)')+'</button>':'')+'</div>';
  h+='<div class="tblwrap"><table class="tbl"><thead><tr><th>类型</th><th>价格区间</th><th>状态</th><th>距现价</th><th>快捷算仓</th></tr></thead><tbody>';
  if(!shown.length)h+='<tr><td colspan="5" class="muted" style="text-align:center;padding:10px">'+(allRows.length?'现价 ±8% 内无近端结构，可点右上展开远端结构':'暂无有效结构区域')+'</td></tr>';
  for(const x of shown){
    const mid=(x.top+x.bottom)/2,d=(mid/r.lastClose-1)*100;
    const slRef=x.dir===1?Math.max(0,x.bottom-r.atr*0.15):(x.dir===-1?x.top+r.atr*0.15:mid);
    const rng=Math.abs(x.top-x.bottom)<1e-9?px(x.top):(px(x.bottom)+'–'+px(x.top));
    h+='<tr><td class="'+x.cls+'">'+x.k+'</td><td>'+rng+'</td><td class="muted">'+x.state+'</td>'+
      '<td class="'+(d>=0?'up':'down')+'">'+(d>=0?'+':'')+d.toFixed(2)+'%</td>'+
      '<td><div class="smc-act">'+
        (x.kind!=='liq'?'<button type="button" data-rk-en="'+smcRawPx(mid)+'" title="将区间中轴填入入场价">入场</button>':'')+
        '<button type="button" data-rk-sl="'+smcRawPx(slRef)+'" title="将该结构外沿填入止损价">止损</button>'+
        '<button type="button" data-rk-tp="'+smcRawPx(mid)+'" title="将该流动性/区间填入目标价">目标</button>'+
      '</div></td></tr>';
  }
  h+='</tbody></table></div>';
  h+='<p class="muted hint" style="margin-top:6px">口径：合约 '+SMCUI.tf+' K线 320 根 · 摆动长度 10 · 已突破/已扫过的历史 EQH/EQL 自动剔除，默认仅展示 ±8%（或 4×ATR）内的近端可挂单区域。</p>';
  body.innerHTML=h;
  body.querySelectorAll('[data-smc-tf]').forEach(b=>b.onclick=()=>{SMCUI.tf=b.dataset.smcTf;smcRender()});
  const tfBtn=body.querySelector('#smcToggleFar');
  if(tfBtn)tfBtn.onclick=()=>{SMCUI.showFar=!SMCUI.showFar;smcPaint(r)};
  body.querySelectorAll('[data-rk-en],[data-rk-sl],[data-rk-tp]').forEach(b=>b.onclick=()=>{
    if(b.dataset.rkEn)RISK.entry=b.dataset.rkEn;
    if(b.dataset.rkSl)RISK.sl=b.dataset.rkSl;
    if(b.dataset.rkTp)RISK.tp=b.dataset.rkTp;
    const en=+RISK.entry,sl=+RISK.sl;
    if(en>0&&sl>0)RISK.side=sl<en?'long':'short';
    RISK.note='已从 SMC 表格填入点位';
    riskRender();
    if(typeof dtTacticalDraw==='function')dtTacticalDraw();
  });
}

/* ---------- 以损定量风控与仓位速算器 ---------- */
function riskAutoSeed(sym,r,force){
  if(!sym||!r||!(r.lastClose>0))return;
  if(!force&&RISK.sym===sym&&RISK.entry&&RISK.sl){riskRender();return}
  const side=force&&RISK.sym===sym?RISK.side:(r.dir===-1?'short':'long');
  const px=r.lastClose,atr=r.atr||px*0.015;
  let sl,tp,noteParts=[];
  if(side==='long'){
    const bullOb=r.obs.filter(o=>o.dir===1&&o.state!==2&&o.bottom<px&&px-o.bottom<=Math.max(atr*4,px*0.08)).sort((a,b)=>b.top-a.top)[0];
    if(bullOb){sl=bullOb.bottom-atr*0.15;noteParts.push('止损取近端需求OB下沿-0.15ATR')}
    else{sl=px-atr*1.5;noteParts.push('止损取现价-1.5ATR参考')}
    const bsl=(r.bsl&&r.bsl[0]?.price)||(r.eq.find(e=>!e.swept&&e.price>px)?.price);
    const whaleS=typeof whaleGetCoinSummary==='function'?whaleGetCoinSummary(sym)?.nearShortPx:null;
    if(bsl&&bsl>px){tp=bsl;noteParts.push('目标取上方未扫BSL前高')}
    else if(whaleS&&whaleS>px){tp=whaleS;noteParts.push('目标取HL空单强平簇')}
    else{tp=px+(px-sl)*2;noteParts.push('目标取2R参考')}
  }else{
    const bearOb=r.obs.filter(o=>o.dir===-1&&o.state!==2&&o.top>px&&o.top-px<=Math.max(atr*4,px*0.08)).sort((a,b)=>a.bottom-b.bottom)[0];
    if(bearOb){sl=bearOb.top+atr*0.15;noteParts.push('止损取近端供给OB上沿+0.15ATR')}
    else{sl=px+atr*1.5;noteParts.push('止损取现价+1.5ATR参考')}
    const ssl=(r.ssl&&r.ssl[0]?.price)||(r.eq.find(e=>!e.swept&&e.price<px)?.price);
    const whaleL=typeof whaleGetCoinSummary==='function'?whaleGetCoinSummary(sym)?.nearLongPx:null;
    if(ssl&&ssl<px){tp=ssl;noteParts.push('目标取下方未扫SSL前低')}
    else if(whaleL&&whaleL<px){tp=whaleL;noteParts.push('目标取HL多单强平簇')}
    else{tp=Math.max(px*0.1,px-(sl-px)*2);noteParts.push('目标取2R参考')}
  }
  RISK.sym=sym;RISK.side=side;
  RISK.entry=smcRawPx(px);RISK.sl=smcRawPx(sl);RISK.tp=smcRawPx(tp);RISK.tp2='';
  RISK.note=noteParts.join(' · ');
  riskRender();
}

function riskSaveCfg(){
  try{localStorage.setItem('oif_risk_cfg',JSON.stringify({riskUsd:RISK.riskUsd,feePct:RISK.feePct}))}catch(e){}
}

function riskCalc(){
  const en=parseFloat(RISK.entry),sl=parseFloat(RISK.sl),tp=parseFloat(RISK.tp);
  const riskUsd=parseFloat(RISK.riskUsd),feePct=Math.max(0,parseFloat(RISK.feePct)||0)/100;
  if(!(en>0&&sl>0&&riskUsd>0)||en===sl)return null;
  const isLong=RISK.side==='long';
  const validSide=isLong?sl<en:sl>en;
  const stopDistPct=Math.abs(en-sl)/en;
  const tpDistPct=(tp>0&&((isLong&&tp>en)||(!isLong&&tp<en)))?Math.abs(tp-en)/en:null;
  const grossRR=tpDistPct!=null?tpDistPct/stopDistPct:null;
  const unitLossPct=stopDistPct+feePct;
  const netGainPct=tpDistPct!=null?Math.max(0,tpDistPct-feePct):null;
  const netRR=netGainPct!=null&&unitLossPct>0?netGainPct/unitLossPct:null;
  const notional=riskUsd/unitLossPct;
  const qty=notional/en;
  return {en,sl,tp,riskUsd,feePct,validSide,stopDistPct,tpDistPct,grossRR,netRR,notional,qty};
}

function riskRender(){
  const host=$('#riskBody');if(!host)return;
  const sym=(typeof S!=='undefined'&&S.dt&&S.dt.sym)||RISK.sym||'BTCUSDT';
  const c=riskCalc();
  const presets=[50,100,200,500].map(u=>'<button type="button" class="btn mini'+(+RISK.riskUsd===u?' pri':'')+'" data-rk-u="'+u+'">'+u+'U</button>').join('');
  let resHtml='<p class="muted hint" style="margin-top:6px">填入入场价与结构止损价后，自动计算扣费净盈亏比与最大可开仓位。</p>';
  if(c){
    if(!c.validSide){
      resHtml='<div class="banner on err">止损方向与当前做多/做空矛盾（做多止损须低于入场价，做空止损须高于入场价）。</div>';
    }else{
      const rrCls=c.netRR==null?'':(c.netRR>=2?'up':(c.netRR<1.5?'down':''));
      const warn=c.netRR!=null&&c.netRR<1.5?'<div class="banner on warn" style="margin:6px 0">提示：扣除双边手续费后净盈亏比仅 <b>'+c.netRR.toFixed(2)+'R</b>（&lt;1.5R），直接追单性价比偏低，可考虑点选上方 OB/FVG 中轴挂回踩限价单优化入场价。</div>':'';
      resHtml=warn+
        '<div class="rk-grid">'+
          '<div class="rk-kpi"><span>止损距离</span><b class="down">-'+(c.stopDistPct*100).toFixed(2)+'%</b><small>含双边费 '+(c.feePct*100).toFixed(2)+'%</small></div>'+
          '<div class="rk-kpi"><span>目标空间 / 净R:R</span><b class="'+rrCls+'">'+(c.tpDistPct!=null?'+'+(c.tpDistPct*100).toFixed(2)+'%':'—')+' · '+(c.netRR!=null?c.netRR.toFixed(2)+'R':'—')+'</b><small>毛R:R '+(c.grossRR!=null?c.grossRR.toFixed(2)+'R':'—')+'</small></div>'+
          '<div class="rk-kpi"><span>建议名义仓位</span><b style="color:var(--acc)">$'+fC(c.notional)+'</b><small>约 '+fN(c.qty,c.qty>=10?1:4)+' '+sym.replace(/USDT$/,'')+'</small></div>'+
          '<div class="rk-kpi"><span>所需保证金参考</span><b>10x $'+fC(c.notional/10)+'</b><small>5x $'+fC(c.notional/5)+' · 20x $'+fC(c.notional/20)+'</small></div>'+
        '</div>';
    }
  }
  const stamp=$('#riskStamp');
  if(stamp&&c&&c.validSide)stamp.textContent=(RISK.side==='long'?'做多':'做空')+' · 止损 '+(c.stopDistPct*100).toFixed(2)+'% · '+(c.netRR!=null?'净 '+c.netRR.toFixed(2)+'R · ':'')+'仓位 $'+fC(c.notional);
  host.innerHTML=
    '<div class="row" style="margin-bottom:8px;justify-content:space-between">'+
      '<div class="seg" id="rkSide"><button type="button" data-s="long"'+(RISK.side==='long'?' class="on"':'')+'>做多 Long</button><button type="button" data-s="short"'+(RISK.side==='short'?' class="on"':'')+'>做空 Short</button></div>'+
      '<div class="row" style="gap:4px"><button type="button" class="btn mini" id="rkAuto">↻ 按SMC重取点位</button><button type="button" class="btn mini" id="rkCopy">复制计划</button></div>'+
    '</div>'+
    '<div class="rk-inputs">'+
      '<label><span>入场价 Entry</span><input id="rkEntry" type="number" step="any" value="'+RISK.entry+'"></label>'+
      '<label><span>失效止损 SL</span><input id="rkSl" type="number" step="any" value="'+RISK.sl+'"></label>'+
      '<label><span>第一目标 TP1</span><input id="rkTp" type="number" step="any" value="'+RISK.tp+'"></label>'+
      '<label><span>单笔定损 (USDT)</span><input id="rkUsd" type="number" step="10" min="1" value="'+RISK.riskUsd+'"></label>'+
    '</div>'+
    '<div class="row" style="margin-top:6px;gap:6px"><span class="mut">快捷定损</span>'+presets+
      '<span class="mut" style="margin-left:auto">双边费率%</span><input id="rkFee" type="number" step="0.01" min="0" max="1" value="'+RISK.feePct+'" style="width:62px;padding:4px 6px;font-size:12px">'+
    '</div>'+
    (RISK.note?'<p class="muted hint" style="margin-top:4px;font-size:10.5px">点位来源：'+RISK.note+'</p>':'')+
    resHtml;

  host.querySelectorAll('#rkSide button').forEach(b=>b.onclick=()=>{
    RISK.side=b.dataset.s;
    const hit=SMCUI.cache.get(sym+'|'+SMCUI.tf);
    if(hit)riskAutoSeed(sym,hit.res,true);else riskRender();
    if(typeof dtTacticalDraw==='function')dtTacticalDraw();
  });
  const bindInp=(id,key,save)=>{
    const el=host.querySelector(id);if(!el)return;
    el.onchange=()=>{RISK[key]=el.value;if(save)riskSaveCfg();riskRender();if(typeof dtTacticalDraw==='function')dtTacticalDraw()};
  };
  bindInp('#rkEntry','entry',false);bindInp('#rkSl','sl',false);bindInp('#rkTp','tp',false);
  bindInp('#rkUsd','riskUsd',true);bindInp('#rkFee','feePct',true);
  host.querySelectorAll('[data-rk-u]').forEach(b=>b.onclick=()=>{RISK.riskUsd=+b.dataset.rkU;riskSaveCfg();riskRender()});
  const autoBtn=host.querySelector('#rkAuto');
  if(autoBtn)autoBtn.onclick=()=>{
    const hit=SMCUI.cache.get(sym+'|'+SMCUI.tf);
    if(hit){riskAutoSeed(sym,hit.res,true);if(typeof dtTacticalDraw==='function')dtTacticalDraw()}
    else smcRender();
  };
  const copyBtn=host.querySelector('#rkCopy');
  if(copyBtn)copyBtn.onclick=()=>{
    const k=riskCalc();
    if(!k||!k.validSide){toast('请先确认有效入场与止损价');return}
    const txt=`[${sym} ${RISK.side==='long'?'做多':'做空'}计划] 入场 ${k.en} | 止损 ${k.sl} (-${(k.stopDistPct*100).toFixed(2)}%) | 目标 ${k.tp||'—'} (${k.netRR!=null?'净'+k.netRR.toFixed(2)+'R':'—'}) | 定损 $${k.riskUsd} → 建议名义仓位 $${Math.round(k.notional)} (${k.qty.toPrecision(4)} 币)`;
    if(navigator.clipboard?.writeText)navigator.clipboard.writeText(txt).then(()=>toast('已复制交易计划')).catch(()=>toast(txt));
    else toast(txt);
  };
}

function smcInit(){
  smcMount();
  if($('#smcFold')&&$('#smcFold').open)smcRender();
}

function smcRefresh(){
  smcMount();
  const f=$('#smcFold');
  if(f&&f.open)smcRender();
  else riskRender();
}

globalThis.SmcState={SMCUI,RISK,smcEnsureData,smcBuildRows,riskCalc,riskRender};
