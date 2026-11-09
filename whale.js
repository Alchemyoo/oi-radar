/* 巨鲸持仓 (Hyperliquid) — hourly snapshot cache, same-origin fetch. */
'use strict';
const WHALE={data:null,loading:false,err:null,coin:null,tab:'list',loadTs:0};

function whaleAddr(a){return a&&a.length>=6?('0x…'+String(a).slice(-6)):'—'}
function whaleFull(a){return /^0x/i.test(String(a))?String(a):'0x'+String(a)}
function whaleSym(coin){return coin.endsWith('-USD')?coin.slice(0,-4):coin}
function whalePct(x){return x==null||!isFinite(x)?'—':(x>=0?'+':'')+ (x*100).toFixed(1)+'%'}
function whaleUp(v,pos,neg){return v>0?'up':(v<0?'down':(pos||''))}

async function whaleOpen(){
  if(WHALE.data)return whaleRender();
  if(WHALE.loading)return;
  WHALE.loading=true;whaleRenderLoading('加载 Hyperliquid 巨鲸快照…');
  try{
    const r=await fetch('hl-whale-cache.json',{cache:'no-store'});
    if(!r.ok)throw new Error('HTTP '+r.status);
    WHALE.data=await r.json();WHALE.err=null;WHALE.loadTs=Date.now();
  }catch(e){WHALE.err='快照加载失败：'+e.message}
  WHALE.loading=false;whaleRender();
}

function whaleRenderLoading(msg){
  const host=$('#whaleHost');if(!host)return;
  host.innerHTML='<p class="muted hint">'+msg+'</p>';
}

