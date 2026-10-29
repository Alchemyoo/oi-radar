/* 持仓市值 — Binance USDT 永续实时 OI × CoinGecko 流通市值，OI/市值比排序。 */
'use strict';
const CAP={rows:null,loading:false,err:null,q:'',sort:'mcap',dir:-1,cgTs:0};

function capCacheGet(){
  try{const v=JSON.parse(localStorage.getItem('oif_cap')||'null');
    if(v&&Date.now()-v.t<15*60*1000)return v}catch(e){}
  return null}
function capCacheSet(cg){try{localStorage.setItem('oif_cap',JSON.stringify({t:Date.now(),cg}))}catch(e){}}

async function capJget(u,to,tries=2){
  let last;
  for(let i=0;i<tries;i++){
    try{return await jget(u,to)}catch(e){last=e;if(i<tries-1)await new Promise(r=>setTimeout(r,1500*(i+1)))}
  }
  throw last;
}

async function capFetchCG(){
  const cached=capCacheGet();
  if(cached)return cached.cg;
  const out={};
  for(let p=1;p<=4;p++){
    const u='https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page='+p+'&price_change_percentage=24h';
    const r=await capJget(u,20000,2);
    if(!Array.isArray(r)||!r.length)break;
    for(const c of r)if(c.symbol)out[String(c.symbol).toUpperCase()]={mc:c.market_cap,px:c.current_price,nm:c.name||''};
    if(r.length<250)break;
  }
  if(!Object.keys(out).length)throw new Error('CoinGecko 空响应');
  capCacheSet(out);
  return out;
}

async function capLoad(){
  if(CAP.loading)return;
  const cached=capRowsCache();
  if(cached&&cached.length){CAP.rows=cached;CAP.err=null;capRender();return}
  CAP.loading=true;capRenderLoading('加载市值与全量 OI…');
  try{
    const [tk,cg]=await Promise.all([
      capJget(API+'/fapi/v1/ticker/24hr',45000,3),
      capFetchCG().catch(()=>null)
    ]);
    if(!Array.isArray(tk))throw new Error('行情响应异常');
    const syms=tk.filter(x=>x.symbol.endsWith('USDT')).map(x=>x.symbol);
    const px={};for(const x of tk)px[x.symbol]=+x.lastPrice;
    const vol={};for(const x of tk)vol[x.symbol]=+x.quoteVolume;
    const chg={};for(const x of tk)chg[x.symbol]=+x.priceChangePercent;
    const oi=new Map();
    let failed=0,done=0;
    const note=()=>{const h=$('#capHost');if(h&&CAP.loading)h.innerHTML='<p class="muted hint">加载市值与全量 OI… '+done+'/'+syms.length+'</p>'};
    note();
    await pool(syms,16,async s=>{try{oi.set(s,await loadOiOne(s))}catch(e){failed++}done++;if(done%40===0)note()});
    const rows=[];
    for(const s of syms){
      const base=s.slice(0,-4);
      const oic=oi.get(s),p=px[s];
      if(!(oic>0)||!(p>0))continue;
      const oiv=oic*p;
      const c=cg?cg[base]:null;
      rows.push({sym:s,base,px:p,chg:chg[s],vol:vol[s],oi:oic,oiv,
        mcap:c&&c.mc>0?c.mc:null,cgname:c?c.nm:null,
        ratio:(c&&c.mc>0)?oiv/c.mc:null});
    }
    if(!rows.length)throw new Error('无有效数据');
    CAP.rows=rows;CAP.err=null;
    try{localStorage.setItem('oif_cap_rows',JSON.stringify({t:Date.now(),rows:rows.map(r=>[r.sym,r.px,r.chg,r.vol,r.oi,r.mcap,r.cgname])}))}catch(e){}
  }catch(e){CAP.err='加载失败：'+e.message}
  CAP.loading=false;capRender();
}

function capRowsCache(){
  try{const v=JSON.parse(localStorage.getItem('oif_cap_rows')||'null');
    if(v&&Date.now()-v.t<10*60*1000)return v.rows.map(a=>({sym:a[0],base:a[0].slice(0,-4),px:a[1],chg:a[2],vol:a[3],oi:a[4],oiv:a[4]*a[1],mcap:a[5],cgname:a[6],ratio:a[5]?a[4]*a[1]/a[5]:null}));
  }catch(e){}
  return null}

function capInit(){
  const host=$('#capHost');if(!host)return;
  capOpen();
}
function capOpen(){
  if(CAP.rows)return capRender();
  if(CAP.loading)return;
  capLoad();
}

function capRenderLoading(msg){const h=$('#capHost');if(h)h.innerHTML='<p class="muted hint">'+msg+'</p>'}

