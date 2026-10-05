#!/usr/bin/env python3
"""Official Binance history -> explicit fresh JSON cache. No keys/proxy."""
import argparse, concurrent.futures, datetime as dt, json, math, time, urllib.request, urllib.error, urllib.parse
from pathlib import Path
BASE='https://www.binance.com'
IDS={'BTC':'bitcoin','ETH':'ethereum','BNB':'binancecoin','SOL':'solana','XRP':'ripple','DOGE':'dogecoin','ADA':'cardano','AVAX':'avalanche-2','LINK':'chainlink','DOT':'polkadot','LTC':'litecoin','BCH':'bitcoin-cash','TRX':'tron','UNI':'uniswap','AAVE':'aave','SUI':'sui','APT':'aptos','NEAR':'near','ATOM':'cosmos','ETC':'ethereum-classic','FIL':'filecoin','OP':'optimism','ARB':'arbitrum','INJ':'injective-protocol','SEI':'sei-network','TON':'the-open-network','WLD':'worldcoin-wld','ORCA':'orca','AXS':'axie-infinity','GTC':'gitcoin'}
def get(url):
 req=urllib.request.Request(url,headers={'User-Agent':'OI-Radar-cache/1.0','Accept':'application/json'})
 with urllib.request.urlopen(req,timeout=18) as r:return json.load(r)
def valid(v):return isinstance(v,(float,int)) and math.isfinite(v)
def select_end(rows,clock):
 ends=[int(x['timestamp']) for x in rows if isinstance(x,dict) and valid(x.get('timestamp')) and 0<int(x['timestamp'])<=clock//300000*300000]
 if not ends:raise ValueError('No published historical endpoint')
 end=max(ends)
 if clock-end>600000:raise ValueError('Official publication lag exceeds 10 minutes')
 return end
def calculate(rows,start,end):
 def at(t):
  a=[x for x in rows if int(x.get('timestamp',0))==t]
  if len(a)!=1:raise ValueError('Exact 1H endpoint missing or duplicate')
  return a[0]
 a,b=at(start),at(end);v=[float(a['sumOpenInterest']),float(b['sumOpenInterest']),float(b['sumOpenInterestValue'])]
 if not all(math.isfinite(x) and x>0 for x in v):raise ValueError('Invalid OI')
 growth=(v[1]/v[0]-1)*100
 if not math.isfinite(growth):raise ValueError('Invalid change')
 return {'growth':growth,'notional':v[2],'coinStart':v[0],'coinEnd':v[1]}
def collect(limit):
 clock=int(get(BASE+'/fapi/v1/time')['serverTime']);ex=get(BASE+'/fapi/v1/exchangeInfo')
 syms={x['symbol'] for x in ex['symbols'] if x.get('status')=='TRADING' and x.get('contractType')=='PERPETUAL' and x.get('quoteAsset')=='USDT'}
 tick=get(BASE+'/fapi/v1/ticker/24hr');universe=sorted([x for x in tick if x.get('symbol') in syms],key=lambda x:float(x['quoteVolume']),reverse=True)[:limit]
 def hist(sym):return get(BASE+'/futures/data/openInterestHist?symbol='+urllib.parse.quote(sym,safe='')+'&period=5m&limit=16')
 anchor=hist('BTCUSDT');end=select_end(anchor,clock);start=end-3600000
 ids=list({IDS[x['symbol'][:-4]] for x in universe if x['symbol'][:-4] in IDS})
 cap_error='';caps={}
 try:
  if ids:caps=get('https://api.coingecko.com/api/v3/simple/price?ids='+','.join(sorted(ids))+'&vs_currencies=usd&include_market_cap=true&include_last_updated_at=true')
 except Exception as e:cap_error=type(e).__name__+': '+str(e)
 rows=[];errors=[];halt=False
 def one(item):
  sym=item['symbol'];data=anchor if sym=='BTCUSDT' else hist(sym);r=calculate(data,start,end);base=sym[:-4];asset=IDS.get(base);cap=caps.get(asset,{})
  try:m=float(cap.get('usd_market_cap',0));t=float(cap.get('last_updated_at',0))*1000
  except (ValueError,TypeError):m,t=0,0
  now=int(time.time()*1000);ok=math.isfinite(m) and m>0 and 0<t<=now+60000 and now-t<=900000
  r.update(sym=sym,ratio=r['notional']/m*100 if ok else None,marketCap=m if ok else None,capTime=t if ok else None,capId=asset,source='Binance openInterestHist')
  return r
 # bounded batches allow stopping after HTTP429/418 without resubmitting the full universe
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  for i in range(0,len(universe),3):
   if halt:break
   futs=[(x['symbol'],pool.submit(one,x)) for x in universe[i:i+3]]
   for sym,f in futs:
    try:rows.append(f.result())
    except Exception as e:
     errors.append({'sym':sym,'reason':type(e).__name__+': '+str(e)})
     if isinstance(e,urllib.error.HTTPError) and e.code in (429,418):halt=True
 generated=int(time.time()*1000)
 if generated-end>900000:raise ValueError('Collection ended with stale endpoint; refusing cache')
 return {'schemaVersion':1,'generatedAt':generated,'expiresAt':min(generated+900000,end+900000),'serverTime':clock,'window':{'start':start,'end':end},'publicationLagMs':clock-end,'scope':{'type':'quoteVolumeTop','limit':limit,'symbols':[x['symbol'] for x in universe]},'sources':{'oi':'https://www.binance.com/futures/data/openInterestHist','marketCap':'https://api.coingecko.com/api/v3/simple/price','capIdentity':'explicit vetted ID registry; unmapped excluded'},'rows':rows,'errors':errors,'capError':cap_error,'stoppedForRateLimit':halt}
def main():
 p=argparse.ArgumentParser();p.add_argument('--limit',type=int,choices=[5,10,50,100],default=50);p.add_argument('--output',type=Path,required=True);a=p.parse_args();d=collect(a.limit)
 a.output.parent.mkdir(parents=True,exist_ok=True);tmp=a.output.with_suffix('.tmp');tmp.write_text(json.dumps(d,ensure_ascii=False,indent=2));tmp.replace(a.output)
 print(json.dumps({'output':str(a.output),'total':len(d['scope']['symbols']),'validOi':len(d['rows']),'validMarketCap':sum(x['ratio'] is not None for x in d['rows']),'failed':len(d['errors']),'capError':d['capError'],'window':d['window'],'generatedAt':d['generatedAt']},ensure_ascii=False))
if __name__=='__main__':main()
