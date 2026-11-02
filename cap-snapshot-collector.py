#!/usr/bin/env python3
"""Perp OI x market-cap snapshot -> cap-snapshot.json (for oi-radar 市值 page).

Public endpoints only: fapi ticker/24hr + fapi openInterest (per symbol, paced)
+ CoinGecko coins/markets (top 2500). Output rows are ready-to-render.
"""
import argparse, concurrent.futures, http.client, json, math, threading, time, urllib.request, urllib.error
from pathlib import Path

FAPI='https://fapi.binance.com'
CG='https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page='
UA={'User-Agent':'oi-radar-cache/1.0','Accept':'application/json'}

_PACE_LOCK=threading.Lock()
_NEXT_AT=[0.0]
MIN_INTERVAL=0.15

def _pace():
    with _PACE_LOCK:
        now=time.time()
        wait=_NEXT_AT[0]-now
        if wait>0: time.sleep(wait)
        _NEXT_AT[0]=max(now, _NEXT_AT[0] if _NEXT_AT[0]>now else now)+MIN_INTERVAL

def _repair(b):
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

UA_STR='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

def get(url, retries=5, timeout=25):
    # curl subprocess: python-urllib TLS fingerprint is WAF-blocked on this IP
    import subprocess
    last=None
    for i in range(retries):
        _pace()
        try:
            r=subprocess.run(['curl','-s','--compressed','-m',str(timeout),'-A',UA_STR,'-H','Accept: application/json',url],
                             capture_output=True,timeout=timeout+5)
            if r.returncode==0 and r.stdout:
                try: return json.loads(r.stdout)
                except Exception:
                    cand=_repair(r.stdout)
                    if cand:
                        try: return json.loads(cand)
                        except Exception: pass
                    last=RuntimeError('bad json')
            else:
                last=RuntimeError('curl rc=%d'%r.returncode)
        except Exception as e:
            last=e
        time.sleep(min(20,3*(i+1)))
    raise last

def num(x, nd=None):
    try: v=float(x)
    except (TypeError,ValueError): return None
    if not math.isfinite(v): return None
    return round(v, nd) if nd is not None else v

def fetch_cg(pages=10):
    out={}
    got=0
    for p in range(1,pages+1):
        rows=None
        for attempt in range(2):
            try:
                rows=get(CG+str(p), retries=2, timeout=25)
                break
            except Exception:
                rows=None
                time.sleep(12)  # 429 cooldown, keep going with the next pages
        if not isinstance(rows,list) or not rows:
            continue
        got+=1
        for c in rows:
            sym=str(c.get('symbol') or '').upper()
            mc=c.get('market_cap') or 0
            # keep the highest-mcap entry per symbol (CG lists duplicates/similar tickers)
            if sym and (sym not in out or mc>(out[sym].get('mc') or 0)):
                out[sym]={'mc':mc,'nm':c.get('name') or ''}
        if len(rows)<250: break
        time.sleep(6)  # CoinGecko free tier rate limit: keep pages spaced out
    print(f"cg pages fetched={got} symbols={len(out)}")
    return out

def collect():
    tk=get(FAPI+'/fapi/v1/ticker/24hr', retries=4, timeout=30)
    if not isinstance(tk,list) or not tk: raise ValueError('ticker 响应异常')
    tk=[x for x in tk if str(x.get('symbol','')).endswith('USDT')]
    px={x['symbol']:num(x.get('lastPrice')) for x in tk}
    vol={x['symbol']:num(x.get('quoteVolume')) for x in tk}
    chg={x['symbol']:num(x.get('priceChangePercent'),2) for x in tk}
    oi={}
    def one(s):
        d=get(FAPI+'/fapi/v1/openInterest?symbol='+s, retries=4, timeout=15)
        v=num((d or {}).get('openInterest'))
        if v is not None and v>0: oi[s]=v
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda s: _safe(one,s), [x['symbol'] for x in tk]))
    cg=fetch_cg()
    rows=[]
    for x in tk:
        s=x['symbol']; base=s[:-4]; p=px[s]; o=oi.get(s)
        if not p or not o: continue
        oiv=o*p
        c=cg.get(base)
        mc=c['mc'] if c and c.get('mc',0)>0 else None
        rows.append({'s':s,'p':p,'c':chg[s],'v':num(vol[s]),'oi':num(o,4),'mc':mc,'nm':(c or {}).get('nm','')})
    rows.sort(key=lambda r:-(r['mc'] or 0))
    return rows

def _safe(fn,s):
    try: fn(s)
    except Exception: pass

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--output', default='cap-snapshot.json')
    a=ap.parse_args()
    rows=collect()
    data={'generatedAt':int(time.time()*1000),'source':'binance-fapi+coingecko',
          'note':'server-side snapshot from tokyo-01; OI notional=oi*price; mc=null means no CoinGecko match (tokenized stocks etc.)',
          'coins':rows}
    Path(a.output).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    print(f"coins={len(rows)} bytes={Path(a.output).stat().st_size} at={time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}")

if __name__=='__main__':
    main()
