#!/usr/bin/env python3
"""Alpha card snapshot -> explicit fresh JSON cache. Public endpoints only.

Universe: Binance Alpha tokens whose cexCoinName trades as a Binance USDT perpetual.
Per coin: Alpha list stats + bapi hourly OI trend + fapi 15m klines (+ Gate borrow book).
Verdict score is our own transparent formula (NOT the source bot's algorithm).
"""
import argparse, concurrent.futures, http.client, json, math, time, urllib.request, urllib.error
from pathlib import Path

ALPHA_LIST='https://www.binance.com/bapi/defi/v1/public/wallet-direct/buw/wallet/cex/alpha/all/token/list'
ALPHA_OI='https://www.binance.com/bapi/apex/v1/public/apex/marketing/web/alpha/open-interest-trend'
FAPI='https://fapi.binance.com'
GATE='https://api.gateio.ws/api/v4/margin/funding_book'
UA={'User-Agent':'oi-radar-cache/1.0','Accept':'application/json'}

def _repair(b):
    # Truncated JSON: drop the last incomplete element, close open brackets.
    if not b: return b
    s=b.decode('utf8','ignore')
    i=s.rfind('}')
    if i<0: return b''
    s=s[:i+1]
    stack=[];in_str=False;esc=False
    for ch in s:
        if in_str:
            if esc: esc=False
            elif ch=='\\': esc=True
            elif ch=='"': in_str=False
        elif ch=='"': in_str=True
        elif ch in '{[': stack.append(ch)
        elif ch in '}]' and stack: stack.pop()
    return (s+''.join('}' if c=='{' else ']' for c in reversed(stack))).encode()

def get(url, retries=4, timeout=20):
    last=None
    for i in range(retries):
        try:
            req=urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except http.client.IncompleteRead as e:
            for cand in (e.partial, _repair(e.partial)):
                try:
                    return json.loads(cand)
                except Exception:
                    pass
            last=e; time.sleep(1.5*(i+1))
        except urllib.error.HTTPError as e:
            if e.code in (429,418,400): time.sleep(2*(i+1)); last=e; continue
            raise
        except Exception as e:
            last=e; time.sleep(1.5*(i+1))
    raise last

def num(x, nd=None):
    try: v=float(x)
    except (TypeError,ValueError): return None
    if not math.isfinite(v): return None
    return round(v, nd) if nd is not None else v

def verdict(dP1h, dP15m, dOi1hPct, dOi1hUsd, volX, gateRate):
    if dP1h is None: return None
    score=50.0
    if dP1h>=1.5: score+=12
    elif dP1h>=0.5: score+=8
    elif dP1h<=-1.5: score-=12
    elif dP1h<=-0.5: score-=8
    oi_up = dOi1hPct is not None and dOi1hPct>=2 and (dOi1hUsd is None or dOi1hUsd>=500_000)
    oi_dn = dOi1hPct is not None and dOi1hPct<=-2 and (dOi1hUsd is None or abs(dOi1hUsd)>=500_000)
    if oi_up: score+=8
    if oi_dn: score-=8
    up=(dP1h or 0)>0
    if oi_up and up: score+=10; quad='价涨+OI增'
    elif oi_up and not up: score-=6; quad='价跌+OI增'
    elif oi_dn and up: score+=2; quad='价涨+OI降'
    elif oi_dn and not up: score-=2; quad='价跌+OI降'
    else: quad='—'
    if volX is not None and volX>=2:
        score+=6 if (dP15m or 0)>=0 else -6
    if gateRate is not None and gateRate>=1: score-=8
    score=max(0.0,min(100.0,score))
    label='偏多' if score>=60 else ('偏空' if score<45 else '中性')
    return {'score':int(round(score)),'label':label,'quad':quad}

def build_coin(row, fapi_meta, oi_hist_cache, gate_cache):
    ca=row.get('contractAddress'); chain=row.get('chainId'); sym=row.get('cexCoinName')
    if not ca or not sym: return None
    d={'sym':sym,'coin':row.get('symbol'),'ca':ca.lower(),'chain':chain,
       'price':num(row.get('price'),8),'pct24h':num(row.get('percentChange24h'),2),
       'vol24h':num(row.get('volume24h')),'mcap':num(row.get('marketCap')),'holders':row.get('holders')}
    # OI trend (hourly USD points)
    oi=None
    try:
        d_oi=get(ALPHA_OI+'?chainId='+chain+'&contractAddress='+ca).get('data') or {}
        pts=[(p.get('timestamp'),num(p.get('totalOi'))) for p in (d_oi.get('points') or []) if p.get('totalOi') is not None]
        pts.sort()
        if pts:
            oi=pts[-1][1]
            def chg(back):
                if len(pts)<back+1: return None,None
                prev=pts[-1-back][1]
                if not prev: return None,None
                cur=pts[-1][1]
                return round((cur/prev-1)*100,2), round(cur-prev)
            d['dOi1hPct'],d['dOi1hUsd']=chg(1)
            d['dOi4hPct'],d['dOi4hUsd']=chg(4)
    except Exception:
        d['dOi1hPct']=d['dOi1hUsd']=d['dOi4hPct']=d['dOi4hUsd']=None
    d['oi']=oi
    # fapi 15m klines
    dP1h=dP15m=dP4h=volX=None
    try:
        kl=get(FAPI+'/fapi/v1/klines?symbol='+sym+'&interval=15m&limit=40')
        cl=[float(k[4]) for k in kl]
        vols=[float(k[5]) for k in kl]
        if len(cl)>=17:
            dP15m=round((cl[-2]/cl[-3]-1)*100,2)  # last closed vs prev closed
            dP1h=round((cl[-2]/cl[-6]-1)*100,2)
        if len(cl)>=33: dP4h=round((cl[-2]/cl[-18]-1)*100,2)
        if len(vols)>=33:
            a=sum(vols[-17:-1]); b=sum(vols[-33:-17])
            if b>0: volX=round(a/b,2)
    except Exception:
        pass
    d['dP15m']=dP15m; d['dP1h']=dP1h; d['dP4h']=dP4h; d['volX']=volX
    # Gate borrow book
    gr=None; gn=0
    try:
        fb=gate_cache.setdefault(sym[:-4], get(GATE+'?currency='+sym[:-4])) or []
        if isinstance(fb,list) and fb:
            gn=len(fb); gr=min(float(x.get('rate',1e9)) for x in fb if x.get('rate') is not None)
    except Exception:
        pass
    d['gateRate']=num(gr,6) if gr is not None else None
    d['gateBook']=gn
    v=verdict(dP1h,dP15m,d.get('dOi1hPct'),d.get('dOi1hUsd'),volX,d['gateRate'])
    d['score']=v['score'] if v else None
    d['label']=v['label'] if v else None
    d['quad']=v['quad'] if v else None
    tags=[]
    if volX is not None and volX>=2: tags.append('4h 成交量异动')
    if dP15m is not None and abs(dP15m)>=1: tags.append('15m 价格异动')
    if d.get('dOi1hPct') is not None and abs(d['dOi1hPct'])>=5 and abs(d.get('dOi1hUsd') or 0)>=500_000: tags.append('1h OI 异动')
    d['tags']=tags
    return d

