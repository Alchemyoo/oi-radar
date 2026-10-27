/* Alpha 判断卡片 — hourly snapshot cache (alpha-card-collector.py). 判断公式为自建公开口径。 */
'use strict';
const ALPHA={data:null,loading:false,err:null,sym:null,loadTs:0};

function alphaOpen(){
  if(ALPHA.data||ALPHA.loading)return alphaRender();
  ALPHA.loading=true;alphaRenderLoading('加载 Alpha 快照…');
  fetch('alpha-card-cache.json',{cache:'no-store'}).then(r=>{
    if(!r.ok)throw new Error('HTTP '+r.status);
    return r.json();
  }).then(d=>{ALPHA.data=d;ALPHA.err=null}).catch(e=>{ALPHA.err='快照加载失败：'+e.message}).finally(()=>{
    ALPHA.loading=false;alphaRender();
  });
}
function alphaRenderLoading(msg){const h=$('#alphaHost');if(h)h.innerHTML='<p class="muted hint">'+msg+'</p>'}

function alphaLabelCls(l){return l==='偏多'?'up':(l==='偏空'?'down':'dim')}
function alphaTag(t){return '<span class="alpha-tag">'+t+'</span>'}
function alphaShort(c){return (c.ca||'').slice(0,6)+'…'+(c.ca||'').slice(-4)}
function alphaExplorer(c){
  const ch=String(c.chain||'');
  if(ch==='56')return 'https://bscscan.com/token/'+c.ca;
  if(ch==='8453')return 'https://basescan.org/token/'+c.ca;
  return 'https://solscan.io/token/'+c.ca;
}

function alphaRender(){
  const host=$('#alphaHost');if(!host)return;
  if(ALPHA.loading)return;
  if(ALPHA.err||!ALPHA.data){host.innerHTML='<p class="muted hint">'+(ALPHA.err||'暂无快照数据')+'</p>';return}
  const d=ALPHA.data,coins=d.coins||[];
  if(!coins.length){host.innerHTML='<p class="muted hint">快照里没有符合口径的币</p>';return}
  const c=ALPHA.sym?coins.find(x=>x.sym===ALPHA.sym):null;
  const stamp=new Date(d.generatedAt);
  const hh=String(stamp.getHours()).padStart(2,'0'),mm=String(stamp.getMinutes()).padStart(2,'0');
  if(!c)return alphaList(d,coins,hh,mm);
  return alphaDetail(d,c,hh,mm);
}

function alphaList(d,coins,hh,mm){
  let html='<p class="muted hint" style="margin-bottom:8px">口径：Binance Alpha 代币 ∩ Binance USDT 永续（按 Alpha 24h 量取前 '+coins.length+'）· 数据截至 '+hh+':'+mm+' · 每小时 ：07 刷新</p>';
  html+='<div class="tblwrap"><table class="tbl alpha-tbl"><thead><tr><th>币</th><th>现价</th><th>24h</th><th>判断</th><th>组合</th><th>异动</th></tr></thead><tbody>';
  for(const c of coins){
    const sc=c.score==null?'—':'<span class="'+alphaLabelCls(c.label)+'">'+c.label+' '+c.score+'</span>';
    html+='<tr data-sym="'+c.sym+'" class="alpha-row"><td class="ta-l"><b>'+c.sym+'</b></td>'+
      '<td>'+(c.price!=null?fN(c.price,c.price>=100?2:5):'—')+'</td>'+
      '<td class="'+whaleUp(c.pct24h)+'">'+(c.pct24h!=null?(c.pct24h>=0?'+':'')+c.pct24h+'%':'—')+'</td>'+
      '<td>'+sc+'</td><td class="muted">'+(c.quad||'—')+'</td>'+
      '<td class="muted" style="font-size:10px">'+(c.tags||[]).map(alphaTag).join('')+'</td></tr>';
  }
  html+='</tbody></table></div>';
  html+='<p class="muted hint" style="margin-top:6px">点行看单币卡片：异动标签 · 判断 · 判断历史。判断分数是自建公式（价/OI/量组合，50 为中性），非原卡片算法；聪明钱持仓与 Gate 借币利率无公开接口，恒为「—」。</p>';
  const host=$('#alphaHost');host.innerHTML=html;
  $$('#alphaHost .alpha-row').forEach(tr=>tr.onclick=()=>{ALPHA.sym=tr.dataset.sym;alphaRender();$('#main').scrollTop=0});
}

