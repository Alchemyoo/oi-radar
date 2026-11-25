/* 清算 — Coinglass 全币种快照（cg-snapshot.json，每小时）
   终端化结构（对齐《去信号化重构方案》L1–L7）：
   L1 币种头 / L2 核心 KPI 胶囊条 / L3 首屏工作区（K 线 + 关键价位·多周期快照）
   L4 合约博弈 2x2 / L5 资金流 / L6 全币种深度表 / L7 客观口径说明。
   全部为客观数值，不含自动归因文案、不含 6 宫格信号卡、不含主观引导条。 */
'use strict';
const CG={rows:null,snapT:null,levels:null,loading:false,err:null,q:'',sort:'liq',dir:-1,open:{},
  sym:null,lvTab:'levels',lvOpen:false,tf:'1h',layers:{lv:true,ma:true},unit:'usd',
  kline:{key:'',rows:null,err:'',loading:false},alerts:null};

function cgSnapUrl(){return 'cg-snapshot.json?v='+Math.floor(Date.now()/300000)}
function cgGet(url,ms){
  const ctl=typeof AbortController!=='undefined'?new AbortController():null;
  const t=ctl?setTimeout(()=>ctl.abort(),ms||20000):null;
  return fetch(url,ctl?{signal:ctl.signal}:undefined).then(r=>{
    if(!r.ok){const e=new Error('HTTP '+r.status);e.status=r.status;throw e}
    return r.json();
  }).finally(()=>{if(t)clearTimeout(t)});
}
function cgEsc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function cgPct(v,d=2){return v==null||!isFinite(v)?'—':(v>=0?'+':'')+v.toFixed(d)+'%'}
function cgCls(v){return v==null||!isFinite(v)?'muted':(v>0?'up':(v<0?'down':'muted'))}
function cgPx(v){if(v==null||!isFinite(v))return '—';const a=Math.abs(v);return fN(v,a>=10000?1:(a>=100?2:(a>=1?3:6)))}

/* ---- 计价单位 / 单一价格源 / 快照新鲜度 ---- */
function cgPxOf(){const r=cgCur();return r&&r.px!=null?r.px:null}
function cgDist(p){const px=cgPxOf();if(px==null||p==null||!isFinite(p))return null;return (p-px)/px*100}
function cgAmt(v){
  if(v==null||!isFinite(v))return '—';
  const a=Math.abs(v);
  if(CG.unit==='btc'){
    const px=cgPxOf();if(!px)return '—';
    const b=a/px;
    return fN(b,b>=1000?0:(b>=1?2:5))+' ₿';
  }
  return '$'+fC(a);
}
function cgSigned(v){if(v==null||!isFinite(v))return '—';return (v>0?'+':(v<0?'-':''))+cgAmt(v)}
function cgAgeMin(){return CG.snapT?Math.max(0,Math.round((Date.now()-CG.snapT)/60000)):null}
function cgFreshHtml(){
  const m=cgAgeMin();
  if(m==null)return '<span class="cg-fresh" id="cgFresh">快照时间未知</span>';
  if(m>=90)return '<span class="cg-fresh warn" id="cgFresh">快照延迟 '+m+' 分钟</span>';
  return '<span class="cg-fresh ok" id="cgFresh">快照 '+m+' 分钟前</span>';
}
function cgSetUnit(u){
  CG.unit=(u==='btc'?'btc':'usd');
  try{localStorage.setItem('cgUnit',CG.unit)}catch(e){}
  cgRender();
}

function cgLoad(force){
  const host=$('#cgHost');if(!host)return;
  if(CG.loading)return;
  if(CG.rows&&!force)return cgRender();
  CG.loading=true;CG.err=null;
  host.innerHTML='<p class="muted hint">加载 Coinglass 快照…</p>';
  cgGet(cgSnapUrl(),20000).then(r=>{
    if(!r||!Array.isArray(r.coins)||!r.coins.length)throw new Error('快照为空');
    CG.rows=r.coins.slice();
    CG.snapT=r.generatedAt||null;
    CG.levels=r.levels||{};
    CG.missing=r.missing||[];
    if(!CG.sym||!CG.rows.some(x=>cgKey(x)===CG.sym))CG.sym=cgSymList()[0]||cgKey(CG.rows[0]);
    CG.loading=false;cgRender();
  }).catch(e=>{
    CG.loading=false;CG.err='加载失败：'+(e&&e.message||e);cgRender();
  });
}

function cgKey(r){return String(r.bs||r.s||'').toUpperCase()}
function cgLiq(r){return (r.ll||0)+(r.ls||0)}
function cgLongPct(r){const t=cgLiq(r);return t>0?(r.ll||0)/t*100:null}

/* 币种顺序：有关键价位的（主流 8 币）在前，其余按市值/爆仓额排 */
function cgSymList(){
  const rows=CG.rows||[];
  const lv=CG.levels||{};
  const head=Object.keys(lv);
  const seen=new Set(head);
  const rest=rows.slice().sort((a,b)=>(b.mc||0)-(a.mc||0)).map(cgKey).filter(s=>s&&!seen.has(s));
  return head.concat(rest);
}
function cgCur(){
  const rows=CG.rows||[];if(!rows.length)return null;
  return rows.find(r=>cgKey(r)===CG.sym)||rows[0];
}
function cgRank(r){
  const sorted=(CG.rows||[]).slice().sort((a,b)=>(b.mc||0)-(a.mc||0));
  const i=sorted.findIndex(x=>cgKey(x)===cgKey(r));
  return i>=0?'#'+(i+1):'';
}

/* ---------------- 渲染主入口 ---------------- */
function cgRender(){
  const host=$('#cgHost');if(!host)return;
  if(CG.err){host.innerHTML='<p class="muted hint">'+cgEsc(CG.err)+' · <a href="javascript:void(0)" id="cgRetry">重试</a></p>';
    const b=$('#cgRetry');if(b)b.onclick=()=>cgLoad(true);return}
  const rows=CG.rows||[];
  if(!rows.length){host.innerHTML='<p class="muted hint">暂无快照</p>';return}
  const r=cgCur();
  const stamp=CG.snapT?new Date(CG.snapT):null;
  host.innerHTML=
    cgHeadHtml(r)+
    cgKpiHtml(r)+
    cgWsHtml(r)+
    cgBentoHtml(r)+
    cgFlowHtml(r)+
    cgTableHtml(rows)+
    cgNotesHtml(stamp,rows.length);
  cgBind();
  cgChartTick();
  cgCheckAlerts();
}

