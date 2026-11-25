/* 实战交易决策总台 v2 (decision.js) — 经实盘信号回测审计迭代优化
 * 核心目标：直接回答「买什么标的 · 做多还是做空 · 现价还是挂单 · 止损在哪 · 止盈TP1/TP2在哪 · 开多大仓位」。
 * 二轮迭代重点：
 *   1. 同底层标的/杠杆ETF自动去重 + 单一细分板块上限保护（防半导体单边集中度过高）；
 *   2. 限价回踩单目标位自动锚定现价波段极值外侧，修复挂单前 TP1 已被现价穿越的逻辑缺陷，并收紧挂单最大偏离(≤3.2%)；
 *   3. 统一单卡价格小数位精度、综合分严格降序排列、支持展开全部候选单、与单币作战室 #riskFold 100% 实时双向同步。 */
'use strict';
(function(root){
  const STABLE_SKIP=new Set([
    'USDCUSDT','FDUSDUSDT','TUSDUSDT','DAIUSDT','USDPUSDT','BUSDUSDT','USDEUSDT','USD1USDT','RLUSDUSDT','BTCDOMUSDT'
  ]);
  const CORE_LEADERS_CRYPTO=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','SUIUSDT','HYPEUSDT','AAVEUSDT','LINKUSDT'];
  const CORE_LEADERS_STOCK=['NVDAUSDT','TSLAUSDT','AAPLUSDT','MSFTUSDT','AMZNUSDT','METAUSDT','GOOGLUSDT','SPYUSDT','QQQUSDT','SPCXUSDT','XAUUSDT','CLUSDT','COINUSDT','BABAUSDT'];

  /* 同底层资产归并组：同一底层（如正股与2x/3x杠杆ETF或双合约）仅保留综合分最高的 1 张单，杜绝重复暴露 */
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

  const DECIDE={
    scope:'all',        /* all | crypto | stock */
    style:'intraday',   /* intraday (1h+15m) | swing (4h+1h) */
    sideFilter:'all',   /* all | long | short | market */
    showAll:false,
    riskUsd:100,
    feePct:0.08,
    autoRefresh:false,
    timer:null,
    loading:false,
    progress:{done:0,total:0,phase:''},
    plans:[],
    rejected:0,
    deduped:0,
    regime:{crypto:null,stock:null},
    updatedAt:0,
    err:''
  };

  try{
    const rk=JSON.parse(localStorage.getItem('oif_risk_cfg')||'null');
    if(rk&&Number.isFinite(+rk.riskUsd)&&+rk.riskUsd>0)DECIDE.riskUsd=+rk.riskUsd;
    if(rk&&Number.isFinite(+rk.feePct)&&+rk.feePct>=0)DECIDE.feePct=+rk.feePct;
  }catch(e){}

  const fin=x=>typeof x==='number'&&Number.isFinite(x);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pct=(v,d=2)=>!fin(v)?'—':(v>=0?'+':'')+v.toFixed(d)+'%';

  /* 按参考价格统一卡片内所有点位的小数位数，消除同一卡片精度参差不齐 */
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

  function calcRollingVwap(bars,win){
    if(!Array.isArray(bars)||!bars.length)return null;
    const slice=bars.slice(-Math.min(win,bars.length));
    let pv=0,vv=0;
    for(const b of slice){
      const typ=(b.h+b.l+b.c)/3;
      if(fin(typ)&&fin(b.v)&&b.v>0){pv+=typ*b.v;vv+=b.v}
    }
    return vv>0?pv/vv:bars[bars.length-1].c;
  }

  function calcVolRatio(bars){
    if(!Array.isArray(bars)||bars.length<24)return 1;
    const recent=bars.slice(-5,-1).reduce((a,b)=>a+(b.v||0),0)/4;
    const base=bars.slice(-25,-5).reduce((a,b)=>a+(b.v||0),0)/20;
    return base>0?recent/base:1;
  }

  function closedRet(bars,back){
    if(!Array.isArray(bars)||bars.length<back+2)return null;
    const cur=bars[bars.length-2].c,old=bars[bars.length-2-back].c;
    return (cur>0&&old>0)?(cur/old-1)*100:null;
  }

  /* 阶段 1：全市场多板块均衡初筛 ~34 个高流动性候选标的 */
  async function gatherUniverse(){
    const [capRows,cgRes,whaleData,tickArr,premArr]=await Promise.all([
      typeof capEnsureQuiet==='function'?capEnsureQuiet():Promise.resolve(null),
      (typeof CG!=='undefined'&&CG.rows)?Promise.resolve({coins:CG.rows}):fetch('cg-snapshot.json').then(r=>r.ok?r.json():null).catch(()=>null),
      typeof whaleEnsureQuiet==='function'?whaleEnsureQuiet():Promise.resolve(null),
      jget(API+'/fapi/v1/ticker/24hr',25000),
      jget(API+'/fapi/v1/premiumIndex',25000).catch(()=>[])
    ]);
    if(cgRes&&Array.isArray(cgRes.coins)&&typeof CG!=='undefined'&&!CG.rows)CG.rows=cgRes.coins;
    const capMap=new Map((capRows||[]).map(r=>[r.sym,r]));
    const cgMap=new Map();
    for(const c of (cgRes?.coins||[])){
      const k=String(c.bs||c.s||'').toUpperCase();
      if(k)cgMap.set(k,c);
    }
    const prMap=new Map();
    for(const p of (Array.isArray(premArr)?premArr:[])){
      if(!p.symbol)continue;
      const mk=+p.markPrice,ix=+p.indexPrice;
      prMap.set(p.symbol,{
        fr:fin(+p.lastFundingRate)?+p.lastFundingRate:null,
        mark:mk>0?mk:null,index:ix>0?ix:null,
        basis:(mk>0&&ix>0)?(mk/ix-1)*100:null
      });
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

    const cryptoBias=(btc.chg*0.6+eth.chg*0.4);
    const stockBias=(spy.chg*0.5+qqq.chg*0.5);
    DECIDE.regime={
      crypto:{
        btcChg:btc.chg,ethChg:eth.chg,bias:cryptoBias,
        label:cryptoBias>=2?'多头趋势（顺势回踩做多为主）':cryptoBias<=-2?'空头承压（反弹做空弱势币 / 严选逆势抗跌做多）':'区间震荡（不追涨杀跌，严守OB/FVG边界高抛低吸）'
      },
      stock:{
        spyChg:spy.chg,qqqChg:qqq.chg,bias:stockBias,
        session:typeof stockMarketSession==='function'?stockMarketSession():{badge:'24/7交易',code:'unknown'},
        label:stockBias>=1?'美股风险偏好偏强（优选科技/半导体领涨龙头做多）':stockBias<=-1?'美股大盘回调承压（优选破位弱势股做空或逆势防御标的做多）':'美股指数窄幅整理（精选个股独立催化与基差回归）'
      }
    };

    const all=[];
    for(const [sym,tk] of tickMap.entries()){
      if(!(tk.px>0))continue;
      const isSk=typeof isTradFiSymbol==='function'&&isTradFiSymbol(sym);
      if(DECIDE.scope==='crypto'&&isSk)continue;
      if(DECIDE.scope==='stock'&&!isSk)continue;
      const minVol=isSk?8e6:15e6;
      const isCore=CORE_LEADERS_CRYPTO.includes(sym)||CORE_LEADERS_STOCK.includes(sym);
      if(!isCore&&(tk.vol||0)<minVol)continue;
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

      let preScore=Math.log10(Math.max(1e6,tk.vol||1e6))*4;
      if(Math.abs(excess24)>=3.5)preScore+=9;
      if(ratioPct!=null&&ratioPct>=12)preScore+=8;
      if(pr?.fr!=null&&pr.fr<=-0.0001&&excess24>0)preScore+=14;
      if(pr?.fr!=null&&pr.fr>=0.00025&&tk.chg>=5)preScore+=11;
      if(longLiqPct!=null&&(longLiqPct>=72||longLiqPct<=28)&&(liqTot||0)>=400000)preScore+=10;
      if(isSk&&pr?.basis!=null&&Math.abs(pr.basis)>=0.12)preScore+=7;
      if(isCore)preScore+=10;

      all.push({
        sym,base,isStock:isSk,
        underlyingGroup:UNDERLYING_GROUP[base]||sym,
        sectorKey:skMeta?skMeta.s:'crypto',
        name:skMeta?skMeta.n:base,
        sectorName:skMeta?skMeta.sectorName:'加密永续',
        px:pr?.mark||tk.px,lastPx:tk.px,chg24:tk.chg,vol24:tk.vol,excess24,
        fr:pr?.fr??null,basis:pr?.basis??null,
        oiv:cr?.oiv??(cg?.oi??null),ratioPct,
        liqTot,longLiqPct,oiChg24:cg?.oc??null,
        whale:wh,preScore
      });
    }

    /* 初筛阶段即对同底层资产去重，并控制股票单一板块初筛配额，确保多板块覆盖 */
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
      const cPick=pickFrom(all.filter(x=>!x.isStock),18,99);
      const sPick=pickFrom(all.filter(x=>x.isStock),14,4);
      return [...cPick,...sPick];
    }
    if(DECIDE.scope==='stock'){
      return pickFrom(all,28,6);
    }
    return pickFrom(all,28,99);
  }

  /* 阶段 2：单方向精确点位推导与综合评分 */
  function buildDirectionalPlan(side,meta,htfRes,ltfRes,ltfBars,htfBars){
    const close=ltfBars[ltfBars.length-1].c;
    const atr=ltfRes.atr||close*0.015;
    const vwap=calcRollingVwap(ltfBars,DECIDE.style==='intraday'?96:24)||close;
    const volX=calcVolRatio(ltfBars);
    const retFast=closedRet(ltfBars,4);
    const isLong=(side==='long');
    const isSk=meta.isStock;
    const feeRound=Math.max(0,DECIDE.feePct)/100;

    /* 1. 近端顺向支撑/阻力结构 */
    const maxPullPct=DECIDE.style==='intraday'?(isSk?0.025:0.032):(isSk?0.04:0.05);
    const maxZoneDist=Math.max(atr*3.2,close*maxPullPct);
    const alignedLtfObs=(ltfRes.obs||[]).filter(o=>o.state!==2&&o.dir===(isLong?1:-1)&&(isLong?o.bottom<close*1.002:o.top>close*0.998)&&Math.abs((o.top+o.bottom)/2-close)<=maxZoneDist);
    const alignedHtfObs=(htfRes.obs||[]).filter(o=>o.state!==2&&o.dir===(isLong?1:-1)&&(isLong?o.bottom<close*1.004:o.top>close*0.996)&&Math.abs((o.top+o.bottom)/2-close)<=maxZoneDist*1.25);
    const alignedFvgs=(ltfRes.fvgs||[]).filter(f=>f.state===0&&f.dir===(isLong?1:-1)&&(isLong?f.bottom<close:f.top>close)&&Math.abs((f.top+f.bottom)/2-close)<=maxZoneDist);

    const nearOb=alignedLtfObs.sort((a,b)=>isLong?(b.top-a.top):(a.bottom-b.bottom))[0]
               ||alignedHtfObs.sort((a,b)=>isLong?(b.top-a.top):(a.bottom-b.bottom))[0]||null;
    const nearFvg=alignedFvgs.sort((a,b)=>isLong?(b.top-a.top):(a.bottom-b.bottom))[0]||null;

    const recent10=ltfBars.slice(-10);
    const recentLo=Math.min(...recent10.map(b=>b.l));
    const recentHi=Math.max(...recent10.map(b=>b.h));

    const minStopPct=isSk?0.006:0.009;
    const maxStopPct=isSk?0.042:0.062;
    const comfortableMktStop=isSk?0.026:0.038;

    let entry=close,execMode='market',entryReason='现价紧靠有效结构且止损可控，可直接市价/现价区间分批建仓';
    let pullAnchor=null;
    if(nearOb){
      pullAnchor=isLong?Math.min(close,nearOb.top*0.7+nearOb.bottom*0.3):Math.max(close,nearOb.bottom*0.7+nearOb.top*0.3);
    }else if(nearFvg){
      pullAnchor=isLong?Math.min(close,nearFvg.top*0.65+nearFvg.bottom*0.35):Math.max(close,nearFvg.bottom*0.65+nearFvg.top*0.35);
    }else if((isLong&&vwap<close&&close-vwap<=close*maxPullPct)||(!isLong&&vwap>close&&vwap-close<=close*maxPullPct)){
      pullAnchor=vwap;
    }

    const computeSl=(en)=>{
      let raw;
      if(isLong){
        const base=(nearOb&&nearOb.bottom<en)?nearOb.bottom:Math.min(en-atr*1.2,recentLo);
        raw=base-atr*0.22;
        raw=Math.min(raw,en*(1-minStopPct));
      }else{
        const base=(nearOb&&nearOb.top>en)?nearOb.top:Math.max(en+atr*1.2,recentHi);
        raw=base+atr*0.22;
        raw=Math.max(raw,en*(1+minStopPct));
      }
      return raw;
    };

    let sl=computeSl(entry);
    let stopPct=Math.abs(entry-sl)/entry;

    /* 仅当现价止损过宽，或价格极端乖离 VWAP (>2.6 ATR 且止损不够紧) 时，才要求回踩挂限价单（且挂单距离不超过 maxPullPct） */
    const extremeOverExt=isLong?(close-vwap>atr*2.6&&stopPct>comfortableMktStop*0.7):(vwap-close>atr*2.6&&stopPct>comfortableMktStop*0.7);
    if((stopPct>comfortableMktStop||extremeOverExt)&&pullAnchor&&Math.abs(pullAnchor-close)/close<=maxPullPct&&Math.abs(pullAnchor-close)/close>=0.0025){
      entry=pullAnchor;
      sl=computeSl(entry);
      stopPct=Math.abs(entry-sl)/entry;
      execMode='limit';
      entryReason=nearOb?(isLong?'现价短线偏离支撑，建议在近端需求OB上沿挂限价单接回踩':'现价短线急跌偏离，建议在近端供给OB下沿挂限价单等反抽')
                        :'短线偏离均价，建议在 FVG/VWAP 位置挂限价单，不追单';
    }
    if(stopPct>maxStopPct||!(stopPct>=minStopPct*0.9)||!(sl>0))return null;

    /* 2. 防撞墙校验 */
    const riskAbs=Math.abs(entry-sl);
    const oppObs=[...(ltfRes.obs||[]),...(htfRes.obs||[])].filter(o=>o.state===0&&o.dir===(isLong?-1:1));
    const wall=oppObs.find(o=>isLong?(o.bottom>entry&&(o.bottom-entry)<riskAbs*1.05):(o.top<entry&&(entry-o.top)<riskAbs*1.05));
    if(wall){
      if(execMode==='market'&&pullAnchor&&Math.abs(pullAnchor-close)/close<=maxPullPct&&Math.abs(pullAnchor-close)/close>=0.003){
        entry=pullAnchor;sl=computeSl(entry);stopPct=Math.abs(entry-sl)/entry;
        if(stopPct>maxStopPct)return null;
        execMode='limit';
        entryReason='现价正前方紧贴反向订单块阻力，须回踩拉开盈亏比空间后挂单入场';
      }else if(execMode==='market'){
        return null;
      }
    }

    /* 3. 计算严格合理的 TP1 & TP2（修复限价单 TP1 必须越过或回测当前波段极值 close！） */
    const riskNow=Math.abs(entry-sl);
    const magnets=[];
    if(execMode==='limit'){
      /* 限价回踩成交的前提是价格先折返至 entry，因此当前 close 本身即成为第一波段前高/前低回测磁吸目标！ */
      magnets.push({p:close,src:isLong?'回踩成交后前高回测位':'反抽成交后前低回测位'});
    }
    if(isLong){
      for(const b of (ltfRes.bsl||[]))if(b.price>Math.max(entry,close*0.998))magnets.push({p:b.price,src:'小周期未扫前高(BSL)'});
      for(const b of (htfRes.bsl||[]))if(b.price>Math.max(entry,close*0.998))magnets.push({p:b.price,src:'大周期未扫前高(BSL)'});
      for(const e of (ltfRes.eq||[]))if(!e.swept&&e.price>Math.max(entry,close))magnets.push({p:e.price,src:'等高流动性池(EQH)'});
      if(meta.whale?.nearShortPx>Math.max(entry,close))magnets.push({p:meta.whale.nearShortPx,src:'HL巨鲸空单强平簇'});
      if(htfRes.swingHigh>Math.max(entry,close))magnets.push({p:htfRes.swingHigh,src:'大周期摆动高点'});
      magnets.sort((a,b)=>a.p-b.p);
    }else{
      for(const s of (ltfRes.ssl||[]))if(s.price>0&&s.price<Math.min(entry,close*1.002))magnets.push({p:s.price,src:'小周期未扫前低(SSL)'});
      for(const s of (htfRes.ssl||[]))if(s.price>0&&s.price<Math.min(entry,close*1.002))magnets.push({p:s.price,src:'大周期未扫前低(SSL)'});
      for(const e of (ltfRes.eq||[]))if(!e.swept&&e.price>0&&e.price<Math.min(entry,close))magnets.push({p:e.price,src:'等低流动性池(EQL)'});
      if(meta.whale?.nearLongPx>0&&meta.whale.nearLongPx<Math.min(entry,close))magnets.push({p:meta.whale.nearLongPx,src:'HL巨鲸多单强平簇'});
      if(htfRes.swingLow>0&&htfRes.swingLow<Math.min(entry,close))magnets.push({p:htfRes.swingLow,src:'大周期摆动低点'});
      magnets.sort((a,b)=>b.p-a.p);
    }

    const minTp1Dist=riskNow*1.68+entry*feeRound*2;
    /* 对限价单，TP1 至少要回到当前现价 close（甚至越过），绝不给出还未到现价就止盈的倒挂点位 */
    const validTp1=m=>{
      const d=Math.abs(m.p-entry);
      if(d<minTp1Dist||d>riskNow*4.2)return false;
      if(execMode==='limit'){
        return isLong?(m.p>=close*0.999):(m.p<=close*1.001);
      }
      return isLong?(m.p>entry):(m.p<entry);
    };
    const tp1Cand=magnets.find(validTp1);
    let tp1,tp1Src;
    if(tp1Cand){
      tp1=tp1Cand.p;tp1Src=tp1Cand.src;
    }else{
      const baseTarget=isLong?entry+Math.max(minTp1Dist,riskNow*1.95):Math.max(entry*0.2,entry-Math.max(minTp1Dist,riskNow*1.95));
      tp1=execMode==='limit'?(isLong?Math.max(baseTarget,close):Math.min(baseTarget,close)):baseTarget;
      tp1Src='ATR结构2.0R量度目标';
    }

    const tp2Cand=magnets.find(m=>isLong?(m.p>tp1+riskNow*0.85):(m.p<tp1-riskNow*0.85));
    const tp2=tp2Cand?tp2Cand.p:(isLong?Math.max(tp1+riskNow*1.3,entry+riskNow*3.2):Math.max(entry*0.15,Math.min(tp1-riskNow*1.3,entry-riskNow*3.2)));
    const tp2Src=tp2Cand?tp2Cand.src:'波段趋势3.2R延伸位';

    const tp1Pct=Math.abs(tp1-entry)/entry;
    const tp2Pct=Math.abs(tp2-entry)/entry;
    const unitLoss=stopPct+feeRound;
    const netRR1=(tp1Pct-feeRound)/unitLoss;
    const netRR2=(tp2Pct-feeRound)/unitLoss;
    if(!(netRR1>=1.55))return null;

    /* 4. 综合实战评分（0–99，所见即所得，卡片严格按此分排序） */
    let score=0;
    const reasons=[];
    let tag='';

    const regBias=isSk?(DECIDE.regime.stock?.bias||0):(DECIDE.regime.crypto?.bias||0);
    if(isLong){
      if(meta.excess24>=3){score+=12;reasons.push(`24h 强于大盘基准 ${pct(meta.excess24,1)}，主动买盘承接显著`)}
      else if(meta.excess24>0){score+=7}
      if(regBias>=-0.5)score+=6;
      else if(meta.excess24>=4){score+=6;tag='逆势抗跌领涨'}
    }else{
      if(meta.excess24<=-3){score+=12;reasons.push(`24h 弱于大盘基准 ${pct(meta.excess24,1)}，空头主导领跌`)}
      else if(meta.excess24<0){score+=7}
      if(regBias<=0.5)score+=6;
    }

    const htfAligned=(isLong&&htfRes.dir===1)||(!isLong&&htfRes.dir===-1);
    const ltfAligned=(isLong&&ltfRes.dir===1)||(!isLong&&ltfRes.dir===-1);
    if(htfAligned&&ltfAligned){
      score+=20;
      reasons.push(`大小周期均呈${isLong?'上升多头结构(BOS/CHoCH↑)':'下降空头结构(BOS/CHoCH↓)'}，趋势共振明确`);
      if(!tag)tag=isLong?'双周期顺势做多':'双周期顺势做空';
    }else if(htfAligned){
      score+=13;
      reasons.push(`大周期维持${isLong?'多头上升':'空头下降'}趋势，小周期提供回撤入场点`);
    }else if(ltfAligned&&ltfRes.lastEvent&&/CHoCH/.test(ltfRes.lastEvent.type)){
      score+=11;
      reasons.push(`小周期刚触发 ${ltfRes.lastEvent.type} 结构转向确认`);
      if(!tag)tag=isLong?'小级别止跌转向':'小级别见顶转向';
    }else{
      return null;
    }

    if((isLong&&close>=vwap)||(!isLong&&close<=vwap)){
      score+=8;
      reasons.push(`价格位于 24h VWAP (${fmtScale(vwap,entry)}) ${isLong?'上方，日内多头占优':'下方，日内空头控盘'}`);
    }else if(execMode==='limit'){
      score+=4;
    }

    let fuelPts=6;
    if(isLong){
      if(meta.fr!=null&&meta.fr<=-0.00008){
        fuelPts+=11;
        reasons.push(`实时资金费率为负 (${(meta.fr*100).toFixed(4)}%)，空头付费补贴多头，具逼空潜力`);
        tag='负费率逼空做多';
      }else if(meta.fr!=null&&meta.fr<=0.00015){
        fuelPts+=5;
      }else if(meta.fr!=null&&meta.fr>=0.0004){
        fuelPts-=6;
      }
      if(meta.ratioPct!=null&&meta.ratioPct>=12){
        fuelPts+=5;
        reasons.push(`合约 OI/流通市值达 ${meta.ratioPct.toFixed(1)}%，持仓博弈集中`);
      }
      if(meta.longLiqPct!=null&&meta.longLiqPct>=72&&(meta.liqTot||0)>=300000){
        fuelPts+=5;
        reasons.push(`24h多单爆仓占比 ${meta.longLiqPct.toFixed(0)}%，急跌清算后浮筹减轻`);
        if(!tag)tag='清算洗盘后做多';
      }
      if(meta.whale?.longPct!=null&&meta.whale.longPct>=56){
        fuelPts+=4;
        reasons.push(`Hyperliquid 大户多头占 ${meta.whale.longPct.toFixed(0)}%`);
      }
    }else{
      if(meta.fr!=null&&meta.fr>=0.00022){
        fuelPts+=11;
        reasons.push(`实时资金费率偏高 (+${(meta.fr*100).toFixed(4)}%)，多头拥挤且做空可顺收资费`);
        tag='多头拥挤做空';
      }else if(meta.fr!=null&&meta.fr>=-0.00005){
        fuelPts+=5;
      }else if(meta.fr!=null&&meta.fr<=-0.0003){
        fuelPts-=8;
      }
      if(meta.basis!=null&&meta.basis>=0.10){
        fuelPts+=5;
        reasons.push(`合约标记溢价 +${meta.basis.toFixed(2)}%，具溢价回归引力`);
        if(isSk)tag='溢价回归做空';
      }
      if(meta.whale?.longPct!=null&&meta.whale.longPct<=44){
        fuelPts+=5;
        reasons.push(`Hyperliquid 大户空头占 ${(100-meta.whale.longPct).toFixed(0)}%`);
      }
    }
    score+=Math.max(0,Math.min(23,fuelPts));

    const pd=ltfRes.pdPos;
    if(pd!=null&&((isLong&&pd<=0.55)||(!isLong&&pd>=0.45)))score+=5;
    if(nearOb||nearFvg)score+=5;
    if(volX>=1.3&&((isLong&&(retFast||0)>0)||(!isLong&&(retFast||0)<0))){
      score+=3;
      reasons.push(`近端量能放大至均值 ${volX.toFixed(1)} 倍，突破/承接有量配合`);
    }

    /* 净盈亏比与立即执行度直接计入综合评分，使展示分数 = 真实排序依据 */
    score+=netRR1>=2.8?12:(netRR1>=2.1?9:6);
    if(execMode==='market')score+=4;

    score=Math.round(Math.min(98,score));
    if(score<63)return null;

    const slReason=nearOb
      ?(isLong?`跌破近端需求OB下沿 (${fmtScale(nearOb.bottom,entry)})`:`突破近端供给OB上沿 (${fmtScale(nearOb.top,entry)})`)
      :(isLong?`跌破近期摆动低点 (${fmtScale(recentLo,entry)}) - 0.22ATR`:`突破近期摆动高点 (${fmtScale(recentHi,entry)}) + 0.22ATR`);

    const cancelRef=fmtScale(tp2,entry);
    const invalidNote=execMode==='limit'
      ?`若未回踩成交而价格直接${isLong?'拉升突破':'下杀跌破'}远端目标 ${cancelRef}，说明踏空本轮行情，立即撤销挂单`
      :`15m 收盘越过止损价 ${fmtScale(sl,entry)} 立即止损离场，严禁撤止损扛单`;

    return {
      sym:meta.sym,base:meta.base,name:meta.name,isStock:isSk,
      sectorKey:meta.sectorKey,sectorName:meta.sectorName,underlyingGroup:meta.underlyingGroup,
      side,execMode,tag:tag||(isLong?'结构顺势做多':'结构顺势做空'),
      score,close,vwap,atr,
      entry,entryReason,
      sl,stopPct,slReason,
      tp1,tp1Pct,tp1Src,netRR1,
      tp2,tp2Pct,tp2Src,netRR2,
      chg24:meta.chg24,excess24:meta.excess24,fr:meta.fr,basis:meta.basis,vol24:meta.vol24,
      reasons:reasons.slice(0,4),invalidNote
    };
  }

  async function evaluateCandidate(meta){
    const htfIv=DECIDE.style==='intraday'?'1h':'4h';
    const ltfIv=DECIDE.style==='intraday'?'15m':'1h';
    const [htfRaw,ltfRaw]=await Promise.all([
      jget(`${API}/fapi/v1/klines?symbol=${encodeURIComponent(meta.sym)}&interval=${htfIv}&limit=160`,16000),
      jget(`${API}/fapi/v1/klines?symbol=${encodeURIComponent(meta.sym)}&interval=${ltfIv}&limit=200`,16000)
    ]);
    if(!Array.isArray(htfRaw)||htfRaw.length<50||!Array.isArray(ltfRaw)||ltfRaw.length<60)return null;
    const htfBars=htfRaw.map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}));
    const ltfBars=ltfRaw.map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}));
    const htfRes=SmcCore.analyze(htfBars,{sLen:8});
    const ltfRes=SmcCore.analyze(ltfBars,{sLen:10});
    if(!htfRes||!ltfRes)return null;

    if(typeof SmcState!=='undefined'&&SmcState.SMCUI){
      SmcState.SMCUI.cache.set(meta.sym+'|'+ltfIv,{t:Date.now(),res:ltfRes});
    }

    const longP=buildDirectionalPlan('long',meta,htfRes,ltfRes,ltfBars,htfBars);
    const shortP=buildDirectionalPlan('short',meta,htfRes,ltfRes,ltfBars,htfBars);
    if(longP&&shortP){
      if(Math.abs(longP.score-shortP.score)<10)return null;
      return longP.score>shortP.score?longP:shortP;
    }
    return longP||shortP||null;
  }

  /* 阶段 3：组合去重与细分板块分散度过滤（防止同一板块集中刷屏） */
  function diversifyPlans(rawPlans){
    rawPlans.sort((a,b)=>b.score-a.score||b.netRR1-a.netRR1);
    const out=[],secCount={},usedGroup=new Set();
    let deduped=0;
    const maxPerStockSec=DECIDE.scope==='stock'?3:2;
    for(const p of rawPlans){
      if(usedGroup.has(p.underlyingGroup)){deduped++;continue}
      if(p.isStock){
        const c=secCount[p.sectorKey]||0;
        if(c>=maxPerStockSec){deduped++;continue}
        secCount[p.sectorKey]=c+1;
      }
      usedGroup.add(p.underlyingGroup);
      out.push(p);
    }
    return {plans:out,deduped};
  }

  async function decideScan(force){
    if(DECIDE.loading)return;
    if(DECIDE.plans.length&&!force&&Date.now()-DECIDE.updatedAt<45000){decideRender();return}
    DECIDE.loading=true;DECIDE.err='';DECIDE.showAll=false;DECIDE.progress={done:0,total:1,phase:'全市场多源初筛'};
    decideRender();
    try{
      const cands=await gatherUniverse();
      DECIDE.progress={done:0,total:cands.length,phase:'多周期K线与结构测算'};
      decideRender();
      const rawFound=[];
      let rej=0;
      await pool(cands,6,async c=>{
        try{
          const plan=await evaluateCandidate(c);
          if(plan)rawFound.push(plan);else rej++;
        }catch(e){rej++}
        DECIDE.progress.done++;
        const pTxt=$('#dcProgTxt'),pFill=$('#dcProgBar i');
        if(pTxt)pTxt.textContent=`正在深度测算双周期结构与止盈止损 ${DECIDE.progress.done}/${DECIDE.progress.total}…`;
        if(pFill&&DECIDE.progress.total>0)pFill.style.width=(DECIDE.progress.done/DECIDE.progress.total*100).toFixed(1)+'%';
      });
      const div=diversifyPlans(rawFound);
      DECIDE.plans=div.plans;
      DECIDE.deduped=div.deduped;
      DECIDE.rejected=rej;
      DECIDE.updatedAt=Date.now();
    }catch(e){
      DECIDE.err='决策引擎扫描异常：'+(e.message||e);
    }finally{
      DECIDE.loading=false;
      decideRender();
    }
  }

  function calcSizing(plan){
    const riskUsd=Math.max(1,parseFloat(DECIDE.riskUsd)||100);
    const feeRound=Math.max(0,parseFloat(DECIDE.feePct)||0.08)/100;
    const unitLoss=plan.stopPct+feeRound;
    const notional=riskUsd/unitLoss;
    const qty=notional/plan.entry;
    return {riskUsd,notional,qty,margin10x:notional/10};
  }

  function decideOpenInCockpit(plan,allShown){
    if(typeof setJumpContext==='function')setJumpContext(allShown.map(p=>p.sym),'今日实战决策单');
    const ltfIv=DECIDE.style==='intraday'?'15m':'1h';
    if(typeof SmcState!=='undefined'){
      if(SmcState.SMCUI)SmcState.SMCUI.tf=ltfIv;
      if(SmcState.RISK){
        const R=SmcState.RISK;
        R.sym=plan.sym;
        R.side=plan.side;
        R.entry=fmtScale(plan.entry,plan.entry);
        R.sl=fmtScale(plan.sl,plan.entry);
        R.tp=fmtScale(plan.tp1,plan.entry);
        R.tp2=fmtScale(plan.tp2,plan.entry);
        R.riskUsd=DECIDE.riskUsd;
        R.note=`来自决策总台「${plan.tag}」(${plan.execMode==='market'?'现价单':'限价单'} · TP2=${fmtScale(plan.tp2,plan.entry)})`;
      }
    }
    if(typeof S!=='undefined'&&S.tac)S.tac.tf=ltfIv;
    if(typeof jumpSym==='function')jumpSym(plan.sym);
    if(typeof SmcState!=='undefined'&&typeof SmcState.riskRender==='function')setTimeout(()=>SmcState.riskRender(),30);
  }

  function decideCopyPlan(plan){
    const sz=calcSizing(plan),ref=plan.entry;
    const dir=plan.side==='long'?'【做多 LONG】':'【做空 SHORT】';
    const mode=plan.execMode==='market'?'现价执行':'限价埋伏(勿追单)';
    const txt=`${dir}${plan.sym} (${plan.name}) · ${mode} · 综合分${plan.score}/100\n`+
      `📍 入场：${fmtScale(plan.entry,ref)}（现价 ${fmtScale(plan.close,ref)}）\n`+
      `🛑 止损：${fmtScale(plan.sl,ref)}（-${(plan.stopPct*100).toFixed(2)}% · ${plan.slReason}）\n`+
      `🎯 止盈1：${fmtScale(plan.tp1,ref)}（+${(plan.tp1Pct*100).toFixed(2)}% · 净${plan.netRR1.toFixed(2)}R · 平50%推保本）\n`+
      `🚀 止盈2：${fmtScale(plan.tp2,ref)}（+${(plan.tp2Pct*100).toFixed(2)}% · 净${plan.netRR2.toFixed(2)}R）\n`+
      `💰 仓位（定损$${sz.riskUsd}）：名义仓位 $${Math.round(sz.notional)}（约 ${sz.qty.toPrecision(4)} ${plan.base} · 10x保证金 $${Math.round(sz.margin10x)}）\n`+
      `⚠️ 纪律：${plan.invalidNote}`;
    if(navigator.clipboard?.writeText)navigator.clipboard.writeText(txt).then(()=>toast('已复制完整下单指令')).catch(()=>toast(txt));
    else toast(txt);
  }

  function decideRender(){
    const host=$('#decideHost');if(!host)return;
    const rc=DECIDE.regime.crypto,rs=DECIDE.regime.stock;
    const allFiltered=DECIDE.plans.filter(p=>{
      if(DECIDE.sideFilter==='long')return p.side==='long';
      if(DECIDE.sideFilter==='short')return p.side==='short';
      if(DECIDE.sideFilter==='market')return p.execMode==='market';
      return true;
    });
    const shown=DECIDE.showAll?allFiltered:allFiltered.slice(0,8);
    const hiddenMore=Math.max(0,allFiltered.length-shown.length);

    const cntLong=DECIDE.plans.filter(p=>p.side==='long').length;
    const cntShort=DECIDE.plans.filter(p=>p.side==='short').length;
    const cntMkt=DECIDE.plans.filter(p=>p.execMode==='market').length;
    const upStr=DECIDE.updatedAt?new Date(DECIDE.updatedAt).toTimeString().slice(0,8):'待扫描';

    let html=`<div class="dc-regime-grid">`+
      `<div class="dc-regcard">`+
        `<div class="row" style="justify-content:space-between"><span>加密市场风向标</span><b>BTC <em class="${clsP(rc?.btcChg)}">${rc?pct(rc.btcChg):'—'}</em> · ETH <em class="${clsP(rc?.ethChg)}">${rc?pct(rc.ethChg):'—'}</em></b></div>`+
        `<p>${esc(rc?.label||'正在读取大盘状态…')}</p>`+
      `</div>`+
      `<div class="dc-regcard">`+
        `<div class="row" style="justify-content:space-between"><span>币安股票合约风向标</span><b>SPY <em class="${clsP(rs?.spyChg)}">${rs?pct(rs.spyChg):'—'}</em> · QQQ <em class="${clsP(rs?.qqqChg)}">${rs?pct(rs.qqqChg):'—'}</em></b></div>`+
        `<p>${esc(rs?.session?.badge||'')} · ${esc(rs?.label||'正在读取美股状态…')}</p>`+
      `</div>`+
    `</div>`;

    html+=`<div class="card" style="padding:10px 12px">`+
      `<div class="row" style="gap:6px;margin-bottom:8px">`+
        `<div class="seg">`+
          `<button type="button" data-dc-sc="all" class="${DECIDE.scope==='all'?'on':''}">全市场(加密+股票)</button>`+
          `<button type="button" data-dc-sc="crypto" class="${DECIDE.scope==='crypto'?'on':''}">仅加密货币</button>`+
          `<button type="button" data-dc-sc="stock" class="${DECIDE.scope==='stock'?'on':''}">仅币安股票</button>`+
        `</div>`+
        `<div class="seg">`+
          `<button type="button" data-dc-st="intraday" class="${DECIDE.style==='intraday'?'on':''}">日内波段(1h+15m)</button>`+
          `<button type="button" data-dc-st="swing" class="${DECIDE.style==='swing'?'on':''}">趋势波段(4h+1h)</button>`+
        `</div>`+
        `<button type="button" class="btn mini pri" id="dcRefreshBtn" ${DECIDE.loading?'disabled':''}>↻ 刷新最新信号</button>`+
        `<button type="button" class="btn mini${DECIDE.autoRefresh?' pri':''}" id="dcAutoBtn">${DECIDE.autoRefresh?'⏱ 90s自动刷新中':'⏱ 自动刷新关'}</button>`+
      `</div>`+
      `<div class="row" style="gap:8px;justify-content:space-between">`+
        `<div class="seg">`+
          `<button type="button" data-dc-sd="all" class="${DECIDE.sideFilter==='all'?'on':''}">全部精选 (${DECIDE.plans.length})</button>`+
          `<button type="button" data-dc-sd="market" class="${DECIDE.sideFilter==='market'?'on':''}">⚡ 现价可入 (${cntMkt})</button>`+
          `<button type="button" data-dc-sd="long" class="${DECIDE.sideFilter==='long'?'on':''}">🟢 只看做多 (${cntLong})</button>`+
          `<button type="button" data-dc-sd="short" class="${DECIDE.sideFilter==='short'?'on':''}">🔴 只看做空 (${cntShort})</button>`+
        `</div>`+
        `<div class="row" style="gap:5px">`+
          `<span class="mut">单笔定损</span>`+
          `<input id="dcRiskUsd" type="number" min="5" step="10" value="${DECIDE.riskUsd}" style="width:72px;padding:5px 8px;font-size:13px">`+
          `<span class="mut">USDT · 更新 ${upStr}${DECIDE.rejected?` (淘汰低盈亏比 ${DECIDE.rejected} 个${DECIDE.deduped?`，相关性去重 ${DECIDE.deduped} 个`:''})`:''}</span>`+
        `</div>`+
      `</div>`+
      (DECIDE.loading?`<div class="pbar on" id="dcProgBar" style="margin-top:8px"><i></i></div><p class="mut" id="dcProgTxt" style="margin-top:4px"><span class="spin"></span> ${esc(DECIDE.progress.phase)}…</p>`:'')+
      (DECIDE.err?`<div class="banner on err" style="margin-top:8px">${esc(DECIDE.err)}</div>`:'')+
    `</div>`;

    if(!DECIDE.loading&&!shown.length){
      html+=`<div class="card" style="text-align:center;padding:28px 16px">`+
        `<b style="font-size:15px">当前筛选下暂无同时满足「多周期共振 + 净盈亏比 ≥1.55R」的高胜率单</b>`+
        `<p class="mut" style="margin-top:6px">宁可空仓等待，不做逆势低盈亏比单；可切换「全部精选」或「趋势波段(4h+1h)」查看。</p>`+
      `</div>`;
    }else{
      html+=`<div class="dc-cards">`;
      shown.forEach((p,idx)=>{
        const isLong=p.side==='long',ref=p.entry;
        const sz=calcSizing(p);
        const distFromNow=(p.entry/p.close-1)*100;
        const badgeCls=isLong?(p.execMode==='market'?'dc-b-long':'dc-b-long-lim'):(p.execMode==='market'?'dc-b-short':'dc-b-short-lim');
        const badgeTxt=(isLong?'做多 LONG':'做空 SHORT')+' · '+(p.execMode==='market'?'⚡ 现价可入':'⏳ 限价挂单');
        const mktTag=p.isStock?`<span class="bdg-sk">${esc(p.sectorName.replace(/^[^\s]+\s/,''))}</span>`:`<span class="dc-tag-crypto">加密永续</span>`;
        const enStr=fmtScale(p.entry,ref),slStr=fmtScale(p.sl,ref),tp1Str=fmtScale(p.tp1,ref),tp2Str=fmtScale(p.tp2,ref),curStr=fmtScale(p.close,ref);

        html+=`<article class="dc-card ${isLong?'is-long':'is-short'}">`+
          `<div class="dc-card-hd">`+
            `<div class="row" style="gap:7px">`+
              `<span class="dc-rank">#${idx+1}</span>`+
              `<span class="dc-dir-badge ${badgeCls}">${badgeTxt}</span>`+
              `<b class="dc-sym">${esc(p.base)}</b>`+
              `<span class="mut" style="font-size:12px">${esc(p.name!==p.base?p.name:'')}</span>`+
              `${mktTag}`+
              `<span class="dc-setup-tag">${esc(p.tag)}</span>`+
            `</div>`+
            `<div class="dc-score" title="由大盘相对强弱+双周期结构+VWAP+费率/持仓燃料+净盈亏比综合计算">综合评分 <b>${p.score}</b><small>/100</small></div>`+
          `</div>`+

          `<div class="dc-levels">`+
            `<div class="dc-lv entry" data-copy="${enStr}" title="点击复制入场价">`+
              `<span>📍 ${p.execMode==='market'?'建议入场价 (现价可入)':'建议限价挂单 (勿追现价)'}</span>`+
              `<b>${enStr}</b>`+
              `<small>当前现价 ${curStr} (${p.execMode==='market'?'可直接分批入场':'距挂单 '+pct(distFromNow,2)})</small>`+
            `</div>`+
            `<div class="dc-lv sl" data-copy="${slStr}" title="点击复制止损价">`+
              `<span>🛑 严格止损 SL</span>`+
              `<b>${slStr} <em>-${(p.stopPct*100).toFixed(2)}%</em></b>`+
              `<small>${esc(p.slReason)}</small>`+
            `</div>`+
            `<div class="dc-lv tp1" data-copy="${tp1Str}" title="点击复制第一止盈价">`+
              `<span>🎯 第一止盈 TP1 (平50%推保本)</span>`+
              `<b>${tp1Str} <em>+${(p.tp1Pct*100).toFixed(2)}% · ${p.netRR1.toFixed(2)}R</em></b>`+
              `<small>${esc(p.tp1Src)}</small>`+
            `</div>`+
            `<div class="dc-lv tp2" data-copy="${tp2Str}" title="点击复制第二止盈价">`+
              `<span>🚀 第二止盈 TP2 (尾仓格局)</span>`+
              `<b>${tp2Str} <em>+${(p.tp2Pct*100).toFixed(2)}% · ${p.netRR2.toFixed(2)}R</em></b>`+
              `<small>${esc(p.tp2Src)}</small>`+
            `</div>`+
          `</div>`+

          `<div class="dc-sizing">`+
            `<span>💰 <b>仓位指令</b>（定损 $${sz.riskUsd}）：开仓名义价值 <b style="color:var(--acc)">$${fC(sz.notional)}</b>（约 <b>${fN(sz.qty,sz.qty>=10?1:4)}</b> ${esc(p.base)} · 10x保证金 $${fC(sz.margin10x)}）</span>`+
            `<span class="mut">24h ${pct(p.chg24)} · 费率 ${p.fr!=null?(p.fr*100).toFixed(4)+'%':'—'}</span>`+
          `</div>`+

          `<ul class="dc-reasons">${p.reasons.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>`+
          `<div class="dc-foot">`+
            `<span class="dc-invalid">⚠️ 纪律：${esc(p.invalidNote)}</span>`+
            `<div class="row" style="gap:6px;margin-left:auto">`+
              `<button type="button" class="btn mini" data-dc-copy="${idx}">📋 复制指令</button>`+
              `<button type="button" class="btn mini pri" data-dc-chart="${idx}">📊 看K线点位图 & 作战室 ›</button>`+
              `<a class="btn mini" href="https://www.binance.com/zh-CN/futures/${encodeURIComponent(p.sym)}" target="_blank" rel="noopener" style="text-decoration:none">🔶 去下单</a>`+
            `</div>`+
          `</div>`+
        `</article>`;
      });
      html+=`</div>`;
      if(hiddenMore>0||DECIDE.showAll&&allFiltered.length>8){
        html+=`<div style="text-align:center;margin-top:10px"><button type="button" class="btn mini" id="dcToggleMore">${DECIDE.showAll?'收起（仅显示前 8 张最高分决策单）':`展开其余 ${hiddenMore} 张合格候选单（共 ${allFiltered.length} 张）`}</button></div>`;
      }
    }

    html+=`<p class="muted hint" style="margin-top:8px">风控铁律：系统已自动剔除同底层重复杠杆标的、限制单一股票行业集中度，并硬性淘汰扣费净盈亏比 &lt;1.55R 的追高杀跌单。请务必在开仓同时设置好止损单（SL），单笔定损建议控制在账户本金 1%–2% 以内。</p>`;

    host.innerHTML=html;

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
    const rkInp=$('#dcRiskUsd');
    if(rkInp)rkInp.onchange=()=>{
      const v=parseFloat(rkInp.value);
      if(v>0){
        DECIDE.riskUsd=v;
        try{localStorage.setItem('oif_risk_cfg',JSON.stringify({riskUsd:v,feePct:DECIDE.feePct}))}catch(e){}
        if(typeof SmcState!=='undefined'&&SmcState.RISK)SmcState.RISK.riskUsd=v;
        decideRender();
      }
    };
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
})(typeof globalThis!=='undefined'?globalThis:this);
