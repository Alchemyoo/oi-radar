/* 清算 — Coinglass 全币种快照（cg-snapshot.json，每小时）
   终端化结构（对齐《去信号化重构方案》L1–L7）：
   L1 币种头 / L2 核心 KPI 胶囊条 / L3 首屏工作区（K 线 + 关键价位·多周期快照）
   L4 合约博弈 2x2 / L5 资金流 / L6 全币种深度表 / L7 客观口径说明。
   全部为客观数值，不含自动归因文案、不含 6 宫格信号卡、不含主观引导条。 */
'use strict';
const CG={rows:null,snapT:null,levels:null,loading:false,err:null,q:'',sort:'liq',dir:-1,open:{},
  sym:null,lvTab:'levels',lvOpen:false,tf:'1h',layers:{lv:true,ma:true},
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
}

/* L1 全局币种头 */
function cgHeadHtml(r){
  const syms=cgSymList();
  const lvSyms=Object.keys(CG.levels||{});
  const chips=syms.filter((s,i)=>lvSyms.includes(s)||i<18);
  const liq=cgLiq(r);
  return '<div class="cg-head" id="cgTop">'+
    '<div class="cg-head-top">'+
      '<div class="cg-head-id"><b>'+cgEsc(cgKey(r))+'</b><span class="cg-rank">'+cgRank(r)+'</span>'+
        '<span class="muted" style="font-size:10.5px">'+cgEsc(r.n||'')+'</span></div>'+
      '<div class="cg-head-px"><b>'+cgPx(r.px)+'</b><span class="'+cgCls(r.c)+'">'+cgPct(r.c)+'</span></div>'+
    '</div>'+
    '<div class="cg-head-sub"><span class="muted">24h 爆仓 <b class="'+cgCls(liq?1:0)+'">'+(liq>0?'$'+fC(liq):'—')+'</b></span>'+
      '<span class="muted">OI <b>'+(r.oi?'$'+fC(r.oi):'—')+'</b></span>'+
      '<span class="muted">费率(年化) <b class="'+cgCls(r.fa)+'">'+(r.fa!=null?cgPct(r.fa,1):'—')+'</b></span></div>'+
    '<div class="seg cg-chips" id="cgChips">'+chips.map(s=>'<button data-s="'+cgEsc(s)+'"'+(s===cgKey(r)?' class="on"':'')+'>'+cgEsc(s)+'</button>').join('')+'</div>'+
  '</div>';
}

/* L2 核心 KPI 胶囊条（横向滑动，点击锚点跳转） */
function cgKpiHtml(r){
  const liq=cgLiq(r),lp=cgLongPct(r);
  const items=[
    ['总市值',r.mc?'$'+fC(r.mc):'—','流通市值','cgSecOi'],
    ['24h 合约成交',r.vt?'$'+fC(r.vt):'—','永续+交割','cgSecFund'],
    ['全网持仓 OI',r.oi?'$'+fC(r.oi):'—',cgPct(r.oc)+' 24h','cgSecOi'],
    ['24h 爆仓',liq>0?'$'+fC(liq):'—',lp!=null?'多单占 '+lp.toFixed(0)+'%':'—','cgSecLiq'],
    ['加权费率',r.fa!=null?cgPct(r.fa,2):'—',r.fr!=null?('每小时 '+cgPct(r.fr,4)):'年化','cgSecFund'],
    ['ETF 净流入',(r.ef!=null&&r.ef!==0)?((r.ef>0?'+':'-')+'$'+fC(Math.abs(r.ef))):'—',r.ed?('截至 '+cgEsc(r.ed)):'无数据','cgSecFlow'],
    ['恐惧贪婪',r.fg!=null?String(r.fg):'—','0–100 指数','cgSecFlow'],
    ['主动买占比',r.tb!=null?r.tb.toFixed(1)+'%':'—','24h 主动成交','cgSecLs'],
  ];
  return '<div class="cg-kpibar" id="cgKpi">'+items.map(it=>
    '<button class="cg-kpi" data-go="'+it[3]+'">'+
      '<span class="k">'+it[0]+'</span>'+
      '<span class="v">'+it[1]+'</span>'+
      '<span class="s">'+it[2]+'</span>'+
    '</button>').join('')+'</div>';
}