/* L1 全局币种头 */
function cgHeadHtml(r){
  const syms=cgSymList();
  const lvSyms=Object.keys(CG.levels||{});
  const chips=syms.filter((s,i)=>lvSyms.includes(s)||i<18);
  const liq=cgLiq(r),px=cgPxOf();
  return '<div class="cg-head" id="cgTop">'+
    '<div class="cg-head-top">'+
      '<div class="cg-head-id"><b>'+cgEsc(cgKey(r))+'</b><span class="cg-rank">'+cgRank(r)+'</span>'+
        '<span class="muted" style="font-size:10.5px">'+cgEsc(r.n||'')+'</span>'+
        '<button type="button" class="btn mini pri" data-cg-cockpit="'+cgEsc(cgKey(r))+'" style="padding:3px 8px;font-size:11px">🎯 作战室</button></div>'+
      '<div class="cg-head-px"><b data-copy="'+(px!=null?px:'')+'" title="点击复制裸数值">'+cgPx(px)+'</b>'+
        '<span class="'+cgCls(r.c)+'">'+cgPct(r.c)+'</span>'+
        '<span class="cg-unit" id="cgUnit"><button data-unit="usd"'+(CG.unit==='usd'?' class="on"':'')+' title="U 本位（USD）">USD</button>'+
        '<button data-unit="btc"'+(CG.unit==='btc'?' class="on"':'')+' title="币本位（BTC）· 快捷键 U">BTC</button></span></div>'+
    '</div>'+
    '<div class="cg-head-sub"><span class="muted">24h 爆仓 <b class="'+cgCls(liq?1:0)+'">'+cgAmt(liq)+'</b></span>'+
      '<span class="muted">OI <b>'+cgAmt(r.oi)+'</b></span>'+
      '<span class="muted">费率(年化) <b class="'+cgCls(r.fa)+'">'+(r.fa!=null?cgPct(r.fa,1):'—')+'</b></span>'+
      cgFreshHtml()+'</div>'+
    '<div class="seg cg-chips" id="cgChips">'+chips.map(s=>'<button data-s="'+cgEsc(s)+'"'+(s===cgKey(r)?' class="on"':'')+'>'+cgEsc(s)+'</button>').join('')+'</div>'+
  '</div>';
}

/* L2 核心 KPI 胶囊条（横向滑动，点击锚点跳转） */
function cgKpiHtml(r){
  const liq=cgLiq(r),lp=cgLongPct(r);
  const u=CG.unit==='btc'?'币本位':null;
  const items=[
    ['总市值',cgAmt(r.mc),'流通市值','cgSecOi'],
    ['24h 合约成交',cgAmt(r.vt),'永续+交割','cgSecFund'],
    ['全网持仓 OI',cgAmt(r.oi),cgPct(r.oc)+' 24h','cgSecOi'],
    ['24h 爆仓',cgAmt(liq),lp!=null?'多单占 '+lp.toFixed(0)+'%':'—','cgSecLiq'],
    ['加权费率',r.fa!=null?cgPct(r.fa,2):'—',r.fr!=null?('每小时 '+cgPct(r.fr,4)):'年化','cgSecFund'],
    ['ETF 净流入',(r.ef!=null&&r.ef!==0)?cgSigned(r.ef):'—',r.ed?('截至 '+cgEsc(r.ed)):'无数据','cgSecFlow'],
    ['恐惧贪婪',r.fg!=null?String(r.fg):'—','0–100 指数','cgSecFlow'],
    ['主动买占比',r.tb!=null?r.tb.toFixed(1)+'%':'—','24h 主动成交','cgSecLs'],
  ];
  return '<div class="cg-kpibar" id="cgKpi">'+items.map(it=>
    '<button class="cg-kpi" data-go="'+it[3]+'">'+
      '<span class="k">'+it[0]+'</span>'+
      '<span class="v">'+it[1]+'</span>'+
      '<span class="s">'+(u?u+' · ':'')+it[2]+'</span>'+
    '</button>').join('')+'</div>';
}

/* L3 首屏工作区：主图 + 右栏（关键价位 / 多周期快照） */
function cgWsHtml(r){
  const tf=['15m','1h','4h','1D','1W'].map(t=>'<button data-tf="'+t+'"'+(CG.tf===t?' class="on"':'')+'>'+t+'</button>').join('');
  const lay=[['lv','关键价位线'],['ma','MA20']].map(([k,n])=>
    '<button data-lay="'+k+'"'+(CG.layers[k]?' class="on"':'')+'>'+n+'</button>').join('');
  const tab=(CG.lvTab==='levels'?'':' class="on"');
  return '<section class="cg-ws" id="cgSecWs">'+
    '<div class="cg-chartcard">'+
      '<div class="cg-chart-tools"><div class="seg">'+tf+'</div><div class="seg">'+lay+'</div></div>'+
      '<div class="cg-chartwrap"><canvas id="cgKline"></canvas><div class="cg-chart-msg" id="cgKlineMsg">加载 K 线…</div></div>'+
      '<p class="muted hint cg-chart-note" id="cgKlineNote">Binance Vision 现货 K 线 · 仅展示历史价格</p>'+
    '</div>'+
    '<div class="cg-panel">'+
      '<div class="seg cg-panelseg"><button data-lvt="levels"'+(CG.lvTab==='levels'?' class="on"':'')+'>关键价位</button>'+
        '<button data-lvt="snap"'+tab+'>多周期快照</button></div>'+
      (CG.lvTab==='levels'?cgLevelsPanel(r):cgSnapPanel(r))+
    '</div>'+
  '</section>';
}

function cgKlinesReady(){
  const r=cgCur();if(!r)return false;
  return CG.kline.key===((r.bs||r.s)+'|'+CG.tf)&&!!CG.kline.rows;
}

/* 关键价位：上阻 / 现价锚点 / 下撑，带强度条与本地预警铃 */
function cgLevelsPanel(r){
  const d=(CG.levels||{})[cgKey(r)];
  if(!d||!d.rows||!d.rows.length)
    return '<p class="muted hint" style="margin:8px 2px">该币暂无关键价位数据（Coinglass 仅覆盖主流币）。</p>';
  const rows=d.rows.slice().sort((a,b)=>(b[3]||0)-(a[3]||0));
  const amts=rows.map(x=>Math.abs(x[5]||0)).filter(v=>v>0);
  const maxAmt=amts.length?Math.max.apply(null,amts):1;
  const px=cgPxOf();
  const cur=px!=null?px:(d.px||(rows.find(x=>x[0]==='current_price')||[])[3]||r.px);
  const up=[],dn=[];
  rows.forEach(x=>{
    if(x[0]==='current_price')return;
    const p=x[3];if(p==null)return;
    (p>=cur?up:dn).push(x);
  });
  up.sort((a,b)=>Math.abs(cgDist(a[3])||0)-Math.abs(cgDist(b[3])||0));
  dn.sort((a,b)=>Math.abs(cgDist(a[3])||0)-Math.abs(cgDist(b[3])||0));
  let upList=up,dnList=dn;
  if(!CG.lvOpen){
    upList=up.slice(0,2);dnList=dn.slice(0,2);
    let need=4-upList.length-dnList.length;
    if(need>0){const e=up.slice(2,2+need);upList=upList.concat(e);need-=e.length}
    if(need>0){const e=dn.slice(2,2+need);dnList=dnList.concat(e)}
  }
  const sym=cgKey(r);
  const rowHtml=x=>{
    const k=CG_LV_KIND[x[0]]||{c:'muted',tag:x[1]==='spot'?'现货':(x[1]==='futures'?'合约':'')};
    const pct=Math.max(3,Math.round(Math.abs(x[5]||0)/maxAmt*100));
    const dist=cgDist(x[3]);
    const on=cgHasAlert(sym,x[3]);
    return '<div class="cg-lvrow '+k.c+'" data-price="'+x[3]+'">'+
      '<i class="cg-lvi" style="width:'+pct+'%"></i>'+
      '<div class="cg-lvb"><b>'+cgEsc(x[6]||'')+'</b>'+(k.tag?'<em>'+cgEsc(k.tag)+'</em>':'')+
        '<span>'+cgEsc([x[2],cgAmt(x[5])].filter(Boolean).join(' · '))+'</span></div>'+
      '<div class="cg-lvr"><b class="'+k.c+'" data-copy="'+x[3]+'" title="点击复制裸数值">'+cgPx(x[3])+'</b>'+
        '<span class="'+(dist>=0?'down':'up')+'">'+(dist!=null?cgPct(dist,2):'')+'</span></div>'+
      '<button class="cg-bell'+(on?' on':'')+'" data-bell="'+x[3]+'" title="'+(on?'已设预警':'设置价格预警')+'">'+(on?'◉':'○')+'</button>'+
    '</div>';
  };
  const total=up.length+dn.length;
  const cap=(cls,name,shown,all)=>'<span class="cg-lvcap '+cls+'">'+name+' · '+(CG.lvOpen?all+' 档':'显示 '+shown+'/'+all+' 档')+'</span>';
  let h='<div class="cg-lvpanel">';
  if(upList.length)h+='<div class="cg-lvsec">'+cap('down','上方阻力',upList.length,up.length)+upList.map(rowHtml).join('')+'</div>';
  h+='<div class="cg-lvanchor"><span>当前价格锚点</span><b data-copy="'+(cur!=null?cur:'')+'" title="点击复制裸数值">'+cgPx(cur)+'</b></div>';
  if(dnList.length)h+='<div class="cg-lvsec">'+cap('up','下方支撑',dnList.length,dn.length)+dnList.map(rowHtml).join('')+'</div>';
  h+='</div>';
  if(total>4)h+='<button class="btn mini cg-more" id="cgLvMore">'+(CG.lvOpen?'收起（仅看最近 4 档）':'展开全部 '+total+' 档')+'</button>';
  h+='<p class="muted hint" style="margin:6px 2px 0">距离%按当前现价实时派生（与顶部同一数据源）。铃档=本地预警；价位可点击复制裸数值。</p>';
  return h;
}

