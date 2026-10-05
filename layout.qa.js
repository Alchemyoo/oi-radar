/* Run in browser console: await (await fetch('layout.qa.js')).text().then(eval) */
(async()=>{
 const out=[],check=(name,ok)=>{out.push({name,ok:!!ok});if(!ok)throw Error(name)};
 const saved={fav:[...S.fav],list:{q:S.ov.q,page:S.ov.page,sort:S.ov.sort,dir:S.ov.dir},view:Layout.current,op:Layout.op};
 try{
  check('3 primary entries',$$('#tabbar button').length===3);
  check('market loaded',S.ov.list.length>0);
  check('unique IDs',$$('[id]').every((e,i,a)=>a.findIndex(x=>x.id===e.id)===i));
  check('correct market header',$('#ovTitle').contains($('#ovCount')));
  check('correct radar header',$('#rtCard h3').textContent.startsWith('实时 OI 雷达'));
  check('no automatic monitoring',!S.rt.on&&!S.id.on);
  S.fav.clear();saveFav();layoutNavigate('watch');
  check('watch compatibility uses market',Layout.current==='market'&&S.ov.favOnly);rtToggle(true);
  check('empty radar blocked',!S.rt.on);
  layoutNavigate('market');S.ov.favOnly=false;S.ov.q='BTC';S.ov.page=1;ovRender();
  S.fav.add('ETHUSDT');saveFav();layoutNavigate('watch');
  check('favorite filter retains market search',S.ov.q==='BTC');S.ov.q='';$('#ovSearch').value='';ovRender();
  check('only favorites',ovFiltered().length===1&&ovFiltered()[0].sym==='ETHUSDT');
  check('favorite title',$('#ovTitle').textContent.startsWith('收藏行情'));
  check('automatic radar enrollment',S.rt.last.has('ETHUSDT'));
  S.ov.favOnly=false;S.ov.q='BTC';Layout.lists.market.q='BTC';layoutNavigate('market');check('market search retained',S.ov.q==='BTC'&&!S.ov.favOnly);
  layoutNavigate('opportunity');
  for(const k of ['strong','scan']){layoutOp(k);check(k+' exclusive visibility',['strong','scan'].every(x=>$('#v-'+x).hidden===(x!==k)))}
  layoutNavigate('signal');check('signal is primary',Layout.current==='signal'&&$('#v-signal').classList.contains('on'));check('radar host exists',!!$('#oiMarketCapRadar'));
  layoutNavigate('detail');layoutBack();check('detail returns to signal',Layout.current==='signal');
  check('evidence folded',!$('#signalEvidence').open&&$('#signalEvidence').contains($('#qdTbl')));
  check('execution first',$('#v-signal .card').firstElementChild.contains($('#idToggle')));
  layoutNavigate('opportunity');layoutOp('scan');$('#main').scrollTop=120;const y=$('#main').scrollTop;
  layoutNavigate('detail');check('detail source',Layout.returnTo.view==='opportunity'&&Layout.returnTo.op==='scan');
  layoutBack();check('source and scroll restored',Layout.current==='opportunity'&&Layout.op==='scan'&&$('#main').scrollTop===y);
  layoutNavigate('watch');S.fav.clear();saveFav();
  check('remove last favorite clears monitoring',!S.rt.last.size&&!S.rt.rows.length);
  for(let i=0;i<20;i++)layoutNavigate(['market','signal','opportunity'][i%3]);
  check('repeated switching preserves DOM',$$('[id]').every((e,i,a)=>a.findIndex(x=>x.id===e.id)===i));
  const originalJget=fetchX;let resolve;let requests=0;
  try{
   S.fav.add('ETHUSDT');saveFav();S.rt.on=true;
   fetchX=()=>{requests++;return new Promise(r=>resolve=r)};
   const p=rtPoll();await rtPoll();check('radar in-flight lock',requests===1);
   rtToggle(false);resolve({openInterest:'100'});await p;
   check('pause discards old response',S.rt.last.get('ETHUSDT')===0&&!S.rt.hist.size);
   S.rt.on=true;fetchX=async()=>({openInterest:'100'});await rtPoll();
   check('first sample accepted',S.rt.last.get('ETHUSDT')===100);
   fetchX=async()=>{throw Error('simulated network failure')};await rtPoll();
   check('transient failure keeps symbol',S.rt.last.has('ETHUSDT'));
  }finally{rtToggle(false);fetchX=originalJget}
  const oldK=loadKlines,oldD=fetchDay;let release;
  try{
   loadKlines=s=>s==='BTCUSDT'?new Promise(r=>release=r):Promise.resolve([]);
   fetchDay=async()=>[];
   $('#dtStart').value=dstr(utcToday0()-DAY);$('#dtEnd').value=dstr(utcToday0()-DAY);
   $('#dtSym').value='BTCUSDT';const a=dtLoad();
   $('#dtSym').value='ETHUSDT';await dtLoad();const cap=$('#dtCap').textContent;
   release([]);await a;
   check('rapid detail switch rejects stale result',S.dt.sym==='ETHUSDT'&&$('#dtCap').textContent===cap&&cap.includes('ETHUSDT'));
  }finally{loadKlines=oldK;fetchDay=oldD}
 }finally{
  S.fav=new Set(saved.fav);saveFav();layoutNavigate('market');Object.assign(S.ov,saved.list);$('#ovSearch').value=S.ov.q;ovRender();
  Layout.op=saved.op;
 }
 window.layoutQA=out;return {passed:out.filter(x=>x.ok).length,total:out.length,tests:out};
})()