/* L3 首屏工作区：主图 + 右栏（关键价位 / 多周期快照） */
function cgWsHtml(r){
  const tf=['15m','1h','4h','1D'].map(t=>'<button data-tf="'+t+'"'+(CG.tf===t?' class="on"':'')+'>'+t+'</button>').join('');
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
  const cur=d.px||(rows.find(x=>x[0]==='current_price')||[])[3]||r.px;
  const up=[],dn=[];
  rows.forEach(x=>{
    if(x[0]==='current_price')return;
    const p=x[3];if(p==null)return;
    (p>=(cur||0)?up:dn).push(x);
  });
  up.sort((a,b)=>Math.abs(a[4]||0)-Math.abs(b[4]||0));   // 最近的在上
  dn.sort((a,b)=>Math.abs(a[4]||0)-Math.abs(b[4]||0));   // 最近的在上（紧贴现价）
  let upList=up,dnList=dn;
  if(!CG.lvOpen){
    upList=up.slice(0,2);dnList=dn.slice(0,2);
    let need=4-upList.length-dnList.length;
    if(need>0){const e=up.slice(2,2+need);upList=upList.concat(e);need-=e.length}
    if(need>0){const e=dn.slice(2,2+need);dnList=dnList.concat(e)}
  }
  const rowHtml=x=>{
    const k=CG_LV_KIND[x[0]]||{c:x[1]==='spot'?'muted':'muted',tag:x[1]==='spot'?'现货':(x[1]==='futures'?'合约':'')};
    const pct=Math.max(3,Math.round(Math.abs(x[5]||0)/maxAmt*100));
    return '<div class="cg-lvrow '+k.c+'" data-price="'+x[3]+'" data-kind="'+cgEsc(x[0])+'">'+
      '<i class="cg-lvi" style="width:'+pct+'%"></i>'+
      '<div class="cg-lvb"><b>'+cgEsc(x[6]||'')+'</b>'+(k.tag?'<em>'+cgEsc(k.tag)+'</em>':'')+
        '<span>'+cgEsc([x[2],cgLvMoney(x[5])].filter(Boolean).join(' · '))+'</span></div>'+
      '<div class="cg-lvr"><b class="'+k.c+'">'+cgPx(x[3])+'</b>'+
        '<span class="'+(x[4]>=0?'down':'up')+'">'+(x[4]!=null?cgPct(x[4],2):'')+'</span></div>'+
      '<button class="cg-bell" data-bell="'+x[3]+'" title="记录到本地预警清单">🔔</button>'+
    '</div>';
  };
  const total=up.length+dn.length;
  const cap=(cls,name,shown,all)=>'<span class="cg-lvcap '+cls+'">'+name+' · '+(CG.lvOpen?all+' 档':'显示 '+shown+'/'+all+' 档')+'</span>';
  let h='<div class="cg-lvpanel">';
  if(upList.length)h+='<div class="cg-lvsec">'+cap('down','上方阻力',upList.length,up.length)+upList.map(rowHtml).join('')+'</div>';
  h+='<div class="cg-lvanchor"><span>当前价格锚点</span><b>'+cgPx(cur||r.px)+'</b></div>';
  if(dnList.length)h+='<div class="cg-lvsec">'+cap('up','下方支撑',dnList.length,dn.length)+dnList.map(rowHtml).join('')+'</div>';
  h+='</div>';
  if(total>4)h+='<button class="btn mini cg-more" id="cgLvMore">'+(CG.lvOpen?'收起（仅看最近 4 档）':'展开全部 '+total+' 档')+'</button>';
  h+='<p class="muted hint" style="margin:6px 2px 0">挂单墙=盘口真实挂单；清算密集区=24h 爆仓热力聚合价位；期权最大痛点=到期日买方最不利结算价。铃铛写入本地预警清单（浏览器推送未接入）。</p>';
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
    kv('OI 名义','$'+fC(Math.abs(r.oi||0)))+kv('OI 24h 变化',cgPct(r.oc),cgCls(r.oc))+
    kv('OI / 市值',r.omp!=null?r.omp.toFixed(1)+'%':'—')+kv('MA200 偏离',cgPct(r.m2),cgCls(r.m2)));
  const c2=card('cgSecFund','资金费率',
    kv('每小时费率',r.fr!=null?cgPct(r.fr,4):'—',cgCls(r.fr))+
    kv('年化费率',r.fa!=null?cgPct(r.fa,2):'—',cgCls(r.fa))+
    kv('合约成交额',r.vt?'$'+fC(r.vt):'—')+
    kv('距 ATH',cgPct(r.athd),cgCls(r.athd)));
  const c3=card('cgSecLs','多空与主动成交',
    (r.tb!=null?'<div class="cg-mini-t"><span class="up">主动买 '+r.tb.toFixed(1)+'%</span><span class="down">卖 '+(100-r.tb).toFixed(1)+'%</span></div>'+
      '<div class="cg-bar-t" style="margin:5px 0 8px"><i class="up" style="width:'+r.tb.toFixed(1)+'%"></i></div>':'')+
    kv('现货净流入',r.sn!=null?((r.sn>0?'+':'-')+'$'+fC(Math.abs(r.sn))):'—',cgCls(r.sn))+
    kv('合约净流入',r.fn!=null?((r.fn>0?'+':'-')+'$'+fC(Math.abs(r.fn))):'—',cgCls(r.fn))+
    kv('ETF 净流入',(r.ef!=null&&r.ef!==0)?((r.ef>0?'+':'-')+'$'+fC(Math.abs(r.ef))):'—',cgCls(r.ef)));
  const c4=card('cgSecLiq','全网爆仓统计',
    (lp!=null?'<div class="cg-mini-t"><span class="up">多单 '+lp.toFixed(0)+'%</span><span class="down">空单 '+(100-lp).toFixed(0)+'%</span></div>'+
      '<div class="cg-bar-t" style="margin:5px 0 8px"><i class="up" style="width:'+lp.toFixed(1)+'%"></i></div>':'')+
    kv('24h 合计',liq>0?'$'+fC(liq):'—')+
    kv('多单 / 空单','<span class="up">$'+fC(r.ll||0)+'</span> / <span class="down">$'+fC(r.ls||0)+'</span>')+
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
      '<b class="'+cgCls(v)+'">'+(v==null?'—':((v>0?'+':'-')+'$'+fC(Math.abs(v))))+'</b></div>'+
      '<div class="cg-bar-t"><i class="'+(v>=0?'up':'down')+'" style="width:'+w+'%"></i></div></div>';
  });
  h+='<p class="muted hint" style="margin:6px 2px 0">净流入为 Coinglass 口径的当日/24h 净值；ETF 为 T+1 数据，非实时。</p></section>';
  return h;
}