function capRender(){
  const host=$('#capHost');if(!host)return;
  if(CAP.loading)return;
  if(CAP.err){host.innerHTML='<p class="muted hint">'+CAP.err+' · <a href="javascript:void(0)" id="capRetry">重试</a></p>';
    const b=$('#capRetry');if(b)b.onclick=()=>{CAP.err=null;capLoad()};return}
  const rows=CAP.rows;
  const withMcap=rows.filter(r=>r.mcap!=null);
  const totalOiv=rows.reduce((a,r)=>a+r.oiv,0);
  const totalMcap=withMcap.reduce((a,r)=>a+r.mcap,0);
  const key=r=>{
    if(CAP.sort==='mcap')return r.mcap!=null?r.mcap:0;
    if(CAP.sort==='oiv')return r.oiv;
    if(CAP.sort==='ratio')return r.ratio!=null?r.ratio:0;
    if(CAP.sort==='vol')return r.vol;
    return 0};
  const q=CAP.q.trim().toUpperCase();
  let list=rows.filter(r=>!q||r.sym.includes(q)||(r.cgname||'').toUpperCase().includes(q));
  list=list.slice().sort((a,b)=>((key(a)-key(b))||a.sym.localeCompare(b.sym))*CAP.dir);
  list=list.slice(0,150);
  const sorts=[['mcap','市值'],['oiv','OI'],['ratio','OI/市值'],['vol','成交额']];
  let html='<p class="muted hint" style="margin-bottom:6px">口径：Binance USDT 永续实时 OI（名义值）× CoinGecko 流通市值（15 分钟缓存）。比值=OI名义/市值，越大说明杠杆持仓相对体量越重。覆盖市值数据 '+withMcap.length+'/'+rows.length+' 币。</p>';
  html+='<div class="row" style="margin-bottom:6px">'+
    '<input id="capQ" placeholder="搜索币种" value="'+CAP.q+'" style="flex:1;background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:14px;color:var(--txt);outline:none">'+
    '<span class="muted" style="font-size:11px">全市场 OI $'+fC(totalOiv)+'</span></div>';
  html+='<div class="seg" style="margin-bottom:8px" id="capSort">'+sorts.map(s=>
    '<button data-k="'+s[0]+'"'+(CAP.sort===s[0]?' class="on"':'')+'>'+s[1]+(CAP.sort===s[0]?(CAP.dir<0?' ↓':' ↑'):'')+'</button>').join('')+'</div>';
  if(!list.length){html+='<p class="muted hint">无匹配</p>';host.innerHTML=html;capBind();return}
  html+='<div class="tblwrap"><table class="tbl cap-tbl"><thead><tr><th>#</th><th>币</th><th>现价</th><th>24h</th><th>市值</th><th>OI 名义</th><th>OI/市值</th></tr></thead><tbody>';
  list.forEach((r,i)=>{
    html+='<tr><td class="muted">'+(i+1)+'</td>'+
      '<td class="ta-l"><b>'+r.base+'</b><span class="muted" style="font-size:9.5px;display:block">'+(r.cgname||'')+'</span></td>'+
      '<td>'+fN(r.px,r.px>=100?2:5)+'</td>'+
      '<td class="'+whaleUp(r.chg)+'">'+(isFinite(r.chg)?(r.chg>=0?'+':'')+r.chg.toFixed(2)+'%':'—')+'</td>'+
      '<td>'+(r.mcap!=null?'$'+fC(r.mcap):'<span class="muted">—</span>')+'</td>'+
      '<td>$'+fC(r.oiv)+'</td>'+
      '<td class="'+(r.ratio!=null&&r.ratio>=0.15?'up':(r.ratio!=null?'':'muted'))+'">'+(r.ratio!=null?(r.ratio*100).toFixed(1)+'%':'—')+'</td></tr>';
  });
  html+='</tbody></table></div>';
  html+='<p class="muted hint" style="margin-top:6px">OI 名义 = 合约持仓量 × 标记价；市值未匹配多为 CoinGecko 前 1000 之外或新币。比值≥15% 高亮（资金杠杆度高，波动可能被放大）。</p>';
  host.innerHTML=html;
  capBind();
}

function capBind(){
  const q=$('#capQ');
  if(q)q.oninput=()=>{CAP.q=q.value;capRender();
    const q2=$('#capQ');if(q2){q2.focus();q2.setSelectionRange(q2.value.length,q2.value.length)}};
  $$('#capSort button').forEach(b=>b.onclick=()=>{
    const k=b.dataset.k;
    if(CAP.sort===k)CAP.dir*=-1;else{CAP.sort=k;CAP.dir=-1}
    capRender()});
}
