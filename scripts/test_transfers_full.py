"""Offline, deterministic full-registry Transfer tests; never contact real RPCs."""
import copy
from io import BytesIO
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

import collect_transfers as c

HASH = '0x' + 'b' * 64
OTHER = '0x' + 'c' * 64


def token(symbol='TESTUSDT', chain='bsc', address=None):
    return {'symbol': symbol, 'chain': chain, 'chainId': c.CHAIN_IDS.get(chain, 'CT_501'),
            'address': address or '0x' + 'a' * 40, 'mappingStatus': 'mapped',
            'sources': [{'url': 'https://example.test/identity'}]}


def event(address, amount=10**24, number=800, index=0, block_hash=HASH):
    return {'address': address, 'removed': False,
            'topics': [c.TOPIC, '0x' + '0' * 24 + '1' * 40, '0x' + '0' * 24 + '2' * 40],
            'data': '0x' + format(amount, '064x'), 'blockNumber': hex(number),
            'logIndex': hex(index), 'transactionHash': '0x' + format(index + 1, '064x'),
            'blockHash': block_hash}


class FakeRPC:
    def __init__(self, chain, fail=None, logs=None, wrong=False, reorg=False):
        self.chain, self.fail, self.logs = chain, fail, logs
        self.wrong, self.reorg = wrong, reorg
        self.records, self.batches, self.reads = [], [], {}
        self.calls, self.methods = 0, 0
    def call(self, method, params):
        self.calls += 1
        return self._method(method, params)
    def batch(self, calls):
        self.calls += 1
        self.batches.append(copy.deepcopy(calls))
        results = []
        for m, p in calls:
            try:
                results.append(self._method(m, p))
            except c.Unavailable as e:
                if str(e) in c.STOP_REASONS:
                    raise
                results.append(e)
        return results
    def _method(self, method, params):
        self.methods += 1
        self.records.append((method, copy.deepcopy(params)))
        if method == self.fail:
            raise c.Unavailable('rpc_timeout' if self.fail == 'eth_getLogs' else 'rpc_method_unavailable')
        if method == 'eth_chainId':
            return hex(1 if self.wrong else c.CHAIN_IDS[self.chain])
        if method == 'eth_blockNumber':
            return hex(1000)
        if method == 'eth_call':
            return '0x' + format(18, '064x')
        if method == 'eth_getBlockByNumber':
            n = c.quantity(params[0]); self.reads[n] = self.reads.get(n, 0) + 1
            return {'number': hex(n), 'timestamp': hex(1700000000 + n),
                    'hash': OTHER if self.reorg and self.reads[n] > 1 else HASH}
        if method == 'eth_getLogs':
            return self.logs(params[0]) if callable(self.logs) else (self.logs or [])
        raise AssertionError(method)


