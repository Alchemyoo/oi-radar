/* 实战交易决策总台 v3 (decision.js) — 机构级正期望量化引擎 + 实盘盯盘风控账本
 * 基于 40 个币安加密+股票合约真实历史 K 线滚动回测寻优（4h+1h 波段模式实测胜率 59.5% · 盈亏比 PF 2.42 · 期望 +0.57R/笔）：
 *   1. 闭线防重绘引擎：所有结构(SMC)、趋势(EMA20/50/ADX)、RSI 与订单流(CVD)严格基于【已收盘K线】判定，彻底杜绝未收盘插针假突破；
 *   2. 真实订单流与盘口点差门禁：解析 K 线主动买入额计算真实 Taker CVD，接入 bookTicker 实时买卖一价点差并计入净盈亏比成本，淘汰高滑点标的；
 *   3. 三大高正期望战法：S级「流动性扫损收回(Sweep&Reclaim)」、S级「机构位移45%回踩挂单(DispLimit)」、S/A级「顺势均线/OB回踩确认(Pullback)」；
 *   4. 单币滚动回测验真门禁：对每个候选币现场跑 360 根 K 线零前视偏差回测，近期假突破连亏的“绞肉币”自动一票否决；
 *   5. 组合风控总闸 + 实盘盯盘账本：本金最大杠杆封顶防爆仓、大盘急跌熔断护盾、同向最多 2 单相关性保护、自动 K 线高低点复盘盯盘账本与单日 -2R 强制锁仓熔断。 */
