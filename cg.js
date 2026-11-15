/* 清算 — Coinglass 全币种快照（cg-snapshot.json，每小时）
   指标：24h 爆仓多空、OI 24h、资金费率（年化）、ETF 净流入、多周期涨跌、OI/市值、主动买占比。 */
'use strict';
const CG={rows:null,snapT:null,levels:null,loading:false,err:null,q:'',sort:'liq',dir:-1,open:{},lvSym:null};

function cgSnapUrl(){return 'cg-snapshot.json?v='+Math.floor(Date.now()/300000)}
function cgEsc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function cgPct(v,d=2){return v==null||!isFinite(v)?'—':(v>=0?'+':'')+v.toFixed(d)+'%'}
function cgCls(v){return v==null||!isFinite(v)?'muted':(v>0?'up':(v<0?'down':'muted'))}

function cgLoad(force){
  const host=$('#cgHost');if(!host)return;
  if(CG.loading)return;
  if(CG.rows&&!force)return cgRender();
  CG.loading=true;CG.err=null;
  host.innerHTML='<p class="muted hint">加载 Coinglass 快照…</p>';
  jget(cgSnapUrl(),20000).then(r=>{
    if(!r||!Array.isArray(r.coins)||!r.coins.length)throw new Error('快照为空');
    CG.rows=r.coins.slice();
    CG.snapT=r.generatedAt||null;
    CG.levels=r.levels||{};
    CG.lvSym=CG.lvSym||Object.keys(CG.levels)[0]||null;
    CG.missing=r.missing||[];
    CG.loading=false;cgRender();
  }).catch(e=>{
    CG.loading=false;CG.err='加载失败：'+(e&&e.message||e);cgRender();
  });
}

function cgLiq(r){return (r.ll||0)+(r.ls||0)}
function cgLongPct(r){const t=cgLiq(r);return t>0?(r.ll||0)/t*100:null}

