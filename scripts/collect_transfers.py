#!/usr/bin/env python3
"""Bounded ERC20 event evidence. No keys, trades, guessed labels or USD estimates."""
import argparse
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import re
import signal
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
ADDR = re.compile(r'0x[0-9a-fA-F]{40}\Z')
WORD = re.compile(r'0x[0-9a-fA-F]{64}\Z')
ZERO = '0x' + '0' * 40
DEFAULT_RPC = 'https://bsc-rpc.publicnode.com'
# Explicit per-chain buffers are heuristics, never a claim of protocol finality.
CHAIN_CONFIG = {
    'ethereum': (1, 'https://ethereum-rpc.publicnode.com', 20),
    'bsc': (56, DEFAULT_RPC, 64),
    'base': (8453, 'https://base-rpc.publicnode.com', 32),
    'arbitrum': (42161, 'https://arbitrum-one-rpc.publicnode.com', 32),
    'optimism': (10, 'https://optimism-rpc.publicnode.com', 32),
    'avalanche': (43114, 'https://avalanche-c-chain-rpc.publicnode.com', 20),
    'polygon': (137, 'https://polygon-bor-rpc.publicnode.com', 128),
}
CHAIN_IDS = {**{k: v[0] for k, v in CHAIN_CONFIG.items()}, 'linea': 59144}
RPC_URLS = {v[1] for v in CHAIN_CONFIG.values()} | {'https://bsc.drpc.org'}
MAX_RESPONSE = 2 * 1024 * 1024
MAX_LOGS = 2000
MAX_GROUP = 20
STOP_REASONS = {'rate_limited', 'rpc_timeout', 'rpc_network_error',
                'deadline_exceeded', 'chain_deadline_exceeded',
                'request_budget_exhausted', 'global_request_budget_exhausted'}
UNKNOWN_REASONS = {'decimals_unknown', 'threshold_precision', 'invalid_threshold'}

class Unavailable(Exception):
    pass

class Budget:
    """HTTP requests (batch <=20 methods), not tokens, share one wall-clock budget."""
    def __init__(self, seconds=180, requests=400, clock=time.monotonic):
        self.clock, self.deadline = clock, clock() + seconds
        self.limit, self.used = requests, 0
    def check(self):
        if self.clock() >= self.deadline:
            raise Unavailable('deadline_exceeded')
    def reserve(self):
        self.check()
        if self.used >= self.limit:
            raise Unavailable('global_request_budget_exhausted')
        self.used += 1

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

@contextmanager
def request_deadline(seconds):
    """POSIX wall-clock cap also covers DNS and a slow-drip response body."""
    enabled = hasattr(signal, 'setitimer') and threading.current_thread() is threading.main_thread()
    if not enabled:
        yield  # Library workers still have urllib socket timeout; CLI runs on main.
        return
    previous = signal.getsignal(signal.SIGALRM)
    try:
        old_timer = signal.getitimer(signal.ITIMER_REAL)
        started = time.monotonic()
        def expired(*_):
            raise TimeoutError('rpc_deadline')
        signal.signal(signal.SIGALRM, expired)
        signal.setitimer(signal.ITIMER_REAL, max(.001, seconds))
    except (OSError, NotImplementedError):
        # iSH may expose setitimer without implementing it; use socket timeout.
        signal.signal(signal.SIGALRM, previous)
        yield
        return
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)
        if old_timer[0] > 0:
            signal.setitimer(signal.ITIMER_REAL, max(.001, old_timer[0] - (time.monotonic() - started)), old_timer[1])