/* 多周期快照：只有客观数值矩阵 */
function cgSnapPanel(r){
  const p=r.p||{};
  const rows=[['1h',p.h1],['4h',p.h4],['24h',p.h24],['7d',p.d7],['30d',p.d30]];
  let h='<div class="tblwrap cg-snapwrap"><table class="tbl cg-snap"><thead><tr>'+
    '<th>周期</th><th>涨跌幅</th></tr></thead><tbody>';
  rows.forEach(([k,v])=>h+='<tr><td class="ta-l">'+k+'</td><td class="'+cgCls(v)+'">'+cgPct(v)+'</td></tr>');
  h+='</tbody></table></div>';
  const lp=cgLongPct(r),tb=r.tb;
  h+='<div class="cg-bars">';
  if(lp!=null)h+='<div class="cg-bar"><div class="cg-bar-l"><span class="up">多单爆仓 '+lp.toFixed(0)+'%</span><span class="down">空单 '+(100-lp).toFixed(0)+'%</span></div>'+
    '<div class="cg-bar-t"><i class="up" style="width:'+lp.toFixed(1)+'%"></i></div></div>';
  if(tb!=null)h+='<div class="cg-bar"><div class="cg-bar-l"><span class="up">主动买入 '+tb.toFixed(1)+'%</span><span class="down">主动卖出 '+(100-tb).toFixed(1)+'%</span></div>'+
    '<div class="cg-bar-t"><i class="up" style="width:'+tb.toFixed(1)+'%"></i></div></div>';
  h+='</div>';
  h+='<p class="muted hint" style="margin:6px 2px 0">多周期仅含价格涨跌与 24h 主动成交/爆仓结构；OI 变化率只有 24h 口径（见下方持仓结构）。</p>';
  return h;
}

/* L4 合约博弈 2x2 */
function cgBentoHtml(r){
  const liq=cgLiq(r),lp=cgLongPct(r);
  const totalLiq=(CG.rows||[]).reduce((a,x)=>a+cgLiq(x),0);
  const share=totalLiq>0&&liq>0?liq/totalLiq*100:null;
  const card=(id,title,body,go)=>'<article class="cg-bento" id="'+id+'"><h4>'+title+(go?'<a href="javascript:void(0)" data-go="'+go+'">详情 ›</a>':'')+'</h4>'+body+'</article>';
  const kv=(k,v,c)=>'<div class="cg-kvrow"><span>'+k+'</span><b'+(c?' class="'+c+'"':'')+'>'+v+'</b></div>';
  const c1=card('cgSecOi','持仓结构',
    kv('OI 名义',cgAmt(r.oi))+kv('OI 24h 变化',cgPct(r.oc),cgCls(r.oc))+
    kv('OI / 市值',r.omp!=null?r.omp.toFixed(1)+'%':'—')+kv('MA200 偏离',cgPct(r.m2),cgCls(r.m2)));
  const c2=card('cgSecFund','资金费率',
    kv('每小时费率',r.fr!=null?cgPct(r.fr,4):'—',cgCls(r.fr))+
    kv('年化费率',r.fa!=null?cgPct(r.fa,2):'—',cgCls(r.fa))+
    kv('合约成交额',cgAmt(r.vt))+
    kv('距 ATH',cgPct(r.athd),cgCls(r.athd)));
  const c3=card('cgSecLs','多空与主动成交',
    (r.tb!=null?'<div class="cg-mini-t"><span class="up">主动买 '+r.tb.toFixed(1)+'%</span><span class="down">卖 '+(100-r.tb).toFixed(1)+'%</span></div>'+
      '<div class="cg-bar-t" style="margin:5px 0 8px"><i class="up" style="width:'+r.tb.toFixed(1)+'%"></i></div>':'')+
    kv('现货净流入',cgSigned(r.sn),cgCls(r.sn))+
    kv('合约净流入',cgSigned(r.fn),cgCls(r.fn))+
    kv('ETF 净流入',(r.ef!=null&&r.ef!==0)?cgSigned(r.ef):'—',cgCls(r.ef)));
  const c4=card('cgSecLiq','全网爆仓统计',
    (lp!=null?'<div class="cg-mini-t"><span class="up">多单 '+lp.toFixed(0)+'%</span><span class="down">空单 '+(100-lp).toFixed(0)+'%</span></div>'+
      '<div class="cg-bar-t" style="margin:5px 0 8px"><i class="up" style="width:'+lp.toFixed(1)+'%"></i></div>':'')+
    kv('24h 合计',cgAmt(liq))+
    kv('多单 / 空单','<span class="up">'+cgAmt(r.ll||0)+'</span> / <span class="down">'+cgAmt(r.ls||0)+'</span>')+
    kv('占全市场',share!=null?share.toFixed(1)+'%':'—'));
  return '<section class="cg-bentos">'+c1+c2+c3+c4+'</section>';
}

