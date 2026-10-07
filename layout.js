/* Three workspaces; move existing nodes so IDs, data and bound events survive. */
'use strict';
const Layout={current:'market',op:'strong',returnTo:null,scroll:{},lists:{market:{q:'',page:1,sort:'vol',dir:-1}}};
function layoutNode(tag,id,html){const e=document.createElement(tag);e.id=id;if(html)e.innerHTML=html;return e}
function layoutSaveList(){
  if(Layout.current!=='market')return;
  const k=Layout.current;
  for(const key of ['q','page','sort','dir'])Layout.lists[k][key]=S.ov[key];
}
function layoutList(k){
  const host=$('#marketListHost');
  host.append($('#v-overview'));
  Object.assign(S.ov,Layout.lists[k]);
  $('#ovSearch').value=S.ov.q;
  $('#ovTitle').firstChild.textContent=S.ov.favOnly?'收藏行情 ':'USDT 永续市场 ';
  $('#ovFavBtn').textContent=S.ov.favOnly?'★ 收藏中 · 显示全部':'☆ 只看收藏';
  ovMeta();ovRender();
}
function layoutOp(k){
  if(!['strong','scan'].includes(k))k='strong';
  Layout.op=k;
  for(const id of ['strong','scan'])$('#v-'+id).hidden=id!==k;
  $$('#opTabs button').forEach(b=>{const on=b.dataset.op===k;b.classList.toggle('on',on);b.setAttribute('aria-selected',String(on))});
  $('#opHelp').textContent={strong:'先找跑赢 BTC 的币，再点币种查看持仓。',scan:'寻找持仓变化异常、价格尚未明显跟随的币。',signal:'结合价格与持仓验证方向；日内监测默认关闭。'}[k];
  if(k==='strong'&&typeof stRender==='function')stRender();
}
function layoutNavigate(v,restore=false){
  if(v==='overview')v='market';
  if(v==='watch'){S.ov.favOnly=true;v='market'}
  if(['strong','scan'].includes(v)){layoutOp(v);v='opportunity'}
  if(v==='fund'||v==='heat'){
    layoutNavigate('market');
    $('#marketTools').open=true;
    const box=$(v==='fund'?'#toolFund':'#toolHeat');box.open=true;return;
  }
  if(!['market','opportunity','signal','detail'].includes(v))return;
  layoutSaveList();Layout.scroll[Layout.current]=$('#main').scrollTop;
  if(v==='detail'&&Layout.current!=='detail')Layout.returnTo={view:Layout.current,op:Layout.op,scroll:$('#main').scrollTop};
  Layout.current=v;
  if(v==='market')layoutList(v);
  if(v==='opportunity')layoutOp(Layout.op);
  for(const id of ['market','opportunity','signal','detail'])$('#v-'+id).classList.toggle('on',id===v);
  const active=v==='detail'?(Layout.returnTo?.view||'market'):v;
  $$('#tabbar button').forEach(b=>{const on=b.dataset.v===active;b.classList.toggle('on',on);b.setAttribute('aria-current',on?'page':'false')});
  $('#hdr h1').textContent=v==='detail'?'单币详情':'OI 雷达';
  $('#detailBack').hidden=v!=='detail';
  $('#main').scrollTop=restore?(Layout.scroll[v]||0):0;
  if(v==='detail')setTimeout(dtChartRender,60);
}
function layoutBack(){
  const r=Layout.returnTo||{view:'market',op:'strong',scroll:0};
  layoutOp(r.op);layoutNavigate(r.view,true);$('#main').scrollTop=r.scroll;
}
function layoutFavoritesChanged(render=true){
  if(Layout.current==='market'){$('#ovFavBtn').textContent=S.ov.favOnly?'★ 收藏中 · 显示全部':'☆ 只看收藏'}
  // Keep existing samples; remove deleted symbols and enroll new favourites.
  S.rt.ctl?.abort();S.rt.loading=false;S.rt.job=null;
  S.rt.generation=(S.rt.generation||0)+1;
  for(const sym of [...S.rt.last.keys()])if(!S.fav.has(sym)){S.rt.last.delete(sym);S.rt.hist.delete(sym)}
  for(const sym of S.fav)if(!S.rt.last.has(sym))S.rt.last.set(sym,S.oi.get(sym)||0);
  rtBuild();if(render){ovMeta();ovRender();if(S.fd.rows)fdRender()}
}
function layoutInit(){
  const main=$('#main');
  const market=layoutNode('section','v-market','<div class="workspace-heading"><h2>市场</h2><p>看行情，点币种深入分析</p></div><div id="marketListHost"></div><details id="marketTools" class="fold"><summary>辅助数据 <span>资金费率 · 热度 / 清算</span></summary><div class="fold-body"><details id="toolFund" class="fold"><summary>资金费率 <span>看多空持仓成本</span></summary></details><details id="toolHeat" class="fold"><summary>热度 / 清算 <span>MegaGlass · 外部数据</span></summary></details></div></details>');
  market.className='view';main.prepend(market);
  const op=layoutNode('section','v-opportunity','<div class="workspace-heading"><h2>机会</h2><p>选币 → 查持仓异动</p></div><div class="workspace-tabs seg" id="opTabs" role="tablist" aria-label="机会分析方式"><button class="on" data-op="strong" role="tab">强势选币</button><button data-op="scan" role="tab">持仓异动</button></div><p class="workspace-help" id="opHelp"></p>');
  op.className='view';main.append(op);
  const watch=layoutNode('details','marketWatch','<summary>收藏 OI 雷达 <span>手动开启 · 仅收藏币种</span></summary>');watch.className='fold';$('#marketTools .fold-body').prepend(watch);
  $('#v-overview').className='market-panel';
  watch.append($('#rtCard'));rtShowCard();
  $('#v-overview h3').id='ovTitle';
  $('#rtLoadFav').textContent='重置采样';
  const hint=layoutNode('p','rtHint','只监测自选币种；手动开启，每 60 秒采样，切页后继续，暂停即停止。');hint.className='workspace-help';$('#rtCard').append(hint);
  for(const id of ['strong','scan']){const el=$('#v-'+id);el.className='op-panel';op.append(el)}
  const signal=$('#v-signal');signal.className='view';signal.hidden=false;main.append(signal);
  signal.prepend(layoutNode('div','signalHeading','<div class="workspace-heading"><h2>信号</h2><p>OI榜单 → 日内观察 → 历史证据</p></div>'),layoutNode('div','oiMarketCapRadar',''));
  for(const [id,host,loader] of [['fund','toolFund',fdLoad],['heat','toolHeat',mgLoad]]){
    const el=$('#v-'+id);el.className='tool-panel';$('#'+host).append(el);
    $('#'+host).ontoggle=()=>{if($('#'+host).open)loader()};
  }
  $('#rtTbl').addEventListener('click',e=>{const a=e.target.closest('a[data-sym]');if(a)jumpSym(a.dataset.sym)});
  $$('#opTabs button').forEach(b=>b.onclick=()=>{layoutOp(b.dataset.op);$('#main').scrollTop=0});
  const back=layoutNode('button','detailBack','‹ 返回');back.className='btn mini';back.hidden=true;back.onclick=layoutBack;$('#hdr').insertBefore(back,$('#hdr .logo'));
  // Show execution controls first; put historical quadrant evidence behind a fold.
  const card=$('#v-signal .card'),execution=$('#idToggle').parentElement.parentElement;
  const evidence=layoutNode('details','signalEvidence','<summary>历史象限证据 <span>展开扫描、胜率与统计</span></summary>');evidence.className='fold';
  [...card.childNodes].forEach(n=>{if(n!==execution)evidence.append(n)});
  card.append(execution,evidence);execution.style.borderTop='none';execution.style.marginTop='0';execution.style.paddingTop='0';
  $('#fdStat').insertAdjacentHTML('afterend','<div class="banner" id="fdBan"></div>');
  layoutOp('strong');layoutFavoritesChanged(false);layoutNavigate('market');
}
