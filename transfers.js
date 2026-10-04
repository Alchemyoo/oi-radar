/* Standalone cache-only Transfer evidence. No scoring, guessed identity or labels. */
(function(root){
 'use strict';
 const A=/^0x[0-9a-f]{40}$/i,H=/^0x[0-9a-f]{64}$/i,U=/^(0|[1-9][0-9]{0,77})$/;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
 const integer=v=>Number.isSafeInteger(v)&&v>=0;
 const identity=(a,b)=>a&&b&&a.symbol===b.symbol&&a.chain===b.chain&&a.chainId===b.chainId&&A.test(a.address)&&A.test(b.address)&&a.address.toLowerCase()===b.address.toLowerCase();
 const direction=(from,to)=>from==='0x'+'0'.repeat(40)?'mint':to==='0x'+'0'.repeat(40)?'burn':'address_to_address';
 function rawThreshold(units,decimals){
  if(!Number.isInteger(decimals)||decimals<0||decimals>255||typeof units!=='string'||units.length>80||!/^\d+(?:\.\d+)?$/.test(units))throw Error('threshold_unknown');
  const [a,b='']=units.split('.');if(b.length>decimals)throw Error('threshold_precision');
  const n=BigInt(a)*10n**BigInt(decimals)+BigInt((b+'0'.repeat(decimals)).slice(0,decimals)||'0');
  if(n<=0n||n>=2n**256n)throw Error('invalid_threshold');return n;
 }
 function amount(raw,d){const s=BigInt(raw).toString().padStart(d+1,'0');return d?(s.slice(0,-d)+'.'+s.slice(-d)).replace(/\.?0+$/,''):s}
 function validate(data,token){
  const r=data?.tokens?.[token?.symbol];
  if(data?.schemaVersion!==1||!identity(r?.identity,token))throw Error('identity_or_schema_mismatch');
  if(!['ok','unknown','unavailable'].includes(r.status)||!Array.isArray(r.events)||r.events.length>50)throw Error('invalid_status');
  if(r.status!=='ok'){if(r.events.length)throw Error('unavailable_with_events');return r}
  const c=r.coverage,t=r.threshold;
  if(!time(r.fetchedAt)||!c||!integer(c.fromBlock)||!integer(c.toBlock)||c.fromBlock>c.toBlock||c.toBlock-c.fromBlock>=2000||c.complete!==true||!integer(c.matchedCount)||typeof c.displayTruncated!=='boolean'||!time(c.fromTime)||!time(c.toTime)||Date.parse(c.fromTime)>Date.parse(c.toTime)||!t||t.kind!=='token_units'||t.operator!=='>='||!U.test(t.raw||''))throw Error('invalid_coverage');
  const threshold=rawThreshold(t.units,r.decimals);
  if(threshold.toString()!==t.raw||!r.decimalsSource||r.decimalsSource.method!=='eth_call:decimals()'||r.decimalsSource.blockNumber!==c.toBlock||!H.test(r.decimalsSource.blockHash))throw Error('invalid_decimals_or_threshold');
  const seen=new Set();
  for(const e of r.events){
   if(!e||!H.test(e.txHash)||!H.test(e.blockHash)||!integer(e.blockNumber)||e.blockNumber<c.fromBlock||e.blockNumber>c.toBlock||!integer(e.logIndex)||!A.test(e.from)||!A.test(e.to)||!U.test(e.rawAmount||'')||BigInt(e.rawAmount)>=2n**256n||BigInt(e.rawAmount)<threshold||!time(e.eventTime)||Date.parse(e.eventTime)<Date.parse(c.fromTime)||Date.parse(e.eventTime)>Date.parse(c.toTime)||e.direction!==direction(e.from.toLowerCase(),e.to.toLowerCase()))throw Error('invalid_event');
   const key=e.txHash.toLowerCase()+':'+e.logIndex;if(seen.has(key))throw Error('duplicate_event');seen.add(key);
  }
  if(c.matchedCount<r.events.length||(!c.displayTruncated&&c.matchedCount!==r.events.length)||(c.displayTruncated&&c.matchedCount<=r.events.length))throw Error('invalid_count');
  return r;
 }
 function state(r,now=Date.now()){
  if(!r)return 'unavailable';if(r.status==='unknown')return 'unknown';if(r.status!=='ok')return 'unavailable';
  const age=now-Date.parse(r.fetchedAt),endAge=now-Date.parse(r.coverage?.toTime);return !Number.isFinite(age)||!Number.isFinite(endAge)||age< -300000||endAge< -300000?'unavailable':age>90*60000||endAge>90*60000?'stale':'ok';
 }
 function render(data,token,now=Date.now()){
  let r=null,error='';try{r=validate(data,token)}catch(e){error=e.message}
  const s=state(r,now),head='<h3>大额 Transfer 事件证据</h3>',note='<p>转账不是买卖、交易所净流入或资金流。地址标签未知；USD 估值未知。不参与合约评分。</p>';
  if(!token)return head+'<p>未知：未接入已核实链与合约，不按名称匹配。</p>'+note;
  if(s==='unknown'||s==='unavailable')return head+'<p>'+esc(s==='unknown'?'未知：decimals 或数量阈值未核实':'不可用：没有完整有效的日志缓存')+' · '+esc(error||r?.reason||'not_collected')+'</p>'+note;
  const c=r.coverage,explorer=token.chainId===56?'https://bscscan.com':null;
  const link=(path,value)=>explorer?'<a target="_blank" rel="noopener noreferrer" href="'+explorer+'/'+path+'/'+encodeURIComponent(value)+'">'+esc(value)+'</a>':esc(value);
  let html=head+'<p>'+esc(s==='stale'?'旧快照：仅供历史参考':'RPC 缓存：单一公共节点返回，未独立交叉核验')+'</p><p>'+esc(token.symbol)+' · chainId '+esc(token.chainId)+' · '+esc(token.address)+'</p><p>数量过滤 ≥ '+esc(r.threshold.units)+' tokens；decimals '+r.decimals+'（区块 '+r.decimalsSource.blockNumber+' eth_call 核实）。不是 USD 大额标准。</p><p>区块 '+c.fromBlock+'–'+c.toBlock+'；'+esc(c.fromTime)+'–'+esc(c.toTime)+'。抓取 '+esc(r.fetchedAt)+'；20 区块缓冲，不保证最终性。</p><p>范围内满足阈值 '+c.matchedCount+' 个事件'+(c.displayTruncated?'；仅显示最近 50 个':'')+'。不代表全链或 1h 覆盖。</p>';
  if(!r.events.length)html+='<p>完整查询范围内无满足该数量阈值的事件；不是全链“无大额转账”。</p>';
  else html+='<div style="overflow:auto"><table><thead><tr><th>数量 / 方向</th><th>From → To（标签未知）</th><th>交易哈希 / logIndex / 时间</th></tr></thead><tbody>'+r.events.map(e=>'<tr><td>'+esc(amount(e.rawAmount,r.decimals))+'<br>'+esc({mint:'零地址发出（mint 形式）',burn:'转至零地址（burn 形式）',address_to_address:'地址 → 地址（用途未知）'}[e.direction])+'</td><td>'+link('address',e.from)+'<br>→ '+link('address',e.to)+'</td><td>'+link('tx',e.txHash)+' #'+e.logIndex+'<br>'+esc(e.eventTime)+'</td></tr>').join('')+'</tbody></table></div>';
  return html+note;
 }
 const Core={rawThreshold,amount,validate,state,render};
 if(typeof module!=='undefined'&&module.exports){module.exports=Core;return}root.TransferEvidence=Core;
 // Optional integration hook. Caller supplies an exact registry identity; cache read only.
 root.mountTransferEvidence=async function(element,token){
  element.innerHTML='<p>读取 Transfer 缓存…</p>';
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),10000);
  try{const response=await fetch('data/transfers.json',{signal:ctl.signal,cache:'no-store'});if(!response.ok)throw Error('cache_unavailable');const text=await response.text();if(text.length>2000000)throw Error('cache_too_large');element.innerHTML=render(JSON.parse(text),token)}
  catch(_){element.innerHTML=render(null,token)}finally{clearTimeout(timer)}
 };
})(globalThis);