class RPC:
    def __init__(self, url, opener=urlopen, budget=90, shared=None, chain=None):
        u = urlsplit(url)
        clean = url.rstrip('/')
        if u.scheme != 'https' or clean not in RPC_URLS or u.path not in ('', '/') or u.query or u.fragment:
            raise Unavailable('rpc_not_allowlisted')
        if chain and clean not in ({CHAIN_CONFIG[chain][1]} | ({'https://bsc.drpc.org'} if chain == 'bsc' else set())):
            raise Unavailable('rpc_chain_url_mismatch')
        self.url, self.opener, self.remaining = clean, opener, budget
        self.shared = shared or Budget()
        self.deadline = min(self.shared.deadline, self.shared.clock() + 90)
        self.stopped, self.calls, self.methods = None, 0, 0
    def check(self):
        if self.stopped:
            raise Unavailable(self.stopped)
        self.shared.check()
        if self.shared.clock() >= self.deadline:
            raise Unavailable('chain_deadline_exceeded')
    def _request(self, payload):
        try:
            self.check()
            if self.remaining <= 0:
                raise Unavailable('request_budget_exhausted')
            self.shared.reserve()
            self.remaining -= 1
            self.calls += 1
            self.methods += len(payload) if isinstance(payload, list) else 1
            until = min(self.shared.deadline, self.deadline, self.shared.clock() + 4)
            request = Request(self.url, data=json.dumps(payload).encode(), headers={
                'Content-Type': 'application/json', 'User-Agent': 'oi-transfer-evidence/2'})
            timeout = max(.001, until - self.shared.clock())
            with request_deadline(timeout):
                with self.opener(request, timeout=timeout) as response:
                    raw = response.read(MAX_RESPONSE + 1)
            self.check()
            if self.shared.clock() >= until:
                raise Unavailable('rpc_timeout')
            if len(raw) > MAX_RESPONSE:
                raise Unavailable('response_too_large')
            return json.loads(raw)
        except HTTPError as e:
            reason = 'rate_limited' if e.code == 429 else 'rpc_http_error'
        except URLError as e:
            reason = 'rpc_timeout' if isinstance(e.reason, TimeoutError) else 'rpc_network_error'
        except TimeoutError:
            reason = 'rpc_timeout'
        except OSError:
            reason = 'rpc_network_error'
        except (ValueError, RecursionError):
            reason = 'invalid_rpc_json'
        except Unavailable as e:
            reason = str(e)
        if reason in STOP_REASONS:
            self.stopped = reason
        raise Unavailable(reason)
    def _result(self, item, request_id):
        if not isinstance(item, dict) or type(item.get('id')) is not int or item['id'] != request_id or item.get('jsonrpc') != '2.0':
            raise Unavailable('invalid_rpc_response')
        if 'error' in item:
            error = item['error']
            if isinstance(error, dict) and re.search(r'rate.?limit|too many requests', str(error.get('message', '')), re.I):
                self.stopped = 'rate_limited'
                raise Unavailable('rate_limited')
            raise Unavailable('rpc_method_unavailable')
        if 'result' not in item:
            raise Unavailable('invalid_rpc_response')
        return item['result']
    def call(self, method, params):
        return self._result(self._request({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}), 1)
    def batch(self, calls):
        if not 1 <= len(calls) <= MAX_GROUP:
            raise Unavailable('invalid_rpc_batch_size')
        payload = [{'jsonrpc': '2.0', 'id': i + 1, 'method': m, 'params': p}
                   for i, (m, p) in enumerate(calls)]
        response = self._request(payload)
        if not isinstance(response, list) or len(response) != len(calls):
            # Bounded fallback only for an explicit provider batch rejection.
            if isinstance(response, dict) and isinstance(response.get('error'), dict):
                if re.search(r'rate.?limit|too many requests', str(response['error'].get('message', '')), re.I):
                    self.stopped = 'rate_limited'
                    raise Unavailable('rate_limited')
                if response['error'].get('code') in (-32600, -32601):
                    return [self.call(m, p) for m, p in calls]
            raise Unavailable('invalid_rpc_batch_response')
        indexed = {}
        for item in response:
            if not isinstance(item, dict) or type(item.get('id')) is not int or item['id'] in indexed:
                raise Unavailable('invalid_rpc_batch_response')
            indexed[item['id']] = item
        if set(indexed) != set(range(1, len(calls) + 1)):
            raise Unavailable('invalid_rpc_batch_response')
        results = []
        for i in range(1, len(calls) + 1):
            try:
                results.append(self._result(indexed[i], i))
            except Unavailable as e:
                if str(e) in STOP_REASONS:
                    raise
                results.append(e)
        return results

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

def block_value(result, number):
    if not isinstance(result, dict) or quantity(result.get('number')) != number or not WORD.fullmatch(str(result.get('hash', ''))):
        raise Unavailable('block_unavailable')
    try:
        return result['hash'].lower(), stamp(quantity(result.get('timestamp')))
    except (ValueError, OverflowError, OSError):
        raise Unavailable('block_unavailable') from None

def block(rpc, number):
    return block_value(rpc.call('eth_getBlockByNumber', [hex(number), False]), number)


def grouped(values, size=MAX_GROUP):
    for i in range(0, len(values), size):
        yield values[i:i + size]


