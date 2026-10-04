/* Test preview only; mutates list state, never runs chain collection or contract scans. */
(async()=>{
 const results=[],check=(name,ok)=>{results.push({name,ok:!!ok});if(!ok)throw Error(name)};
 await onchainLoad();
 const old={fav:[...S.fav],rows:Onchain.rows,registry:Onchain.registry,q:S.ov.q,only:{...Onchain.only},sym:S.dt.sym,fetch:window.fetch};
 try{
  check('three entries unchanged',$$('#tabbar button').length===3);
  check('three verified pilots',Onchain.registry.length===3);
  check('three current snapshots',Onchain.registry.every(t=>OnchainCore.freshness(Onchain.rows[t.symbol])==='fresh'));
  check('no background contract scans',!S.rt.on&&!S.id.on&&!S.st.run&&!S.sc.run);
  check('detail evidence defaults folded',!$('#ocDetail').open);
  check('cache uses original contract identity',Onchain.registry.every(t=>OnchainCore.identity(Onchain.rows[t.symbol].identity,t)));
  layoutNavigate('market');S.ov.q='';$('#ovSearch').value='';Onchain.only.market=true;ovRender();onchainRender();
  check('pilot-only filtering',ovFiltered().length===3&&ovFiltered().every(r=>Onchain.registry.some(t=>t.symbol===r.sym)));
  onchainDecorate();check('pilot table badges',$$('#ovTbl .oc-badge').length===3);
  S.fav.add('BTCUSDT');saveFav();layoutNavigate('watch');check('watch filter independent',!Onchain.only.watch&&ovFiltered().some(r=>r.sym==='BTCUSDT'));
  layoutNavigate('market');check('market filter restored',Onchain.only.market&&ovFiltered().length===3);
  dtSetSym('龙虾USDT');layoutNavigate('detail');$('#ocDetail').open=true;onchainRender();
  check('lobster exact contract',$('#ocDetailBody').textContent.includes('0xeccbb861c0dda7efd964010085488b69317e4444'));
  check('real metrics shown',$$('.oc-metrics b').some(e=>e.textContent.includes('$')));
  check('USD flow not fabricated',$('#ocDetailBody').textContent.includes('买卖金额差额暂无'));
  check('holders unavailable',$('#ocDetailBody').textContent.includes('Top10 集中度：暂无'));
  check('timestamp and source disclosed',$('#ocDetailBody').textContent.includes('未提供底层数据更新时间'));
  check('first sample no fake change',$('#ocDetailBody').textContent.includes('等待可比快照')||Onchain.rows['龙虾USDT'].liquidityBaselineAt);
  dtSetSym('MUBARAKUSDT');check('missing liquidity coverage disclosed',$('#ocDetailBody').textContent.includes('总额暂无，未披露不补零')||Onchain.rows.MUBARAKUSDT.liquidityUsd!==null);
  dtSetSym('BTCUSDT');check('unmapped coin not guessed',$('#ocDetailBody').textContent.includes('不按名称自动匹配')&&!$('#ocDetailBody').textContent.includes('0xeccbb'));
  const sym='龙虾USDT',r=Onchain.rows[sym];dtSetSym(sym);
  Onchain.rows={...Onchain.rows,[sym]:{...r,status:'stale'}};onchainRender();check('stale data neutral',OnchainCore.evidence(Onchain.rows[sym]).kind==='neutral'&&$('#ocDetailBody').textContent.includes('旧快照'));
  Onchain.rows=old.rows;window.fetch=async()=>{throw Error('simulated offline')};await onchainLoad(true);
  check('failed cache reload preserves old rows',Object.keys(Onchain.rows).length===3);
  check('failed cache reload marks stale',Object.values(Onchain.rows).every(x=>x.status==='stale'));
  window.fetch=old.fetch;await onchainLoad(true);check('cache recovers',!Onchain.error&&OnchainCore.freshness(Onchain.rows[sym])==='fresh');
  const table=$('#scTbl tbody'),prior=table.innerHTML;
  table.innerHTML='<tr><td><a data-sym="龙虾USDT">龙虾</a></td></tr>';onchainDecorate();
  check('opportunity evidence attached',table.querySelector('.oc-badge')?.textContent===OnchainCore.evidence(Onchain.rows[sym]).text);table.innerHTML=prior;
  check('unique DOM identifiers',$$('[id]').every((e,i,a)=>a.findIndex(x=>x.id===e.id)===i));
 }finally{
  window.fetch=old.fetch;S.fav=new Set(old.fav);saveFav();Onchain.only={market:false,watch:false};layoutNavigate('market');S.ov.q='';$('#ovSearch').value='';dtSetSym(old.sym);$('#ocDetail').open=false;ovRender();onchainRender();
 }
 window.onchainQA=results;return {passed:results.filter(x=>x.ok).length,total:results.length,tests:results};
})()