/* L5 资金流 */
function cgFlowHtml(r){
  const items=[
    ['现货净流入',r.sn,'链上+交易所现货'],
    ['合约净流入',r.fn,'合约市场'],
    ['ETF 净流入',(r.ef==null?null:r.ef),r.ed?('美国现货 ETF · '+r.ed):'美国现货 ETF'],
  ];
  const max=Math.max.apply(null,items.map(i=>Math.abs(i[1]||0)).concat([1]));
  let h='<section class="card cg-flow" id="cgSecFlow"><h4>机构与资金流<a href="javascript:void(0)" data-go="cgSecTable">全市场 ›</a></h4>';
  items.forEach(([n,v,sub])=>{
    const w=v!=null&&max>0?Math.max(2,Math.round(Math.abs(v)/max*100)):0;
    h+='<div class="cg-flowrow"><div class="cg-flowtop"><span>'+n+'<em>'+sub+'</em></span>'+
      '<b class="'+cgCls(v)+'">'+cgSigned(v)+'</b></div>'+
      '<div class="cg-bar-t"><i class="'+(v>=0?'up':'down')+'" style="width:'+w+'%"></i></div></div>';
  });
  h+='<p class="muted hint" style="margin:6px 2px 0">净流入为 Coinglass 口径的当日/24h 净值；ETF 为 T+1 数据，非实时。当前计价：'+(CG.unit==='btc'?'币本位 BTC':'U 本位 USD')+'。</p></section>';
  return h;
}

/* L6 全币种表（首列冻结 + 排序 + 展开） */
function cgTableHtml(rows){
  const sorts=[['liq','爆仓额'],['lp','多单占比'],['oi','OI'],['oc','OI 24h'],['fr','费率'],['etf','ETF'],['omp','OI/市值'],['chg','涨跌幅']];
  let h='<div id="cgSecTable"><div class="cg-tblhead"><h4>全市场深度表<span class="muted">'+rows.length+' 个永续币种</span></h4>'+
    '<button class="btn mini" id="cgReload">刷新</button></div>';
  h+='<div class="seg cg-sorts" id="cgSort">'+sorts.map(s=>
    '<button data-k="'+s[0]+'"'+(CG.sort===s[0]?' class="on"':'')+'>'+s[1]+(CG.sort===s[0]?(CG.dir<0?' ↓':' ↑'):'')+'</button>').join('')+'</div>';
  h+='<input id="cgQ" class="cg-search" placeholder="搜索币种（快捷键 /）" value="'+cgEsc(CG.q)+'">';
  const key=r=>{
    if(CG.sort==='liq')return cgLiq(r);
    if(CG.sort==='lp'){const p=cgLongPct(r);return p==null?-1:p}
    if(CG.sort==='oi')return r.oi||0;
    if(CG.sort==='oc')return r.oc==null?-99:r.oc;
    if(CG.sort==='fr')return r.fa==null?-99:r.fa;
    if(CG.sort==='etf')return r.ef==null?-1e18:r.ef;
    if(CG.sort==='omp')return r.omp==null?-1:r.omp;
    if(CG.sort==='chg')return r.c==null?-99:r.c;
    return 0};
  const q=CG.q.trim().toUpperCase();
  let list=rows.filter(r=>!q||cgKey(r).includes(q)||(r.n||'').toUpperCase().includes(q));
  list=list.slice().sort((a,b)=>((key(a)-key(b))||cgKey(a).localeCompare(cgKey(b)))*CG.dir);
  const shown=list.slice(0,60);
  h+='<div class="tblwrap cg-tblwrap"><table class="tbl cg-tbl"><thead><tr>'+
    '<th class="ta-l">币</th><th>现价</th><th>24h</th><th>24h 爆仓</th><th>多单占</th><th>费率</th>'+
    '</tr></thead><tbody>';
  shown.forEach(r=>{
    const s=cgKey(r),lp=cgLongPct(r),liq=cgLiq(r);
    h+='<tr class="cg-row'+(s===CG.sym?' sel':'')+'" data-s="'+cgEsc(s)+'">'+
      '<td class="ta-l cg-sticky"><b>'+cgEsc(r.bs||r.s)+'</b><span class="muted">'+cgEsc((r.n||'').slice(0,10))+'</span></td>'+
      '<td data-copy="'+(r.px!=null?r.px:'')+'">'+(r.px!=null?cgPx(r.px):'—')+'</td>'+
      '<td class="'+cgCls(r.c)+'">'+cgPct(r.c)+'</td>'+
      '<td>'+(liq>0?cgAmt(liq):'<span class="muted">—</span>')+
        (liq>0?'<div class="cg-minibar"><i class="l" style="width:'+lp.toFixed(0)+'%"></i></div>':'')+'</td>'+
      '<td>'+(lp!=null?lp.toFixed(0)+'%':'—')+'</td>'+
      '<td class="'+cgCls(r.fa)+'">'+(r.fa!=null?cgPct(r.fa,1):'—')+'</td></tr>';
    if(CG.open[s])h+='<tr class="cg-det"><td colspan="6">'+cgRowDetail(r)+
      '<div class="row" style="gap:6px;margin-top:4px"><button class="btn mini" data-pick="'+cgEsc(s)+'">切换到 '+cgEsc(s)+' 终端 ↑</button>'+
      '<button class="btn mini pri" data-cg-cockpit="'+cgEsc(s)+'">🎯 单币作战室（SMC · 多空 · 算仓）</button></div></td></tr>';
  });
  h+='</tbody></table></div>';
  if(list.length>shown.length)h+='<p class="muted hint">显示前 '+shown.length+' / '+list.length+'，用搜索缩小范围。</p>';
  return h+'</div>';
}

function cgNotesHtml(stamp,count){
  const hh=stamp?String(stamp.getHours()).padStart(2,'0')+':'+String(stamp.getMinutes()).padStart(2,'0'):'—';
  return '<p class="muted hint cg-notes">数据来源 Coinglass 币种页服务端快照（'+hh+' 更新，覆盖 '+count+' 个永续币种）+ Binance Vision 现货 K 线。'+
    '爆仓为过去 24h 全交易所合计；多单占=多单爆仓/(多单+空单)。本页只呈现原始数值与口径，不做方向预测。</p>';
}

/* ---------------- 关键价位图标映射 / 单币详情折叠卡 ---------------- */
const CG_LV_KIND={
  spot_sell_wall:{c:'down',tag:'现货'},
  futures_sell_wall:{c:'down',tag:'合约'},
  spot_buy_wall:{c:'up',tag:'现货'},
  futures_buy_wall:{c:'up',tag:'合约'},
  liquidation_short:{c:'down',tag:'清算'},
  liquidation_long:{c:'up',tag:'清算'},
  option_max_pain:{c:'lv-opt',tag:'期权'},
  current_price:{c:'lv-cur',tag:''},
};

function cgLvMoney(v){
  if(v==null||!isFinite(v))return '';
  if(v>=1e9)return '$'+(v/1e9).toFixed(2)+'B';
  if(v>=1e6)return '$'+(v/1e6).toFixed(1)+'M';
  if(v>=1e3)return '$'+(v/1e3).toFixed(0)+'K';
  return '$'+v.toFixed(0);
}

/* ---------------- 主图：Binance Vision 现货 K 线 + 价位线 ---------------- */
function cgChartTick(){
  const r=cgCur();if(!r)return;
  const key=(r.bs||r.s)+'|'+CG.tf;
  if(CG.kline.key===key)return cgChartDraw();
  cgChartLoad();
}