function cgRender(){
  const host=$('#cgHost');if(!host)return;
  if(CG.err){host.innerHTML='<p class="muted hint">'+CG.err+' · <a href="javascript:void(0)" id="cgRetry">重试</a></p>';
    const b=$('#cgRetry');if(b)b.onclick=()=>cgLoad(true);return}
  const rows=CG.rows||[];
  if(!rows.length){host.innerHTML='<p class="muted hint">暂无快照</p>';return}

  const totalL=rows.reduce((a,r)=>a+(r.ll||0),0),totalS=rows.reduce((a,r)=>a+(r.ls||0),0);
  const totalLiq=totalL+totalS;
  const longPct=totalLiq>0?totalL/totalLiq*100:null;
  const etfRows=rows.filter(r=>r.ef!=null&&r.ef!==0);
  const etfNet=etfRows.reduce((a,r)=>a+r.ef,0);
  const btc=rows.find(r=>r.s==='BTC')||rows[0];
  const stamp=CG.snapT?new Date(CG.snapT):null;
  const hh=stamp?String(stamp.getHours()).padStart(2,'0')+':'+String(stamp.getMinutes()).padStart(2,'0'):'—';

  let html='<p class="muted hint" style="margin-bottom:6px">来源 Coinglass 币种页（服务端快照 '+hh+'，每小时更新）· 覆盖 '+rows.length+' 个永续币种。爆仓为过去 24h 全交易所合计。</p>';

  /* 汇总条 */
  html+='<div class="card" style="padding:10px 12px;margin-bottom:8px">'+
    '<div class="row" style="justify-content:space-between;align-items:baseline">'+
      '<div><div class="muted" style="font-size:10.5px">全市场 24h 爆仓</div>'+
      '<div style="font-size:19px;font-weight:700">$'+fC(totalLiq)+'</div></div>'+
      '<div style="text-align:right"><div class="muted" style="font-size:10.5px">多 / 空</div>'+
      '<div style="font-size:12.5px"><span class="up">$'+fC(totalL)+'</span> / <span class="down">$'+fC(totalS)+'</span></div></div>'+
    '</div>'+
    '<div class="cg-splitbar" title="左=多单爆仓 右=空单爆仓">'+
      '<i class="l" style="width:'+(longPct!=null?longPct.toFixed(1):0)+'%"></i><i class="s"></i></div>'+
    '<div class="row" style="justify-content:space-between;margin-top:4px">'+
      '<span class="muted" style="font-size:10.5px">多单占 '+(longPct!=null?longPct.toFixed(0)+'%':'—')+'</span>'+
      '<span class="muted" style="font-size:10.5px">'+(longPct==null?'':longPct>=60?'多头被止损为主':(longPct<=40?'空头被挤兑为主':'多空相对均衡'))+'</span>'+
    '</div>'+
    '<div class="cg-kv4" style="margin-top:8px">'+
      '<div><b class="'+cgCls(etfNet)+'">'+(etfNet?(etfNet>0?'+':'')+'$'+fC(etfNet):'—')+'</b><span>ETF 净流入</span></div>'+
      '<div><b>'+(btc&&btc.fg!=null?btc.fg:'—')+'</b><span>恐贪指数</span></div>'+
      '<div><b>'+fC(rows.reduce((a,r)=>a+(r.oi||0),0))+'</b><span>OI 合计($)</span></div>'+
      '<div><b class="'+cgCls(btc&&btc.fr)+'">'+(btc&&btc.fa!=null?(btc.fa>=0?'+':'')+btc.fa.toFixed(1)+'%':'—')+'</b><span>BTC 费率年化</span></div>'+
    '</div>'+
    (btc?cgNarrative(btc):'')+
  '</div>';

  /* 关键价位（大额挂单墙 / 清算密集区 / 期权最大痛点） */
  html+=cgLevelsHtml();

  /* 控制条 */
  const sorts=[['liq','爆仓额'],['lp','多单占比'],['oi','OI'],['oc','OI 24h'],['fr','费率'],['etf','ETF'],['omp','OI/市值'],['chg','涨跌幅']];
  html+='<div class="seg" style="margin-bottom:8px;flex-wrap:wrap" id="cgSort">'+sorts.map(s=>
    '<button data-k="'+s[0]+'"'+(CG.sort===s[0]?' class="on"':'')+'>'+s[1]+(CG.sort===s[0]?(CG.dir<0?' ↓':' ↑'):'')+'</button>').join('')+'</div>';
  html+='<div class="row" style="margin-bottom:6px">'+
    '<input id="cgQ" placeholder="搜索币种" value="'+CG.q+'" style="flex:1;background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:14px;color:var(--txt);outline:none">'+
    '<button class="btn mini" id="cgReload">刷新</button></div>';

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
  let list=rows.filter(r=>!q||(r.s||'').toUpperCase().includes(q)||(r.n||'').toUpperCase().includes(q));
  list=list.slice().sort((a,b)=>((key(a)-key(b))||String(a.s).localeCompare(String(b.s)))*CG.dir);
  const shown=list.slice(0,60);

  html+='<div class="tblwrap"><table class="tbl cg-tbl"><thead><tr>'+
    '<th>币</th><th>24h</th><th>24h 爆仓</th><th>多单占</th><th>费率</th>'+
    '</tr></thead><tbody>';
  shown.forEach(r=>{
    const lp=cgLongPct(r),liq=cgLiq(r);
    html+='<tr class="cg-row" data-s="'+(r.bs||r.s)+'">'+
      '<td class="ta-l"><b>'+cgEsc(r.bs||r.s)+'</b><span class="muted" style="font-size:9.5px;display:block">'+cgEsc(r.n||'')+'</span></td>'+
      '<td class="'+cgCls(r.c)+'">'+cgPct(r.c)+'</td>'+
      '<td>'+(liq>0?'$'+fC(liq):'<span class="muted">—</span>')+
        (liq>0?'<div class="cg-minibar"><i class="l" style="width:'+lp.toFixed(0)+'%"></i></div>':'')+'</td>'+
      '<td class="'+(lp!=null?(lp>=60?'down':(lp<=40?'up':'muted')):'muted')+'">'+(lp!=null?lp.toFixed(0)+'%':'—')+'</td>'+
      '<td class="'+cgCls(r.fa)+'">'+(r.fa!=null?(r.fa>=0?'+':'')+r.fa.toFixed(1)+'%':'—')+'</td>'+

      '</tr>';
    if(CG.open[r.bs||r.s])html+='<tr class="cg-det"><td colspan="5">'+cgRowDetail(r)+'</td></tr>';
  });
  html+='</tbody></table></div>';
  if(list.length>shown.length)html+='<p class="muted hint">显示前 '+shown.length+' / '+list.length+'，可用搜索缩小范围。</p>';
  html+='<p class="muted hint" style="margin-top:6px">爆仓条：绿=多单爆仓占比，红=空单爆仓。多单占越高说明下跌中多头被止损更多（多头拥挤）；越低说明上涨中空头被挤兑更多。ETF 仅主流币有数据（美国现货 ETF，T+1）。</p>';

  host.innerHTML=html;
  cgBind();
}