class FullTransfers(unittest.TestCase):
    def collect(self, tokens, fakes=None, **kw):
        fakes = fakes or {}
        self.providers = {}
        def factory(url, **args):
            chain = args['chain']
            provider = fakes.get(chain) or FakeRPC(chain)
            self.providers[chain] = provider
            return provider
        return c.collect_registry({'schemaVersion': 1, 'tokens': tokens}, rpc_factory=factory, **kw)
    def test_full_275_real_registry_all_statuses_no_catalog_cap(self):
        registry = json.loads((Path(__file__).resolve().parents[1] / 'onchain.registry.json').read_text())
        result = self.collect(registry['tokens'])
        self.assertEqual(len(result['tokens']), 275)
        self.assertEqual(result['collection']['statusCounts'], {'ok': 240, 'unsupported': 35})
        self.assertEqual(set(result['tokens']), {t['symbol'] for t in registry['tokens']})
        self.assertTrue(all(v['coverage']['matchedCount'] is None for v in result['tokens'].values() if v['status'] != 'ok'))
    def test_grouped_address_array_max20_and_quote_alias_dedup(self):
        tokens = [token('T%dUSDT' % i, address='0x' + format(i + 1, '040x')) for i in range(25)]
        alias = {**tokens[0], 'symbol': 'T0USDC', 'address': tokens[0]['address'].upper().replace('0X', '0x')}
        result = self.collect(tokens + [alias], thresholds={t['symbol']: '1' for t in tokens + [alias]})
        rpc = self.providers['bsc']
        logs = [p[0] for m, p in rpc.records if m == 'eth_getLogs']
        decimals = [p for m, p in rpc.records if m == 'eth_call']
        self.assertEqual([len(q['address']) for q in logs], [20, 5])
        self.assertEqual(len(decimals), 25)
        self.assertEqual(len({p[0]['to'] for p in decimals}), 25)
        self.assertTrue(all(p[1] == hex(1000 - c.CHAIN_CONFIG['bsc'][2]) for p in decimals))
        self.assertEqual(result['tokens']['T0USDT']['status'], 'ok')
        self.assertEqual(result['tokens']['T0USDC']['status'], 'ok')
    def test_wrong_chain_id_fails_only_that_chain(self):
        result = self.collect([token(), token('BASEUSDT', 'base')], {'bsc': FakeRPC('bsc', wrong=True)})
        self.assertEqual(result['tokens']['TESTUSDT']['reason'], 'chain_id_mismatch')
        self.assertIsNone(result['tokens']['TESTUSDT']['coverage']['matchedCount'])
        self.assertEqual(result['tokens']['BASEUSDT']['status'], 'ok')
    def test_timeout_unknown_coverage_does_not_block_remaining_chain(self):
        result = self.collect([token(), token('ETHUSDT', 'ethereum')], {'bsc': FakeRPC('bsc', fail='eth_getLogs')})
        row = result['tokens']['TESTUSDT']
        self.assertEqual(row['reason'], 'rpc_timeout')
        self.assertFalse(row['coverage']['complete']); self.assertIsNone(row['coverage']['matchedCount'])
        self.assertEqual(row['events'], [])
        self.assertEqual(result['tokens']['ETHUSDT']['status'], 'ok')
    def test_sol_sui_linea_explicit_unsupported(self):
        sol = token('SOLUSDT', 'solana', '11111111111111111111111111111111')
        sui = {**token('SUIUSDT', 'sui', '0x2::sui::SUI'), 'chainId': 'CT_784'}
        result = self.collect([sol, sui, token('LINEAUSDT', 'linea'), token()])
        for symbol in ('SOLUSDT', 'SUIUSDT', 'LINEAUSDT'):
            row = result['tokens'][symbol]
            self.assertEqual(row['status'], 'unsupported'); self.assertTrue(row['reason'])
            self.assertIsNone(row['coverage']['matchedCount'])
        self.assertEqual(result['tokens']['TESTUSDT']['status'], 'ok')
    def test_reorg_and_hidden_below_threshold_block_hash_rejected(self):
        for rpc in (FakeRPC('bsc', reorg=True), FakeRPC('bsc', logs=[event(token()['address'], amount=1, number=900, block_hash=OTHER)])):
            result = self.collect([token()], {'bsc': rpc})
            row = result['tokens']['TESTUSDT']
            self.assertEqual(row['reason'], 'reorg_detected')
            self.assertEqual(row['events'], []); self.assertIsNone(row['coverage']['matchedCount'])
    def test_raw_uint256_and_log_duplicates_exact(self):
        row = event(token()['address'], amount=2**256 - 1, number=900)
        result = self.collect([token(), token('TESTUSDC')], {'bsc': FakeRPC('bsc', logs=[row, row])})
        for symbol in result['tokens']:
            r = result['tokens'][symbol]
            self.assertEqual(r['coverage']['matchedCount'], 1)
            self.assertEqual(r['events'][0]['rawAmount'], str(2**256 - 1))
            for field in ('usdValue', 'fromLabel', 'toLabel'):
                self.assertIsNone(r['events'][0][field])
    def test_per_chain_blocks_default100_slices_max100(self):
        result = self.collect([token(), token('ETHUSDT', 'ethereum')], blocks=201, chain_blocks={'bsc': 7})
        self.assertEqual(result['tokens']['TESTUSDT']['coverage']['toBlock'] - result['tokens']['TESTUSDT']['coverage']['fromBlock'], 6)
        for rpc in self.providers.values():
            for method, params in rpc.records:
                if method == 'eth_getLogs':
                    self.assertLessEqual(c.quantity(params[0]['toBlock']) - c.quantity(params[0]['fromBlock']) + 1, 100)
        self.assertEqual(len([m for m, _ in self.providers['ethereum'].records if m == 'eth_getLogs']), 3)
    def test_missing_threshold_is_unknown_not_zero(self):
        result = self.collect([token(), token('TESTUSDC')], thresholds={'TESTUSDT': '1000000'})
        self.assertEqual(result['tokens']['TESTUSDT']['status'], 'ok')
        self.assertEqual(result['tokens']['TESTUSDC']['status'], 'unknown')
        self.assertIsNone(result['tokens']['TESTUSDC']['coverage']['matchedCount'])
    def test_invalid_registry_identity_is_row_local(self):
        bad = {**token('BADUSDT'), 'chainId': 1}
        result = self.collect([bad, token()])
        self.assertEqual(result['tokens']['BADUSDT']['reason'], 'invalid_registry_identity')
        self.assertEqual(result['tokens']['TESTUSDT']['status'], 'ok')
    def test_deadline_expired_writes_all_unavailable_without_requests(self):
        now = [0.0]
        budget = c.Budget(1, clock=lambda: now[0]); now[0] = 2
        result = self.collect([token(), token('ETHUSDT', 'ethereum')], shared=budget)
        self.assertEqual(self.providers, {})
        self.assertTrue(all(r['reason'] == 'deadline_exceeded' for r in result['tokens'].values()))
    def test_buffers_are_chain_specific_never_protocol_finality(self):
        result = self.collect([token(), token('ETHUSDT', 'ethereum')])
        for r in result['tokens'].values():
            self.assertIs(r['coverage']['finalized'], False)
            self.assertEqual(r['coverage']['confirmationBlocksBuffer'], c.CHAIN_CONFIG[r['identity']['chain']][2])
        self.assertNotEqual(c.CHAIN_CONFIG['bsc'][2], c.CHAIN_CONFIG['ethereum'][2])
    def test_collection_mode_is_actual_actions_environment(self):
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'true'}):
            self.assertEqual(self.collect([token()])['collectionMode'], 'github_actions')
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'}):
            self.assertEqual(self.collect([token()])['collectionMode'], 'manual')
    def test_main_argv_atomic_replaces_output_partial_run_is_not_fatal(self):
        with tempfile.TemporaryDirectory() as tmp:
            registry, output = Path(tmp) / 'registry.json', Path(tmp) / 'data.json'
            registry.write_text(json.dumps({'schemaVersion': 1, 'tokens': [token()]}))
            output.write_text('{"old":true}')
            with patch.object(c, 'collect_registry', wraps=c.collect_registry) as collect:
                # An elapsed fake budget avoids all network access through the real CLI.
                clock = [0.0]; budget = c.Budget(1, clock=lambda: clock[0]); clock[0] = 2
                real = collect._mock_wraps
                collect.side_effect = lambda r, **kw: real(r, shared=budget, **kw)
                self.assertEqual(c.main(['--registry', str(registry), '--output', str(output), '--blocks', '100', '--deadline', '1']), 0)
            data = json.loads(output.read_text())
            self.assertEqual(data['tokens']['TESTUSDT']['reason'], 'deadline_exceeded')
            self.assertFalse(list(Path(tmp).glob('.transfers-*')))