function cgChartLoad(){
  const r=cgCur();if(!r)return;
  const sym=String(r.bs||r.s||'').toUpperCase();
  const tf=CG.tf||'1h';
  const key=sym+'|'+tf;
  if(CG.kline.key===key)return cgChartDraw();
  CG.kline={key:key,rows:null,err:'',loading:true};
  cgChartDraw();
  const iv={'15m':'15m','1h':'1h','4h':'4h','1D':'1d','1W':'1w'}[tf]||'1h';
  const cands=[sym+'USDT'];
  if(!/^1000/.test(sym))cands.push('1000'+sym+'USDT');
  const tryNext=i=>{
    if(i>=cands.length){
      if(CG.kline.key!==key)return;
      CG.kline={key:key,rows:null,err:'无对应现货交易对，K 线不可用',loading:false};
      return cgChartDraw();
    }
    cgGet('https://data-api.binance.vision/api/v3/klines?symbol='+cands[i]+'&interval='+iv+'&limit=168',12000).then(a=>{
      if(CG.kline.key!==key)return;
      if(!Array.isArray(a)||!a.length)throw new Error('empty');
      CG.kline={key:key,rows:a.map(k=>({t:+k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4]})),err:'',loading:false};
      cgChartDraw();
    }).catch(()=>tryNext(i+1));
  };
  tryNext(0);
}

function cgChartDraw(){
  const cv=document.getElementById('cgKline');
  if(!cv)return;
  const msg=document.getElementById('cgKlineMsg');
  const note=document.getElementById('cgKlineNote');
  const wrap=cv.parentElement;
  const w=wrap.clientWidth||330,h=wrap.clientHeight||300;
  const dpr=window.devicePixelRatio||1;
  cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);
  cv.style.width=w+'px';cv.style.height=h+'px';
  const g=cv.getContext('2d');
  g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);
  const st=CG.kline||{};
  if(!st.rows||!st.rows.length){
    if(msg){msg.style.display='flex';msg.textContent=st.err||'加载 K 线…'}
    if(note)note.textContent='Binance Vision 现货 K 线';
    return;
  }
  if(msg)msg.style.display='none';
  const rows=st.rows;
  const last=rows[rows.length-1].c;
  const padR=56,padL=3,padT=8,padB=16;
  const plotW=Math.max(30,w-padL-padR),plotH=Math.max(30,h-padT-padB);
  let lo=Infinity,hi=-Infinity;
  rows.forEach(k=>{if(k.l<lo)lo=k.l;if(k.h>hi)hi=k.h});
  const lvRows=((CG.levels||{})[CG.sym]||{}).rows||[];
  const lvShow=[];
  if(CG.layers.lv){
    lvRows.forEach(x=>{
      const p=x[3];
      if(p==null||x[0]==='current_price')return;
      if(Math.abs(p-last)/last>0.12)return;
      lvShow.push(x);if(p<lo)lo=p;if(p>hi)hi=p;
    });
  }
  const pad=(hi-lo)*0.06||1;lo-=pad;hi+=pad;
  const y=p=>padT+(hi-p)/(hi-lo)*plotH;
  const cw=plotW/rows.length;
  /* 横向网格 + 右侧价格刻度 */
  g.font='10px -apple-system,system-ui,sans-serif';g.textBaseline='middle';
  const usedY=[];
  const canLabel=yy=>usedY.every(u=>Math.abs(u-yy)>11.5);
  for(let i=0;i<=3;i++){
    const p=lo+(hi-lo)*i/3,yy=y(p);
    g.strokeStyle='rgba(35,44,63,.75)';g.lineWidth=1;
    g.beginPath();g.moveTo(padL,yy);g.lineTo(padL+plotW,yy);g.stroke();
    g.fillStyle='#5c6579';g.textAlign='left';g.fillText(cgPx(p),padL+plotW+6,yy);
    usedY.push(yy);
  }
  /* K 线 */
  const bw=Math.max(1,Math.min(9,cw*0.66));
  rows.forEach((k,i)=>{
    const x=padL+cw*(i+0.5);
    const up=k.c>=k.o;
    g.strokeStyle=up?'#2ebd85':'#f6465d';g.fillStyle=up?'#2ebd85':'#f6465d';
    g.beginPath();g.moveTo(x,y(k.h));g.lineTo(x,y(k.l));g.lineWidth=1;g.stroke();
    const yo=y(k.o),yc=y(k.c),top=Math.min(yo,yc),bh=Math.max(1,Math.abs(yc-yo));
    g.fillRect(x-bw/2,top,bw,bh);
  });
  /* MA20 */
  if(CG.layers.ma&&rows.length>21){
    g.strokeStyle='#f0b90b';g.lineWidth=1.2;g.beginPath();
    let started=false;
    for(let i=19;i<rows.length;i++){
      let s=0;for(let j=i-19;j<=i;j++)s+=rows[j].c;
      const ma=s/20,x=padL+cw*(i+0.5),yy=y(ma);
      if(!started){g.moveTo(x,yy);started=true}else g.lineTo(x,yy);
    }
    g.stroke();
  }
  /* 关键价位线 */
  lvShow.forEach(x=>{
    const p=x[3],yy=y(p),isUp=p>=last;
    const col=x[0]==='option_max_pain'?'#a78bfa':(isUp?'#f6465d':'#2ebd85');
    g.save();g.setLineDash([4,3]);g.strokeStyle=col;g.globalAlpha=.85;g.lineWidth=1;
    g.beginPath();g.moveTo(padL,yy);g.lineTo(padL+plotW,yy);g.stroke();g.restore();
    if(canLabel(yy)){g.fillStyle=col;g.textAlign='left';g.fillText(cgPx(p),padL+plotW+6,yy);usedY.push(yy)}
  });
  /* 现价线 */
  const yl=y(last);
  g.save();g.setLineDash([2,3]);g.strokeStyle='rgba(233,237,245,.55)';
  g.beginPath();g.moveTo(padL,yl);g.lineTo(padL+plotW,yl);g.stroke();g.restore();
  /* 时间刻度 */
  const fmt=t=>{const d=new Date(t);return (d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':00'};
  g.fillStyle='#5c6579';g.textAlign='left';
  g.fillText(fmt(rows[0].t),padL,h-7);
  g.textAlign='right';g.fillText(fmt(rows[rows.length-1].t),padL+plotW,h-7);
  if(note)note.textContent='Binance Vision 现货 K 线 · '+rows.length+' 根 '+CG.tf+(lvShow.length?(' · 叠加 '+lvShow.length+' 条价位线'):'');
}

/* ---------------- 绑定 ---------------- */
function cgGo(id){
  const el=document.getElementById(id);
  if(!el)return;
  try{el.scrollIntoView({behavior:'smooth',block:'start'})}catch(e){el.scrollIntoView()}
}