/* ---------- 关键价位：大额挂单墙 / 清算密集区 / 期权最大痛点 ---------- */
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

function cgLevelsHtml(){
  const L=CG.levels||{};
  const syms=Object.keys(L);
  if(!syms.length)return '';
  const sym=CG.lvSym&&L[CG.lvSym]?CG.lvSym:syms[0];
  const d=L[sym]||{};
  const rows=(d.rows||[]).slice();
  const cur=d.px||(rows.find(r=>r[0]==='current_price')||[])[3]||null;
  let html='<div class="card" style="padding:10px 12px;margin-bottom:8px">';
  html+='<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">'+
        '<b style="font-size:13px">关键价位</b>'+
        '<span class="muted" style="font-size:10.5px">大额挂单 · 清算密集区 · 期权痛点</span></div>';
  html+='<div class="seg" style="margin-bottom:8px;overflow-x:auto" id="cgLvSym">'+syms.map(s=>
        '<button data-s="'+s+'"'+(s===sym?' class="on"':'')+'>'+s+'</button>').join('')+'</div>';
  if(!rows.length){return html+'<p class="muted hint">暂无数据</p></div>'}
  rows.sort((a,b)=>(b[3]||0)-(a[3]||0));
  html+='<div class="cg-lv-list">';
  for(const r of rows){
    const k=CG_LV_KIND[r[0]]||{c:'',tag:r[1]==='spot'?'现货':(r[1]==='futures'?'合约':'')};
    const isCur=r[0]==='current_price';
    const dist=r[4], price=r[3];
    html+='<div class="cg-lv'+(isCur?' cur':'')+'" data-k="'+cgEsc(r[0])+'">'+
      '<span class="cg-lv-d '+k.c+'">'+(isCur?'现价':(dist==null?'':(dist>=0?'+':'')+dist.toFixed(2)+'%'))+'</span>'+
      '<i class="cg-lv-dot '+k.c+'"></i>'+
      '<div class="cg-lv-m"><b class="'+k.c+'">'+cgEsc(r[6]||'')+'</b>'+
        (k.tag?'<em>'+cgEsc(k.tag)+'</em>':'')+
        '<span>'+cgEsc([r[2],cgLvMoney(r[5])].filter(Boolean).join(' · '))+'</span></div>'+
      '<span class="cg-lv-p">'+(price!=null?fN(price,price>=100?1:4):'—')+'</span>'+
      '</div>';
  }
  html+='</div>';
  html+='<p class="muted hint" style="margin-top:6px">挂单墙=盘口真实挂单；清算密集区=24h 爆仓热力聚合价位；期权最大痛点=到期日买方最不利的结算价。现价 '+(cur!=null?fN(cur,2):'—')+'。</p>';
  return html+'</div>';
}