function whaleRender(){
  const host=$('#whaleHost');if(!host)return;
  if(WHALE.loading)return;
  if(WHALE.err||!WHALE.data){host.innerHTML='<p class="muted hint">'+(WHALE.err||'暂无快照数据')+' · <a href="hl-whale-cache.json">缓存文件</a></p>';return}
  const d=WHALE.data,coins=d.coins||[];
  if(!coins.length){host.innerHTML='<p class="muted hint">快照里没有持仓记录</p>';return}
  if(!WHALE.coin||!coins.some(c=>c.coin===WHALE.coin))WHALE.coin=coins[0].coin;
  const c=coins.find(x=>x.coin===WHALE.coin),wl=c.wl,tot=wl.vL+wl.vS;
  const longPct=tot?wl.vL/tot*100:50;
  const stamp=new Date(d.generatedAt);
  const hh=String(stamp.getHours()).padStart(2,'0'),mm=String(stamp.getMinutes()).padStart(2,'0');
  let html='<div class="row" style="margin-bottom:8px">'+
    '<select id="whaleSel" class="whale-sel" aria-label="选择币种">'+
      coins.map(x=>'<option value="'+x.coin+'"'+(x.coin===WHALE.coin?' selected':'')+'>'+whaleSym(x.coin)+'</option>').join('')+
    '</select>'+
    '<span class="muted" style="font-size:11.5px">现价 '+(c.mark!=null?fN(c.mark,c.mark>=100?1:4):'—')+
    ' · 资金费 '+(c.fund!=null?whalePct(c.fund):'—')+'</span>'+
    '<span class="r muted" style="margin-left:auto;font-size:11px">数据截至 '+hh+':'+mm+' · 扫描前 '+d.usersScanned+' 大账户</span></div>';
  html+='<p class="muted hint" style="margin-bottom:6px">口径：Hyperliquid 账户价值前 '+d.usersScanned+' 名（命中 '+d.accountsHit+' 户）在 '+whaleSym(c.coin)+' 上的当前持仓，合计 <b>$'+fC(tot)+'</b>'+
    (c.oi?'，约占全市场 OI $'+fC(c.oi)+' 的 '+(tot/c.oi*100).toFixed(1)+'%':'')+'。</p>';
  html+='<div class="whale-bar" role="img" aria-label="多空占比">'+
    '<span class="wb-l" style="width:'+longPct.toFixed(1)+'%"></span><span class="wb-s"></span></div>';
  html+='<div class="row" style="font-size:11.5px;margin:4px 0 2px">'+
    '<span class="up">■ 多 '+wl.l+' 户 · $'+fC(wl.vL)+'</span>'+
    '<span class="down" style="margin-left:auto">空 '+wl.s+' 户 · $'+fC(wl.vS)+' ■</span></div>';
  html+='<div class="seg" style="margin:8px 0" id="whaleTabs">'+
    '<button data-t="list"'+(WHALE.tab==='list'?' class="on"':'')+'>大户列表</button>'+
    '<button data-t="ladder"'+(WHALE.tab==='ladder'?' class="on"':'')+'>价位分布</button>'+
    '<button data-t="liq"'+(WHALE.tab==='liq'?' class="on"':'')+'>爆仓分布</button></div>';
  if(WHALE.tab==='ladder')html+=whaleLadder(c);
  else if(WHALE.tab==='liq')html+=whaleLiq(c)+(WHALE.live&&WHALE.live.coin===c.coin?whaleLiveBlock(WHALE.live):'<p class="muted hint" id="liqLiveNote">正在连接 Hyperliquid 实时数据…</p>');
  else{
    html+='<div class="tblwrap"><table class="tbl whale-tbl"><thead><tr>'+
      ['#','地址','向','持仓','价值','开仓价','未实现','杠杆','强平价'].map(h=>'<th>'+h+'</th>').join('')+
      '</tr></thead><tbody>';
    c.holders.forEach((h,i)=>{
      const dir=h.s==='L'?'<span class="up">多</span>':'<span class="down">空</span>';
      html+='<tr><td>'+(i+1)+'</td>'+
        '<td class="ta-l"><a href="https://app.hyperliquid.xyz/explorer/address/'+whaleFull(h.a)+'" target="_blank" rel="noopener">'+whaleAddr(h.a)+'</a></td>'+
        '<td>'+dir+'</td>'+
        '<td>'+(h.sz!=null?fN(Math.abs(h.sz),Math.abs(h.sz)>=100?0:2):'—')+'</td>'+
        '<td>$'+fC(h.v)+'</td>'+
        '<td>'+(h.e!=null?fN(h.e,h.e>=100?1:4):'—')+'</td>'+
        '<td class="'+whaleUp(h.up)+'">'+(h.up!=null?(h.up>=0?'+':'')+fC(h.up):'—')+
          (h.roe!=null?' <span class="muted">'+whalePct(h.roe)+'</span>':'')+'</td>'+
        '<td>'+fN(h.lv,0)+(h.lt==='i'?' 全':' 逐')+'</td>'+
        '<td>'+(h.lq!=null?fN(h.lq,h.lq>=100?1:4):'—')+'</td></tr>';
    });
    html+='</tbody></table></div>';
  }
  html+='<p class="muted hint" style="margin-top:6px">每小时 ：45 由服务端定时抓取 Hyperliquid 公开 API（leaderboard + clearinghouseState）生成快照；'+d.lagNote+'。地址尾部可点开 Hyperliquid 资产页。</p>';
  host.innerHTML=html;
  const sel=$('#whaleSel');if(sel)sel.onchange=()=>{WHALE.coin=sel.value;whaleRender()};
  $$('#whaleTabs button').forEach(b=>b.onclick=()=>{WHALE.tab=b.dataset.t;whaleRender();if(WHALE.tab==='liq')whaleLiveStart(c.coin);else whaleLiveStop()});
  if(WHALE.tab==='liq')whaleLiveStart(c.coin);else whaleLiveStop();
}