def batch(rpc, calls):
    if hasattr(rpc, 'batch'):
        return rpc.batch(calls)
    results = []
    for method, params in calls:
        try:
            results.append(rpc.call(method, params))
        except Unavailable as e:
            if str(e) in STOP_REASONS:
                raise
            results.append(e)
    return results


def new_row(token, units, buffer=None, start=None, end=None):
    return {'identity': {k: token.get(k) for k in ('symbol', 'chain', 'chainId', 'address')},
            'status': 'unavailable', 'reason': 'not_collected', 'fetchedAt': stamp(),
            'decimals': None, 'decimalsSource': None,
            'threshold': {'kind': 'token_units', 'units': units, 'raw': None, 'operator': '>='},
            'coverage': {'fromBlock': start, 'toBlock': end, 'complete': False,
                         'matchedCount': None, 'displayTruncated': False,
                         'fromTime': None, 'toTime': None, 'finalized': False,
                         'confirmationBlocksBuffer': buffer,
                         'finality': 'buffer_only_not_finality_guarantee'}, 'events': []}


def fail(row, reason, status=None):
    row.update(status=status or ('unknown' if reason in UNKNOWN_REASONS else 'unavailable'),
               reason=reason, events=[], fetchedAt=stamp())
    row['coverage'].update(complete=False, matchedCount=None, displayTruncated=False)
    return row


def collect_group(rpc, rows, start, end, anchor, start_time, end_time, cache):
    """One <=20-address query; alias symbols never cause duplicate RPC work."""
    by_address = {}
    for row in rows:
        row['coverage'].update(fromBlock=start, toBlock=end, fromTime=start_time, toTime=end_time)
        by_address.setdefault(row['identity']['address'].lower(), []).append(row)
    try:
        missing = [a for a in by_address if a not in cache['decimals']]
        values = batch(rpc, [('eth_call', [{'to': a, 'data': '0x313ce567'}, hex(end)]) for a in missing]) if missing else []
        for a, value in zip(missing, values):
            if isinstance(value, Unavailable):
                cache['decimals'][a] = value
            elif not isinstance(value, str) or not WORD.fullmatch(value) or int(value, 16) > 255:
                cache['decimals'][a] = Unavailable('decimals_unknown')
            else:
                cache['decimals'][a] = int(value, 16)
        active = {}
        for address, aliases in by_address.items():
            decimals = cache['decimals'][address]
            for row in aliases:
                if isinstance(decimals, Unavailable):
                    fail(row, str(decimals))
                    continue
                row.update(decimals=decimals, decimalsSource={
                    'method': 'eth_call:decimals()', 'blockNumber': end, 'blockHash': anchor})
                try:
                    row['threshold']['raw'] = str(threshold_raw(row['threshold']['units'], decimals))
                    active.setdefault(address, []).append(row)
                except Unavailable as e:
                    fail(row, str(e))
        if not active:
            return
        seen = {}
        for lower in range(start, end + 1, 100):
            upper = min(lower + 99, end)
            logs = rpc.call('eth_getLogs', [{'address': list(active), 'fromBlock': hex(lower),
                            'toBlock': hex(upper), 'topics': [TOPIC]}])
            if not isinstance(logs, list) or len(logs) >= MAX_LOGS:
                raise Unavailable('log_limit_or_invalid_response')
            for log in logs:
                address = str(log.get('address', '')).lower() if isinstance(log, dict) else ''
                if address not in active:
                    raise Unavailable('invalid_transfer_log')
                event = decode(log, active[address][0]['identity'], lower, upper)
                key = (event['txHash'], event['logIndex'])
                record = (address, event)
                if key in seen and seen[key] != record:
                    raise Unavailable('conflicting_duplicate_log')
                seen[key] = record
        # Verify ALL returned event blocks, including below-threshold and hidden events.
        numbers = sorted({e['blockNumber'] for _, e in seen.values()} - cache['blocks'].keys())
        for group in grouped(numbers):
            values = batch(rpc, [('eth_getBlockByNumber', [hex(n), False]) for n in group])
            for n, value in zip(group, values):
                if isinstance(value, Unavailable):
                    raise value
                cache['blocks'][n] = block_value(value, n)
        for _, event in seen.values():
            canonical, event_time = cache['blocks'][event['blockNumber']]
            if canonical != event['blockHash']:
                raise Unavailable('reorg_detected')
            if not start_time <= event_time <= end_time:
                raise Unavailable('invalid_block_timestamp')
            event['eventTime'] = event_time
        if block(rpc, end)[0] != anchor:
            raise Unavailable('reorg_detected')
        for address, aliases in active.items():
            events = [e for a, e in seen.values() if a == address]
            for row in aliases:
                threshold = int(row['threshold']['raw'])
                matches = sorted((e for e in events if int(e['rawAmount']) >= threshold),
                                 key=lambda e: (e['blockNumber'], e['logIndex']), reverse=True)
                row.update(status='ok', reason=None, fetchedAt=stamp(),
                           events=[dict(e) for e in matches[:50]])
                row['coverage'].update(complete=True, matchedCount=len(matches),
                                       displayTruncated=len(matches) > 50)
    except Unavailable as e:
        for row in rows:
            if row['reason'] in ('not_collected', None):
                fail(row, str(e))
        if str(e) in STOP_REASONS or str(e) == 'reorg_detected':
            raise


