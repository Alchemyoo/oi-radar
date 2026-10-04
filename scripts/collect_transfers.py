#!/usr/bin/env python3
"""Bounded ERC20 event evidence. No keys, trades, guessed labels or USD estimates."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
ADDR = re.compile(r'0x[0-9a-fA-F]{40}\Z')
WORD = re.compile(r'0x[0-9a-fA-F]{64}\Z')
ZERO = '0x' + '0' * 40
DEFAULT_RPC = 'https://bsc-rpc.publicnode.com'

class Unavailable(Exception):
    pass

def stamp(seconds=None):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace('+00:00', 'Z') if seconds is not None else datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

def quantity(value):
    if not isinstance(value, str) or not re.fullmatch(r'0x[0-9a-fA-F]{1,64}', value):
        raise Unavailable('invalid_rpc_quantity')
    return int(value, 16)

def threshold_raw(units, decimals):
    if type(decimals) is not int or not 0 <= decimals <= 255:
        raise Unavailable('decimals_unknown')
    if not isinstance(units, str) or len(units) > 80 or not re.fullmatch(r'[0-9]+(?:\.[0-9]+)?', units):
        raise Unavailable('invalid_threshold')
    whole, _, fraction = units.partition('.')
    if len(fraction) > decimals:
        raise Unavailable('threshold_precision')
    raw = int(whole) * 10 ** decimals + int((fraction + '0' * decimals)[:decimals] or '0')
    if not 0 < raw < 2 ** 256:
        raise Unavailable('invalid_threshold')
    return raw

class RPC:
    def __init__(self, url, opener=urlopen, budget=80):
        # Only public URLs: do not accept credentials, query keys or arbitrary hosts.
        from urllib.parse import urlsplit
        u = urlsplit(url)
        if u.scheme != 'https' or u.netloc not in ('bsc-rpc.publicnode.com', 'bsc.drpc.org') or u.path not in ('', '/') or u.query or u.fragment:
            raise Unavailable('rpc_not_allowlisted')
        self.url, self.opener, self.remaining = url, opener, budget
    def call(self, method, params):
        self.remaining -= 1
        if self.remaining < 0:
            raise Unavailable('request_budget_exhausted')
        request = Request(self.url, data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode(), headers={'Content-Type': 'application/json', 'User-Agent': 'oi-transfer-evidence/1'})
        try:
            with self.opener(request, timeout=8) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise Unavailable('response_too_large')
            data = json.loads(raw)
            if not isinstance(data, dict) or data.get('id') != 1 or 'error' in data or 'result' not in data:
                raise Unavailable('rpc_method_unavailable')
            return data['result']
        except HTTPError as e:
            raise Unavailable('rate_limited' if e.code == 429 else 'rpc_http_error') from None
        except (URLError, TimeoutError, OSError):
            raise Unavailable('rpc_network_error') from None
        except (ValueError, RecursionError):
            raise Unavailable('invalid_rpc_json') from None

def decode(log, identity, start, end):
    if not isinstance(log, dict) or log.get('removed') is not False or str(log.get('address', '')).lower() != identity['address'].lower():
        raise Unavailable('invalid_transfer_log')
    topics = log.get('topics')
    if not isinstance(topics, list) or len(topics) != 3 or str(topics[0]).lower() != TOPIC or not all(isinstance(t, str) and WORD.fullmatch(t) for t in topics):
        # Reject ERC721's four-topic Transfer and nonstandard events.
        raise Unavailable('invalid_transfer_log')
    if any(t[2:26] != '0' * 24 for t in topics[1:]) or not WORD.fullmatch(str(log.get('data', ''))):
        raise Unavailable('invalid_transfer_log')
    block, index = quantity(log.get('blockNumber')), quantity(log.get('logIndex'))
    if not start <= block <= end or not WORD.fullmatch(str(log.get('transactionHash', ''))) or not WORD.fullmatch(str(log.get('blockHash', ''))):
        raise Unavailable('invalid_transfer_log')
    sender, recipient = '0x' + topics[1][-40:].lower(), '0x' + topics[2][-40:].lower()
    return {'txHash': log['transactionHash'].lower(), 'logIndex': index, 'blockNumber': block, 'blockHash': log['blockHash'].lower(), 'from': sender, 'to': recipient, 'rawAmount': str(int(log['data'], 16)), 'eventTime': None, 'direction': 'mint' if sender == ZERO else 'burn' if recipient == ZERO else 'address_to_address', 'fromLabel': None, 'toLabel': None, 'usdValue': None}

def block(rpc, number):
    result = rpc.call('eth_getBlockByNumber', [hex(number), False])
    if not isinstance(result, dict) or quantity(result.get('number')) != number or not WORD.fullmatch(str(result.get('hash', ''))):
        raise Unavailable('block_unavailable')
    return result['hash'].lower(), stamp(quantity(result.get('timestamp')))

def collect_token(rpc, token, start, end, units):
    identity = {k: token[k] for k in ('symbol', 'chain', 'chainId', 'address')}
    row = {'identity': identity, 'status': 'unavailable', 'reason': None, 'fetchedAt': stamp(), 'decimals': None, 'decimalsSource': None, 'threshold': {'kind': 'token_units', 'units': units, 'raw': None, 'operator': '>='}, 'coverage': {'fromBlock': start, 'toBlock': end, 'complete': False, 'matchedCount': None, 'displayTruncated': False, 'fromTime': None, 'toTime': None, 'finality': '20_block_buffer_not_finality_guarantee'}, 'events': []}
    try:
        anchor, end_time = block(rpc, end)
        _, start_time = block(rpc, start)
        value = rpc.call('eth_call', [{'to': identity['address'], 'data': '0x313ce567'}, hex(end)])
        if not isinstance(value, str) or not WORD.fullmatch(value) or int(value, 16) > 255:
            raise Unavailable('decimals_unknown')
        decimals = int(value, 16)
        threshold = threshold_raw(units, decimals)
        row.update(decimals=decimals, decimalsSource={'method': 'eth_call:decimals()', 'blockNumber': end, 'blockHash': anchor})
        row['threshold']['raw'] = str(threshold)
        seen = {}
        for lower in range(start, end + 1, 100):
            upper = min(lower + 99, end)
            logs = rpc.call('eth_getLogs', [{'address': identity['address'], 'fromBlock': hex(lower), 'toBlock': hex(upper), 'topics': [TOPIC]}])
            if not isinstance(logs, list) or len(logs) >= 2000:
                raise Unavailable('log_limit_or_invalid_response')
            for log in logs:
                event = decode(log, identity, lower, upper)
                key = (event['txHash'], event['logIndex'])
                if key in seen and seen[key] != event:
                    raise Unavailable('conflicting_duplicate_log')
                seen[key] = event
        matches = sorted((e for e in seen.values() if int(e['rawAmount']) >= threshold), key=lambda e: (e['blockNumber'], e['logIndex']), reverse=True)
        events = matches[:50]
        blocks = {}
        for event in events:
            n = event['blockNumber']
            if n not in blocks:
                blocks[n] = block(rpc, n)
            if blocks[n][0] != event['blockHash']:
                raise Unavailable('reorg_detected')
            event['eventTime'] = blocks[n][1]
        if block(rpc, end)[0] != anchor:
            raise Unavailable('reorg_detected')
        row.update(status='ok', reason=None, events=events, fetchedAt=stamp())
        row['coverage'].update(complete=True, matchedCount=len(matches), displayTruncated=len(matches) > 50, fromTime=start_time, toTime=end_time)
    except Unavailable as error:
        row.update(reason=str(error), events=[])
        if str(error) in ('decimals_unknown', 'threshold_precision', 'invalid_threshold'):
            row['status'] = 'unknown'
    return row

def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rpc', default=DEFAULT_RPC)
    parser.add_argument('--blocks', type=int, default=200)
    parser.add_argument('--threshold-units', default='1000000', help='Explicit quantity filter, NOT an economic or USD whale threshold')
    parser.add_argument('--thresholds', type=Path, help='Optional JSON object {symbol: decimal-unit-string}; missing symbols stay unknown')
    parser.add_argument('--output', type=Path, default=root / 'data/transfers.json')
    args = parser.parse_args()
    if not 1 <= args.blocks <= 2000:
        parser.error('--blocks must be 1..2000')
    registry = json.loads((root / 'onchain.registry.json').read_text())
    tokens = registry['tokens']
    if registry.get('schemaVersion') != 1 or not 1 <= len(tokens) <= 20 or len({t['symbol'] for t in tokens}) != len(tokens) or any(t.get('chainId') != 56 or t.get('chain') != 'bsc' or not ADDR.fullmatch(str(t.get('address', ''))) or not t.get('sources') for t in tokens):
        parser.error('only existing verified BSC registry identities are supported')
    thresholds = json.loads(args.thresholds.read_text()) if args.thresholds else {}
    rows = {}
    try:
        rpc = RPC(args.rpc)
        if quantity(rpc.call('eth_chainId', [])) != 56:
            raise Unavailable('chain_id_mismatch')
        end = quantity(rpc.call('eth_blockNumber', [])) - 20
        if end < args.blocks - 1:
            raise Unavailable('invalid_head')
        for token in tokens:
            units = thresholds.get(token['symbol']) if args.thresholds else args.threshold_units
            rows[token['symbol']] = collect_token(rpc, token, end - args.blocks + 1, end, units)
    except Unavailable as error:
        rows = {t['symbol']: {'identity': {k: t[k] for k in ('symbol', 'chain', 'chainId', 'address')}, 'status': 'unavailable', 'reason': str(error), 'fetchedAt': stamp(), 'events': [], 'coverage': {'complete': False, 'matchedCount': None}} for t in tokens}
    output = {'schemaVersion': 1, 'generatedAt': stamp(), 'collectionMode': 'manual', 'source': {'kind': 'public_rpc', 'url': args.rpc if args.rpc in (DEFAULT_RPC, 'https://bsc.drpc.org') else None, 'trust': 'single_public_rpc_not_independently_verified'}, 'tokens': rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=args.output.parent, prefix='.transfers-')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(output, f, ensure_ascii=False, separators=(',', ':'))
            f.write('\n')
        os.replace(name, args.output)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    print(json.dumps({k: {'status': v['status'], 'reason': v.get('reason'), 'matchedCount': v.get('coverage', {}).get('matchedCount')} for k, v in rows.items()}, ensure_ascii=False))
    return 0 if all(r['status'] == 'ok' for r in rows.values()) else 2

if __name__ == '__main__':
    raise SystemExit(main())