function whaleLadder(c){
  const hs=c.holders.filter(h=>h.e!=null&&h.e>0);
  if(!hs.length)return '<p class="muted hint">无有效开仓价数据</p>';
  // 按地址分位分箱：每箱地址数相近，避免线性分箱的空箱问题（更细：8-20 箱）
  const N=Math.min(20,Math.max(8,Math.round(hs.length/4)));
  const sorted=hs.slice().sort((a,b)=>a.e-b.e);
  const bins=[];
  for(let i=0;i<N;i++){
    const lo=Math.floor(i*sorted.length/N),hi=Math.floor((i+1)*sorted.length/N);
    const seg=sorted.slice(lo,hi);
    if(!seg.length)continue;
    let L=0,S=0,nL=0,nS=0;
    for(const h of seg){if(h.s==='L'){L+=h.v;nL++}else{S+=h.v;nS++}}
    bins.push({lo:seg[0].e,hi:seg[seg.length-1].e,nL,nS,vL:L,vS:S});
  }
  const mx=Math.max(...bins.map(b=>Math.max(b.vL,b.vS)),1);
  const cur=c.mark;
  const ps=(v)=>{ // 3 位有效数字，避免 2.3K–2.3K / 3K–3K 这类两端相同
    if(v>=1e6)return (v/1e6).toPrecision(3).replace(/\.?0+$/,'')+'M';
    if(v>=1e3)return (v/1e3).toPrecision(3).replace(/\.?0+$/,'')+'K';
    return v>=1?v.toPrecision(3).replace(/\.?0+$/,''):v.toPrecision(2);
  };
  // 现价可能落在两箱之间的空隙（分箱只覆盖真实开仓价），取最近箱标注
  let curIdx=-1,curDist=Infinity;
  if(cur!=null)bins.forEach((b,i)=>{
    const d=cur<b.lo?b.lo-cur:(cur>b.hi?cur-b.hi:0);
    if(d<curDist){curDist=d;curIdx=i}
  });
  const ps4=(v)=>{
    if(v>=1e6)return (v/1e6).toPrecision(4).replace(/\.?0+$/,'')+'M';
    if(v>=1e3)return (v/1e3).toPrecision(4).replace(/\.?0+$/,'')+'K';
    return v>=1?v.toPrecision(4).replace(/\.?0+$/,''):v.toPrecision(3);
  };
  const psPair=(lo,hi)=>{
    const a=ps(lo),b=ps(hi);
    if(a===b)return ps4(lo)+'–'+ps4(hi);  // 3 位撞车时升到 4 位
    return a+'–'+b;
  };
  const curLine='<div class="wl-curline"><span>现价 '+(cur!=null?fN(cur,cur>=100?1:4):'—')+'</span></div>';
  const rows=bins.map((b,i)=>{
    const inCur=i===curIdx;
    const rng=psPair(b.lo,b.hi);
    const row='<div class="wl-row'+(inCur?' curRow':'')+'">'+
      '<span class="wl-px'+(inCur?' cur':'')+'" title="地址 '+b.nL+'多/'+b.nS+'空">'+rng+(inCur?' ★':'')+'</span>'+
      '<span class="wl-l"><i class="wl-lbar" style="width:'+(b.vL/mx*100)+'%"></i>'+
      (b.vL?'<em>'+fC(b.vL)+'</em>':'')+'</span>'+
      '<span class="wl-s">'+(b.vS?'<em>'+fC(b.vS)+'</em>':'')+'<i class="wl-sbar" style="width:'+(b.vS/mx*100)+'%"></i></span></div>';
    return (inCur?curLine:'')+row;
  }).reverse();
  const above=hs.filter(h=>cur!=null&&h.e>cur&&h.s==='L').reduce((a,h)=>a+h.v,0);
  const below=hs.filter(h=>cur!=null&&h.e<=cur&&h.s==='L').reduce((a,h)=>a+h.v,0);
  const hiP=ps(Math.max(...hs.map(h=>h.e))),loP=ps(Math.min(...hs.map(h=>h.e)));
  const axis='<div class="wl-axis"><span>最高 '+hiP+'</span><span class="cur">现价 '+(cur!=null?fN(cur,cur>=100?1:4):'—')+'</span><span>最低 '+loP+'</span></div>';
  const pnlNote=cur!=null?'<div class="wl-note">多单浮盈 $'+fC(below)+' · 浮亏 $'+fC(above)+'（以现价 '+fN(cur,cur>=100?1:4)+' 计）</div>':'';
  return '<div class="whale-ladder">'+axis+'<div class="wl-head"><span class="up">多 · 开仓价筹码</span>'+
    '<span class="muted">'+bins.length+' 箱 · 每箱地址相近</span>'+
    '<span class="down">空 · 开仓价筹码</span></div>'+rows.join('')+
    '<div class="wl-note">'+hs.length+' 大户开仓价 · ★=现价所在箱</div>'+pnlNote+'</div>';
}

