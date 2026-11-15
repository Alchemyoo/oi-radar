#!/usr/bin/env python3
"""Coinglass coin snapshot -> cg-snapshot.json (for oi-radar 清算 page).

Source: Coinglass public Next.js data route
  /_next/data/<buildId>/zh/currencies/<SYM>.json?symbol=<SYM>
It returns the same server-rendered snapshot the coin page shows:
price / 24h change / market cap / OI / 24h liquidation (long & short) /
funding rate / ETF net flow / fear & greed / multi-period performance.

Universe: top N USDT-perp base symbols by market cap from cap-snapshot.json
(falls back to a built-in list when that file is missing).

Output rows are compact (short keys) so the file stays small enough to serve
cheaply from GitHub Pages.
"""
import argparse, json, re, subprocess, sys, threading, time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
BASE = 'https://www.coinglass.com'

# Binance perp symbol prefixes that are not part of the Coinglass symbol name.
PREFIXES = ('1000000', '10000', '1000')
# 稳定币对清算/杠杆分析没有意义，直接跳过
STABLES = {'USDC', 'USDT', 'FDUSD', 'TUSD', 'DAI', 'USDP', 'BUSD', 'USDD', 'PYUSD',
           'USD1', 'EUR', 'EURI', 'AEUR', 'USD', 'USDE', 'USDS', 'RLUSD', 'XAUT'}


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def curl(url, timeout=20, tries=2):
    """curl subprocess: VPS python urllib TLS fingerprints get blocked by some CDNs."""
    last = None
    for i in range(tries):
        try:
            r = subprocess.run(
                ['curl', '-sS', '--compressed', '-m', str(timeout), '-A', UA,
                 '-H', 'accept-language: zh-CN,zh;q=0.9',
                 '-H', 'accept: application/json,text/html;q=0.9',
                 '-w', '\n%{http_code}', url],
                capture_output=True)
            body = r.stdout
            nl = body.rfind(b'\n')
            if nl < 0:
                raise RuntimeError('curl 无响应')
            code = body[nl + 1:].decode('ascii', 'ignore').strip()
            body = body[:nl]
            if code == '200' and body:
                return body
            last = RuntimeError('HTTP %s' % code)
        except Exception as e:  # noqa: BLE001
            last = e
        if i < tries - 1:
            time.sleep(1.2 * (i + 1))
    raise last


def load_build_id(force=False):
    """Next.js build id changes on every site deploy; cache it for the run."""
    cache = ROOT / '.cg-buildid'
    if not force and cache.exists():
        bid = cache.read_text().strip()
        if re.fullmatch(r'[\w\-]{6,40}', bid or ''):
            return bid
    html = curl(BASE + '/zh/currencies/BTC', timeout=25).decode('utf8', 'ignore')
    m = re.search(r'"buildId":"([^"]+)"', html)
    if not m:
        raise RuntimeError('buildId 未找到')
    bid = m.group(1)
    try:
        cache.write_text(bid)
    except OSError:
        pass
    return bid


def snap_of(bid, sym):
    """fetch one coin snapshot; retries cover both transport cuts and truncated bodies."""
    url = '%s/_next/data/%s/zh/currencies/%s.json?symbol=%s' % (BASE, bid, sym, sym)
    last = None
    for i in range(3):
        try:
            raw = curl(url, timeout=20, tries=2)
            d = json.loads(raw)
            p = d.get('pageProps') or (d.get('props') or {}).get('pageProps') or {}
            return p.get('snap')
        except json.JSONDecodeError as e:
            last = e
            time.sleep(0.8 * (i + 1))
        except Exception as e:  # noqa: BLE001
            if 'HTTP 404' in str(e):
                raise
            last = e
            time.sleep(0.6 * (i + 1))
    raise last or RuntimeError('未取到快照')


def rnd(v, n=6):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float('inf'), float('-inf')):
        return None
    return round(f, n)