/* ---- 价格预警（本地）：popover 设置 / 常驻标记 / 到价检查 ---- */
function cgAlerts(){let a=[];try{a=JSON.parse(localStorage.getItem('cgAlerts2')||'[]')||[]}catch(e){a=[]}return Array.isArray(a)?a:[]}
function cgAlertsSave(a){try{localStorage.setItem('cgAlerts2',JSON.stringify(a.slice(-120)))}catch(e){}}
function cgHasAlert(sym,price){
  return cgAlerts().some(x=>x.s===sym&&Math.abs((x.price||0)-(price||0))<Math.max(1e-9,Math.abs(price||0)*1e-6));
}
function cgSaveAlert(sym,price,dir,notify){
  const a=cgAlerts();
  const hit=a.find(x=>x.s===sym&&Math.abs((x.price||0)-(price||0))<Math.max(1e-9,Math.abs(price||0)*1e-6));
  if(hit){hit.dir=dir;hit.notify=!!notify;hit.on=true}
  else a.push({s:sym,price:+price,dir:dir||'up',notify:!!notify,on:true,ts:Date.now()});
  cgAlertsSave(a);
  return a.length;
}
function cgCheckAlerts(){
  const r=cgCur();if(!r||r.px==null)return;
  const sym=cgKey(r),px=r.px;
  const a=cgAlerts();let changed=false;
  a.forEach(x=>{
    if(!x.on||x.fired||x.s!==sym)return;
    const hit=x.dir==='down'?px<=x.price:px>=x.price;
    if(!hit)return;
    x.fired=Date.now();changed=true;
    const msg='预警触发：'+sym+' '+(x.dir==='down'?'下穿 ≤ ':'上穿 ≥ ')+cgPx(x.price)+'（现价 '+cgPx(px)+'）';
    toast(msg);
    if(x.notify&&typeof Notification!=='undefined'&&Notification.permission==='granted'){
      try{new Notification('OI 雷达·价格预警',{body:msg})}catch(e){}
    }
  });
  if(changed)cgAlertsSave(a);
}
function cgPopClose(){const p=document.getElementById('cgAlertPop');if(p)p.hidden=true}
function cgPopOpen(anchor,price){
  let p=document.getElementById('cgAlertPop');
  if(!p){
    p=document.createElement('div');
    p.id='cgAlertPop';p.className='cg-pop';p.hidden=true;
    p.innerHTML='<div class="cg-pop-h">价格预警 <span id="cgPopSym"></span></div>'+
      '<div class="cg-pop-row"><span>触发价</span><input id="cgPopPrice" type="number" step="any" inputmode="decimal"></div>'+
      '<div class="cg-pop-row"><div class="seg cg-pop-dir" id="cgPopDir"><button data-d="up">上穿 ≥</button><button data-d="down">下穿 ≤</button></div></div>'+
      '<div class="cg-pop-row cg-pop-steps" id="cgPopSteps"><button data-s="-0.5">-0.5%</button><button data-s="-0.1">-0.1%</button><button data-s="0.1">+0.1%</button><button data-s="0.5">+0.5%</button></div>'+
      '<label class="cg-pop-note"><input type="checkbox" id="cgPopNotify"> 触发时发系统通知</label>'+
      '<div class="cg-pop-f"><button class="btn mini" id="cgPopCancel">取消</button><button class="btn mini pri" id="cgPopSave">保存</button></div>';
    document.body.appendChild(p);
    const inp=p.querySelector('#cgPopPrice');
    p.querySelector('#cgPopCancel').onclick=cgPopClose;
    p.querySelector('#cgPopSteps').onclick=e=>{
      const b=e.target.closest('button');if(!b)return;
      const v=parseFloat(inp.value||'0');if(!isFinite(v))return;
      inp.value=+(v*(1+parseFloat(b.dataset.s)/100)).toFixed(8);
    };
    p.querySelector('#cgPopDir').onclick=e=>{
      const b=e.target.closest('button');if(!b)return;
      [...p.querySelectorAll('#cgPopDir button')].forEach(x=>x.classList.toggle('on',x===b));
    };
    p.querySelector('#cgPopSave').onclick=()=>{
      const px=parseFloat(inp.value);
      if(!isFinite(px)||px<=0){toast('价格无效');return}
      const dir=p.querySelector('#cgPopDir button.on')?.dataset.d||'up';
      const notify=p.querySelector('#cgPopNotify').checked;
      if(notify&&typeof Notification!=='undefined'&&Notification.permission==='default'){
        Notification.requestPermission().catch(()=>{});
      }
      const n=cgSaveAlert(p.dataset.sym,px,dir,notify);
      cgPopClose();cgRender();
      toast('已保存预警：'+p.dataset.sym+' '+(dir==='down'?'≤':'≥')+' '+cgPx(px)+'（共 '+n+' 条）');
    };
    document.addEventListener('click',e=>{if(!p.hidden&&!p.contains(e.target)&&!e.target.closest('.cg-bell'))cgPopClose()},true);
  }
  const px=cgPxOf();
  p.dataset.sym=CG.sym||'';
  p.querySelector('#cgPopSym').textContent=CG.sym||'';
  p.querySelector('#cgPopPrice').value=price!=null?+price:'';
  const cur=px!=null?px:price;
  const dir=(price!=null&&cur!=null&&price<cur)?'down':'up';
  [...p.querySelectorAll('#cgPopDir button')].forEach(b=>b.classList.toggle('on',b.dataset.d===dir));
  p.querySelector('#cgPopNotify').checked=cgAlerts().some(x=>x.s===CG.sym&&Math.abs(x.price-price)<1e-6&&x.notify);
  p.hidden=false;
  const rect=anchor.getBoundingClientRect();
  const w=280,h=p.offsetHeight||190;
  let left=Math.min(Math.max(8,rect.right-w+8),window.innerWidth-w-8);
  let top=rect.bottom+6;
  if(top+h>window.innerHeight-8)top=rect.top-h-6;
  top=Math.min(Math.max(8,top),Math.max(8,window.innerHeight-h-8));
  p.style.left=left+'px';p.style.top=top+'px';
}
/* ---- 裸数值复制 ---- */
function cgCopyRaw(v,x,y){
  const raw=String(v==null?'':v);
  if(!raw||raw==='—')return;
  const tip=document.getElementById('cgTip')||(()=>{
    const t=document.createElement('div');t.id='cgTip';t.className='cg-tip';document.body.appendChild(t);return t;
  })();
  tip.textContent='已复制 '+raw;
  tip.style.left=Math.min(Math.max(8,(x||60)-30),window.innerWidth-120)+'px';
  tip.style.top=Math.max(8,((y||60)-34))+'px';
  tip.classList.add('on');
  clearTimeout(cgCopyRaw._t);
  cgCopyRaw._t=setTimeout(()=>tip.classList.remove('on'),1100);
  const done=()=>{};
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(raw).then(done).catch(()=>cgCopyFallback(raw));
  }else cgCopyFallback(raw);
}
function cgCopyFallback(raw){
  try{
    const ta=document.createElement('textarea');
    ta.value=raw;ta.style.position='fixed';ta.style.left='-999px';
    document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();
  }catch(e){}
}