function cgRowDetail(r){
  const p=r.p||{};
  const cells=[['1h',p.h1],['4h',p.h4],['24h',p.h24],['7d',p.d7],['30d',p.d30],['90d',p.d90],['今年',p.ytd],['1年',p.y1]];
  let h='<div class="cg-detgrid">';
  cells.forEach(([k,v])=>{
    h+='<div><span>'+k+'</span><b class="'+cgCls(v)+'">'+cgPct(v)+'</b></div>';
  });
  h+='</div><div class="cg-detgrid">'+
    '<div><span>现价</span><b>'+(r.px!=null?fN(r.px,r.px>=100?2:5):'—')+'</b></div>'+
    '<div><span>OI 名义</span><b>'+(r.oi?'$'+fC(r.oi):'—')+'</b></div>'+
    '<div><span>OI 24h</span><b class="'+cgCls(r.oc)+'">'+cgPct(r.oc)+'</b></div>'+
    '<div><span>费率(小时)</span><b class="'+cgCls(r.fr)+'">'+(r.fr!=null?(r.fr>=0?'+':'')+r.fr.toFixed(4)+'%':'—')+'</b></div>'+
    '<div><span>市值</span><b>'+(r.mc?'$'+fC(r.mc):'—')+'</b></div>'+
    '<div><span>OI/市值</span><b>'+(r.omp!=null?r.omp.toFixed(1)+'%':'—')+'</b></div>'+
    '<div><span>MA200 偏离</span><b class="'+cgCls(r.m2)+'">'+cgPct(r.m2)+'</b></div>'+
    '<div><span>距 ATH</span><b class="'+cgCls(r.athd)+'">'+cgPct(r.athd)+'</b></div>'+
    '<div><span>现货净流入</span><b class="'+cgCls(r.sn)+'">'+(r.sn!=null?(r.sn>0?'+':'')+'$'+fC(r.sn):'—')+'</b></div>'+
    '<div><span>合约净流入</span><b class="'+cgCls(r.fn)+'">'+(r.fn!=null?(r.fn>0?'+':'')+'$'+fC(r.fn):'—')+'</b></div>'+
    '<div><span>主动买占比</span><b>'+(r.tb!=null?r.tb.toFixed(1)+'%':'—')+'</b></div>'+
    '<div><span>合约成交额</span><b>'+(r.vt?'$'+fC(r.vt):'—')+'</b></div>'+
    '<div><span>ETF 净流入</span><b class="'+cgCls(r.ef)+'">'+(r.ef!=null&&r.ef!==0?(r.ef>0?'+':'')+'$'+fC(r.ef):'—')+'</b></div>'+
    '</div>';
  if(r.ed)h+='<p class="muted hint" style="margin-top:4px">ETF 数据日期 '+cgEsc(r.ed)+'（美国现货 ETF 合计净流入）</p>';
  return h;
}

