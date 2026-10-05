const ORIGIN='https://alchemyoo.github.io';
const BINANCE='https://www.binance.com';
const CG='https://api.coingecko.com/api/v3/simple/price';
const IDS={BTC:'bitcoin',ETH:'ethereum',BNB:'binancecoin',SOL:'solana',XRP:'ripple',DOGE:'dogecoin',ADA:'cardano',AVAX:'avalanche-2',LINK:'chainlink',DOT:'polkadot',LTC:'litecoin',BCH:'bitcoin-cash',TRX:'tron',UNI:'uniswap',AAVE:'aave',SUI:'sui',APT:'aptos',NEAR:'near',ATOM:'cosmos',ETC:'ethereum-classic',FIL:'filecoin',OP:'optimism',ARB:'arbitrum',INJ:'injective-protocol',SEI:'sei-network',TON:'the-open-network',WLD:'worldcoin-wld',ORCA:'orca',AXS:'axie-infinity',GTC:'gitcoin'};
const cors={ 'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin','Cache-Control':'no-store' };
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
async function json(url){const r=await fetch(url,{headers:{'Accept':'application/json','User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1','Referer':'https://www.binance.com/'}});if(!r.ok){const e=Error('HTTP '+r.status);e.status=r.status;e.upstream=new URL(url).hostname+new URL(url).pathname;throw e}return r.json()}
export default {async fetch(req,env){
 const origin=req.headers.get('Origin');if(origin!==ORIGIN)return new Response('Forbidden',{status:403});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const u=new URL(req.url);
 if(u.pathname==='/health'&&req.method==='GET')return reply({ok:true,hasToken:!!env?.GITHUB_TOKEN});
 if(u.pathname==='/status/latest'&&req.method==='GET'){const r=await fetch('https://api.github.com/repos/Alchemyoo/oi-radar/actions/workflows/oi-radar-cache.yml/runs?per_page=1',{headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'oi-radar-live'}});if(!r.ok)return reply({error:'GitHub status HTTP '+r.status},502);const d=await r.json(),x=d.workflow_runs?.[0];return reply({run:x?{id:x.id,status:x.status,conclusion:x.conclusion,event:x.event,created_at:x.created_at}:null})}
 if(u.pathname==='/status'&&req.method==='GET'){const id=Number(u.searchParams.get('run'));if(!Number.isSafeInteger(id)||id<=0)return reply({error:'run id required'},400);const r=await fetch('https://api.github.com/repos/Alchemyoo/oi-radar/actions/runs/'+id,{headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'oi-radar-live'}});if(!r.ok)return reply({error:'GitHub status HTTP '+r.status},502);const x=await r.json();return reply({run:{id:x.id,status:x.status,conclusion:x.conclusion,event:x.event,created_at:x.created_at,updated_at:x.updated_at}})}
 if(u.pathname==='/collect'&&req.method==='POST'){
  const runs=await fetch('https://api.github.com/repos/Alchemyoo/oi-radar/actions/workflows/oi-radar-cache.yml/runs?per_page=5',{headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'oi-radar-live'}});if(!runs.ok)return reply({error:'GitHub status HTTP '+runs.status},502);const current=await runs.json();if((current.workflow_runs||[]).some(r=>r.status==='queued'||r.status==='in_progress'))return reply({error:'已有采集任务运行中',run:(current.workflow_runs||[]).find(r=>r.status==='queued'||r.status==='in_progress')?.html_url},409);
  const dispatch=await fetch('https://api.github.com/repos/Alchemyoo/oi-radar/actions/workflows/oi-radar-cache.yml/dispatches',{method:'POST',headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'oi-radar-live','Content-Type':'application/json'},body:JSON.stringify({ref:'main',inputs:{limit:'50'}})});if(!dispatch.ok)return reply({error:'触发采集失败：GitHub HTTP '+dispatch.status},502);return reply({accepted:true,message:'官方OI采集已启动',limit:50,previousRunId:current.workflow_runs?.[0]?.id||0},202)
 }
 if(u.pathname!=='/collect-data'||req.method!=='POST')return reply({error:'Not found'},404);
 let body;try{body=await req.json()}catch{return reply({error:'Invalid JSON'},400)}
 const syms=body?.symbols;if(!Array.isArray(syms)||syms.length<1||syms.length>50||syms.some(s=>typeof s!=='string'||! /^[A-Z0-9]{2,24}USDT$/.test(s)))return reply({error:'symbols must be 1..50 USDT perpetual symbols'},400);
 if(new Set(syms).size!==syms.length)return reply({error:'duplicate symbols'},400);
 try{
  const [clock,exchange]=await Promise.all([json(BINANCE+'/fapi/v1/time'),json(BINANCE+'/fapi/v1/exchangeInfo')]);
  const serverTime=Number(clock.serverTime),allowed=new Set((exchange.symbols||[]).filter(x=>x.status==='TRADING'&&x.contractType==='PERPETUAL'&&x.quoteAsset==='USDT').map(x=>x.symbol));
  if(!Number.isFinite(serverTime)||syms.some(s=>!allowed.has(s)))return reply({error:'Invalid time or symbol outside active USDT perpetual universe'},400);
  const ids=[...new Set(syms.map(s=>IDS[s.slice(0,-4)]).filter(Boolean))];let caps={},capError='';
  try{if(ids.length)caps=await json(CG+'?ids='+ids.join(',')+'&vs_currencies=usd&include_market_cap=true&include_last_updated_at=true')}catch(e){capError='市值接口不可用：'+String(e.message).slice(0,120)}
  const rows=[],errors=[];let cursor=0;
  const workers=Array.from({length:Math.min(3,syms.length)},async()=>{while(cursor<syms.length){const sym=syms[cursor++];try{const data=await json(BINANCE+'/futures/data/openInterestHist?symbol='+encodeURIComponent(sym)+'&period=5m&limit=16');if(!Array.isArray(data))throw Error('invalid response');const capId=IDS[sym.slice(0,-4)]||null;rows.push({sym,samples:data.filter(x=>Number.isFinite(Number(x.timestamp))&&Number(x.sumOpenInterest)>0&&Number(x.sumOpenInterestValue)>0).map(x=>({t:Number(x.timestamp),oi:Number(x.sumOpenInterest),oiv:Number(x.sumOpenInterestValue)})),cap:caps[capId]||null,capId})}catch(e){errors.push({sym,error:String(e.message).slice(0,160)})}}});await Promise.all(workers);
  return reply({schemaVersion:1,serverTime,symbols:syms,rows,errors,capError,source:'Binance official openInterestHist; CoinGecko market cap'});
 }catch(e){return reply({error:String(e.message).slice(0,200),upstream:e.upstream||null},502)}
}};