function alphaDetail(d,c,hh,mm){
  let html='<div class="row" style="margin-bottom:6px"><button class="btn mini" id="alphaBack">‹ 列表</button>'+
    '<b style="font-size:15px">'+c.sym+'</b><span>'+fN(c.price,c.price>=100?3:6)+'</span>'+
    '<span class="'+whaleUp(c.pct24h)+'">'+(c.pct24h!=null?(c.pct24h>=0?'+':'')+c.pct24h+'%':'')+' 24h</span>'+
    '<span class="r muted" style="margin-left:auto;font-size:11px">截至 '+hh+':'+mm+'</span></div>';
  html+='<p class="muted hint" style="margin-bottom:4px">Alpha 市值 $'+fC(c.mcap)+' · 24h 量 $'+fC(c.vol24h)+' · 持有人 '+(c.holders!=null?fN(c.holders,0):'—')+
    ' · 永续 OI '+(c.oi!=null?'$'+fC(c.oi):'—')+'</p>';
  html+='<p style="margin:6px 0">'+((c.tags&&c.tags.length)?c.tags.map(alphaTag).join(' '):'<span class="muted">无异动标签</span>')+'</p>';
  const sc=c.score==null?'—':'<span class="'+alphaLabelCls(c.label)+'" style="font-size:17px;font-weight:700">'+c.label+' '+c.score+'</span>';
  html+='<p style="margin:8px 0">'+sc+' <span class="muted">· '+(c.quad||'—')+'</span></p>';
  html+='<p class="muted hint" style="font-size:11px">1h 价 '+(c.dP1h!=null?(c.dP1h>=0?'+':'')+c.dP1h+'%':'—')+' · 4h 价 '+(c.dP4h!=null?(c.dP4h>=0?'+':'')+c.dP4h+'%':'—')+
    ' · 1h OI '+(c.dOi1hPct!=null?(c.dOi1hPct>=0?'+':'')+c.dOi1hPct+'%':'—')+(c.dOi1hUsd!=null?' ($'+fC(c.dOi1hUsd)+')':'')+
    ' · 4h OI '+(c.dOi4hPct!=null?(c.dOi4hPct>=0?'+':'')+c.dOi4hPct+'%':'—')+
    ' · 4h 量比 '+(c.volX!=null?c.volX+'x':'—')+' · Gate 借币 '+(c.gateRate!=null?fN(c.gateRate,4):(c.gateBook?'有盘':'—'))+'</p>';
  const hist=(c.hist||[]).slice().reverse();
  html+='<h3 class="card-title" style="margin:10px 0 4px">判断历史 <span class="muted">近 '+hist.length+' 次变化</span></h3>';
  if(hist.length){
    html+='<div class="tblwrap"><table class="tbl"><thead><tr><th>时间</th><th>判断</th><th>组合</th></tr></thead><tbody>';
    for(const h of hist){
      const dt=new Date(h.t);
      html+='<tr><td class="muted">'+(dt.getMonth()+1)+'/'+String(dt.getDate()).padStart(2,'0')+' '+String(dt.getHours()).padStart(2,'0')+':00</td>'+
        '<td class="'+alphaLabelCls(h.l)+'">'+h.l+' '+h.s+'</td><td class="muted">'+(h.q||'—')+'</td></tr>';
    }
    html+='</tbody></table></div>';
  }else html+='<p class="muted hint">暂无历史（每小时快照累加，最多保留 48 条）</p>';
  html+='<p class="muted hint" style="margin-top:6px">合约 <a href="'+alphaExplorer(c)+'" target="_blank" rel="noopener">'+alphaShort(c)+'</a> · 链 '+c.chain+' · 原口径卡片中的聪明钱持仓与借币利率无公开接口，恒显示「—」</p>';
  const host=$('#alphaHost');host.innerHTML=html;
  $('#alphaBack').onclick=()=>{ALPHA.sym=null;alphaRender()};
}

function alphaInit(){
  const host=$('#alphaHost');if(!host)return;
  alphaOpen();
}