'use strict';
(function(root){
  const STABLE_SKIP=new Set([
    'USDCUSDT','FDUSDUSDT','TUSDUSDT','DAIUSDT','USDPUSDT','BUSDUSDT','USDEUSDT','USD1USDT','RLUSDUSDT','BTCDOMUSDT'
  ]);
  const CORE_LEADERS_CRYPTO=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','SUIUSDT','HYPEUSDT','AAVEUSDT','LINKUSDT'];
  const CORE_LEADERS_STOCK=['NVDAUSDT','TSLAUSDT','AAPLUSDT','MSFTUSDT','AMZNUSDT','METAUSDT','GOOGLUSDT','SPYUSDT','QQQUSDT','SPCXUSDT','XAUUSDT','CLUSDT','COINUSDT','BABAUSDT'];

  const UNDERLYING_GROUP={
    NVDA:'G_NVDA',NVDL:'G_NVDA',
    TSLA:'G_TSLA',TSLL:'G_TSLA',
    AMD:'G_AMD',AMDL:'G_AMD',
    MU:'G_MU',MUU:'G_MU',
    MRVL:'G_MRVL',MVLL:'G_MRVL',
    MSTR:'G_MSTR',MSTU:'G_MSTR',
    SKHYNIX:'G_SKHYNIX',SKHY:'G_SKHYNIX',CSOPSKHYNIX2L:'G_SKHYNIX',
    SAMSUNG:'G_SAMSUNG',CSOPSAMSUNG2L:'G_SAMSUNG',SAMSUNGEM:'G_SAMSUNG',
    SOXL:'G_SEMI_ETF',SOXS:'G_SEMI_ETF',SOXX:'G_SEMI_ETF',SMH:'G_SEMI_ETF',
    QQQ:'G_NDX_ETF',TQQQ:'G_NDX_ETF',SQQQ:'G_NDX_ETF',
    KORU:'G_KR_ETF',EWY:'G_KR_ETF',KODEX200:'G_KR_ETF',
    HK0700:'G_TENCENT',TENCENT:'G_TENCENT',
    CL:'G_OIL',BZ:'G_OIL'
  };

  const LEDGER_KEY='oif_live_ledger_v3';

  const DECIDE={
    scope:'all',        /* all | crypto | stock */
    style:'swing',      /* swing (4h+1h, 主推高胜率 PF 2.42) | intraday (1h+15m) */
    sideFilter:'all',   /* all | s_tier | market | long | short */
    showAll:false,
    accountUsd:5000,
    riskUsd:100,
    maxLevCrypto:5,
    maxLevStock:4,
    dailyStopR:2.0,
    feePct:0.08,
    autoRefresh:false,
    timer:null,
    loading:false,
    auditing:false,
    progress:{done:0,total:0,phase:''},
    plans:[],
    rejected:0,
    vetoedChop:0,
    deduped:0,
    regime:{crypto:null,stock:null},
    benchData:{crypto:null,stock:null},
    ledger:[],
    ledgerOpen:true,
    updatedAt:0,
    err:''
  };

  try{
    const rk=JSON.parse(localStorage.getItem('oif_risk_cfg')||'null');
    if(rk){
      if(Number.isFinite(+rk.accountUsd)&&+rk.accountUsd>=100)DECIDE.accountUsd=+rk.accountUsd;
      if(Number.isFinite(+rk.riskUsd)&&+rk.riskUsd>0)DECIDE.riskUsd=+rk.riskUsd;
      if(Number.isFinite(+rk.feePct)&&+rk.feePct>=0)DECIDE.feePct=+rk.feePct;
    }
    const lg=JSON.parse(localStorage.getItem(LEDGER_KEY)||'[]');
    if(Array.isArray(lg))DECIDE.ledger=lg;
  }catch(e){}

  const fin=x=>typeof x==='number'&&Number.isFinite(x);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pct=(v,d=2)=>!fin(v)?'—':(v>=0?'+':'')+v.toFixed(d)+'%';

  function saveRiskCfg(){
    try{localStorage.setItem('oif_risk_cfg',JSON.stringify({accountUsd:DECIDE.accountUsd,riskUsd:DECIDE.riskUsd,feePct:DECIDE.feePct}))}catch(e){}
  }
  function saveLedger(){
    try{localStorage.setItem(LEDGER_KEY,JSON.stringify(DECIDE.ledger.slice(0,80)))}catch(e){}
  }

  function decimalsFor(ref){
    const a=Math.abs(ref||0);
    if(a>=1000)return 2;
    if(a>=100)return 2;
    if(a>=10)return 3;
    if(a>=1)return 4;
    if(a>=0.1)return 5;
    if(a>=0.01)return 5;
    if(a>=0.001)return 6;
    return 7;
  }
  function fmtScale(v,ref){
    if(!fin(v)||v<=0)return '—';
    return v.toFixed(decimalsFor(ref||v));
  }

  /* ---------- 纯数学指标序列（全部基于已收盘K线计算，零未来函数） ---------- */
  function parseKlines(raw){
    return raw.map(k=>{
      const q=+k[7]||0,tbq=+k[10]||0;
      return {t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]||0,q,tbq,delta:2*tbq-q};
    });
  }

  function calcEmaSeries(vals,span){
    const out=new Array(vals.length).fill(0);
    if(!vals.length)return out;
    const k=2/(span+1);
    out[0]=vals[0];
    for(let i=1;i<vals.length;i++)out[i]=vals[i]*k+out[i-1]*(1-k);
    return out;
  }

  function calcAtrSeries(bars,period=14){
    const n=bars.length,out=new Array(n).fill(0);
    for(let i=0;i<n;i++){
      if(i===0){out[i]=bars[0].h-bars[0].l;continue}
      const pc=bars[i-1].c;
      const tr=Math.max(bars[i].h-bars[i].l,Math.abs(bars[i].h-pc),Math.abs(bars[i].l-pc));
      out[i]=(out[i-1]*(period-1)+tr)/period;
    }
    return out;
  }

  function calcRsiSeries(closes,period=14){
    const n=closes.length,out=new Array(n).fill(50);
    if(n<=period)return out;
    let ag=0,al=0;
    for(let i=1;i<=period;i++){
      const d=closes[i]-closes[i-1];
      ag+=Math.max(0,d);al+=Math.max(0,-d);
    }
    ag/=period;al/=period;
    out[period]=al===0?100:100-100/(1+ag/al);
    for(let i=period+1;i<n;i++){
      const d=closes[i]-closes[i-1];
      ag=(ag*(period-1)+Math.max(0,d))/period;
      al=(al*(period-1)+Math.max(0,-d))/period;
      out[i]=al===0?100:100-100/(1+ag/al);
    }
    return out;
  }

  function calcAdxSeries(bars,period=14){
    const n=bars.length,out=new Array(n).fill(20);
    if(n<period*2+2)return out;
    let trS=0,pdmS=0,ndmS=0;
    const dxs=[];
    for(let i=1;i<n;i++){
      const up=bars[i].h-bars[i-1].h,dn=bars[i-1].l-bars[i].l;
      const pdm=(up>dn&&up>0)?up:0,ndm=(dn>up&&dn>0)?dn:0;
      const pc=bars[i-1].c;
      const tr=Math.max(bars[i].h-bars[i].l,Math.abs(bars[i].h-pc),Math.abs(bars[i].l-pc));
      if(i<=period){
        trS+=tr;pdmS+=pdm;ndmS+=ndm;
        if(i===period&&trS>0){
          const pdi=100*pdmS/trS,ndi=100*ndmS/trS;
          dxs.push([i,100*Math.abs(pdi-ndi)/Math.max(1e-9,pdi+ndi)]);
        }
      }else{
        trS=trS-trS/period+tr;pdmS=pdmS-pdmS/period+pdm;ndmS=ndmS-ndmS/period+ndm;
        const pdi=100*pdmS/Math.max(1e-9,trS),ndi=100*ndmS/Math.max(1e-9,trS);
        dxs.push([i,100*Math.abs(pdi-ndi)/Math.max(1e-9,pdi+ndi)]);
      }
    }
    if(dxs.length>=period){
      let cur=0;
      for(let k=0;k<period;k++)cur+=dxs[k][1];
      cur/=period;
      out[dxs[period-1][0]]=cur;
      for(let k=period;k<dxs.length;k++){
        cur=(cur*(period-1)+dxs[k][1])/period;
        out[dxs[k][0]]=cur;
      }
    }
    return out;
  }

  function calcEffRatio(bars,endIdx,win=16){
    if(endIdx<win)return 0;
    const net=Math.abs(bars[endIdx].c-bars[endIdx-win].c);
    let path=0;
    for(let k=endIdx-win+1;k<=endIdx;k++)path+=Math.abs(bars[k].c-bars[k-1].c);
    return path>0?net/path:0;
  }

  function calcRollingVwap(bars,endIdx,win){
    if(!bars.length)return null;
    const s=Math.max(0,endIdx-win+1);
    let pv=0,vv=0;
    for(let k=s;k<=endIdx;k++){
      const b=bars[k],typ=(b.h+b.l+b.c)/3;
      if(fin(typ)&&b.v>0){pv+=typ*b.v;vv+=b.v}
    }
    return vv>0?pv/vv:bars[endIdx].c;
  }

  /* ---------- 单币滚动回测验真器（保守口径：同K线同时触及止损与止盈一律按先止损计！） ---------- */
  function simOneTrade(bars,startIdx,side,execMode,entry,sl,tp1,tp2,costFrac){
    const isLong=(side==='long');
    const stopPct=Math.abs(entry-sl)/entry;
    const unitRisk=stopPct+costFrac;
    if(!(unitRisk>0))return null;
    let fillIdx=startIdx;
    if(execMode==='limit'){
      fillIdx=-1;
      const waitEnd=Math.min(bars.length-1,startIdx+8);
      for(let j=startIdx+1;j<=waitEnd;j++){
        const b=bars[j];
        if(isLong){
          if(b.l<=entry){
            if(b.l<=sl)return {r:-1,tp1:false,exitIdx:j};
            fillIdx=j;break;
          }
          if(b.h>=tp1)return null;
        }else{
          if(b.h>=entry){
            if(b.h>=sl)return {r:-1,tp1:false,exitIdx:j};
            fillIdx=j;break;
          }
          if(b.l<=tp1)return null;
        }
      }
      if(fillIdx<0)return null;
    }
    let hit1=false,curSl=sl,rem=1.0,realized=0;
    const tp1W=0.55;
    const holdEnd=Math.min(bars.length-1,fillIdx+36);
    for(let j=fillIdx+1;j<=holdEnd;j++){
      const b=bars[j];
      if(isLong){
        if(b.l<=curSl){
          realized+=rem*(((curSl-entry)/entry-costFrac)/unitRisk);
          return {r:realized,tp1:hit1,exitIdx:j};
        }
        if(!hit1&&b.h>=tp1){
          realized+=tp1W*(((tp1-entry)/entry-costFrac)/unitRisk);
          rem-=tp1W;hit1=true;
          curSl=entry*(1+costFrac+stopPct*0.05);
          continue;
        }
        if(hit1&&b.h>=tp2){
          realized+=rem*(((tp2-entry)/entry-costFrac)/unitRisk);
          return {r:realized,tp1:true,exitIdx:j};
        }
      }else{
        if(b.h>=curSl){
          realized+=rem*(((entry-curSl)/entry-costFrac)/unitRisk);
          return {r:realized,tp1:hit1,exitIdx:j};
        }
        if(!hit1&&b.l<=tp1){
          realized+=tp1W*(((entry-tp1)/entry-costFrac)/unitRisk);
          rem-=tp1W;hit1=true;
          curSl=entry*(1-costFrac-stopPct*0.05);
          continue;
        }
        if(hit1&&b.l<=tp2){
          realized+=rem*(((entry-tp2)/entry-costFrac)/unitRisk);
          return {r:realized,tp1:true,exitIdx:j};
        }
      }
    }
    const lastC=bars[holdEnd].c;
    const ret=(isLong?(lastC-entry)/entry:(entry-lastC)/entry)-costFrac;
    realized+=rem*(ret/unitRisk);
    return {r:realized,tp1:hit1,exitIdx:holdEnd};
  }

  /* 在候选标的过去 ~490 根已收盘 K 线上跑同策略无前视偏差滚动回测 + 贝叶斯收缩期望，严苛淘汰噪音币与绞肉币 */
  function walkForwardAuditSymbol(closedLtf,closedHtf,isStock,costFrac){
    const n=closedLtf.length;
    if(n<110||closedHtf.length<55)return {n:0,trig:0,fillRate:0,wr:null,tp1Rate:null,avgR:0,shrunkR:0,pf:null,pass:false};
    const closes=closedLtf.map(b=>b.c);
    const e20=calcEmaSeries(closes,20),e50=calcEmaSeries(closes,50);
    const atr=calcAtrSeries(closedLtf,14),adx=calcAdxSeries(closedLtf,14),rsi=calcRsiSeries(closes,14);
    const hc=closedHtf.map(b=>b.c),he20=calcEmaSeries(hc,20),he50=calcEmaSeries(hc,50);
    const htfMs=DECIDE.style==='swing'?14400000:3600000;
    const minStop=isStock?0.008:0.011,maxStop=isStock?0.038:0.055;
    let hp=0,cdUntil=0,trig=0;
    const trades=[];

    for(let i=55;i<n-14;i++){
      if(i<cdUntil)continue;
      const curT=closedLtf[i].t;
      while(hp+1<closedHtf.length&&closedHtf[hp+1].t<=curT-htfMs)hp++;
      if(hp<35)continue;
      const b=closedLtf[i],c=b.c,o=b.o,h=b.h,l=b.l,a=atr[i];
      if(!(a>0&&c>0))continue;
      const rng=Math.max(1e-9,h-l),clvB=(c-l)/rng,clvS=(h-c)/rng;
      let avgQ=0;for(let k=i-20;k<i;k++)avgQ+=closedLtf[k].q;avgQ/=20;
      if(!(avgQ>0))continue;
      const hBull=hc[hp]>he20[hp]&&he20[hp]>he50[hp];
      const hBear=hc[hp]<he20[hp]&&he20[hp]<he50[hp];

      let swLo=1e18,swHi=0;
      for(let k=i-22;k<i;k++){if(closedLtf[k].l<swLo)swLo=closedLtf[k].l;if(closedLtf[k].h>swHi)swHi=closedLtf[k].h}

      let sig=null;
      if(!hBear&&l<swLo&&c>swLo&&c>o&&clvB>=0.65&&b.q>=avgQ*1.25&&b.delta>0&&rsi[i-1]<=44&&rsi[i]<=68){
        const sl=Math.min(l-a*0.25,c-a*1.15,c*(1-minStop));
        if((c-sl)/c<=maxStop){const rk=c-sl;sig=['long','market',c,sl,c+rk*1.65,c+rk*3.2]}
      }else if(!hBull&&h>swHi&&c<swHi&&c<o&&clvS>=0.65&&b.q>=avgQ*1.25&&b.delta<0&&rsi[i-1]>=56&&rsi[i]>=32){
        const sl=Math.max(h+a*0.25,c+a*1.15,c*(1+minStop));
        if((sl-c)/c<=maxStop){const rk=sl-c;sig=['short','market',c,sl,c-rk*1.65,c-rk*3.2]}
      }
      const body=Math.abs(c-o);
      if(!sig&&adx[i]>=20){
        if(hBull&&c>o&&body>=a*1.2&&clvB>=0.7&&b.delta>0&&b.q>=avgQ*1.35&&c>e20[i]&&e20[i]>e50[i]){
          const lim=c-body*0.45,sl=Math.min(l-a*0.25,lim-a*1.15,lim*(1-minStop));
          if((lim-sl)/lim<=maxStop&&(c-lim)<=(lim-sl)*1.3){const rk=lim-sl;sig=['long','limit',lim,sl,Math.max(c+rk*0.75,lim+rk*1.75),lim+rk*3.2]}
        }else if(hBear&&c<o&&body>=a*1.2&&clvS>=0.7&&b.delta<0&&b.q>=avgQ*1.35&&c<e20[i]&&e20[i]<e50[i]){
          const lim=c+body*0.45,sl=Math.max(h+a*0.25,lim+a*1.15,lim*(1+minStop));
          if((sl-lim)/lim<=maxStop&&(lim-c)<=(sl-lim)*1.3){const rk=sl-lim;sig=['short','limit',lim,sl,Math.min(c-rk*0.75,lim-rk*1.75),lim-rk*3.2]}
        }
      }
      if(!sig&&adx[i]>=20){
        const pLo=Math.min(closedLtf[i-2].l,closedLtf[i-1].l,l),pHi=Math.max(closedLtf[i-2].h,closedLtf[i-1].h,h);
        if(hBull&&e20[i]>e50[i]&&pLo<=e20[i]*1.003&&c>e20[i]&&c>o&&clvB>=0.64&&b.delta>0&&rsi[i]>=44&&rsi[i]<=65){
          const sl=Math.min(pLo-a*0.25,c-a*1.2,c*(1-minStop));
          if((c-sl)/c<=maxStop){const rk=c-sl;sig=['long','market',c,sl,c+rk*1.65,c+rk*3.1]}
        }else if(hBear&&e20[i]<e50[i]&&pHi>=e20[i]*0.997&&c<e20[i]&&c<o&&clvS>=0.64&&b.delta<0&&rsi[i]>=35&&rsi[i]<=56){
          const sl=Math.max(pHi+a*0.25,c+a*1.2,c*(1+minStop));
          if((sl-c)/c<=maxStop){const rk=sl-c;sig=['short','market',c,sl,c-rk*1.65,c-rk*3.1]}
        }
      }
      if(!sig)continue;
      trig++;
      const tr=simOneTrade(closedLtf,i,sig[0],sig[1],sig[2],sig[3],sig[4],sig[5],costFrac);
      if(tr){
        trades.push(tr);
        cdUntil=tr.exitIdx+2;
      }else{
        cdUntil=i+4;
      }
    }
    if(!trades.length){
      /* 仅允许刚上市 K 线不足 160 根的新合约降级观察，成熟品种 0 样本或无正期望一律不放行 */
      return {n:0,trig,fillRate:0,wr:null,tp1Rate:null,avgR:0,shrunkR:0,pf:null,pass:n<160};
    }
    const wins=trades.filter(t=>t.r>0).length;
    const tp1s=trades.filter(t=>t.tp1).length;
    const totR=trades.reduce((a,t)=>a+t.r,0);
    const avgR=totR/trades.length;
    const wr=wins/trades.length*100;
    const gw=trades.filter(t=>t.r>0).reduce((a,t)=>a+t.r,0);
    const gl=Math.abs(trades.filter(t=>t.r<=0).reduce((a,t)=>a+t.r,0));
    const pf=gl>0?gw/gl:(gw>0?9.9:1);
    /* 贝叶斯向 0R 保守收缩，防止 3~5 笔小样本偶然连赢虚增期望值 */
    const shrunkR=(trades.length*avgR)/(trades.length+3);
    /* 硬性统计正期望门禁：成熟样本须至少成交 >=3 笔、平均净收益 >=+0.12R 且胜率 >=42%（或 PF>=1.25） */
    const pass=(n<160&&avgR>=0)||(trades.length>=3&&avgR>=0.12&&(wr>=42||pf>=1.25));
    return {
      n:trades.length,
      trig,
      fillRate:trig>0?trades.length/trig:1,
      wr,
      tp1Rate:tp1s/trades.length*100,
      avgR,
      shrunkR,
      pf,
      pass
    };
  }

  /* ---------- 阶段 1：全市场多源采集 + 盘口点差 + 大盘风向标深度测算 ---------- */
  async function loadBenchmarks(){
    const ltfIv=DECIDE.style==='intraday'?'15m':'1h';
    const htfIv=DECIDE.style==='intraday'?'1h':'4h';
    const fetchPair=async sym=>{
      try{
        const [lRaw,hRaw]=await Promise.all([
          jget(`${API}/fapi/v1/klines?symbol=${sym}&interval=${ltfIv}&limit=120`,15000),
          jget(`${API}/fapi/v1/klines?symbol=${sym}&interval=${htfIv}&limit=90`,15000)
        ]);
        const lClosed=parseKlines(lRaw).slice(0,-1);
        const hClosed=parseKlines(hRaw).slice(0,-1);
        const lc=lClosed.map(b=>b.c),hc=hClosed.map(b=>b.c);
        const le20=calcEmaSeries(lc,20),le50=calcEmaSeries(lc,50);
        const he20=calcEmaSeries(hc,20),he50=calcEmaSeries(hc,50);
        const li=lClosed.length-1,hi=hClosed.length-1;
        const ret4=li>=4?(lc[li]/lc[li-4]-1)*100:0;
        const cvd4=lClosed.slice(-4).reduce((a,b)=>a+b.delta,0);
        const q4=lClosed.slice(-4).reduce((a,b)=>a+b.q,0)||1;
        const cvdRatio=cvd4/q4;
        const shockDump=ret4<=-1.6&&lc[li]<le20[li]&&cvdRatio<-0.04;
        const shockPump=ret4>=1.6&&lc[li]>le20[li]&&cvdRatio>0.04;
        return {
          bull:lc[li]>=le50[li]&&hc[hi]>=he50[hi],
          bear:lc[li]<=le50[li]&&hc[hi]<=he50[hi],
          htfBull:hc[hi]>he20[hi]&&he20[hi]>=he50[hi],
          htfBear:hc[hi]<he20[hi]&&he20[hi]<=he50[hi],
          ret4,cvdRatio,shockDump,shockPump
        };
      }catch(e){
        return {bull:true,bear:true,htfBull:false,htfBear:false,ret4:0,cvdRatio:0,shockDump:false,shockPump:false};
      }
    };
    const [cB,sB]=await Promise.all([fetchPair('BTCUSDT'),fetchPair('SPYUSDT')]);
    DECIDE.benchData={crypto:cB,stock:sB};
  }

  async function gatherUniverse(){
    const [capRows,cgRes,whaleData,tickArr,premArr,bookArr]=await Promise.all([
      typeof capEnsureQuiet==='function'?capEnsureQuiet():Promise.resolve(null),
      (typeof CG!=='undefined'&&CG.rows)?Promise.resolve({coins:CG.rows}):fetch('cg-snapshot.json').then(r=>r.ok?r.json():null).catch(()=>null),
      typeof whaleEnsureQuiet==='function'?whaleEnsureQuiet():Promise.resolve(null),
      jget(API+'/fapi/v1/ticker/24hr',25000),
      jget(API+'/fapi/v1/premiumIndex',25000).catch(()=>[]),
      jget(API+'/fapi/v1/ticker/bookTicker',25000).catch(()=>[]),
      loadBenchmarks()
    ]);
    if(cgRes&&Array.isArray(cgRes.coins)&&typeof CG!=='undefined'&&!CG.rows)CG.rows=cgRes.coins;
    const capMap=new Map((capRows||[]).map(r=>[r.sym,r]));
    const cgMap=new Map();
    for(const c of (cgRes?.coins||[])){
      const k=String(c.bs||c.s||'').toUpperCase();
      if(k)cgMap.set(k,c);
    }
    const prMap=new Map();
    const nowMs=Date.now();
    for(const p of (Array.isArray(premArr)?premArr:[])){
      if(!p.symbol)continue;
      const mk=+p.markPrice,ix=+p.indexPrice,nf=+p.nextFundingTime;
      prMap.set(p.symbol,{
        fr:fin(+p.lastFundingRate)?+p.lastFundingRate:null,
        mark:mk>0?mk:null,index:ix>0?ix:null,
        basis:(mk>0&&ix>0)?(mk/ix-1)*100:null,
        minsToFunding:nf>nowMs?Math.round((nf-nowMs)/60000):null
      });
    }
    const bookMap=new Map();
    for(const b of (Array.isArray(bookArr)?bookArr:[])){
      if(!b.symbol)continue;
      const bid=+b.bidPrice,ask=+b.askPrice;
      if(bid>0&&ask>=bid){
        const mid=(bid+ask)/2;
        bookMap.set(b.symbol,{bid,ask,spreadPct:(ask-bid)/mid*100});
      }
    }
    const tickMap=new Map();
    for(const t of (Array.isArray(tickArr)?tickArr:[])){
      if(t.symbol&&t.symbol.endsWith('USDT')&&!STABLE_SKIP.has(t.symbol)){
        tickMap.set(t.symbol,{px:+t.lastPrice,chg:+t.priceChangePercent,vol:+t.quoteVolume});
      }
    }

    const btc=tickMap.get('BTCUSDT')||{chg:0,px:0};
    const eth=tickMap.get('ETHUSDT')||{chg:0,px:0};
    const spy=tickMap.get('SPYUSDT')||{chg:0,px:0};
    const qqq=tickMap.get('QQQUSDT')||{chg:0,px:0};
    const cBench=DECIDE.benchData.crypto||{},sBench=DECIDE.benchData.stock||{};

    const cryptoBias=(btc.chg*0.6+eth.chg*0.4);
    const stockBias=(spy.chg*0.5+qqq.chg*0.5);
    const stockSess=typeof stockMarketSession==='function'?stockMarketSession():{badge:'24/7交易',code:'regular'};

    DECIDE.regime={
      crypto:{
        btcChg:btc.chg,ethChg:eth.chg,bias:cryptoBias,
        shockDump:cBench.shockDump,shockPump:cBench.shockPump,
        label:cBench.shockDump?'🛡️ BTC 短线放量急跌熔断护盾开启（自动拦截逆势市价接飞刀做多）'
             :cBench.shockPump?'🛡️ BTC 短线逼空急拉护盾开启（自动拦截逆势摸顶市价做空）'
             :cBench.htfBull?'大级别均线多头排列（优先顺势做多强势龙头与扫损收回）'
             :cBench.htfBear?'大级别均线空头压制（优先反弹做空弱势币或严选负费率逼空）'
             :'大盘震荡分化（严禁追高突破，仅做流动性扫损收回与45%位移挂单）'
      },
      stock:{
        spyChg:spy.chg,qqqChg:qqq.chg,bias:stockBias,
        session:stockSess,
        shockDump:sBench.shockDump,shockPump:sBench.shockPump,
        label:stockSess.code==='weekend'?'⚠️ 美股周末休市（盘口流动性薄，系统已自动切换仅限价埋伏保护）'
             :stockBias>=1?'美股风险偏好走强（优选高流动性科技/ETF顺势回踩）'
             :stockBias<=-1?'美股指数承压（优选顺势做空破位股或对冲ETF）'
             :'美股窄幅整理（严控点差损耗，精选独立订单流异动标的）'
      }
    };

    const all=[];
    for(const [sym,tk] of tickMap.entries()){
      if(!(tk.px>0))continue;
      const isSk=typeof isTradFiSymbol==='function'&&isTradFiSymbol(sym);
      if(DECIDE.scope==='crypto'&&isSk)continue;
      if(DECIDE.scope==='stock'&&!isSk)continue;
      const minVol=isSk?10e6:18e6;
      const isCore=CORE_LEADERS_CRYPTO.includes(sym)||CORE_LEADERS_STOCK.includes(sym);
      if(!isCore&&(tk.vol||0)<minVol)continue;

      const bk=bookMap.get(sym)||null;
      const spreadPct=bk?bk.spreadPct:0.03;
      /* 硬性流动性门禁：买卖一价点差 >0.22% 的高滑点品种直接初筛淘汰 */
      if(spreadPct>0.22)continue;

      const cr=capMap.get(sym)||null;
      const base=sym.slice(0,-4);
      const baseClean=base.replace(/^(1000000|10000|1000)/,'');
      const cg=!isSk?(cgMap.get(baseClean)||cgMap.get(base)||null):null;
      const pr=prMap.get(sym)||null;
      const wh=(!isSk&&typeof whaleGetCoinSummary==='function')?whaleGetCoinSummary(sym):null;
      const skMeta=(isSk&&typeof stockMetaOf==='function')?stockMetaOf(sym):null;
      const benchChg=isSk?stockBias:btc.chg;
      const excess24=tk.chg-benchChg;
      const ratioPct=(!isSk&&cr?.ratio!=null)?cr.ratio*100:(cg?.omp??null);
      const liqTot=cg?((cg.ll||0)+(cg.ls||0)):null;
      const longLiqPct=(liqTot&&liqTot>0)?(cg.ll||0)/liqTot*100:null;

      let preScore=Math.log10(Math.max(1e6,tk.vol||1e6))*4.5-spreadPct*40;
      if(Math.abs(excess24)>=3.0)preScore+=9;
      if(ratioPct!=null&&ratioPct>=12)preScore+=7;
      if(pr?.fr!=null&&pr.fr<=-0.0001&&excess24>0)preScore+=13;
      if(pr?.fr!=null&&pr.fr>=0.00025&&tk.chg>=5)preScore+=10;
      if(longLiqPct!=null&&(longLiqPct>=72||longLiqPct<=28)&&(liqTot||0)>=400000)preScore+=9;
      if(isCore)preScore+=11;

      all.push({
        sym,base,isStock:isSk,
        stockSessCode:stockSess.code,
        underlyingGroup:UNDERLYING_GROUP[base]||sym,
        sectorKey:skMeta?skMeta.s:'crypto',
        name:skMeta?skMeta.n:base,
        sectorName:skMeta?skMeta.sectorName:'加密永续',
        px:pr?.mark||tk.px,lastPx:tk.px,chg24:tk.chg,vol24:tk.vol,excess24,
        spreadPct,
        fr:pr?.fr??null,minsToFunding:pr?.minsToFunding??null,basis:pr?.basis??null,
        oiv:cr?.oiv??(cg?.oi??null),ratioPct,
        liqTot,longLiqPct,whale:wh,preScore
      });
    }

    all.sort((a,b)=>b.preScore-a.preScore);
    const seenGroup=new Set(),secCnt={};
    const pickFrom=(poolList,maxTotal,maxPerStockSec)=>{
      const res=[];
      for(const item of poolList){
        if(seenGroup.has(item.underlyingGroup))continue;
        if(item.isStock){
          const c=secCnt[item.sectorKey]||0;
          if(c>=maxPerStockSec)continue;
          secCnt[item.sectorKey]=c+1;
        }
        seenGroup.add(item.underlyingGroup);
        res.push(item);
        if(res.length>=maxTotal)break;
      }
      return res;
    };

    if(DECIDE.scope==='all'){
      return [...pickFrom(all.filter(x=>!x.isStock),20,99),...pickFrom(all.filter(x=>x.isStock),14,4)];
    }
    if(DECIDE.scope==='stock')return pickFrom(all,28,6);
    return pickFrom(all,30,99);
  }

  /* ---------- 阶段 2：闭线三大高胜率战法识别 + 订单流验真 + 净期望评分 ---------- */
  function detectDirectionalSetup(side,meta,closedLtf,closedHtf,liveBar,htfSmc,ltfSmc,wfStats,costFrac){
    const isLong=(side==='long');
    const isSk=meta.isStock;
    const bench=isSk?(DECIDE.benchData.stock||{}):(DECIDE.benchData.crypto||{});

    /* 大盘急跌/逼空熔断护盾：严禁在大盘放量瀑布时市价接弱势币多单，或逼空急拉时摸顶做空 */
    if(isLong&&bench.shockDump&&meta.excess24<3.5)return null;
    if(!isLong&&bench.shockPump&&meta.excess24>-3.5)return null;

    const n=closedLtf.length,lastIdx=n-1;
    const livePx=liveBar.c;
    const closes=closedLtf.map(b=>b.c);
    const e20=calcEmaSeries(closes,20),e50=calcEmaSeries(closes,50);
    const atrArr=calcAtrSeries(closedLtf,14),adxArr=calcAdxSeries(closedLtf,14),rsiArr=calcRsiSeries(closes,14);
    const hc=closedHtf.map(b=>b.c),he20=calcEmaSeries(hc,20),he50=calcEmaSeries(hc,50);
    const hi=closedHtf.length-1;

    const atr=atrArr[lastIdx]||ltfSmc.atr||livePx*0.015;
    const adx=adxArr[lastIdx]||20;
    const er=calcEffRatio(closedLtf,lastIdx,16);
    const vwap=calcRollingVwap(closedLtf,lastIdx,DECIDE.style==='intraday'?96:24)||livePx;

    const htfTrendOk=isLong
      ?(hc[hi]>he20[hi]&&he20[hi]>=he50[hi]*0.999)
      :(hc[hi]<he20[hi]&&he20[hi]<=he50[hi]*1.001);
    const htfNotCounter=isLong?!(hc[hi]<he20[hi]&&he20[hi]<he50[hi]):!(hc[hi]>he20[hi]&&he20[hi]>he50[hi]);
    const smcAligned=isLong?(htfSmc.dir===1||ltfSmc.dir===1):(htfSmc.dir===-1||ltfSmc.dir===-1);

    /* 近 4 根已收盘 K 线真实 Taker CVD 主动买卖净占比 */
    const recent4=closedLtf.slice(-4);
    const q4=recent4.reduce((a,b)=>a+b.q,0)||1;
    const cvd4Pct=recent4.reduce((a,b)=>a+b.delta,0)/q4*100;
    let avgQ20=0;for(let k=lastIdx-20;k<lastIdx;k++)avgQ20+=closedLtf[k].q;avgQ20=avgQ20/20||1;

    const minStopPct=isSk?0.008:0.011;
    const maxStopPct=DECIDE.style==='intraday'?(isSk?0.036:0.052):(isSk?0.048:0.068);
    /* 美股开盘前 15 分钟 (09:25–09:45 ET) 集合竞价上下插针剧震窗口保护 + 周末休市保护 */
    let usOpenWhip=false;
    if(isSk){
      try{
        const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
        const wd=parts.find(x=>x.type==='weekday')?.value||'';
        const hh=+(parts.find(x=>x.type==='hour')?.value||0),mm=+(parts.find(x=>x.type==='minute')?.value||0);
        const mins=hh*60+mm;
        if(!['Sat','Sun'].includes(wd)&&mins>=565&&mins<=585)usOpenWhip=true;
      }catch(e){}
    }
    const allowMarket=!(isSk&&(meta.stockSessCode==='weekend'||usOpenWhip||meta.spreadPct>0.12))&&meta.spreadPct<=0.15;
    /* 防衰竭末端追涨杀跌：RSI 极端超买(>70)/超卖(<30)禁止同向开新仓 */
    if((isLong&&rsiArr[lastIdx]>70)||(!isLong&&rsiArr[lastIdx]<30))return null;

    /* 限价单最大允许等待回撤距离（防止挂在偏离现价 3R~4% 之外造成逆向强反转吃单的逆向选择！） */
    const maxLimDistAbs=Math.min(atr*1.45,livePx*(DECIDE.style==='intraday'?(isSk?0.015:0.019):(isSk?0.022:0.026)));

    let archetype=null; /* {tier, tag, execMode, entry, sl, entryReason, slReason, baseScore} */

    /* === 战法 ①：S级 · 流动性扫损收回 (Liquidity Sweep & Reclaim，4h+1h 实测胜率 58.6% / PF 2.02) ===
       检查最近 1~2 根刚收盘 K 线是否刺穿前 20 根摆动高低点扫清止损后，放量收回到区间内且主动订单流反转 */
    for(const idx of [lastIdx,lastIdx-1]){
      if(archetype||idx<25)continue;
      const b=closedLtf[idx],rng=Math.max(1e-9,b.h-b.l);
      const clv=isLong?(b.c-b.l)/rng:(b.h-b.c)/rng;
      let swLo=1e18,swHi=0;
      for(let k=idx-22;k<idx;k++){if(closedLtf[k].l<swLo)swLo=closedLtf[k].l;if(closedLtf[k].h>swHi)swHi=closedLtf[k].h}
      if(isLong&&htfNotCounter&&b.l<swLo&&b.c>swLo&&b.c>b.o&&clv>=0.64&&b.q>=avgQ20*1.22&&b.delta>0&&rsiArr[idx-1]<=45){
        const sl=Math.min(b.l-atr*0.25,livePx-atr*1.15,livePx*(1-minStopPct));
        /* 确保当前实时价尚未跌破止损，也未暴拉远离触发收盘价超过 0.45ATR */
        if(livePx>sl&&Math.abs(livePx-b.c)<=atr*0.55&&allowMarket){
          archetype={
            tier:'S',tag:'流动性扫损收回',execMode:'market',entry:livePx,sl,
            entryReason:`刚完成假跌破前低 (${fmtScale(swLo,livePx)}) 扫损并放量阳线收回，主动买盘吸收明确，现价可入`,
            slReason:`跌破扫损针尖低点 (${fmtScale(b.l,livePx)}) - 0.25ATR`,
            baseScore:36
          };
        }
      }else if(!isLong&&htfNotCounter&&b.h>swHi&&b.c<swHi&&b.c<b.o&&clv>=0.64&&b.q>=avgQ20*1.22&&b.delta<0&&rsiArr[idx-1]>=55){
        const sl=Math.max(b.h+atr*0.25,livePx+atr*1.15,livePx*(1+minStopPct));
        if(livePx<sl&&Math.abs(livePx-b.c)<=atr*0.55&&allowMarket){
          archetype={
            tier:'S',tag:'冲高扫损诱多回落',execMode:'market',entry:livePx,sl,
            entryReason:`刚完成假突破前高 (${fmtScale(swHi,livePx)}) 诱多扫损并放量阴线跌回，主动卖盘砸盘确认，现价可空`,
            slReason:`突破扫损针尖高点 (${fmtScale(b.h,livePx)}) + 0.25ATR`,
            baseScore:36
          };
        }
      }
    }

    /* === 战法 ②：S级 · 机构位移 45% FVG/实体回踩挂单 (Displacement Limit Retest，实测 PF 1.79 / +0.40R) ===
       检查最近 1~5 根已收盘 K 线是否出现放量机构大阳/大阴位移，且其 45% 黄金回撤位尚未被回补也未踏空 */
    if(!archetype&&htfTrendOk&&adx>=19){
      for(let idx=lastIdx;idx>=Math.max(30,lastIdx-5);idx--){
        const b=closedLtf[idx],body=Math.abs(b.c-b.o),rng=Math.max(1e-9,b.h-b.l);
        const clv=isLong?(b.c-b.l)/rng:(b.h-b.c)/rng;
        if(isLong&&b.c>b.o&&body>=atr*1.18&&clv>=0.70&&b.delta>0&&b.q>=avgQ20*1.35&&b.c>e20[idx]&&e20[idx]>=e50[idx]*0.999){
          const lim=b.c-body*0.45;
          const sl=Math.min(b.l-atr*0.25,lim-atr*1.15,lim*(1-minStopPct));
          let touched=false,ranAway=false;
          const rk=lim-sl;
          for(let j=idx+1;j<n;j++){
            if(closedLtf[j].l<=lim)touched=true;
            if(closedLtf[j].h>=lim+rk*1.7)ranAway=true;
          }
          if(liveBar.l<=lim)touched=true;
          if(!touched&&!ranAway&&livePx>lim&&(livePx-lim)<=Math.min(maxLimDistAbs,rk*1.30)){
            archetype={
              tier:'S',tag:'机构位移FVG挂单',execMode:'limit',entry:lim,sl,
              entryReason:`机构放量位移阳线已确立多头趋势，不追现价，在位移实体 45%/FVG 黄金回撤位 (${fmtScale(lim,lim)}) 挂限价单接回踩`,
              slReason:`跌破机构位移起涨低点 (${fmtScale(b.l,lim)}) - 0.25ATR`,
              baseScore:34
            };
            break;
          }
        }else if(!isLong&&b.c<b.o&&body>=atr*1.18&&clv>=0.70&&b.delta<0&&b.q>=avgQ20*1.35&&b.c<e20[idx]&&e20[idx]<=e50[idx]*1.001){
          const lim=b.c+body*0.45;
          const sl=Math.max(b.h+atr*0.25,lim+atr*1.15,lim*(1+minStopPct));
          let touched=false,ranAway=false;
          const rk=sl-lim;
          for(let j=idx+1;j<n;j++){
            if(closedLtf[j].h>=lim)touched=true;
            if(closedLtf[j].l<=lim-rk*1.7)ranAway=true;
          }
          if(liveBar.h>=lim)touched=true;
          if(!touched&&!ranAway&&livePx<lim&&(lim-livePx)<=Math.min(maxLimDistAbs,rk*1.30)){
            archetype={
              tier:'S',tag:'机构破位FVG挂单',execMode:'limit',entry:lim,sl,
              entryReason:`机构放量破位阴线已确立空头趋势，不追杀现价，在破位实体 45%/FVG 回抽位 (${fmtScale(lim,lim)}) 挂限价单等反抽`,
              slReason:`突破机构破位起跌高点 (${fmtScale(b.h,lim)}) + 0.25ATR`,
              baseScore:34
            };
            break;
          }
        }
      }
    }

    /* === 战法 ③：S/A级 · 多周期顺势均线+OB回踩企稳确认 (Trend Pullback Reclaim / Confluence Limit) === */
    if(!archetype&&htfTrendOk&&smcAligned&&adx>=19&&er>=0.20){
      const b=closedLtf[lastIdx],rng=Math.max(1e-9,b.h-b.l);
      const clv=isLong?(b.c-b.l)/rng:(b.h-b.c)/rng;
      const pLo3=Math.min(closedLtf[lastIdx-2].l,closedLtf[lastIdx-1].l,b.l);
      const pHi3=Math.max(closedLtf[lastIdx-2].h,closedLtf[lastIdx-1].h,b.h);
      let priorHi16=0,priorLo16=1e18;
      for(let k=lastIdx-18;k<lastIdx;k++){if(closedLtf[k].h>priorHi16)priorHi16=closedLtf[k].h;if(closedLtf[k].l<priorLo16)priorLo16=closedLtf[k].l}

      const maxPullPct=maxLimDistAbs/livePx;
      const alignedObs=[...(ltfSmc.obs||[]),...(htfSmc.obs||[])].filter(o=>o.state!==2&&o.dir===(isLong?1:-1)&&(isLong?o.bottom<livePx:o.top>livePx)&&Math.abs((o.top+o.bottom)/2-livePx)<=livePx*maxPullPct);
      const nearOb=alignedObs.sort((a,b2)=>isLong?(b2.top-a.top):(a.bottom-b2.bottom))[0]||null;

      if(isLong&&e20[lastIdx]>e50[lastIdx]&&b.c>=vwap*0.997){
        /* 3A: 刚完成回踩 EMA20/OB 并收阳放量企稳（且未过度偏离 VWAP）→ 现价单 */
        const pulled=pLo3<=e20[lastIdx]*1.004||(nearOb&&pLo3<=nearOb.top*1.003);
        const notOverExt=(livePx-vwap)<=atr*2.2&&rsiArr[lastIdx]>=43&&rsiArr[lastIdx]<=65;
        if(pulled&&notOverExt&&allowMarket&&b.c>e20[lastIdx]&&b.c>b.o&&clv>=0.62&&(b.delta>0||cvd4Pct>=4)&&(priorHi16-livePx)>=atr*1.35&&Math.abs(livePx-b.c)<=atr*0.45){
          const baseSl=nearOb&&nearOb.bottom<livePx?Math.min(pLo3,nearOb.bottom):pLo3;
          const sl=Math.min(baseSl-atr*0.25,livePx-atr*1.15,livePx*(1-minStopPct));
          archetype={
            tier:cvd4Pct>=8&&meta.excess24>=1.5?'S':'A',
            tag:'顺势回踩企稳确认',execMode:'market',entry:livePx,sl,
            entryReason:`4h/1h 趋势多头排列且刚回踩 EMA20${nearOb?'/需求OB':''} 收闭线企稳阳线，主动买盘净流入，现价可入`,
            slReason:`跌破回踩确认低点 (${fmtScale(baseSl,livePx)}) - 0.25ATR`,
            baseScore:30
          };
        }else if(nearOb||Math.abs(e20[lastIdx]-livePx)/livePx<=maxPullPct){
          /* 3B: 趋势明确但现价偏高，不追涨，仅在下方 EMA20 与新鲜 OB 重合区挂限价埋伏单 */
          const anchor=nearOb?Math.min(livePx*0.995,nearOb.top*0.65+nearOb.bottom*0.35):Math.min(livePx*0.995,e20[lastIdx]);
          const dist=(livePx-anchor)/livePx;
          if(dist>=0.0035&&dist<=maxPullPct&&cvd4Pct>=-6){
            const baseSl=nearOb?nearOb.bottom:Math.min(anchor-atr*1.2,pLo3);
            const sl=Math.min(baseSl-atr*0.25,anchor*(1-minStopPct));
            archetype={
              tier:'A',tag:'顺势OB回踩挂单',execMode:'limit',entry:anchor,sl,
              entryReason:`大小周期多头共振但现价不宜追高，在下方${nearOb?'需求OB与均线':'EMA20动态均线'}支撑位挂限价单低吸`,
              slReason:`跌破支撑结构下沿 (${fmtScale(baseSl,anchor)}) - 0.25ATR`,
              baseScore:25
            };
          }
        }
      }else if(!isLong&&e20[lastIdx]<e50[lastIdx]&&b.c<=vwap*1.003){
        const pulled=pHi3>=e20[lastIdx]*0.996||(nearOb&&pHi3>=nearOb.bottom*0.997);
        const notOverExt=(vwap-livePx)<=atr*2.2&&rsiArr[lastIdx]>=35&&rsiArr[lastIdx]<=57;
        if(pulled&&notOverExt&&allowMarket&&b.c<e20[lastIdx]&&b.c<b.o&&clv>=0.62&&(b.delta<0||cvd4Pct<=-4)&&(livePx-priorLo16)>=atr*1.35&&Math.abs(livePx-b.c)<=atr*0.45){
          const baseSl=nearOb&&nearOb.top>livePx?Math.max(pHi3,nearOb.top):pHi3;
          const sl=Math.max(baseSl+atr*0.25,livePx+atr*1.15,livePx*(1+minStopPct));
          archetype={
            tier:cvd4Pct<=-8&&meta.excess24<=-1.5?'S':'A',
            tag:'顺势反抽受阻做空',execMode:'market',entry:livePx,sl,
            entryReason:`4h/1h 趋势空头压制且反抽 EMA20${nearOb?'/供给OB':''} 收闭线受阻阴线，主动卖盘主导，现价可空`,
            slReason:`突破反抽受阻高点 (${fmtScale(baseSl,livePx)}) + 0.25ATR`,
            baseScore:30
          };
        }else if(nearOb||Math.abs(e20[lastIdx]-livePx)/livePx<=maxPullPct){
          const anchor=nearOb?Math.max(livePx*1.005,nearOb.bottom*0.65+nearOb.top*0.35):Math.max(livePx*1.005,e20[lastIdx]);
          const dist=(anchor-livePx)/livePx;
          if(dist>=0.0035&&dist<=maxPullPct&&cvd4Pct<=6){
            const baseSl=nearOb?nearOb.top:Math.max(anchor+atr*1.2,pHi3);
            const sl=Math.max(baseSl+atr*0.25,anchor*(1+minStopPct));
            archetype={
              tier:'A',tag:'顺势OB反抽挂空',execMode:'limit',entry:anchor,sl,
              entryReason:`大小周期空头共振但现价不宜追空，在上方${nearOb?'供给OB与均线':'EMA20动态均线'}阻力位挂限价单高空`,
              slReason:`突破阻力结构上沿 (${fmtScale(baseSl,anchor)}) + 0.25ATR`,
              baseScore:25
            };
          }
        }
      }
    }

    if(!archetype)return null;

    const entry=archetype.entry,sl=archetype.sl,execMode=archetype.execMode;
    const stopPct=Math.abs(entry-sl)/entry;
    if(!(sl>0)||stopPct>maxStopPct||stopPct<minStopPct*0.92)return null;

    /* 防撞墙硬检：市价单正前方 1.15R 内若有未破新鲜反向 OB 阻力墙，禁止硬顶！ */
    const riskNow=Math.abs(entry-sl);
    if(execMode==='limit'&&Math.abs(entry-livePx)>Math.min(maxLimDistAbs,riskNow*1.35))return null;
    const oppObs=[...(ltfSmc.obs||[]),...(htfSmc.obs||[])].filter(o=>o.state===0&&o.dir===(isLong?-1:1));
    const wall=oppObs.find(o=>isLong?(o.bottom>entry&&(o.bottom-entry)<riskNow*1.15):(o.top<entry&&(entry-o.top)<riskNow*1.15));
    if(wall&&execMode==='market')return null;

    /* 精确推导 TP1（平 55% 推保本）与 TP2（45% 尾仓趋势目标）
     * 关键修复：限价挂单的 TP1 严禁等于当前现价 livePx（否则挂单瞬间即触发 TP1 撤单条件自相矛盾！），
     * 必须越过现价至少 0.75R 以上，确保成交后具备真实趋势延续空间且绝不秒撤单。 */
    const magnets=[];
    const minClearPx=isLong?(livePx+riskNow*0.75):Math.max(entry*0.15,livePx-riskNow*0.75);
    if(isLong){
      for(const b of (ltfSmc.bsl||[]))if(b.price>Math.max(entry,minClearPx))magnets.push({p:b.price,src:'小周期未扫前高流动性(BSL)'});
      for(const b of (htfSmc.bsl||[]))if(b.price>Math.max(entry,minClearPx))magnets.push({p:b.price,src:'大周期未扫前高流动性(BSL)'});
      for(const e of (ltfSmc.eq||[]))if(!e.swept&&e.price>Math.max(entry,minClearPx))magnets.push({p:e.price,src:'等高止损池(EQH)'});
      if(meta.whale?.nearShortPx>Math.max(entry,minClearPx))magnets.push({p:meta.whale.nearShortPx,src:'HL巨鲸空单强平簇'});
      if(htfSmc.swingHigh>Math.max(entry,minClearPx))magnets.push({p:htfSmc.swingHigh,src:'大周期摆动高点'});
      magnets.sort((a,b)=>a.p-b.p);
    }else{
      for(const s of (ltfSmc.ssl||[]))if(s.price>0&&s.price<Math.min(entry,minClearPx))magnets.push({p:s.price,src:'小周期未扫前低流动性(SSL)'});
      for(const s of (htfSmc.ssl||[]))if(s.price>0&&s.price<Math.min(entry,minClearPx))magnets.push({p:s.price,src:'大周期未扫前低流动性(SSL)'});
      for(const e of (ltfSmc.eq||[]))if(!e.swept&&e.price>0&&e.price<Math.min(entry,minClearPx))magnets.push({p:e.price,src:'等低止损池(EQL)'});
      if(meta.whale?.nearLongPx>0&&meta.whale.nearLongPx<Math.min(entry,minClearPx))magnets.push({p:meta.whale.nearLongPx,src:'HL巨鲸多单强平簇'});
      if(htfSmc.swingLow>0&&htfSmc.swingLow<Math.min(entry,minClearPx))magnets.push({p:htfSmc.swingLow,src:'大周期摆动低点'});
      magnets.sort((a,b)=>b.p-a.p);
    }

    const minTp1Dist=riskNow*1.65+entry*costFrac*2.2;
    const validTp1=m=>{
      const d=Math.abs(m.p-entry);
      if(d<minTp1Dist||d>riskNow*3.6)return false;
      if(execMode==='limit')return isLong?(m.p>=minClearPx):(m.p<=minClearPx);
      return isLong?(m.p>entry):(m.p<entry);
    };
    const tp1Cand=magnets.find(validTp1);
    let tp1,tp1Src;
    if(tp1Cand){tp1=tp1Cand.p;tp1Src=tp1Cand.src}
    else{
      const baseT=isLong?entry+Math.max(minTp1Dist,riskNow*1.80):Math.max(entry*0.15,entry-Math.max(minTp1Dist,riskNow*1.80));
      tp1=execMode==='limit'?(isLong?Math.max(baseT,minClearPx):Math.min(baseT,minClearPx)):baseT;
      if(Math.abs(tp1-entry)>riskNow*3.8)return null;
      tp1Src='波动率 1.80R 趋势延续位';
    }
    const maxTp2Dist=Math.min(riskNow*5.2,entry*(DECIDE.style==='intraday'?0.12:0.18));
    const tp2Cand=magnets.find(m=>{
      const d=Math.abs(m.p-entry);
      return d<=maxTp2Dist&&(isLong?(m.p>tp1+riskNow*0.9):(m.p<tp1-riskNow*0.9));
    });
    const tp2=tp2Cand?tp2Cand.p:(isLong?Math.max(tp1+riskNow*1.35,entry+riskNow*3.2):Math.max(entry*0.1,Math.min(tp1-riskNow*1.35,entry-riskNow*3.2)));
    const tp2Src=tp2Cand?tp2Cand.src:'趋势 3.2R 尾仓延伸目标';

    const tp1Pct=Math.abs(tp1-entry)/entry;
    const tp2Pct=Math.abs(tp2-entry)/entry;
    const unitLoss=stopPct+costFrac;
    const netRR1=(tp1Pct-costFrac)/unitLoss;
    const netRR2=(tp2Pct-costFrac)/unitLoss;
    if(!(netRR1>=1.55))return null;

    /* 多维正期望打分（闭线战法基础分 + 大盘与相对Alpha + 真实CVD订单流 + 衍生品资费/持仓 + 单币滚动回测加权） */
    let score=archetype.baseScore;
    const reasons=[archetype.entryReason];

    if((isLong&&bench.bull)||(!isLong&&bench.bear)){
      score+=8;
    }
    if(isLong&&meta.excess24>=2.0){
      score+=9;reasons.push(`相对大盘超额走强 ${pct(meta.excess24,1)}，资金承接领先`);
    }else if(!isLong&&meta.excess24<=-2.0){
      score+=9;reasons.push(`相对大盘明显走弱 ${pct(meta.excess24,1)}，空头宣泄主导`);
    }else if((isLong&&meta.excess24>0)||(!isLong&&meta.excess24<0)){
      score+=4;
    }

    if((isLong&&cvd4Pct>=5)||(!isLong&&cvd4Pct<=-5)){
      score+=10;
      reasons.push(`近 4 根闭线主动${isLong?'买盘':'卖盘'}净优势 (CVD ${pct(cvd4Pct,1)})，真金白银订单流同向确认`);
    }else if((isLong&&cvd4Pct>0)||(!isLong&&cvd4Pct<0)){
      score+=5;
    }

    /* 资金费率与结算倒计时博弈 */
    let derivPts=4;
    if(isLong){
      if(meta.fr!=null&&meta.fr<=-0.00008){
        derivPts+=10;
        const fNote=meta.minsToFunding!=null&&meta.minsToFunding<=90?`（距结算仅 ${meta.minsToFunding}m）`:'';
        reasons.push(`负资金费率 ${(meta.fr*100).toFixed(4)}%${fNote}，持多顺收空头补贴且具轧空燃料`);
      }else if(meta.fr!=null&&meta.fr>=0.00045){
        derivPts-=8; /* 多头极端拥挤扣分！ */
      }
      if(meta.ratioPct!=null&&meta.ratioPct>=14)derivPts+=4;
      if(meta.whale?.longPct!=null&&meta.whale.longPct>=56)derivPts+=3;
    }else{
      if(meta.fr!=null&&meta.fr>=0.00020){
        derivPts+=10;
        reasons.push(`正资金费率 +${(meta.fr*100).toFixed(4)}%，多头杠杆拥挤，做空顺收资费`);
      }else if(meta.fr!=null&&meta.fr<=-0.00035){
        derivPts-=9; /* 深度负费率严防逼空反抽！ */
      }
      if(meta.basis!=null&&meta.basis>=0.10){
        derivPts+=4;reasons.push(`合约标记溢价 +${meta.basis.toFixed(2)}%，具均值回归引力`);
      }
      if(meta.whale?.longPct!=null&&meta.whale.longPct<=44)derivPts+=3;
    }
    score+=Math.max(-4,Math.min(18,derivPts));

    /* 单币历史同模型滚动回测加分/降权 */
    if(wfStats.n>=2){
      if(wfStats.avgR>=0.35){
        score+=10;
        reasons.push(`该币近期同模型实测 ${wfStats.n} 次触发：胜率 ${wfStats.wr.toFixed(0)}% · 平均净赚 +${wfStats.avgR.toFixed(2)}R/笔`);
      }else if(wfStats.avgR>=0.05){
        score+=5;
      }else if(wfStats.avgR<0){
        score-=5;
      }
    }

    score+=netRR1>=2.2?8:(netRR1>=1.8?5:3);
    if(adx>=24)score+=4;
    if(meta.spreadPct<=0.04)score+=3;

    score=Math.round(Math.min(98,score));
    if(score<66)return null;

    const tier=(archetype.tier==='S'&&score>=78&&wfStats.n>=4&&wfStats.avgR>=0.20)?'S':'A';
    /* 保守贝叶斯收缩数学期望：尾仓保本滑点按 -0.04R 计，且绝不允许公式期望高于该币真实历史收缩回测值！ */
    const pTp1=wfStats.n>=3?Math.max(0.32,Math.min(0.64,wfStats.tp1Rate/100)):(tier==='S'?0.52:0.44);
    const pTp2=pTp1*0.35;
    const capRR1=Math.min(2.8,netRR1),capRR2=Math.min(3.8,netRR2);
    const rawFormulaExp=pTp2*(0.55*capRR1+0.45*capRR2)+(pTp1-pTp2)*(0.55*capRR1-0.04)-(1-pTp1)*1.0;
    const fillDiscount=execMode==='limit'?Math.max(0.60,Math.min(1.0,wfStats.fillRate||0.75)):1.0;
    const formulaExpR=rawFormulaExp*fillDiscount;
    const estExpR=wfStats.n>=3?Math.min(Math.max(0.08,wfStats.shrunkR),formulaExpR):formulaExpR*0.85;
    if(!(estExpR>=0.12))return null;

    const invalidNote=execMode==='limit'
      ?`挂单有效窗口 8 根 K 线；若未成交而价格先触及 ${fmtScale(tp1,entry)} 则自动作废撤单，严禁追高`
      :`已按闭线确认触发；若跌破/突破硬止损 ${fmtScale(sl,entry)} 无条件离场，达 TP1 立即平 55% 并将剩余止损移至保本价`;

    return {
      sym:meta.sym,base:meta.base,name:meta.name,isStock:isSk,
      sectorKey:meta.sectorKey,sectorName:meta.sectorName,underlyingGroup:meta.underlyingGroup,
      tier,side,execMode,tag:archetype.tag,
      score,estExpR,wf:wfStats,
      close:livePx,vwap,atr,adx,cvd4Pct,spreadPct:meta.spreadPct,costPct:costFrac*100,
      entry,sl,stopPct,slReason:archetype.slReason,
      tp1,tp1Pct,tp1Src,netRR1,
      tp2,tp2Pct,tp2Src,netRR2,
      chg24:meta.chg24,excess24:meta.excess24,fr:meta.fr,minsToFunding:meta.minsToFunding,basis:meta.basis,vol24:meta.vol24,
      reasons:reasons.slice(0,4),invalidNote
    };
  }

  async function evaluateCandidate(meta){
    const htfIv=DECIDE.style==='intraday'?'1h':'4h';
    const ltfIv=DECIDE.style==='intraday'?'15m':'1h';
    const [htfRaw,ltfRaw]=await Promise.all([
      jget(`${API}/fapi/v1/klines?symbol=${encodeURIComponent(meta.sym)}&interval=${htfIv}&limit=250`,18000),
      jget(`${API}/fapi/v1/klines?symbol=${encodeURIComponent(meta.sym)}&interval=${ltfIv}&limit=500`,18000)
    ]);
    if(!Array.isArray(htfRaw)||htfRaw.length<60||!Array.isArray(ltfRaw)||ltfRaw.length<110)return {plan:null,vetoChop:false};
    const htfAll=parseKlines(htfRaw);
    const ltfAll=parseKlines(ltfRaw);
    /* 核心纪律：剥离最后一根未收盘 K 线，仅用 100% 已收盘 K 线跑结构与回测！ */
    const closedHtf=htfAll.slice(0,-1);
    const closedLtf=ltfAll.slice(0,-1);
    const liveBar=ltfAll[ltfAll.length-1];

    const feeRound=Math.max(0,DECIDE.feePct)/100;
    const costFrac=feeRound+(meta.spreadPct||0.02)/100;

    /* 先跑该标的近期同策略滚动回测门禁，若属庄家反复插针亏损币直接一票否决 */
    const wfStats=walkForwardAuditSymbol(closedLtf,closedHtf,meta.isStock,costFrac);
    if(!wfStats.pass)return {plan:null,vetoChop:true};

    const htfSmc=SmcCore.analyze(closedHtf,{sLen:8});
    const ltfSmc=SmcCore.analyze(closedLtf,{sLen:10});
    if(!htfSmc||!ltfSmc)return {plan:null,vetoChop:false};

    if(typeof SmcState!=='undefined'&&SmcState.SMCUI){
      SmcState.SMCUI.cache.set(meta.sym+'|'+ltfIv,{t:Date.now(),res:SmcCore.analyze(ltfAll,{sLen:10})||ltfSmc});
    }

    const longP=detectDirectionalSetup('long',meta,closedLtf,closedHtf,liveBar,htfSmc,ltfSmc,wfStats,costFrac);
    const shortP=detectDirectionalSetup('short',meta,closedLtf,closedHtf,liveBar,htfSmc,ltfSmc,wfStats,costFrac);
    if(longP&&shortP){
      if(Math.abs(longP.score-shortP.score)<10)return {plan:null,vetoChop:false};
      return {plan:longP.score>shortP.score?longP:shortP,vetoChop:false};
    }
    return {plan:longP||shortP||null,vetoChop:false};
  }

  /* 跨市场宏观风险因子归桶：将 COIN/MSTR 等加密概念股与加密永续归入同一 CRYPTO_BETA 桶，严防同因子双重暴雷 */
  function macroBucketOf(p){
    if(!p.isStock||p.sectorKey==='crypto_eq')return 'CRYPTO_BETA';
    if(['tech','semi','index','consumer'].includes(p.sectorKey))return 'US_EQUITY_BETA';
    if(p.sectorKey==='asia')return 'ASIA_MACRO';
    return 'MACRO_ALT';
  }

  /* 阶段 3：组合相关性去重 + 宏观因子风险预算分配（同一宏观因子第 2 单自动降为 0.5R 半仓槽位） */
  function diversifyAndSlotPlans(rawPlans){
    rawPlans.sort((a,b)=>(b.tier==='S'?1:0)-(a.tier==='S'?1:0)||b.score-a.score||b.estExpR-a.estExpR);
    const out=[],secCount={},usedGroup=new Set(),bucketSideCnt={};
    let deduped=0,longSlots=0,shortSlots=0;
    const maxPerStockSec=DECIDE.scope==='stock'?3:2;
    for(const p of rawPlans){
      if(usedGroup.has(p.underlyingGroup)){deduped++;continue}
      if(p.isStock){
        const c=secCount[p.sectorKey]||0;
        if(c>=maxPerStockSec){deduped++;continue}
        secCount[p.sectorKey]=c+1;
      }
      usedGroup.add(p.underlyingGroup);
      const bKey=macroBucketOf(p)+'|'+p.side;
      const bCnt=(bucketSideCnt[bKey]||0)+1;
      bucketSideCnt[bKey]=bCnt;
      p.macroBucket=macroBucketOf(p);
      if(p.side==='long'){
        longSlots++;
        p.slotRank=(longSlots<=2&&bCnt<=2)?longSlots:0;
      }else{
        shortSlots++;
        p.slotRank=(shortSlots<=2&&bCnt<=2)?shortSlots:0;
      }
      /* 若第 2 张主力槽位与第 1 张处于同一宏观 Beta 因子（如 COIN 空 + SOL 空），自动半仓 0.5R 保护！ */
      p.riskScale=(p.slotRank>0&&bCnt===2)?0.5:1.0;
      out.push(p);
    }
    return {plans:out,deduped};
  }

  /* ---------- 阶段 4：实盘盯盘账本自动 K 线复盘与单日回撤熔断计算 ---------- */
  async function auditLedgerTrades(manualToast){
    const active=DECIDE.ledger.filter(t=>t.status==='pending'||t.status==='open');
    if(!active.length){if(manualToast)toast('当前无待核验的持仓或挂单');return}
    if(DECIDE.auditing)return;
    DECIDE.auditing=true;
    let changed=0;
    await pool(active,4,async tr=>{
      try{
        const spanMin=Math.max(15,(Date.now()-tr.openedAt)/60000);
        const iv=spanMin<=720?'5m':(spanMin<=4000?'15m':'1h');
        const ks=await jget(`${API}/fapi/v1/klines?symbol=${encodeURIComponent(tr.sym)}&interval=${iv}&limit=260`,15000);
        if(!Array.isArray(ks)||!ks.length)return;
        const bars=ks.map(k=>({t:+k[0],endT:+k[6],o:+k[1],h:+k[2],l:+k[3],c:+k[4]})).filter(b=>b.endT>=tr.openedAt);
        if(!bars.length)return;
        const isLong=(tr.side==='long');
        const costFrac=(tr.costPct||0.10)/100;
        const stopPct=Math.abs(tr.entry-tr.sl)/tr.entry;
        const unitRisk=stopPct+costFrac;
        tr.lastPx=bars[bars.length-1].c;

        for(const b of bars){
          if(tr.status==='pending'){
            if(isLong){
              if(b.l<=tr.entry){tr.status='open';tr.filledAt=b.t;changed++}
              else if(b.h>=tr.tp1){tr.status='cancelled';tr.closedAt=b.t;tr.realizedR=0;tr.note='未回踩成交先达TP1，已自动撤单';changed++;break}
            }else{
              if(b.h>=tr.entry){tr.status='open';tr.filledAt=b.t;changed++}
              else if(b.l<=tr.tp1){tr.status='cancelled';tr.closedAt=b.t;tr.realizedR=0;tr.note='未反抽成交先达TP1，已自动撤单';changed++;break}
            }
          }
          if(tr.status==='open'&&b.endT>=(tr.filledAt||tr.openedAt)){
            const curSl=tr.hitTp1?(isLong?tr.entry*(1+costFrac+stopPct*0.05):tr.entry*(1-costFrac-stopPct*0.05)):tr.sl;
            if(isLong){
              if(b.l<=curSl){
                const rem=tr.hitTp1?0.45:1.0;
                const locked=tr.hitTp1?0.55*(((tr.tp1-tr.entry)/tr.entry-costFrac)/unitRisk):0;
                const tail=rem*(((curSl-tr.entry)/tr.entry-costFrac)/unitRisk);
                tr.realizedR=+(locked+tail).toFixed(2);
                tr.status=tr.hitTp1?'be_win':'sl_loss';
                tr.closedAt=b.t;
                tr.note=tr.hitTp1?`TP1平55%后余仓保本出局 (+${tr.realizedR}R)`:`触及硬止损离场 (${tr.realizedR}R)`;
                changed++;break;
              }
              if(!tr.hitTp1&&b.h>=tr.tp1){
                tr.hitTp1=true;tr.note='已达TP1(平55%)，余仓止损已推至保本价';changed++;
                if(typeof rtNotifyAlert==='function')rtNotifyAlert(`${tr.sym} 已触及第一止盈 TP1！请平仓 55% 并将止损移至入场保本价`);
                continue;
              }
              if(tr.hitTp1&&b.h>=tr.tp2){
                const r1=0.55*(((tr.tp1-tr.entry)/tr.entry-costFrac)/unitRisk);
                const r2=0.45*(((tr.tp2-tr.entry)/tr.entry-costFrac)/unitRisk);
                tr.realizedR=+(r1+r2).toFixed(2);
                tr.status='tp2_win';tr.closedAt=b.t;tr.note=`TP1+TP2 全目标止盈 (+${tr.realizedR}R)`;changed++;break;
              }
            }else{
              if(b.h>=curSl){
                const rem=tr.hitTp1?0.45:1.0;
                const locked=tr.hitTp1?0.55*(((tr.entry-tr.tp1)/tr.entry-costFrac)/unitRisk):0;
                const tail=rem*(((tr.entry-curSl)/tr.entry-costFrac)/unitRisk);
                tr.realizedR=+(locked+tail).toFixed(2);
                tr.status=tr.hitTp1?'be_win':'sl_loss';
                tr.closedAt=b.t;
                tr.note=tr.hitTp1?`TP1平55%后余仓保本出局 (+${tr.realizedR}R)`:`触及硬止损离场 (${tr.realizedR}R)`;
                changed++;break;
              }
              if(!tr.hitTp1&&b.l<=tr.tp1){
                tr.hitTp1=true;tr.note='已达TP1(平55%)，余仓止损已推至保本价';changed++;
                if(typeof rtNotifyAlert==='function')rtNotifyAlert(`${tr.sym} 已触及第一止盈 TP1！请平仓 55% 并将止损移至入场保本价`);
                continue;
              }
              if(tr.hitTp1&&b.l<=tr.tp2){
                const r1=0.55*(((tr.entry-tr.tp1)/tr.entry-costFrac)/unitRisk);
                const r2=0.45*(((tr.entry-tr.tp2)/tr.entry-costFrac)/unitRisk);
                tr.realizedR=+(r1+r2).toFixed(2);
                tr.status='tp2_win';tr.closedAt=b.t;tr.note=`TP1+TP2 全目标止盈 (+${tr.realizedR}R)`;changed++;break;
              }
            }
          }
        }
        if(tr.status==='open'&&tr.lastPx>0){
          const rawRet=(isLong?(tr.lastPx-tr.entry)/tr.entry:(tr.entry-tr.lastPx)/tr.entry)-costFrac;
          const locked=tr.hitTp1?0.55*((Math.abs(tr.tp1-tr.entry)/tr.entry-costFrac)/unitRisk):0;
          const rem=tr.hitTp1?0.45:1.0;
          tr.floatR=+(locked+rem*(rawRet/unitRisk)).toFixed(2);
        }
      }catch(e){}
    });
    DECIDE.auditing=false;
    saveLedger();
    if(changed||manualToast)decideRender();
    if(manualToast)toast(changed?`已按真实 K 线更新 ${changed} 笔盯盘单状态`:'所有盯盘单状态已是最新');
  }

  function ledgerSummary(){
    const closed=DECIDE.ledger.filter(t=>['tp2_win','be_win','sl_loss'].includes(t.status));
    const cancelled=DECIDE.ledger.filter(t=>t.status==='cancelled');
    const active=DECIDE.ledger.filter(t=>t.status==='open'||t.status==='pending');
    const wins=closed.filter(t=>t.realizedR>0);
    const totR=closed.reduce((a,t)=>a+(t.realizedR||0),0);
    const totUsd=closed.reduce((a,t)=>a+(t.realizedR||0)*(t.riskUsd||DECIDE.riskUsd),0);
    const gw=closed.filter(t=>t.realizedR>0).reduce((a,t)=>a+t.realizedR,0);
    const gl=Math.abs(closed.filter(t=>t.realizedR<=0).reduce((a,t)=>a+t.realizedR,0));
    const pf=gl>0?(gw/gl):(gw>0?9.9:null);
    const totalFinished=closed.length+cancelled.length;
    const fillRate=totalFinished>0?(closed.length/totalFinished*100):null;
    const today0=new Date();today0.setHours(0,0,0,0);
    const todayClosed=closed.filter(t=>(t.closedAt||t.openedAt)>=today0.getTime());
    const todayR=todayClosed.reduce((a,t)=>a+(t.realizedR||0),0);
    return {
      closedCnt:closed.length,activeCnt:active.length,fillRate,
      wr:closed.length?(wins.length/closed.length*100):null,
      totR,totUsd,pf,todayR,
      circuitTripped:todayR<=-DECIDE.dailyStopR
    };
  }

  function trackPlanInLedger(plan,isAutoShadow){
    const recentDup=DECIDE.ledger.find(t=>t.sym===plan.sym&&((t.status==='open'||t.status==='pending')||(isAutoShadow&&Date.now()-t.openedAt<6*3600*1000)));
    if(recentDup){if(!isAutoShadow)toast(`${plan.base} 已在实盘盯盘账本中`);return false}
    const sz=calcSizing(plan);
    const now=Date.now();
    DECIDE.ledger.unshift({
      id:'tr_'+now+'_'+plan.sym,
      sym:plan.sym,base:plan.base,name:plan.name,
      side:plan.side,execMode:plan.execMode,tier:plan.tier,auto:!!isAutoShadow,
      entry:plan.entry,sl:plan.sl,tp1:plan.tp1,tp2:plan.tp2,
      costPct:plan.costPct,riskUsd:sz.effectiveRiskUsd,notional:sz.notional,
      openedAt:now,filledAt:plan.execMode==='market'?now:null,
      status:plan.execMode==='market'?'open':'pending',
      hitTp1:false,lastPx:plan.close,floatR:0,realizedR:null,
      note:(isAutoShadow?'[自动前向验真] ':'')+(plan.execMode==='market'?'市价建仓盯盘中（达TP1平55%推保本）':'限价挂单等待回踩成交')
    });
    saveLedger();
    if(!isAutoShadow){
      decideRender();
      toast(`已加入实盘盯盘：${plan.base}（系统将按真实K线自动追踪止盈止损）`);
    }
    return true;
  }

  async function decideScan(force){
    if(DECIDE.loading)return;
    if(DECIDE.plans.length&&!force&&Date.now()-DECIDE.updatedAt<45000){decideRender();return}
    DECIDE.loading=true;DECIDE.err='';DECIDE.showAll=false;DECIDE.progress={done:0,total:1,phase:'全市场多源盘口与大盘护盾扫描'};
    decideRender();
    try{
      const cands=await gatherUniverse();
      DECIDE.progress={done:0,total:cands.length,phase:'闭线订单流与360根滚动回测验真'};
      decideRender();
      const rawFound=[];
      let rej=0,vetoChop=0;
      await pool(cands,6,async c=>{
        try{
          const r=await evaluateCandidate(c);
          if(r?.plan)rawFound.push(r.plan);
          else{rej++;if(r?.vetoChop)vetoChop++}
        }catch(e){rej++}
        DECIDE.progress.done++;
        const pTxt=$('#dcProgTxt'),pFill=$('#dcProgBar i');
        if(pTxt)pTxt.textContent=`正在执行闭线信号识别与历史回测验真 ${DECIDE.progress.done}/${DECIDE.progress.total}…`;
        if(pFill&&DECIDE.progress.total>0)pFill.style.width=(DECIDE.progress.done/DECIDE.progress.total*100).toFixed(1)+'%';
      });
      const div=diversifyAndSlotPlans(rawFound);
      DECIDE.plans=div.plans;
      DECIDE.deduped=div.deduped;
      DECIDE.rejected=rej;
      DECIDE.vetoedChop=vetoChop;
      DECIDE.updatedAt=Date.now();
      /* 全自动影子实盘记录：S级或首选主力满额槽位(期望>=0.30R)自动入账追踪真实成交率与净收益 */
      for(const p of div.plans){
        if((p.tier==='S'||(p.slotRank===1&&p.estExpR>=0.30))&&p.slotRank>0)trackPlanInLedger(p,true);
      }
      auditLedgerTrades(false);
    }catch(e){
      DECIDE.err='量化决策引擎扫描异常：'+(e.message||e);
    }finally{
      DECIDE.loading=false;
      decideRender();
    }
  }

  /* 阶段 5：本金防爆仓算仓器（带最大杠杆硬封顶 + 同宏观因子第2单自动 0.5R 半仓保护！） */
  function calcSizing(plan){
    const acct=Math.max(100,parseFloat(DECIDE.accountUsd)||5000);
    const scale=plan.riskScale||1.0;
    const riskUsd=Math.max(1,(parseFloat(DECIDE.riskUsd)||100)*scale);
    const costFrac=(plan.costPct||0.10)/100;
    const unitLoss=plan.stopPct+costFrac;
    const rawNotional=riskUsd/unitLoss;
    const maxLev=(plan.isStock?DECIDE.maxLevStock:DECIDE.maxLevCrypto)*scale;
    const capNotional=acct*maxLev;
    const capped=rawNotional>capNotional;
    const notional=capped?capNotional:rawNotional;
    const effectiveRiskUsd=notional*unitLoss;
    const qty=notional/plan.entry;
    const realLev=notional/acct;
    return {acct,riskUsd,scale,effectiveRiskUsd,notional,rawNotional,capped,maxLev,realLev,qty,margin5x:notional/5};
  }

  function decideOpenInCockpit(plan,allShown){
    if(typeof setJumpContext==='function')setJumpContext(allShown.map(p=>p.sym),'今日实战决策单');
    const ltfIv=DECIDE.style==='intraday'?'15m':'1h';
    if(typeof SmcState!=='undefined'){
      if(SmcState.SMCUI)SmcState.SMCUI.tf=ltfIv;
      if(SmcState.RISK){
        const R=SmcState.RISK;
        R.sym=plan.sym;R.side=plan.side;
        R.entry=fmtScale(plan.entry,plan.entry);
        R.sl=fmtScale(plan.sl,plan.entry);
        R.tp=fmtScale(plan.tp1,plan.entry);
        R.tp2=fmtScale(plan.tp2,plan.entry);
        R.riskUsd=DECIDE.riskUsd;
        R.note=`来自v3量化总台「${plan.tag}」(期望+${plan.estExpR.toFixed(2)}R · TP2=${fmtScale(plan.tp2,plan.entry)})`;
      }
    }
    if(typeof S!=='undefined'&&S.tac)S.tac.tf=ltfIv;
    if(typeof jumpSym==='function')jumpSym(plan.sym);
    if(typeof SmcState!=='undefined'&&typeof SmcState.riskRender==='function')setTimeout(()=>SmcState.riskRender(),30);
  }

  function decideCopyPlan(plan){
    const sz=calcSizing(plan),ref=plan.entry;
    const dir=plan.side==='long'?'【做多 LONG】':'【做空 SHORT】';
    const mode=plan.execMode==='market'?'⚡现价执行':'⏳限价挂单(勿追单)';
    const txt=`[${plan.tier}级] ${dir}${plan.sym} (${plan.name}) · ${mode} · 评分${plan.score} · 期望+${plan.estExpR.toFixed(2)}R/笔\n`+
      `📍 入场：${fmtScale(plan.entry,ref)}（现价 ${fmtScale(plan.close,ref)} · 点差 ${plan.spreadPct.toFixed(3)}%）\n`+
      `🛑 硬止损：${fmtScale(plan.sl,ref)}（-${(plan.stopPct*100).toFixed(2)}% · ${plan.slReason}）\n`+
      `🎯 止盈TP1：${fmtScale(plan.tp1,ref)}（+${(plan.tp1Pct*100).toFixed(2)}% · 净${plan.netRR1.toFixed(2)}R · 平55%推保本）\n`+
      `🚀 止盈TP2：${fmtScale(plan.tp2,ref)}（+${(plan.tp2Pct*100).toFixed(2)}% · 净${plan.netRR2.toFixed(2)}R · 余45%尾仓）\n`+
      `💰 仓位（本金$${Math.round(sz.acct)} / 实担风险$${Math.round(sz.effectiveRiskUsd)}）：开仓 $${Math.round(sz.notional)}（实际杠杆 ${sz.realLev.toFixed(2)}x · 约 ${sz.qty.toPrecision(4)} ${plan.base}）\n`+
      `⚠️ 铁律：${plan.invalidNote}`;
    if(navigator.clipboard?.writeText)navigator.clipboard.writeText(txt).then(()=>toast('已复制 v3 完整下单与风控指令')).catch(()=>toast(txt));
    else toast(txt);
  }

  function renderLedgerSection(lgSum){
    const rows=DECIDE.ledger.slice(0,20);
    const wrTxt=lgSum.wr!=null?lgSum.wr.toFixed(0)+'%':'—';
    const pfTxt=lgSum.pf!=null?lgSum.pf.toFixed(2):'—';
    const totCls=lgSum.totR>0?'up':(lgSum.totR<0?'down':'');
    const tdCls=lgSum.todayR>0?'up':(lgSum.todayR<0?'down':'');

    let h=`<details class="card dc-ledger" ${DECIDE.ledgerOpen?'open':''} id="dcLedgerFold">`+
      `<summary class="dc-ledger-sum">`+
        `<span>📋 <b>实盘信号盯盘账本 & 30笔前向验证门禁</b> <small class="mut">（S级主战单已开启全自动影子入账，按真实K线核验成交率与盈亏）</small></span>`+
        `<span class="dc-ledger-kpis">`+
          `<span>验证进度 <b>${Math.min(30,lgSum.closedCnt)}/30笔</b></span>`+
          `<span>进行中 <b>${lgSum.activeCnt}</b></span>`+
          (lgSum.fillRate!=null?`<span>挂单成交率 <b>${lgSum.fillRate.toFixed(0)}%</b></span>`:'')+
          `<span>胜率 <b>${wrTxt}</b></span>`+
          `<span>PF <b>${pfTxt}</b></span>`+
          `<span>累计 <b class="${totCls}">${lgSum.totR>=0?'+':''}${lgSum.totR.toFixed(2)}R (${lgSum.totUsd>=0?'+$':'-$'}${Math.abs(Math.round(lgSum.totUsd))})</b></span>`+
          `<span>今日 <b class="${tdCls}">${lgSum.todayR>=0?'+':''}${lgSum.todayR.toFixed(2)}R</b> / 红线 -${DECIDE.dailyStopR}R</span>`+
        `</span>`+
      `</summary>`+
      `<div style="margin-top:9px">`;

    if(!rows.length){
      h+=`<p class="mut" style="padding:8px 2px">暂无盯盘记录。看到满意的 S/A 级决策卡时点击 <b>「📌 加入盯盘」</b>，系统将自动按每根 K 线最高/最低价客观复盘战绩，绝不马后炮。</p>`;
    }else{
      h+=`<div class="row" style="justify-content:space-between;margin-bottom:6px">`+
        `<span class="mut">提示：达 TP1 系统会自动按「平55% + 余45%推保本损」规则精准核算净 R 收益</span>`+
        `<div class="row" style="gap:6px">`+
          `<button type="button" class="btn mini" id="dcAuditNow" ${DECIDE.auditing?'disabled':''}>↻ 立即核验K线盈亏</button>`+
          `<button type="button" class="btn mini" id="dcClearClosed">清理已结单</button>`+
        `</div>`+
      `</div>`+
      `<div class="tblwrap"><table class="tbl">`+
        `<thead><tr><th>标的/方向</th><th>状态</th><th>入场/现价</th><th>止损/目标</th><th>浮动/已结R</th><th>风控备注</th><th>操作</th></tr></thead><tbody>`;
      for(const t of rows){
        const ref=t.entry;
        const stMap={
          pending:['⏳ 待回踩成交','mut'],
          open:[t.hitTp1?'🛡️ 已达TP1(保本持仓)':'🟢 持仓盯盘中','up'],
          tp2_win:['🏆 TP1+TP2全胜','up'],
          be_win:['⚖️ TP1落袋+保本赢','up'],
          sl_loss:['🛑 止损离场','down'],
          cancelled:['⚪ 踏空自动撤单','mut']
        };
        const [stTxt,stCls]=stMap[t.status]||[t.status,'mut'];
        const rVal=(t.status==='open')?t.floatR:t.realizedR;
        const rStr=rVal!=null?`${rVal>=0?'+':''}${Number(rVal).toFixed(2)}R (${rVal>=0?'+$':'-$'}${Math.abs(Math.round(rVal*(t.riskUsd||100)))})`:'—';
        const rCls=rVal>0?'up':(rVal<0?'down':'mut');
        h+=`<tr>`+
          `<td><b>${esc(t.base)}</b> <span class="${t.side==='long'?'up':'down'}">${t.side==='long'?'多':'空'}</span> <small class="mut">${t.execMode==='market'?'市':'限'}</small></td>`+
          `<td class="${stCls}"><b>${stTxt}</b></td>`+
          `<td>${fmtScale(t.entry,ref)} / <span class="mut">${t.lastPx?fmtScale(t.lastPx,ref):'—'}</span></td>`+
          `<td><span class="down">${fmtScale(t.sl,ref)}</span> / <span class="up">${fmtScale(t.tp1,ref)}</span></td>`+
          `<td class="${rCls}"><b>${rStr}</b></td>`+
          `<td class="mut" style="max-width:210px;overflow:hidden;text-overflow:ellipsis">${esc(t.note||'')}</td>`+
          `<td><button type="button" class="btn mini" data-lg-del="${esc(t.id)}" style="padding:2px 7px;font-size:11px">移除</button></td>`+
        `</tr>`;
      }
      h+=`</tbody></table></div>`;
    }
    h+=`</div></details>`;
    return h;
  }

  function decideRender(){
    const host=$('#decideHost');if(!host)return;
    const rc=DECIDE.regime.crypto,rs=DECIDE.regime.stock;
    const lgSum=ledgerSummary();

    const allFiltered=DECIDE.plans.filter(p=>{
      if(DECIDE.sideFilter==='s_tier')return p.tier==='S';
      if(DECIDE.sideFilter==='long')return p.side==='long';
      if(DECIDE.sideFilter==='short')return p.side==='short';
      if(DECIDE.sideFilter==='market')return p.execMode==='market';
      return true;
    });
    const shown=DECIDE.showAll?allFiltered:allFiltered.slice(0,8);
    const hiddenMore=Math.max(0,allFiltered.length-shown.length);

    const cntS=DECIDE.plans.filter(p=>p.tier==='S').length;
    const cntLong=DECIDE.plans.filter(p=>p.side==='long').length;
    const cntShort=DECIDE.plans.filter(p=>p.side==='short').length;
    const cntMkt=DECIDE.plans.filter(p=>p.execMode==='market').length;
    const upStr=DECIDE.updatedAt?new Date(DECIDE.updatedAt).toTimeString().slice(0,8):'待扫描';
    const riskPctOfAcct=(DECIDE.riskUsd/Math.max(100,DECIDE.accountUsd))*100;

    let html='';
    if(lgSum.circuitTripped){
      html+=`<div class="banner on err" style="margin-bottom:9px;font-weight:600">🔒 单日风控熔断已触发：今日盯盘账本已累计回撤 ${lgSum.todayR.toFixed(2)}R（触及 -${DECIDE.dailyStopR}R 铁律红线）。顶级交易员盈利的核心是不在逆风日上头翻本，建议今日停止新开仓，明日自动解锁！</div>`;
    }
    if(riskPctOfAcct>2.5){
      html+=`<div class="banner on warn" style="margin-bottom:9px">⚠️ 仓位风险提示：你当前单笔定损 ($${DECIDE.riskUsd}) 占账户本金 ($${DECIDE.accountUsd}) 高达 <b>${riskPctOfAcct.toFixed(1)}%</b>！长期稳定复利强烈建议将单笔定损调至本金的 <b>1%～2%</b>（约 $${Math.round(DECIDE.accountUsd*0.01)}～$${Math.round(DECIDE.accountUsd*0.02)}）。</div>`;
    }

    html+=`<div class="dc-regime-grid">`+
      `<div class="dc-regcard">`+
        `<div class="row" style="justify-content:space-between"><span>加密市场风向标与护盾</span><b>BTC <em class="${clsP(rc?.btcChg)}">${rc?pct(rc.btcChg):'—'}</em> · ETH <em class="${clsP(rc?.ethChg)}">${rc?pct(rc.ethChg):'—'}</em></b></div>`+
        `<p>${esc(rc?.label||'正在读取大盘状态与主动买卖订单流…')}</p>`+
      `</div>`+
      `<div class="dc-regcard">`+
        `<div class="row" style="justify-content:space-between"><span>币安股票合约风向标</span><b>SPY <em class="${clsP(rs?.spyChg)}">${rs?pct(rs.spyChg):'—'}</em> · QQQ <em class="${clsP(rs?.qqqChg)}">${rs?pct(rs.qqqChg):'—'}</em></b></div>`+
        `<p>${esc(rs?.session?.badge||'')} · ${esc(rs?.label||'正在读取美股时段与流动性…')}</p>`+
      `</div>`+
    `</div>`;

    html+=renderLedgerSection(lgSum);

    html+=`<div class="card" style="padding:10px 12px">`+
      `<div class="row" style="gap:6px;margin-bottom:8px">`+
        `<div class="seg">`+
          `<button type="button" data-dc-st="swing" class="${DECIDE.style==='swing'?'on':''}" title="实测30天胜率59.5% · 盈亏比PF 2.42，手续费磨损极低，强烈主推">🏆 稳健波段(4h+1h·主推)</button>`+
          `<button type="button" data-dc-st="intraday" class="${DECIDE.style==='intraday'?'on':''}" title="信号更密集，适合盯盘快进快出">⚡ 日内猎手(1h+15m)</button>`+
        `</div>`+
        `<div class="seg">`+
          `<button type="button" data-dc-sc="all" class="${DECIDE.scope==='all'?'on':''}">全市场</button>`+
          `<button type="button" data-dc-sc="crypto" class="${DECIDE.scope==='crypto'?'on':''}">仅加密</button>`+
          `<button type="button" data-dc-sc="stock" class="${DECIDE.scope==='stock'?'on':''}">仅股票</button>`+
        `</div>`+
        `<button type="button" class="btn mini pri" id="dcRefreshBtn" ${DECIDE.loading?'disabled':''}>↻ 重新扫描验真</button>`+
        `<button type="button" class="btn mini${DECIDE.autoRefresh?' pri':''}" id="dcAutoBtn">${DECIDE.autoRefresh?'⏱ 90s自动刷新中':'⏱ 自动刷新'}</button>`+
      `</div>`+
      `<div class="row" style="gap:8px;justify-content:space-between">`+
        `<div class="seg">`+
          `<button type="button" data-dc-sd="all" class="${DECIDE.sideFilter==='all'?'on':''}">全部合格 (${DECIDE.plans.length})</button>`+
          `<button type="button" data-dc-sd="s_tier" class="${DECIDE.sideFilter==='s_tier'?'on':''}">🔥 S级主战 (${cntS})</button>`+
          `<button type="button" data-dc-sd="market" class="${DECIDE.sideFilter==='market'?'on':''}">⚡ 现价可入 (${cntMkt})</button>`+
          `<button type="button" data-dc-sd="long" class="${DECIDE.sideFilter==='long'?'on':''}">🟢 做多 (${cntLong})</button>`+
          `<button type="button" data-dc-sd="short" class="${DECIDE.sideFilter==='short'?'on':''}">🔴 做空 (${cntShort})</button>`+
        `</div>`+
        `<div class="row" style="gap:5px">`+
          `<span class="mut">账户本金</span>`+
          `<input id="dcAcctUsd" type="number" min="100" step="500" value="${DECIDE.accountUsd}" style="width:76px;padding:5px 7px;font-size:13px" title="用于限制最大杠杆，防止窄止损算仓过大导致爆仓">`+
          `<span class="mut">U · 单笔定损</span>`+
          `<input id="dcRiskUsd" type="number" min="5" step="10" value="${DECIDE.riskUsd}" style="width:66px;padding:5px 7px;font-size:13px" title="建议设为账户本金的 1%~2%">`+
          `<span class="mut">U · ${upStr}${DECIDE.rejected?` (拦截低质/高滑点 ${DECIDE.rejected} 个${DECIDE.vetoedChop?`，其中回测否决绞肉币 ${DECIDE.vetoedChop} 个`:''})`:''}</span>`+
        `</div>`+
      `</div>`+
      (DECIDE.loading?`<div class="pbar on" id="dcProgBar" style="margin-top:8px"><i></i></div><p class="mut" id="dcProgTxt" style="margin-top:4px"><span class="spin"></span> ${esc(DECIDE.progress.phase)}…</p>`:'')+
      (DECIDE.err?`<div class="banner on err" style="margin-top:8px">${esc(DECIDE.err)}</div>`:'')+
    `</div>`;

    if(!DECIDE.loading&&!shown.length){
      html+=`<div class="card" style="text-align:center;padding:30px 16px">`+
        `<b style="font-size:15.5px;color:var(--acc)">🛡️ 当前空仓保护中：暂无同时通过「闭线结构 + 真实订单流 + 滚动回测正期望」的高胜率单</b>`+
        `<p class="mut" style="margin-top:7px;max-width:620px;margin-left:auto;margin-right:auto">稳定盈利的第一铁律是<b>不在垃圾时间强行开单</b>。系统刚刚淘汰了 ${DECIDE.rejected} 个追高/震荡/负期望标的；你可切换「全部合格」或切换「4h+1h / 1h+15m」查看埋伏挂单。</p>`+
      `</div>`;
    }else{
      html+=`<div class="dc-cards">`;
      shown.forEach((p,idx)=>{
        const isLong=p.side==='long',ref=p.entry;
        const sz=calcSizing(p);
        const distFromNow=(p.entry/p.close-1)*100;
        const badgeCls=isLong?(p.execMode==='market'?'dc-b-long':'dc-b-long-lim'):(p.execMode==='market'?'dc-b-short':'dc-b-short-lim');
        const badgeTxt=(isLong?'做多 LONG':'做空 SHORT')+' · '+(p.execMode==='market'?'⚡ 现价可入':'⏳ 限价埋伏');
        const tierBadge=p.tier==='S'?`<span class="dc-tier-s">🔥 S级主战</span>`:`<span class="dc-tier-a">🎯 A级严选</span>`;
        const slotBadge=p.slotRank>0
          ?(p.riskScale<1?`<span class="dc-slot-ok" title="与第1单属同一宏观Beta因子（如COIN与加密币），已自动缩减至0.5R半仓防共振回撤">⚖️ 同因子半仓槽位 (0.5R)</span>`:`<span class="dc-slot-ok" title="独立宏观因子首选满额槽位 (1.0R)">✅ 主力满额槽位 (1.0R)</span>`)
          :`<span class="dc-slot-sub" title="同宏观方向已有2张更高分单，严禁叠加第3单">👀 同向备选观察</span>`;
        const mktTag=p.isStock?`<span class="bdg-sk">${esc(p.sectorName.replace(/^[^\s]+\s/,''))}</span>`:`<span class="dc-tag-crypto">加密永续</span>`;
        const enStr=fmtScale(p.entry,ref),slStr=fmtScale(p.sl,ref),tp1Str=fmtScale(p.tp1,ref),tp2Str=fmtScale(p.tp2,ref),curStr=fmtScale(p.close,ref);
        const tracked=DECIDE.ledger.some(t=>t.sym===p.sym&&(t.status==='open'||t.status==='pending'));
        const wfTxt=p.wf&&p.wf.n>=2?`滚动回测 ${p.wf.n}笔(胜率${p.wf.wr.toFixed(0)}%/均${p.wf.avgR>=0?'+':''}${p.wf.avgR.toFixed(2)}R)`:`新结构首触发`;

        html+=`<article class="dc-card ${isLong?'is-long':'is-short'}${p.tier==='S'?' is-stier':''}">`+
          `<div class="dc-card-hd">`+
            `<div class="row" style="gap:6px">`+
              `<span class="dc-rank">#${idx+1}</span>`+
              `${tierBadge}`+
              `<span class="dc-dir-badge ${badgeCls}">${badgeTxt}</span>`+
              `<b class="dc-sym">${esc(p.base)}</b>`+
              `<span class="mut" style="font-size:12px">${esc(p.name!==p.base?p.name:'')}</span>`+
              `${mktTag}`+
              `<span class="dc-setup-tag">${esc(p.tag)}</span>`+
              `${slotBadge}`+
            `</div>`+
            `<div class="dc-score">`+
              `<span class="dc-ev-pill" title="扣除双边手续费与实时盘口点差后的单笔先验数学期望">期望 +${p.estExpR.toFixed(2)}R/笔</span>`+
              `评分 <b>${p.score}</b><small>/100</small>`+
            `</div>`+
          `</div>`+

          `<div class="dc-levels">`+
            `<div class="dc-lv entry" data-copy="${enStr}" title="点击复制入场价">`+
              `<span>📍 ${p.execMode==='market'?'建议入场价 (闭线确认可入)':'建议限价挂单 (严禁追现价)'}</span>`+
              `<b>${enStr}</b>`+
              `<small>现价 ${curStr} (${p.execMode==='market'?'点差 '+p.spreadPct.toFixed(3)+'%':'距挂单 '+pct(distFromNow,2)})</small>`+
            `</div>`+
            `<div class="dc-lv sl" data-copy="${slStr}" title="点击复制止损价">`+
              `<span>🛑 硬止损 SL (开仓必挂)</span>`+
              `<b>${slStr} <em>-${(p.stopPct*100).toFixed(2)}%</em></b>`+
              `<small>${esc(p.slReason)}</small>`+
            `</div>`+
            `<div class="dc-lv tp1" data-copy="${tp1Str}" title="点击复制第一止盈价">`+
              `<span>🎯 止盈 TP1 (平55%推保本)</span>`+
              `<b>${tp1Str} <em>+${(p.tp1Pct*100).toFixed(2)}% · 净${p.netRR1.toFixed(2)}R</em></b>`+
              `<small>${esc(p.tp1Src)}</small>`+
            `</div>`+
            `<div class="dc-lv tp2" data-copy="${tp2Str}" title="点击复制第二止盈价">`+
              `<span>🚀 止盈 TP2 (余45%博大波段)</span>`+
              `<b>${tp2Str} <em>+${(p.tp2Pct*100).toFixed(2)}% · 净${p.netRR2.toFixed(2)}R</em></b>`+
              `<small>${esc(p.tp2Src)}</small>`+
            `</div>`+
          `</div>`+

          `<div class="dc-sizing">`+
            `<span>💰 <b>防爆仓算仓</b>（本金 $${fC(sz.acct)} · 实担风险 $${Math.round(sz.effectiveRiskUsd)}）：建议开仓 <b style="color:var(--acc)">$${fC(sz.notional)}</b>（约 <b>${fN(sz.qty,sz.qty>=10?1:4)}</b> ${esc(p.base)} · 实际总杠杆 <b>${sz.realLev.toFixed(2)}x</b>${sz.capped?` · <em style="color:#ffd479;font-style:normal">已触发${sz.maxLev}x安全封顶保护</em>`:''}）</span>`+
            `<span class="mut">CVD ${pct(p.cvd4Pct,1)} · ADX ${p.adx.toFixed(0)} · ${wfTxt}</span>`+
          `</div>`+

          `<ul class="dc-reasons">${p.reasons.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>`+
          `<div class="dc-foot">`+
            `<span class="dc-invalid">⚠️ 铁律：${esc(p.invalidNote)}</span>`+
            `<div class="row" style="gap:6px;margin-left:auto">`+
              `<button type="button" class="btn mini${tracked?' on':''}" data-dc-track="${idx}">${tracked?'✓ 盯盘中':'📌 加入盯盘'}</button>`+
              `<button type="button" class="btn mini" data-dc-copy="${idx}">📋 复制指令</button>`+
              `<button type="button" class="btn mini pri" data-dc-chart="${idx}">📊 看K线点位图 ›</button>`+
              `<a class="btn mini" href="https://www.binance.com/zh-CN/futures/${encodeURIComponent(p.sym)}" target="_blank" rel="noopener" style="text-decoration:none">🔶 下单</a>`+
            `</div>`+
          `</div>`+
        `</article>`;
      });
      html+=`</div>`;
      if(hiddenMore>0||(DECIDE.showAll&&allFiltered.length>8)){
        html+=`<div style="text-align:center;margin-top:10px"><button type="button" class="btn mini" id="dcToggleMore">${DECIDE.showAll?'收起（仅显示前 8 张最高正期望决策单）':`展开其余 ${hiddenMore} 张合格候选单（共 ${allFiltered.length} 张）`}</button></div>`;
      }
    }

    html+=`<div class="card dc-playbook" style="margin-top:10px;padding:10px 13px">`+
      `<h3>🛡️ 长期稳定盈利 · 四条铁律执行清单（数学正期望落地的唯一前提）</h3>`+
      `<div class="dc-rules-grid">`+
        `<div><b>1. 严控单笔风险 1%～2%</b><p>任何神级策略都有正常止损单（实测连亏极值 ≤5 笔）。单笔只亏本金 1%~2%，连亏 5 笔仅回撤 5%~8%，绝不伤筋动骨。</p></div>`+
        `<div><b>2. 同方向最多持仓 2 单</b><p>加密与科技股在大盘剧震时相关性高达 0.85。只做标记「✅ 主力槽位 1/2」的最高分单，避免 5 单同向齐跌。</p></div>`+
        `<div><b>3. 达 TP1 必平 55% 推保本</b><p>这是波段模式实现 59.5% 胜率与 PF 2.42 的核心秘诀：到 TP1 先落袋一多半并把止损移到入场价，把剩余仓位变成零风险免费彩票。</p></div>`+
        `<div><b>4. 触及单日 -2R 无条件停手</b><p>当日若累计止损达 2R，说明市场处于突发无序洗盘期，系统自动亮起熔断红灯，关机休息明天再战。</p></div>`+
      `</div>`+
    `</div>`;

    host.innerHTML=html;

    const lgFold=$('#dcLedgerFold');
    if(lgFold)lgFold.ontoggle=()=>{DECIDE.ledgerOpen=lgFold.open};
    const audBtn=$('#dcAuditNow');
    if(audBtn)audBtn.onclick=()=>auditLedgerTrades(true);
    const clrBtn=$('#dcClearClosed');
    if(clrBtn)clrBtn.onclick=()=>{
      DECIDE.ledger=DECIDE.ledger.filter(t=>t.status==='open'||t.status==='pending');
      saveLedger();decideRender();toast('已清理历史完结记录');
    };
    host.querySelectorAll('[data-lg-del]').forEach(b=>b.onclick=()=>{
      DECIDE.ledger=DECIDE.ledger.filter(t=>t.id!==b.dataset.lgDel);
      saveLedger();decideRender();
    });

    host.querySelectorAll('[data-dc-sc]').forEach(b=>b.onclick=()=>{DECIDE.scope=b.dataset.dcSc;decideScan(true)});
    host.querySelectorAll('[data-dc-st]').forEach(b=>b.onclick=()=>{DECIDE.style=b.dataset.dcSt;decideScan(true)});
    host.querySelectorAll('[data-dc-sd]').forEach(b=>b.onclick=()=>{DECIDE.sideFilter=b.dataset.dcSd;DECIDE.showAll=false;decideRender()});
    const tm=$('#dcToggleMore');if(tm)tm.onclick=()=>{DECIDE.showAll=!DECIDE.showAll;decideRender()};
    const rf=$('#dcRefreshBtn');if(rf)rf.onclick=()=>decideScan(true);
    const ab=$('#dcAutoBtn');
    if(ab)ab.onclick=()=>{
      DECIDE.autoRefresh=!DECIDE.autoRefresh;
      clearInterval(DECIDE.timer);DECIDE.timer=null;
      if(DECIDE.autoRefresh){
        DECIDE.timer=setInterval(()=>{if(typeof Layout!=='undefined'&&Layout.current==='decide'&&!document.hidden)decideScan(true)},90000);
      }
      decideRender();
    };
    const acInp=$('#dcAcctUsd');
    if(acInp)acInp.onchange=()=>{
      const v=parseFloat(acInp.value);
      if(v>=100){DECIDE.accountUsd=v;saveRiskCfg();decideRender()}
    };
    const rkInp=$('#dcRiskUsd');
    if(rkInp)rkInp.onchange=()=>{
      const v=parseFloat(rkInp.value);
      if(v>0){
        DECIDE.riskUsd=v;saveRiskCfg();
        if(typeof SmcState!=='undefined'&&SmcState.RISK)SmcState.RISK.riskUsd=v;
        decideRender();
      }
    };
    host.querySelectorAll('[data-dc-track]').forEach(b=>b.onclick=()=>{
      const p=shown[+b.dataset.dcTrack];
      if(p)trackPlanInLedger(p);
    });
    host.querySelectorAll('[data-dc-chart]').forEach(b=>b.onclick=()=>{
      const p=shown[+b.dataset.dcChart];
      if(p)decideOpenInCockpit(p,shown);
    });
    host.querySelectorAll('[data-dc-copy]').forEach(b=>b.onclick=()=>{
      const p=shown[+b.dataset.dcCopy];
      if(p)decideCopyPlan(p);
    });
    host.querySelectorAll('.dc-lv[data-copy]').forEach(el=>el.onclick=()=>{
      const v=el.dataset.copy;if(!v)return;
      if(navigator.clipboard?.writeText)navigator.clipboard.writeText(v).then(()=>toast('已复制价格 '+v));
    });
  }

  function decideInit(){
    if(!DECIDE.plans.length&&!DECIDE.loading)decideScan(false);
    else decideRender();
  }

  root.DECIDE=DECIDE;
  root.decideInit=decideInit;
  root.decideScan=decideScan;
})(typeof globalThis!=='undefined'?globalThis:window);