function whaleLiq(c){
  const hs=c.holders.filter(h=>h.lq!=null&&h.lq>0);
  if(!hs.length)return '<p class="muted hint">无有效强平价数据</p>';
  const cur=c.mark;
  const ps=(v)=>{
    if(v>=1e6)return (v/1e6).toPrecision(3).replace(/\.?0+$/,'')+'M';
    if(v>=1e3)return (v/1e3).toPrecision(3).replace(/\.?0+$/,'')+'K';
    return v>=1?v.toPrecision(3).replace(/\.?0+$/,''):v.toPrecision(2);
  };
  // 多单强平在下方、空单强平在上方：各自按分位分箱，横轴=价格，条长=该价位爆仓名义
  const side=(list,cls)=>list.slice().sort((a,b)=>a.lq-b.lq);
  const longs=side(hs.filter(h=>h.s==='L')),shorts=side(hs.filter(h=>h.s==='S'));
  const binN=(n)=>Math.min(14,Math.max(4,Math.round(n/3)));
  function bins(list){
    const N=binN(list.length),out=[];
    for(let i=0;i<N;i++){
      const seg=list.slice(Math.floor(i*list.length/N),Math.floor((i+1)*list.length/N));
      if(!seg.length)continue;
      out.push({lo:seg[0].lq,hi:seg[seg.length-1].lq,v:seg.reduce((a,h)=>a+h.v,0),n:seg.length});
    }
    return out;
  }
  const bl=bins(longs),bs=bins(shorts);
  const mx=Math.max(...bl.map(b=>b.v),...bs.map(b=>b.v),1);
  const row=(b,cls)=>{
    const rng=ps(b.lo)+'–'+ps(b.hi);
    return '<div class="wl-row"><span class="wl-px">'+rng+'</span>'+
      '<span class="wl-l"><i class="wl-lbar '+(cls==='S'?'liq-s':'')+'" style="width:'+(b.v/mx*100)+'%"></i><em>'+fC(b.v)+'</em></span>'+
      '<span class="wl-s" style="flex:0 0 34px;justify-content:flex-end"><em class="muted">'+b.n+'户</em></span></div>';
  };
  const curRow=cur!=null?'<div class="wl-curline"><span>现价 '+fN(cur,cur>=100?1:4)+'</span></div>':'';
  const sumL=longs.reduce((a,h)=>a+h.v,0),sumS=shorts.reduce((a,h)=>a+h.v,0);
  const nearest=list=>list.length?list.reduce((a,b)=>Math.abs(b.lq-cur)<Math.abs(a.lq-cur)?b:a):null;
  const nl=cur!=null?nearest(longs):null,ns=cur!=null?nearest(shorts):null;
  let html='<p class="muted hint" style="margin-bottom:6px">口径：按强平价（liquidationPx）分箱，条长=该价位将被强平的名义金额。多单强平在现价<b>下方</b>，空单在上方；已覆盖 '+hs.length+'/'+c.holders.length+' 户有强平价。</p>';
  html+='<div class="wl-axis"><span>多单爆仓 $'+fC(sumL)+'</span><span class="cur">现价 '+(cur!=null?fN(cur,cur>=100?1:4):'—')+'</span><span>空单爆仓 $'+fC(sumS)+'</span></div>';
  html+='<div class="wl-head"><span class="up">多单强平价（下方）</span><span class="muted">'+(bl.length+bs.length)+' 箱</span><span class="down">空单强平价（上方）</span></div>';
  html+='<div class="wl-group down-g">'+bl.slice().reverse().map(b=>row(b,'L')).join('')+'</div>';
  html+=curRow;
  html+='<div class="wl-group">'+bs.map(b=>row(b,'S')).join('')+'</div>';
  if(nl||ns){
    html+='<div class="wl-note">最近爆仓簇：多 '+ (nl?'$'+fC(nl.v)+' @ '+ps(nl.lq):'—') +' · 空 '+(ns?'$'+fC(ns.v)+' @ '+ps(ns.lq):'—')+'</div>';
  }
  html+='<div class="wl-note">爆仓价为账户当前强平价格，随保证金与仓位变化；仅为快照时刻的静态切片，非实时触发价。</div>';
  return html;
}

function whaleInit(){
  const host=$('#whaleHost');if(!host)return;
  whaleOpen();
}