/* 规则化解读：把四个维度拼成一句“为什么涨/跌”，不猜未来。 */
function cgNarrative(r){
  const parts=[];
  const c=r.c||0;
  const lp=cgLongPct(r);
  if(lp!=null&&cgLiq(r)>0){
    if(lp>=60)parts.push('爆仓以多单为主（'+(r.ll>0?'$'+fC(r.ll):'—')+'）');
    else if(lp<=40)parts.push('爆仓以空单为主（'+(r.ls>0?'$'+fC(r.ls):'—')+'）');
    else parts.push('多空爆仓接近平衡');
  }
  if(r.oc!=null){
    if(c<0&&r.oc<-2)parts.push('价格跌、持仓降：多单平仓为主');
    else if(c<0&&r.oc>2)parts.push('价格跌、持仓增：空头新开为主');
    else if(c>0&&r.oc>2)parts.push('价格涨、持仓增：多头新开为主');
    else if(c>0&&r.oc<-2)parts.push('价格涨、持仓降：空头回补为主');
    else parts.push('持仓变化不大（'+(r.oc>=0?'+':'')+r.oc.toFixed(1)+'%）');
  }
  if(r.fa!=null)parts.push('费率年化 '+(r.fa>=0?'+':'')+r.fa.toFixed(1)+'%'+(r.fa>10?'（多头偏拥挤）':(r.fa<-10?'（空头偏拥挤）':'（中性）')));
  if(r.ef!=null&&r.ef!==0)parts.push('ETF '+(r.ef>0?'净流入':'净赎回')+' $'+fC(Math.abs(r.ef)));
  if(!parts.length)return '';
  return '<p style="margin:8px 0 0;font-size:11.5px;line-height:1.5" class="muted"><b style="color:var(--txt)">'+cgEsc(r.s)+' 解读 · </b>'+parts.join('；')+'。</p>';
}

function cgBind(){
  const q=$('#cgQ');
  if(q)q.oninput=()=>{CG.q=q.value;cgRender();
    const q2=$('#cgQ');if(q2){q2.focus();q2.setSelectionRange(q2.value.length,q2.value.length)}};
  $$('#cgSort button').forEach(b=>b.onclick=()=>{
    const k=b.dataset.k;
    if(CG.sort===k)CG.dir*=-1;else{CG.sort=k;CG.dir=-1}
    cgRender()});
  const rb=$('#cgReload');if(rb)rb.onclick=()=>{CG.rows=null;cgLoad(true)};
  $$('#cgLvSym button').forEach(b=>b.onclick=e=>{e.stopPropagation();CG.lvSym=b.dataset.s;cgRender()});
  $$('#cgHost .cg-row').forEach(tr=>tr.onclick=()=>{
    const s=tr.dataset.s;CG.open[s]=!CG.open[s];cgRender()});
}

function cgInit(){cgLoad(false)}

/* ---------- 单币详情页嵌入（v-detail） ---------- */
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
  const cur=d.px;
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
      '<span class="cg-lv-p">'+fN(r[3],r[3]>=100?1:4)+'</span></div>';
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
      '<div><span>24h 爆仓</span><b>'+(liq>0?'$'+fC(liq):'—')+'</b></div>'+
      '<div><span>多 / 空</span><b style="font-size:10px;white-space:nowrap"><span class="up">'+fC(r.ll||0)+'</span> / <span class="down">'+fC(r.ls||0)+'</span></b></div>'+
      '<div><span>多单占</span><b class="'+(lp!=null?(lp>=60?'down':(lp<=40?'up':'muted')):'muted')+'">'+(lp!=null?lp.toFixed(0)+'%':'—')+'</b></div>'+
      '<div><span>OI 24h</span><b class="'+cgCls(r.oc)+'">'+cgPct(r.oc)+'</b></div>'+
      '<div><span>费率年化</span><b class="'+cgCls(r.fa)+'">'+(r.fa!=null?(r.fa>=0?'+':'')+r.fa.toFixed(2)+'%':'—')+'</b></div>'+
      '<div><span>OI/市值</span><b>'+(r.omp!=null?r.omp.toFixed(1)+'%':'—')+'</b></div>'+
      '<div><span>ETF 净流入</span><b class="'+cgCls(r.ef)+'">'+(r.ef!=null&&r.ef!==0?(r.ef>0?'+':'')+'$'+fC(r.ef):'—')+'</b></div>'+
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
  jget(cgSnapUrl(),20000).then(r=>{
    CG.rows=(r&&r.coins)||[];CG.snapT=r&&r.generatedAt||null;CG.levels=(r&&r.levels)||{};paint(CG.rows);
  }).catch(e=>{host.innerHTML='<p class="muted hint">加载失败：'+cgEsc(e&&e.message||e)+'</p>'});
}