/* L6 全币种表（首列冻结 + 排序 + 展开） */
function cgTableHtml(rows){
  const sorts=[['liq','爆仓额'],['lp','多单占比'],['oi','OI'],['oc','OI 24h'],['fr','费率'],['etf','ETF'],['omp','OI/市值'],['chg','涨跌幅']];
  let h='<div id="cgSecTable"><div class="cg-tblhead"><h4>全市场深度表<span class="muted">'+rows.length+' 个永续币种</span></h4>'+
    '<button class="btn mini" id="cgReload">刷新</button></div>';
  h+='<div class="seg cg-sorts" id="cgSort">'+sorts.map(s=>
    '<button data-k="'+s[0]+'"'+(CG.sort===s[0]?' class="on"':'')+'>'+s[1]+(CG.sort===s[0]?(CG.dir<0?' ↓':' ↑'):'')+'</button>').join('')+'</div>';
  h+='<input id="cgQ" class="cg-search" placeholder="搜索币种（如 BTC / SOL）" value="'+cgEsc(CG.q)+'">';
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
      '<td>'+(r.px!=null?cgPx(r.px):'—')+'</td>'+
      '<td class="'+cgCls(r.c)+'">'+cgPct(r.c)+'</td>'+
      '<td>'+(liq>0?'$'+fC(liq):'<span class="muted">—</span>')+
        (liq>0?'<div class="cg-minibar"><i class="l" style="width:'+lp.toFixed(0)+'%"></i></div>':'')+'</td>'+
      '<td>'+(lp!=null?lp.toFixed(0)+'%':'—')+'</td>'+
      '<td class="'+cgCls(r.fa)+'">'+(r.fa!=null?cgPct(r.fa,1):'—')+'</td></tr>';
    if(CG.open[s])h+='<tr class="cg-det"><td colspan="6">'+cgRowDetail(r)+
      '<button class="btn mini" data-pick="'+cgEsc(s)+'">切换到 '+cgEsc(s)+' 终端 ↑</button></td></tr>';
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
  const iv={'15m':'15m','1h':'1h','4h':'4h','1D':'1d'}[tf]||'1h';
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

function cgSaveAlert(sym,price){
  let list=[];
  try{list=JSON.parse(localStorage.getItem('cgAlerts')||'[]')||[]}catch(e){list=[]}
  const key=sym+'@'+price;
  const has=list.some(x=>x&&x.k===key);
  if(!has){list.push({k:key,s:sym,p:price,t:Date.now()});try{localStorage.setItem('cgAlerts',JSON.stringify(list.slice(-50)))}catch(e){}}
  return has?('已在本地预警清单：'+sym+' '+cgPx(price)):('已记录本地预警：'+sym+' '+cgPx(price)+'（共 '+(list.length)+' 条）');
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
  $$('#cgSecWs [data-tf]').forEach(b=>b.onclick=()=>{CG.tf=b.dataset.tf;cgChartLoad()});
  $$('#cgSecWs [data-lay]').forEach(b=>b.onclick=()=>{
    const k=b.dataset.lay;CG.layers[k]=!CG.layers[k];
    b.classList.toggle('on',CG.layers[k]);cgChartDraw()});
  $$('#cgSecWs [data-lvt]').forEach(b=>b.onclick=()=>{CG.lvTab=b.dataset.lvt;cgRender()});
  const more=$('#cgLvMore');if(more)more.onclick=()=>{CG.lvOpen=!CG.lvOpen;cgRender()};
  $$('#cgHost [data-go]').forEach(b=>b.onclick=e=>{e.preventDefault();cgGo(b.dataset.go)});
  $$('#cgHost .cg-bell').forEach(b=>b.onclick=e=>{
    e.stopPropagation();
    toast(cgSaveAlert(CG.sym,+b.dataset.bell));
  });
  $$('#cgHost .cg-row').forEach(tr=>tr.onclick=()=>{
    const s=tr.dataset.s;CG.open[s]=!CG.open[s];cgRender()});
  $$('#cgHost [data-pick]').forEach(b=>b.onclick=e=>{
    e.stopPropagation();CG.sym=b.dataset.pick;CG.open={};CG.lvOpen=false;cgRender();cgGo('cgTop')});
  const rb=$('#cgReload');if(rb)rb.onclick=()=>{CG.rows=null;cgLoad(true)};
  const rt=$('#cgRetry');if(rt)rt.onclick=()=>cgLoad(true);
}

function cgInit(){
  window.addEventListener('resize',()=>{cgChartDraw()});
  cgLoad(false);
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