/* ---------- 实时爆仓：前端直连 Hyperliquid（30s 刷新，仅爆仓 tab） ---------- */
const HLI='https://api.hyperliquid.xyz/info';
async function hlPost(body){
  const r=await fetch(HLI,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok)throw new Error('HL HTTP '+r.status);
  return r.json();
}
function whaleLiveStop(){
  if(WHALE.liveTimer){clearInterval(WHALE.liveTimer);WHALE.liveTimer=null}
}
function whaleLiveStart(coin){
  whaleLiveStop();
  if(!coin)return;
  const run=()=>whaleLiveFetch(coin).catch(e=>{
    WHALE.live={coin,err:e.message,ts:Date.now()};
    const box=$('#liqLiveBox');if(box)box.innerHTML=whaleLiveBlock(WHALE.live);
  });
  run();
  WHALE.liveTimer=setInterval(()=>{if(WHALE.tab!=='liq'||!document.querySelector('#whaleHost'))return;run()},30000);
}
async function whaleLiveFetch(coin){
  const snap=WHALE.data&&WHALE.data.coins.find(x=>x.coin===coin);
  if(!snap)return;
  const addrs=[...new Set((snap.holders||[]).map(h=>whaleFull(h.a)))];
  if(!addrs.length)return;
  const [meta,states]=await Promise.all([
    hlPost({type:'metaAndAssetCtxs'}),
    (async()=>{
      const out=[];
      const q=addrs.slice(0,90);
      for(let i=0;i<q.length;i+=8){
        const batch=q.slice(i,i+8);
        const rs=await Promise.all(batch.map(a=>hlPost({type:'clearinghouseState',user:a}).catch(()=>null)));
        rs.forEach((d,idx)=>{if(d&&d.assetPositions)out.push({a:batch[idx],d})});
      }
      return out;
    })()
  ]);
  let mark=null;
  try{
    const i=meta[0].universe.findIndex(u=>u.name===coin);
    if(i>=0)mark=+meta[1][i].markPx;
  }catch(e){}
  const rows=[];
  for(const {a,d} of states){
    for(const ap of d.assetPositions||[]){
      const p=ap.position||{};
      if(p.coin!==coin)continue;
      const szi=+p.szi||0;if(!szi)continue;
      const lq=+p.liquidationPx||0;
      if(!(lq>0))continue;
      rows.push({a,s:szi>0?'L':'S',lq,v:Math.abs(+(p.positionValue||0)),e:+p.entryPx||0});
    }
  }
  WHALE.live={coin,ts:Date.now(),mark:mark!=null?mark:(snap.mark||null),rows,addrs:addrs.length};
  const box=$('#liqLiveBox');
  if(box)box.innerHTML=whaleLiveBlock(WHALE.live);
}
function whaleLiveBlock(L){
  if(!L)return '';
  if(L.err)return '<div id="liqLiveBox"><p class="muted hint">实时数据获取失败：'+L.err+'（下方为每小时快照）</p></div>';
  const cur=L.mark,rows=L.rows||[];
  if(!rows.length)return '<div id="liqLiveBox"><p class="muted hint">实时：这些地址当前没有 '+L.coin+' 持仓</p></div>';
  const ps=v=>v>=1e6?(v/1e6).toPrecision(3).replace(/\.?0+$/,'')+'M':(v>=1e3?(v/1e3).toPrecision(3).replace(/\.?0+$/,'')+'K':v.toPrecision(4));
  const bin=(list)=>{
    if(!list.length)return [];
    list=list.slice().sort((a,b)=>a.lq-b.lq);
    const N=Math.min(12,Math.max(3,Math.round(list.length/3))),out=[];
    for(let i=0;i<N;i++){
      const seg=list.slice(Math.floor(i*list.length/N),Math.floor((i+1)*list.length/N));
      if(!seg.length)continue;
      out.push({lo:seg[0].lq,hi:seg[seg.length-1].lq,v:seg.reduce((a,h)=>a+h.v,0),n:seg.length});
    }
    return out;
  };
  const longs=bin(rows.filter(r=>r.s==='L')),shorts=bin(rows.filter(r=>r.s==='S'));
  const sumL=longs.reduce((a,b)=>a+b.v,0),sumS=shorts.reduce((a,b)=>a+b.v,0);
  const near=(list)=>{let best=null,bd=Infinity;for(const b of list){const d=cur?Math.abs((b.lo+b.hi)/2-cur)/cur:Infinity;if(d<bd){bd=d;best=b}}return best?{...best,dist:bd}:null};
  const nl=near(longs),ns=near(shorts);
  const t=new Date(L.ts);
  const hh=String(t.getHours()).padStart(2,'0'),mm=String(t.getMinutes()).padStart(2,'0'),ss=String(t.getSeconds()).padStart(2,'0');
  let h='<div id="liqLiveBox" class="smc-pd" style="display:block;padding:8px 10px;margin:6px 0;line-height:1.7">';
  h+='<div style="font-size:10.5px;color:var(--sub)">实时 · '+hh+':'+mm+':'+ss+' · 直连 Hyperliquid · '+L.addrs+' 个地址 · 30 秒自动刷新</div>';
  h+='<div style="font-size:11.5px">现价 <b>'+fN(cur,cur>=100?1:4)+'</b>';
  if(nl)h+=' · <span class="up">最近多爆仓 $'+fC(nl.v)+' @ '+ps(nl.lo)+'–'+ps(nl.hi)+'（'+(nl.dist*100).toFixed(1)+'%）</span>';
  if(ns)h+=' · <span class="down">最近空爆仓 $'+fC(ns.v)+' @ '+ps(ns.lo)+'–'+ps(ns.hi)+'（'+(ns.dist*100).toFixed(1)+'%）</span>';
  h+='</div>';
  h+='<div style="font-size:10.5px;color:var(--dim)">实时多单爆仓 $'+fC(sumL)+' · 空单 $'+fC(sumS)+' · 覆盖 '+rows.length+' 笔持仓（快照地址列表）</div></div>';
  return h;
}