function cgBind(){
  const q=$('#cgQ');
  if(q)q.oninput=()=>{CG.q=q.value;cgRender();
    const q2=$('#cgQ');if(q2){q2.focus();q2.setSelectionRange(q2.value.length,q2.value.length)}};
  $$('#cgSort button').forEach(b=>b.onclick=()=>{
    const k=b.dataset.k;
    if(CG.sort===k)CG.dir*=-1;else{CG.sort=k;CG.dir=-1}
    cgRender()});
  $$('#cgChips button').forEach(b=>b.onclick=e=>{
    e.stopPropagation();CG.sym=b.dataset.s;CG.open={};CG.lvOpen=false;cgRender()});
  $$('#cgUnit button').forEach(b=>b.onclick=e=>{e.stopPropagation();cgSetUnit(b.dataset.unit)});
  $$('#cgSecWs [data-tf]').forEach(b=>b.onclick=()=>{CG.tf=b.dataset.tf;cgChartLoad()});
  $$('#cgSecWs [data-lay]').forEach(b=>b.onclick=()=>{
    const k=b.dataset.lay;CG.layers[k]=!CG.layers[k];
    b.classList.toggle('on',CG.layers[k]);cgChartDraw()});
  $$('#cgSecWs [data-lvt]').forEach(b=>b.onclick=()=>{CG.lvTab=b.dataset.lvt;cgRender()});
  const more=$('#cgLvMore');if(more)more.onclick=()=>{CG.lvOpen=!CG.lvOpen;cgRender()};
  $$('#cgHost [data-go]').forEach(b=>b.onclick=e=>{e.preventDefault();cgGo(b.dataset.go)});
  $$('#cgHost .cg-bell').forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    const price=+b.dataset.bell;
    cgPopOpen(b,price);
  });
  $$('#cgHost .cg-row').forEach(tr=>tr.onclick=()=>{
    const s=tr.dataset.s;CG.open[s]=!CG.open[s];cgRender()});
  $$('#cgHost [data-pick]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();CG.sym=b.dataset.pick;CG.open={};CG.lvOpen=false;cgRender();cgGo('cgTop')});
  $$('#cgHost [data-cg-cockpit]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    const base=b.dataset.cgCockpit;
    const cand=(typeof S!=='undefined'&&S.symSet&&!S.symSet.has(base+'USDT')&&S.symSet.has('1000'+base+'USDT'))?'1000'+base+'USDT':base+'USDT';
    if(typeof setJumpContext==='function'&&Array.isArray(CG.rows))setJumpContext(CG.rows.slice(0,60).map(x=>cgKey(x)+'USDT'),'清算深度表');
    if(typeof jumpSym==='function')jumpSym(cand);
  });
  const rb=$('#cgReload');if(rb)rb.onclick=()=>{CG.rows=null;cgLoad(true)};
  const rt=$('#cgRetry');if(rt)rt.onclick=()=>cgLoad(true);
}

function cgInit(){
  try{const u=localStorage.getItem('cgUnit');if(u==='btc'||u==='usd')CG.unit=u}catch(e){}
  window.addEventListener('resize',()=>{cgChartDraw()});
  const host=$('#cgHost');
  if(host&&!host._cgBound){
    host._cgBound=true;
    host.addEventListener('click',e=>{
      const t=e.target.closest('[data-copy]');
      if(!t)return;
      e.stopPropagation();
      cgCopyRaw(t.dataset.copy,e.clientX,e.clientY);
    });
  }
  if(!document._cgKeys){
    document._cgKeys=true;
    document.addEventListener('keydown',e=>{
      const view=document.getElementById('v-cg');
      if(!view||!view.classList.contains('on'))return;
      const ae=document.activeElement;
      const typing=ae&&(/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)||ae.isContentEditable);
      if(e.key==='Escape'){
        cgPopClose();
        if(typing){ae.value='';ae.blur();CG.q='';cgRender()}
        return;
      }
      if(typing||e.ctrlKey||e.metaKey||e.altKey)return;
      if(e.key==='u'||e.key==='U'){cgSetUnit(CG.unit==='usd'?'btc':'usd');return}
      if(e.key==='/'){e.preventDefault();const s=$('#cgQ');if(s){s.focus();s.select()}return}
      if(/^[1-5]$/.test(e.key)){
        const tfs=['15m','1h','4h','1D','1W'];
        CG.tf=tfs[+e.key-1];cgRender();cgChartLoad();
      }
    });
  }
  const main=$('#main');
  if(main&&!main._cgScroll){
    main._cgScroll=true;
    main.addEventListener('scroll',()=>{const p=document.getElementById('cgAlertPop');if(p&&!p.hidden)cgPopClose()},{passive:true});
  }
  if(!CG._watch){
    CG._watch=setInterval(()=>{
      const el=document.getElementById('cgFresh');
      if(el){const tmp=document.createElement('div');tmp.innerHTML=cgFreshHtml();el.replaceWith(tmp.firstChild)}
      cgCheckAlerts();
    },30000);
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState!=='visible')return;
      const m=cgAgeMin();
      if(m==null||m<12)return;
      cgSilentResync();
    });
  }
  cgLoad(false);
}
/* 静默重取：只在新快照更旧/缺失或浏览器回前台时对齐，不闪加载态 */
function cgSilentResync(){
  if(CG._syncing)return;
  CG._syncing=true;
  cgGet(cgSnapUrl()+'&r='+Date.now(),20000).then(r=>{
    CG._syncing=false;
    if(!r||!Array.isArray(r.coins)||!r.coins.length)return;
    const fresh=r.generatedAt||0;
    if(CG.snapT&&fresh<=CG.snapT)return;
    CG.rows=r.coins.slice();CG.snapT=fresh;CG.levels=r.levels||CG.levels;
    cgRender();
    toast('已同步快照（'+(r.coins.length)+' 币）');
  }).catch(()=>{CG._syncing=false});
}

/* ---------- 单币详情页折叠卡（v-detail） ---------- */
function cgBase(sym){return String(sym||'').toUpperCase().replace(/USDT$/,'').replace(/^(1000000|10000|1000)/,'')}

function cgMount(){
  const card=document.querySelector('#v-detail .card');
  if(!card||document.getElementById('dtCgFold'))return;
  const el=document.createElement('details');
  el.id='dtCgFold';el.className='fold';
  el.innerHTML='<summary>Coinglass 快照 <span>24h 爆仓 · ETF · 情绪</span></summary>'+
    '<div class="fold-body" id="dtCgBody"><p class="muted hint">加载中…</p></div>';
  const anchor=document.getElementById('dtEvidence');
  if(anchor&&anchor.parentElement===card)card.insertBefore(el,anchor);else card.appendChild(el);
}

/* 单币详情：只保留现价上下最近的几条 */
function cgLevelsMini(sym){
  const L=CG.levels||{};
  const d=L[String(sym||'').toUpperCase()];
  if(!d||!d.rows||!d.rows.length)return '';
  const rows=d.rows.filter(r=>r[0]!=='current_price'&&r[3]!=null).slice();
  rows.sort((a,b)=>Math.abs(a[4]||0)-Math.abs(b[4]||0));
  const pick=rows.slice(0,4);
  let h='<div style="margin-top:8px"><div class="muted" style="font-size:10.5px;margin-bottom:2px">关键价位（最近的 '+pick.length+' 条）</div><div class="cg-lv-list">';
  for(const r of pick){
    const k=CG_LV_KIND[r[0]]||{c:'',tag:r[1]==='spot'?'现货':(r[1]==='futures'?'合约':'')};
    h+='<div class="cg-lv"><span class="cg-lv-d '+k.c+'">'+(r[4]!=null?(r[4]>=0?'+':'')+r[4].toFixed(2)+'%':'')+'</span>'+
      '<i class="cg-lv-dot '+k.c+'"></i>'+
      '<div class="cg-lv-m"><b class="'+k.c+'">'+cgEsc(r[6]||'')+'</b>'+(k.tag?'<em>'+cgEsc(k.tag)+'</em>':'')+
      '<span>'+cgEsc([r[2],cgLvMoney(r[5])].filter(Boolean).join(' · '))+'</span></div>'+
      '<span class="cg-lv-p">'+cgPx(r[3])+'</span></div>';
  }
  return h+'</div></div>';
}