class Response(BytesIO):
    pass


class RPCTransport(unittest.TestCase):
    def test_allowlist_every_chain_and_reject_wrong_provider_credentials(self):
        for chain, (_, url, _) in c.CHAIN_CONFIG.items():
            self.assertEqual(c.RPC(url, chain=chain).url, url)
        for url in ('https://ethereum-rpc.publicnode.com?key=x', 'https://user:x@bsc-rpc.publicnode.com', 'https://bsc-rpc.publicnode.com/path'):
            with self.assertRaises(c.Unavailable): c.RPC(url)
        with self.assertRaisesRegex(c.Unavailable, 'rpc_chain_url_mismatch'):
            c.RPC(c.DEFAULT_RPC, chain='ethereum')
    def test_http_429_stops_provider_after_single_request(self):
        calls = []
        def opener(request, timeout):
            calls.append(timeout)
            raise HTTPError(request.full_url, 429, 'limit', {}, None)
        rpc = c.RPC(c.DEFAULT_RPC, opener=opener)
        for _ in range(2):
            with self.assertRaisesRegex(c.Unavailable, 'rate_limited'): rpc.call('eth_blockNumber', [])
        self.assertEqual(len(calls), 1); self.assertLessEqual(calls[0], 4)
    def test_request_timeout_and_global_per_chain_budgets(self):
        calls = []
        def opener(request, timeout):
            calls.append(timeout)
            return Response(b'{"jsonrpc":"2.0","id":1,"result":"0x38"}')
        shared = c.Budget(180, requests=1)
        rpc = c.RPC(c.DEFAULT_RPC, opener=opener, shared=shared)
        self.assertEqual(rpc.call('eth_chainId', []), '0x38')
        with self.assertRaisesRegex(c.Unavailable, 'global_request_budget_exhausted'): rpc.call('eth_chainId', [])
        self.assertEqual(len(calls), 1)
        with self.assertRaisesRegex(c.Unavailable, 'request_budget_exhausted'):
            c.RPC(c.DEFAULT_RPC, opener=opener, budget=0).call('eth_chainId', [])
        def timeout(request, timeout): raise TimeoutError()
        with self.assertRaisesRegex(c.Unavailable, 'rpc_timeout'):
            c.RPC(c.DEFAULT_RPC, opener=timeout).call('eth_chainId', [])
    def test_batch_response_reordered_and_missing_ids_rejected(self):
        def opener(request, timeout):
            payload = json.loads(request.data)
            return Response(json.dumps([{'jsonrpc': '2.0', 'id': p['id'], 'result': p['id']} for p in reversed(payload)]).encode())
        rpc = c.RPC(c.DEFAULT_RPC, opener=opener)
        self.assertEqual(rpc.batch([('eth_call', []), ('eth_call', [])]), [1, 2])
        self.assertEqual(rpc.calls, 1); self.assertEqual(rpc.methods, 2)
        rpc.opener = lambda request, timeout: Response(b'[{"jsonrpc":"2.0","id":1,"result":18}]')
        with self.assertRaisesRegex(c.Unavailable, 'invalid_rpc_batch_response'):
            rpc.batch([('eth_call', []), ('eth_call', [])])


if __name__ == '__main__':
    unittest.main()