def collect_token(rpc, token, start, end, units):
    """Compatibility entry point for deterministic tests / one explicit identity."""
    buffer = CHAIN_CONFIG.get(token.get('chain'), (None, None, None))[2]
    row = new_row(token, units, buffer, start, end)
    try:
        anchor, end_time = block(rpc, end)
        start_hash, start_time = block(rpc, start)
        if start == end and start_hash != anchor:
            raise Unavailable('reorg_detected')
        collect_group(rpc, [row], start, end, anchor, start_time, end_time,
                      {'decimals': {}, 'blocks': {start: (start_hash, start_time), end: (anchor, end_time)}})
    except Unavailable as e:
        fail(row, str(e))
    return row


def collect_registry(registry, blocks=100, units='1000000', thresholds=None,
                     deadline=180, rpc_factory=RPC, shared=None, chain_blocks=None,
                     bsc_rpc=DEFAULT_RPC):
    if not isinstance(registry, dict) or registry.get('schemaVersion') != 1 or not isinstance(registry.get('tokens'), list):
        raise ValueError('invalid_registry_schema')
    tokens = registry['tokens']
    symbols = [t.get('symbol') if isinstance(t, dict) else None for t in tokens]
    if not tokens or any(not isinstance(s, str) or not s for s in symbols) or len(set(symbols)) != len(symbols):
        raise ValueError('invalid_or_duplicate_registry_symbol')
    if type(blocks) is not int or not 1 <= blocks <= 2000:
        raise ValueError('invalid_block_range')
    if not isinstance(deadline, (int, float)) or not math.isfinite(deadline) or deadline <= 0:
        raise ValueError('invalid_deadline')
    chain_blocks = chain_blocks or {}
    if not isinstance(chain_blocks, dict) or any(k not in CHAIN_CONFIG or type(v) is not int or not 1 <= v <= 2000 for k, v in chain_blocks.items()):
        raise ValueError('invalid_chain_blocks')
    if thresholds is not None and not isinstance(thresholds, dict):
        raise ValueError('invalid_thresholds')
    shared = shared or Budget(deadline)
    rows, chains = {}, {}
    for token in tokens:
        symbol, chain = token['symbol'], token.get('chain')
        config = CHAIN_CONFIG.get(chain)
        row = rows[symbol] = new_row(token, thresholds.get(symbol) if thresholds is not None else units,
                                      config[2] if config else None)
        if chain not in CHAIN_CONFIG:
            fail(row, 'non_evm_transfer_adapter_unavailable' if chain in ('solana', 'sui') else 'no_transfer_rpc_adapter', 'unsupported')
        elif type(token.get('chainId')) is not int or token['chainId'] != config[0] or not ADDR.fullmatch(str(token.get('address', ''))):
            fail(row, 'invalid_registry_identity', 'unknown')
        elif token.get('mappingStatus', 'mapped') != 'mapped' or not token.get('sources'):
            fail(row, 'unverified_registry_identity', 'unknown')
        else:
            chains.setdefault(chain, []).append(row)
    providers = {}
    # Each chain has its own provider/caches/circuit breaker. One failure never aborts another.
    for chain, chain_rows in chains.items():
        chain_id, url, buffer = CHAIN_CONFIG[chain]
        url = bsc_rpc if chain == 'bsc' else url
        meta = providers[chain] = {'chainId': chain_id, 'url': url if url.rstrip('/') in RPC_URLS else None,
                                  'confirmationBlocksBuffer': buffer, 'requests': 0}
        rpc = None
        try:
            shared.check()
            rpc = rpc_factory(url, budget=90, shared=shared, chain=chain)
            if quantity(rpc.call('eth_chainId', [])) != chain_id:
                raise Unavailable('chain_id_mismatch')
            head = quantity(rpc.call('eth_blockNumber', []))
            count = chain_blocks.get(chain, blocks)
            end, start = head - buffer, head - buffer - count + 1
            if start < 0 or head > 2 ** 53 - 1:
                raise Unavailable('invalid_head')
            anchor, end_time = block(rpc, end)
            start_hash, start_time = block(rpc, start)
            if start_time > end_time or (start == end and start_hash != anchor):
                raise Unavailable('reorg_detected')
            cache = {'decimals': {}, 'blocks': {start: (start_hash, start_time), end: (anchor, end_time)}}
            addresses = {}
            for row in chain_rows:
                addresses.setdefault(row['identity']['address'].lower(), []).append(row)
            for group in grouped(list(addresses)):
                shared.check()
                collect_group(rpc, [r for a in group for r in addresses[a]], start, end,
                              anchor, start_time, end_time, cache)
        except Unavailable as e:
            for row in chain_rows:
                if row['reason'] == 'not_collected' or str(e) == 'reorg_detected':
                    fail(row, str(e))
        finally:
            meta['requests'] = getattr(rpc, 'calls', 0)
            meta['rpcMethods'] = getattr(rpc, 'methods', 0)
            meta['statusCounts'] = dict(Counter(r['status'] for r in chain_rows))
    counts = dict(Counter(r['status'] for r in rows.values()))
    mode = 'github_actions' if os.environ.get('GITHUB_ACTIONS') == 'true' else 'manual'
    return {'schemaVersion': 1, 'generatedAt': stamp(), 'collectionMode': mode,
            'source': {'kind': 'public_rpc', 'trust': 'single_public_rpc_per_chain_not_independently_verified',
                       'providers': providers},
            'collection': {'scope': 'all_registry_mapped_symbols', 'mappedCount': len(rows),
                           'statusCounts': counts, 'deadlineSeconds': deadline, 'requestTimeoutSeconds': 4,
                           'globalRequestBudget': shared.limit, 'perChainRequestBudget': 90,
                           'requests': shared.used, 'batchMaxMethods': MAX_GROUP,
                           'blocksPerQuery': 100, 'defaultBlocks': blocks, 'chainBlocks': chain_blocks,
                           'coverageKind': 'bounded_block_range_not_wall_clock_window'},
            'tokens': rows}


