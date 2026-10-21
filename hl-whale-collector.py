#!/usr/bin/env python3
"""Hyperliquid whale snapshot -> explicit fresh JSON cache. No keys/proxy.

Public sources only:
  - https://stats-data.hyperliquid.xyz/Mainnet/leaderboard  (all accounts)
  - https://api.hyperliquid.xyz/info  POST clearinghouseState / metaAndAssetCtxs
Output: hl-whale-cache.json  (current positions of the top-N accounts by accountValue)
"""
import argparse, concurrent.futures, datetime as dt, json, math, time, urllib.request, urllib.error
from pathlib import Path

API='https://api.hyperliquid.xyz/info'
LB='https://stats-data.hyperliquid.xyz/Mainnet/leaderboard'

def post(obj, retries=4, timeout=25):
    last=None
    for i in range(retries):
        try:
            req=urllib.request.Request(API, data=json.dumps(obj).encode(),
                headers={'Content-Type':'application/json','User-Agent':'oi-radar-cache/1.0'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429,418):
                last=e; time.sleep(3*(i+1)); continue
            raise
        except Exception as e:
            last=e; time.sleep(1.5*(i+1))
    raise last

def num(x, nd=None):
    try: v=float(x)
    except (TypeError,ValueError): return None
    if not math.isfinite(v): return None
    if nd is not None: v=round(v, nd)
    return v

def collect(users_n=1500, holders_n=80, min_coin_usd=1_500_000):
    t0=time.time()
    req=urllib.request.Request(LB, headers={'User-Agent':'oi-radar-cache/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        lb=json.load(r)
    rows=sorted(lb['leaderboardRows'], key=lambda x: float(x.get('accountValue') or 0), reverse=True)[:users_n]
    addrs=[r['ethAddress'] for r in rows]

    states={}
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        futs={pool.submit(post, {'type':'clearinghouseState','user':a}): a for a in addrs}
        for f in concurrent.futures.as_completed(futs):
            a=futs[f]
            try: d=f.result()
            except Exception: continue
            if isinstance(d, dict) and 'assetPositions' in d: states[a]=d
    if not states: raise ValueError('No clearinghouse states collected')

    meta=post({'type':'metaAndAssetCtxs'})
    marks={}; ois={}; fund={}
    for u, c in zip(meta[0]['universe'], meta[1]):
        coin=u['name']
        marks[coin]=num(c.get('markPx'), 8)
        try: ois[coin]=float(c.get('openInterest') or 0)*float(c.get('markPx') or 0)
        except (TypeError,ValueError): ois[coin]=None
        fund[coin]=num(c.get('funding'), 8)

    per_coin={}
    for a, d in states.items():
        for ap in d.get('assetPositions', []):
            p=ap.get('position') or {}
            try: szi=float(p.get('szi') or 0)
            except (TypeError,ValueError): continue
            if szi==0: continue
            coin=p.get('coin')
            if not coin: continue
            side='L' if szi>0 else 'S'
            val=abs(num(p.get('positionValue')) or 0)
            if val<=0: continue
            lev=p.get('leverage') or {}
            rec={'a':a[-6:].lower(),'s':side,'sz':num(p.get('szi'),6),'v':int(val),
                 'e':num(p.get('entryPx'),8),'lv':num(lev.get('value')),'lt':lev.get('type') or 'c',
                 'up':num(p.get('unrealizedPnl')),'roe':num(p.get('returnOnEquity'),4),
                 'lq':num(p.get('liquidationPx'),8)}
            per_coin.setdefault(coin, []).append(rec)

    coins_out=[]
    for coin, holders in per_coin.items():
        holders.sort(key=lambda x: -x['v'])
        keep=holders[:holders_n]
        vL=sum(h['v'] for h in holders if h['s']=='L')
        vS=sum(h['v'] for h in holders if h['s']=='S')
        if vL+vS<min_coin_usd: continue
        coins_out.append({'coin':coin,'mark':marks.get(coin),
            'oi':int(ois[coin]) if ois.get(coin) else None,'fund':fund.get(coin),
            'wl':{'n':len(holders),'l':sum(1 for h in holders if h['s']=='L'),
                  's':sum(1 for h in holders if h['s']=='S'),
                  'vL':int(vL),'vS':int(vS),'cov':num((vL+vS)/ois[coin],4) if ois.get(coin) else None},
            'holders':keep})
    coins_out.sort(key=lambda c: -(c['wl']['vL']+c['wl']['vS']))
    return {'generatedAt':int(time.time()*1000),'source':'hyperliquid',
            'usersScanned':users_n,'accountsHit':len(states),
            'lagNote':'hourly snapshot of top-N accounts by accountValue; per-symbol ranking covers these whales only',
            'coins':coins_out}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--users', type=int, default=1500)
    ap.add_argument('--holders', type=int, default=80)
    ap.add_argument('--min-coin-usd', type=float, default=1_500_000)
    ap.add_argument('--output', default='hl-whale-cache.json')
    a=ap.parse_args()
    data=collect(a.users, a.holders, a.min_coin_usd)
    Path(a.output).write_text(json.dumps(data, ensure_ascii=False, separators=(',',':')), encoding='utf8')
    size=Path(a.output).stat().st_size
    print(f"coins={len(data['coins'])} accountsHit={data['accountsHit']} bytes={size} "
          f"at={time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(data['generatedAt']/1000))}")

if __name__=='__main__':
    main()