def perp_universe(cache_path='/tmp/fapi_perp_symbols.json'):
    # exchangeInfo is ~1.2MB and flaky over iSH; cache to disk with 6h TTL.
    try:
        import os
        if os.path.exists(cache_path) and time.time()-os.path.getmtime(cache_path)<6*3600:
            return set(json.loads(open(cache_path).read()))
    except Exception:
        pass
    ex=get(FAPI+'/fapi/v1/exchangeInfo', retries=6)
    perp={s['symbol'] for s in ex['symbols'] if s.get('status')=='TRADING' and s.get('quoteAsset')=='USDT'}
    try:
        open(cache_path,'w').write(json.dumps(sorted(perp)))
    except Exception:
        pass
    return perp

def collect(limit=80, max_age_ms=None):
    lb=get(ALPHA_LIST).get('data') or []
    perp=perp_universe()
    rows=[]
    for t in lb:
        sym=(t.get('cexCoinName') or '').upper()
        if sym and sym+'USDT' in perp: rows.append(t)
    rows.sort(key=lambda x: -float(x.get('volume24h') or 0))
    rows=rows[:limit]
    tick={}
    try:
        tick={x['symbol']:x for x in get(FAPI+'/fapi/v1/ticker/24hr')}
    except Exception:
        pass
    gate_cache={}
    out=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futs=[(r,pool.submit(build_coin,r,{},{},gate_cache)) for r in rows]
        for r,f in futs:
            try:
                d=f.result()
                if d:
                    tk=tick.get(d['sym'])
                    if tk: d['futVol24h']=num(tk.get('quoteVolume'))
                    out.append(d)
                else: print('skip', r.get('cexCoinName'))
            except Exception as e:
                print('fail', r.get('cexCoinName'), type(e).__name__, str(e)[:80])
                continue
    # second pass: transient fapi WAF 400s leave kline-derived fields null; retry serially
    rowmap={r.get('cexCoinName'):r for r in rows}
    for c in out:
        if c.get('dP1h') is None:
            time.sleep(0.8)
            r=rowmap.get(c['sym'])
            if not r: continue
            try:
                d2=build_coin(r,{},{},gate_cache)
                for k in ('dP15m','dP1h','dP4h','volX','dOi1hPct','dOi1hUsd','dOi4hPct','dOi4hUsd','score','label','quad','tags','oi'):
                    if d2 and d2.get(k) is not None and c.get(k) is None: c[k]=d2[k]
            except Exception:
                pass
    out.sort(key=lambda x: (-(abs((x['score'] or 50)-50)), -(x['vol24h'] or 0)))
    return out

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=80)
    ap.add_argument('--output', default='alpha-card-cache.json')
    a=ap.parse_args()
    coins=collect(a.limit)
    prev=None
    p=Path(a.output)
    if p.exists():
        try:
            prev=json.loads(p.read_text(encoding='utf8'))
        except Exception:
            prev=None
    prevmap={c['sym']:c for c in ((prev or {}).get('coins') or [])}
    now=int(time.time()*1000)
    for c in coins:
        hist=[]
        pc=prevmap.get(c['sym'])
        if pc: hist=list(pc.get('hist') or [])
        if c['score'] is not None:
            ent={'t':now,'s':c['score'],'l':c['label'],'q':c['quad']}
            if not hist or hist[-1].get('s')!=ent['s'] or hist[-1].get('q')!=ent['q']:
                hist.append(ent)
        c['hist']=hist[-48:]
    data={'generatedAt':now,'source':'binance-alpha+fapi+gate',
          'universe':'Alpha tokens with a Binance USDT perpetual, top-N by Alpha 24h volume',
          'note':'score/verdict is an independent formula over public price/OI/volume; smart-money holdings and Gate borrow rate are not publicly available and stay null',
          'coins':coins}
    p.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    print(f"coins={len(coins)} bytes={p.stat().st_size} at={time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(now/1000))}")

if __name__=='__main__':
    main()