function cgDetail(sym){
  cgMount();
  const host=document.getElementById('dtCgBody');
  if(!host)return;
  const base=cgBase(sym);
  const paint=rows=>{
    const lvHtml=cgLevelsMini(base);
    const r=(rows||[]).find(x=>cgBase(x.bs||x.s)===base||x.s===base);
    if(!r){host.innerHTML='<p class="muted hint">Coinglass 无 '+cgEsc(base)+' 快照（未收录或非永续合约）</p>';return}
    const lp=cgLongPct(r),liq=cgLiq(r);
    let h='<div class="cg-detgrid">'+
      '<div><span>现价</span><b>'+cgPx(r.px)+'</b></div>'+
      '<div><span>24h</span><b class="'+cgCls(r.c)+'">'+cgPct(r.c)+'</b></div>'+
      '<div><span>24h 爆仓</span><b>'+(liq>0?'$'+fC(liq):'—')+'</b></div>'+
      '<div><span>多/空</span><b>'+(lp!=null?lp.toFixed(0)+'% / '+(100-lp).toFixed(0)+'%':'—')+'</b></div>'+
      '<div><span>OI</span><b>'+(r.oi?'$'+fC(r.oi):'—')+'</b></div>'+
      '<div><span>OI 24h</span><b class="'+cgCls(r.oc)+'">'+cgPct(r.oc)+'</b></div>'+
      '<div><span>费率(小时)</span><b class="'+cgCls(r.fr)+'">'+(r.fr!=null?cgPct(r.fr,4):'—')+'</b></div>'+
      '<div><span>费率年化</span><b class="'+cgCls(r.fa)+'">'+(r.fa!=null?cgPct(r.fa,2):'—')+'</b></div>'+
      '<div><span>OI/市值</span><b>'+(r.omp!=null?r.omp.toFixed(1)+'%':'—')+'</b></div>'+
      '<div><span>ETF 净流入</span><b class="'+cgCls(r.ef)+'">'+(r.ef!=null&&r.ef!==0?((r.ef>0?'+':'-')+'$'+fC(Math.abs(r.ef))):'—')+'</b></div>'+
      '<div><span>恐贪指数</span><b>'+(r.fg!=null?r.fg:'—')+'</b></div>'+
      '<div><span>距 ATH</span><b class="'+cgCls(r.athd)+'">'+cgPct(r.athd)+'</b></div>'+
    '</div>';
    const p=r.p||{};
    h+='<div class="cg-detgrid">'+[['1h',p.h1],['4h',p.h4],['24h',p.h24],['7d',p.d7],['30d',p.d30],['90d',p.d90],['今年',p.ytd],['1年',p.y1]]
      .map(([k,v])=>'<div><span>'+k+'</span><b class="'+cgCls(v)+'">'+cgPct(v)+'</b></div>').join('')+'</div>';
    h+=lvHtml;
    if(r.ed)h+='<p class="muted hint" style="margin-top:2px">ETF 数据日期 '+cgEsc(r.ed)+' · 快照 '+(CG.snapT?new Date(CG.snapT).toLocaleString('zh-CN',{hour12:false}):'—')+'</p>';
    host.innerHTML=h;
  };
  if(CG.rows&&CG.rows.length)return paint(CG.rows);
  host.innerHTML='<p class="muted hint">加载 Coinglass 快照…</p>';
  cgGet(cgSnapUrl(),20000).then(r=>{
    CG.rows=(r&&r.coins)||[];CG.snapT=r&&r.generatedAt||null;CG.levels=(r&&r.levels)||{};paint(CG.rows);
  }).catch(e=>{host.innerHTML='<p class="muted hint">加载失败：'+cgEsc(e&&e.message||e)+'</p>'});
}

function cgRowDetail(r){
  const p=r.p||{};
  const cells=[['1h',p.h1],['4h',p.h4],['24h',p.h24],['7d',p.d7],['30d',p.d30],['90d',p.d90],['今年',p.ytd],['1年',p.y1]];
  let h='<div class="cg-detgrid">';
  cells.forEach(([k,v])=>{
    h+='<div><span>'+k+'</span><b class="'+cgCls(v)+'">'+cgPct(v)+'</b></div>';
  });
  h+='</div><div class="cg-detgrid">'+
    '<div><span>现价</span><b>'+cgPx(r.px)+'</b></div>'+
    '<div><span>OI 名义</span><b>'+(r.oi?'$'+fC(r.oi):'—')+'</b></div>'+
    '<div><span>OI 24h</span><b class="'+cgCls(r.oc)+'">'+cgPct(r.oc)+'</b></div>'+
    '<div><span>费率(小时)</span><b class="'+cgCls(r.fr)+'">'+(r.fr!=null?cgPct(r.fr,4):'—')+'</b></div>'+
    '<div><span>市值</span><b>'+(r.mc?'$'+fC(r.mc):'—')+'</b></div>'+
    '<div><span>OI/市值</span><b>'+(r.omp!=null?r.omp.toFixed(1)+'%':'—')+'</b></div>'+
    '<div><span>MA200 偏离</span><b class="'+cgCls(r.m2)+'">'+cgPct(r.m2)+'</b></div>'+
    '<div><span>距 ATH</span><b class="'+cgCls(r.athd)+'">'+cgPct(r.athd)+'</b></div>'+
    '<div><span>现货净流入</span><b class="'+cgCls(r.sn)+'">'+(r.sn!=null?((r.sn>0?'+':'-')+'$'+fC(Math.abs(r.sn))):'—')+'</b></div>'+
    '<div><span>合约净流入</span><b class="'+cgCls(r.fn)+'">'+(r.fn!=null?((r.fn>0?'+':'-')+'$'+fC(Math.abs(r.fn))):'—')+'</b></div>'+
    '<div><span>主动买占比</span><b>'+(r.tb!=null?r.tb.toFixed(1)+'%':'—')+'</b></div>'+
    '<div><span>合约成交额</span><b>'+(r.vt?'$'+fC(r.vt):'—')+'</b></div>'+
    '<div><span>ETF 净流入</span><b class="'+cgCls(r.ef)+'">'+(r.ef!=null&&r.ef!==0?((r.ef>0?'+':'-')+'$'+fC(Math.abs(r.ef))):'—')+'</b></div>'+
    '</div>';
  if(r.ed)h+='<p class="muted hint" style="margin-top:4px">ETF 数据日期 '+cgEsc(r.ed)+'（美国现货 ETF 合计净流入）</p>';
  return h;
}