# MAIN

def main(argv=None):
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--registry', type=Path, default=root / 'onchain.registry.json')
    parser.add_argument('--rpc', default=DEFAULT_RPC, help='Optional allowlisted BSC provider only')
    parser.add_argument('--blocks', type=int, default=100, help='Last N buffered blocks, NOT minutes (1..2000)')
    parser.add_argument('--chain-blocks', type=Path, help='Optional JSON {canonical_chain: block_count}')
    parser.add_argument('--deadline', type=float, default=180, help='Total elapsed collection budget in seconds')
    parser.add_argument('--threshold-units', default='1000000', help='Token quantity, NOT USD; no perp denomination conversion')
    parser.add_argument('--thresholds', type=Path, help='Optional JSON {symbol: unit-string}; missing symbols stay unknown')
    parser.add_argument('--output', type=Path, default=root / 'data/transfers.json')
    args = parser.parse_args(argv)
    try:
        registry = json.loads(args.registry.read_text())
        thresholds = json.loads(args.thresholds.read_text()) if args.thresholds else None
        chain_blocks = json.loads(args.chain_blocks.read_text()) if args.chain_blocks else None
        # Validate overrides even when there are no BSC mappings. Never echo credentials.
        RPC(args.rpc, chain='bsc')
        output = collect_registry(registry, blocks=args.blocks, units=args.threshold_units,
                                  thresholds=thresholds, deadline=args.deadline,
                                  chain_blocks=chain_blocks, bsc_rpc=args.rpc)
    except (OSError, ValueError, Unavailable) as e:
        parser.error(str(e) if isinstance(e, Unavailable) else 'invalid_registry_or_collection_config')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=args.output.parent, prefix='.transfers-')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(output, f, ensure_ascii=False, separators=(',', ':'))
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, args.output)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    print(json.dumps(output['collection'], ensure_ascii=False))
    # An unavailable chain is data, not a process-wide failure; malformed config exits 2.
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
