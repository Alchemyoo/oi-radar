/* 巨鲸持仓 (Hyperliquid) — hourly snapshot cache, same-origin fetch. */
'use strict';
const WHALE={data:null,loading:false,err:null,coin:null,tab:'list',loadTs:0};

function whaleAddr(a){return a&&a.length>=6?('0x…'+String(a).slice(-6)):'—'}
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
    '<button data-t="ladder"'+(WHALE.tab==='ladder'?' class="on"':'')+'>价位分布</button></div>';
  if(WHALE.tab==='ladder')html+=whaleLadder(c);
  else{
    html+='<div class="tblwrap"><table class="tbl whale-tbl"><thead><tr>'+
      ['#','地址','向','持仓','价值','开仓价','未实现','杠杆','强平价'].map(h=>'<th>'+h+'</th>').join('')+
      '</tr></thead><tbody>';
    c.holders.forEach((h,i)=>{
      const dir=h.s==='L'?'<span class="up">多</span>':'<span class="down">空</span>';
      html+='<tr><td>'+(i+1)+'</td>'+
        '<td class="ta-l"><a href="https://app.hyperliquid.xyz/explorer/address/0x'+h.a+'" target="_blank" rel="noopener">'+whaleAddr(h.a)+'</a></td>'+
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
  html+='<p class="muted hint" style="margin-top:6px">每小时 ：37 由 GitHub Actions 抓取 Hyperliquid 公开 API（leaderboard + clearinghouseState）生成快照；'+d.lagNote+'。地址尾部可点开 Hyperliquid 资产页。</p>';
  host.innerHTML=html;
  const sel=$('#whaleSel');if(sel)sel.onchange=()=>{WHALE.coin=sel.value;whaleRender()};
  $$('#whaleTabs button').forEach(b=>b.onclick=()=>{WHALE.tab=b.dataset.t;whaleRender()});
}

function whaleLadder(c){
  const hs=c.holders.filter(h=>h.e!=null&&h.e>0);
  if(!hs.length)return '<p class="muted hint">无有效开仓价数据</p>';
  const lo=Math.min(...hs.map(h=>h.e)),hi=Math.max(...hs.map(h=>h.e));
  const N=12,w=(hi-lo)/N||1;
  const bins=Array.from({length:N},(_,i)=>({lo:lo+i*w,hi:lo+(i+1)*w,L:0,S:0}));
  for(const h of hs){
    let i=Math.min(N-1,Math.max(0,Math.floor((h.e-lo)/w)));
    if(h.s==='L')bins[i].L+=h.v;else bins[i].S+=h.v;
  }
  const mx=Math.max(...bins.map(b=>Math.max(b.L,b.S)),1);
  const cur=c.mark;
  let rows=bins.map((b,i)=>{
    const mid=(b.lo+b.hi)/2;
    return '<div class="wl-row"><span class="wl-l"><i class="wl-lbar" style="width:'+(b.L/mx*100)+'%"></i>'+
      (b.L?'<em>'+fC(b.L)+'</em>':'')+'</span>'+
      '<span class="wl-px'+(cur>=b.lo&&cur<b.hi?' cur':'')+'">'+(mid>=100?mid.toFixed(1):mid.toPrecision(3))+'</span>'+
      '<span class="wl-s">'+(b.S?'<em>'+fC(b.S)+'</em>':'')+'<i class="wl-sbar" style="width:'+(b.S/mx*100)+'%"></i></span></div>';
  }).reverse();
  return '<div class="whale-ladder"><div class="wl-head"><span class="up">多 · 开仓价筹码</span>'+
    '<span class="muted">现价 '+(cur!=null?fN(cur,cur>=100?1:4):'—')+'</span>'+
    '<span class="down">空 · 开仓价筹码</span></div>'+rows.join('')+'</div>';
}

function whaleInit(){
  const host=$('#whaleHost');if(!host)return;
  whaleOpen();
}