def compact(snap):
    liq = snap.get('liquidation24h') or {}
    etf = snap.get('etfNetFlow') or {}
    fg = snap.get('fearGreed') or {}
    perf = snap.get('performance') or {}
    stats = snap.get('stats') or {}
    flow = snap.get('flow24h') or {}
    ath = snap.get('ath')
    px = snap.get('price')
    rec = {
        's': snap.get('symbol'),
        'n': snap.get('name'),
        'r': snap.get('rank'),
        'px': px,
        'c': rnd(snap.get('priceChangePercent24h'), 4),
        'hi': snap.get('high24h'),
        'lo': snap.get('low24h'),
        'mc': rnd(snap.get('marketCap'), 0),
        'fv': rnd(snap.get('fdv'), 0),
        'oi': rnd(snap.get('openInterest'), 0),
        'oc': rnd(snap.get('oiChangePercent24h'), 3),
        'fr': rnd(snap.get('fundingRate'), 8),
        'fa': rnd(snap.get('fundingRateAnnualized'), 4),
        'll': rnd(liq.get('long'), 0),
        'ls': rnd(liq.get('short'), 0),
        'ef': rnd(etf.get('usd'), 0),
        'ed': etf.get('date'),
        'fg': fg.get('value'),
        'omp': rnd(snap.get('oiMcapPct'), 3),
        'm2': rnd(stats.get('ma200Dist'), 3),
        'sn': rnd(flow.get('spotNet'), 0),
        'fn': rnd(flow.get('futNet'), 0),
        'tb': rnd(flow.get('takerBuyPct'), 3),
        'vt': rnd(snap.get('futuresVolUsd'), 0),
        'ath': ath,
        'athd': rnd((px / ath - 1) * 100, 2) if px and ath else None,
        'p': {k: rnd(perf.get(k), 3) for k in ('h1', 'h4', 'h24', 'd7', 'd30', 'd90', 'ytd', 'y1')
              if perf.get(k) is not None},
    }
    return {k: v for k, v in rec.items() if v not in (None, {}, '')}


def universe(n):
    """Top-N base symbols that actually have a Binance USDT perp."""
    rows = []
    f = ROOT / 'cap-snapshot.json'
    if f.exists():
        try:
            data = json.loads(f.read_text())
            for c in data.get('coins') or []:
                s = str(c.get('s') or '')
                if not s.endswith('USDT'):
                    continue
                rows.append((c.get('mc') or 0, s[:-4]))
        except Exception as e:  # noqa: BLE001
            log('cap-snapshot 读取失败:', e)
    if not rows:
        rows = [(0, s) for s in ('BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'LINK')]
    rows.sort(key=lambda x: -x[0])
    out, seen = [], set()
    for _, base in rows:
        key = re.sub(r'^(1000000|10000|1000)', '', base)
        if key in seen or key in STABLES or base in STABLES:
            continue
        seen.add(key)
        out.append((base, key))
        if len(out) >= n:
            break
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--output', '--out', dest='out', default=str(ROOT / 'cg-snapshot.json'))
    ap.add_argument('--top', type=int, default=120, help='按市值取前 N 个币')
    ap.add_argument('--pace', type=float, default=0.45, help='每线程请求间隔秒')
    ap.add_argument('--workers', type=int, default=6, help='并发数')
    ap.add_argument('--limit', type=int, default=0, help='调试：只取前 N 个')
    args = ap.parse_args()

    bid = load_build_id()
    log('buildId', bid)
    uni = universe(args.top)
    if args.limit:
        uni = uni[:args.limit]
    log('universe', len(uni))

    done = [0]
    lock = threading.Lock()

    def one(item):
        base, cg_sym = item
        got = None
        for sym in ([cg_sym] if base == cg_sym else [cg_sym, base]):
            try:
                snap = snap_of(bid, sym)
            except Exception as e:  # noqa: BLE001
                if 'HTTP 404' not in str(e):
                    log('  !', base, e)
                continue
            if snap:
                got = compact(snap)
                got.setdefault('s', sym)
                got['bs'] = base          # Binance 侧原始 base（1000PEPE 等）
                break
        time.sleep(args.pace)
        with lock:
            done[0] += 1
            if done[0] % 25 == 0:
                log('%d/%d' % (done[0], len(uni)))
        return base, got

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        results = list(ex.map(one, uni))

    coins = [g for _, g in results if g]
    miss = [b for b, g in results if not g]

    # 大面积 404 = 站点重新部署，buildId 已轮换：换 id 后补抓一次
    if len(miss) > max(5, len(uni) // 5):
        try:
            bid = load_build_id(force=True)
            log('buildId 刷新，补抓', len(miss), '个')
            retry = [(b, re.sub(r'^(1000000|10000|1000)', '', b)) for b in miss]
            with ThreadPoolExecutor(max_workers=args.workers) as ex:
                again = list(ex.map(one, retry))
            coins += [g for _, g in again if g]
            miss = [b for b, g in again if not g]
        except Exception as e:  # noqa: BLE001
            log('补抓失败', e)

    if not coins:
        log('无有效数据，保留旧文件')
        return 1
    out = {
        'generatedAt': int(time.time() * 1000),
        'source': 'coinglass.com/_next/data',
        'buildId': bid,
        'note': 'Coinglass 币种快照：价格/市值/OI/24h爆仓/资金费率/ETF净流入/恐慌贪婪/多周期涨跌',
        'coins': coins,
        'missing': miss[:40],
    }
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    log('写入', args.out, '币种', len(coins), '缺', len(miss))
    return 0


if __name__ == '__main__':
    sys.exit(main())
