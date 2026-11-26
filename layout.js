/* Workspaces & navigation; move existing nodes so IDs, data and bound events survive. */
'use strict';
const Layout={current:'market',op:'strong',returnTo:null,lastPrimary:'decide',scroll:{},lists:{market:{q:'',page:1,sort:'vol',dir:-1}}};
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
function layoutSyncWatchBtn(){
  const btn=$('#hdrWatchBtn');if(!btn)return;
  const n=S.fav?S.fav.size:0;
  const live=!!(S.rt&&S.rt.on);
  btn.classList.toggle('on',Layout.current==='market');
  btn.classList.toggle('live',live);
  btn.innerHTML=(live?'📡 ':'⭐ ')+'自选'+(n?`(${n})`:'')+'/费率';
}
function layoutOp(k){
  if(!['strong','scan'].includes(k))k='strong';
  Layout.op=k;
  for(const id of ['strong','scan'])$('#v-'+id).hidden=id!==k;
  $$('#opTabs button').forEach(b=>{const on=b.dataset.op===k;b.classList.toggle('on',on);b.setAttribute('aria-selected',String(on))});
  $('#opHelp').textContent={strong:'先找跑赢 BTC 的币（支持 ⚡极速扫主流），再点币种进入单币作战室。',scan:'寻找持仓变化异常、价格尚未明显跟随的币（支持 ⚡直连扫描兜底）。',signal:'结合价格与持仓验证方向；日内监测默认关闭。'}[k];
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
  if(!['market','decide','opportunity','stock','signal','evidence','whale','cg','detail'].includes(v))return;
  layoutSaveList();Layout.scroll[Layout.current]=$('#main').scrollTop;
  if(['decide','opportunity','stock','cg','whale'].includes(v))Layout.lastPrimary=v;
  if(v==='detail'&&Layout.current!=='detail')Layout.returnTo={view:Layout.current,op:Layout.op,scroll:$('#main').scrollTop};
  Layout.current=v;
  for(const id of ['market','decide','opportunity','stock','signal','evidence','whale','cg','detail'])$('#v-'+id).classList.toggle('on',id===v);
  const active=v==='detail'?(Layout.returnTo?.view||'market'):(v==='market'?Layout.lastPrimary:v);
  $$('#tabbar button').forEach(b=>{const on=b.dataset.v===active&&v!=='market';b.classList.toggle('on',on);b.setAttribute('aria-current',on?'page':'false')});
  $('#hdr h1').textContent=v==='detail'?'单币作战室':(v==='decide'?'实战交易决策总台':(v==='market'?'自选雷达 · 资金费率':(v==='stock'?'币安股票合约':(v==='whale'?'巨鲸持仓':(v==='cg'?'清算与资金':'OI 雷达')))));
  $('#detailBack').hidden=v!=='detail';
  layoutSyncWatchBtn();
  $('#main').scrollTop=restore?(Layout.scroll[v]||0):0;
  if(v==='market')layoutList(v);
  if(v==='decide'&&typeof decideInit==='function')decideInit();
  if(v==='opportunity'){layoutOp(Layout.op);if(typeof resScreenerInit==='function')resScreenerInit()}
  if(v==='stock'&&typeof stockInit==='function')stockInit();
  if(v==='whale'&&typeof whaleInit==='function')whaleInit();
  if(v==='cg'&&typeof cgInit==='function')cgInit();
  if(v==='detail'){setTimeout(dtChartRender,60);if(typeof dtTacticalDraw==='function')setTimeout(dtTacticalDraw,60)}
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
  layoutSyncWatchBtn();
  rtBuild();if(render){ovMeta();ovRender();if(S.fd.rows)fdRender()}
}
function layoutInit(){
  const main=$('#main');
  const market=layoutNode('section','v-market','<div class="workspace-heading"><h2>自选雷达与全市场费率</h2><p>60秒高频自选OI盯盘 · 全市场资金费率与基差极值</p></div><div class="row" style="margin-bottom:10px;gap:6px"><button type="button" class="btn mini pri" id="mkQuickWatch">📡 展开60s自选雷达</button><button type="button" class="btn mini" id="mkQuickFund">💰 展开全市场资金费率榜</button><button type="button" class="btn mini" id="mkBackPrimary" style="margin-left:auto">‹ 返回主视图</button></div><div id="marketListHost"></div><details id="marketTools" class="fold" open><summary>辅助数据 <span>自选雷达 · 资金费率 · 热度</span></summary><div class="fold-body"><details id="toolFund" class="fold"><summary>资金费率 <span>看多空持仓成本与结算倒计时</span></summary></details><details id="toolHeat" class="fold"><summary>热度 / 清算 <span>MegaGlass · 外部数据</span></summary></details></div></details>');
  market.className='view';main.prepend(market);
  const decide=layoutNode('section','v-decide','<div class="workspace-heading"><h2>今日实战交易决策单</h2><p>直接给出：买什么 · 做多/做空 · 入场价 · 严格止损SL · 分批止盈TP1/TP2 · 建议仓位</p></div><div id="decideHost"></div>');
  decide.className='view';main.append(decide);
  const op=layoutNode('section','v-opportunity','<div class="workspace-heading"><h2>机会</h2><p>跨源客观共振战法池 → 强势选币 → 滚动持仓异动</p></div><details id="opResFold" class="fold" open><summary>多维客观共振战法池 <span>秒级联查：OI/市值 × 实时费率 × 24h爆仓 × 强弱</span></summary><div id="opResHost" class="fold-body"></div></details><div class="workspace-tabs seg" id="opTabs" role="tablist" aria-label="机会分析方式"><button class="on" data-op="strong" role="tab">强势选币</button><button data-op="scan" role="tab">持仓异动</button></div><p class="workspace-help" id="opHelp"></p>');
  op.className='view';main.append(op);
  const watch=layoutNode('details','marketWatch','<summary>收藏 OI 雷达 <span>手动开启 · 仅收藏币种 · 支持声音提醒</span></summary>');watch.className='fold';watch.open=true;$('#marketTools .fold-body').prepend(watch);
  $('#v-overview').className='market-panel';
  watch.append($('#rtCard'));rtShowCard();
  $('#v-overview h3').id='ovTitle';
  $('#rtLoadFav').textContent='重置采样';
  const hint=layoutNode('p','rtHint','只监测自选币种；手动开启，每 60 秒采样，切页后继续，暂停即停止。');hint.className='workspace-help';$('#rtCard').append(hint);
  for(const id of ['strong','scan']){const el=$('#v-'+id);el.className='op-panel';op.append(el)}
  const signal=$('#v-signal');signal.className='view';signal.hidden=false;main.append(signal);
  signal.prepend(layoutNode('div','signalHeading','<div class="workspace-heading"><h2>信号</h2><p>OI榜单与操作建议 · 日内观察</p></div>'),layoutNode('div','oiMarketCapRadar',''));
  /* 拆分：信号页保留OI榜单+日内执行；历史象限证据整体迁出为独立页面 */
  const card=$('#v-signal .card'),execution=$('#idToggle').parentElement.parentElement;
  const execCard=layoutNode('div','signalExecPanel','');execCard.className='card';execCard.append(execution);
  signal.append(execCard);
  /* 历史象限证据独立页面：迁出全部象限内容与统计表 */
  const evidenceView=layoutNode('section','v-evidence','');evidenceView.className='view';
  evidenceView.innerHTML='<div class="workspace-heading"><h2>历史象限证据</h2><p>条件统计，非胜率</p></div>';
  card.id='signalQuadPanel';evidenceView.append(card);main.append(evidenceView);
  /* 股票与传统金融合约独立工作区（Binance TRADIFI_PERPETUAL） */
  const stock=layoutNode('section','v-stock','<div class="workspace-heading"><h2>股票与传统金融合约</h2><p>币安 24/7 美股 · AI半导体 · 杠杆ETF · 独角兽 · 商品永续</p></div>');
  stock.className='view';main.append(stock);
  stock.append(layoutNode('div','stockHost',''));
  /* 巨鲸持仓独立页面：Hyperliquid 大户快照（hl-whale-collector.py 每小时产出） */
  const whale=layoutNode('section','v-whale','<div class="workspace-heading"><h2>巨鲸持仓</h2><p>Hyperliquid 大户 · 每小时快照</p></div>');
  whale.className='view';main.append(whale);
  whale.append(layoutNode('div','whaleHost',''));
  /* 清算：Coinglass 全币种快照（爆仓 · ETF · 情绪 · 费率） */
  const cg=layoutNode('section','v-cg','<div class="workspace-heading"><h2>清算与资金</h2><p>Coinglass · 24h 爆仓 · ETF · 情绪</p></div>');
  cg.className='view';main.append(cg);
  cg.append(layoutNode('div','cgHost',''));
  execution.style.borderTop='none';execution.style.marginTop='0';execution.style.paddingTop='0';
  for(const [id,host,loader] of [['fund','toolFund',fdLoad],['heat','toolHeat',mgLoad]]){
    const el=$('#v-'+id);el.className='tool-panel';$('#'+host).append(el);
    $('#'+host).ontoggle=()=>{if($('#'+host).open)loader()};
  }
  $('#rtTbl').addEventListener('click',e=>{const a=e.target.closest('a[data-sym]');if(a)jumpSym(a.dataset.sym)});
  const tb=$('#tabbar');if(tb)tb.onclick=e=>{const b=e.target.closest('button[data-v]');if(b)layoutNavigate(b.dataset.v)};
  $$('#opTabs button').forEach(b=>b.onclick=()=>{layoutOp(b.dataset.op);$('#main').scrollTop=0});
  const back=layoutNode('button','detailBack','‹ 返回');back.className='btn mini';back.hidden=true;back.onclick=layoutBack;$('#hdr').insertBefore(back,$('#hdr .logo'));
  const wbtn=layoutNode('button','hdrWatchBtn','⭐ 自选/费率');wbtn.className='hdr-watch-btn';
  wbtn.onclick=()=>{
    if(Layout.current==='market')layoutNavigate(Layout.lastPrimary||'opportunity',true);
    else{
      S.ov.favOnly=S.fav.size>0;
      layoutNavigate('market');
      $('#marketTools').open=true;$('#marketWatch').open=true;
    }
  };
  $('#hdr').insertBefore(wbtn,$('#netDot'));
  $('#mkQuickWatch').onclick=()=>{$('#marketTools').open=true;$('#marketWatch').open=true;$('#marketWatch').scrollIntoView({behavior:'smooth'})};
  $('#mkQuickFund').onclick=()=>{$('#marketTools').open=true;$('#toolFund').open=true;fdLoad();$('#toolFund').scrollIntoView({behavior:'smooth'})};
  $('#mkBackPrimary').onclick=()=>layoutNavigate(Layout.lastPrimary||'opportunity',true);
  $('#fdStat').insertAdjacentHTML('afterend','<div class="banner" id="fdBan"></div>');
  if(typeof smcMount==='function')smcMount();
  layoutOp('strong');layoutFavoritesChanged(false);layoutList('market');layoutNavigate('decide');
}
