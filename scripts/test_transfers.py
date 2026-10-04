import copy
import unittest
import collect_transfers as c

TOKEN = {'symbol': 'TESTUSDT', 'chain': 'bsc', 'chainId': 56, 'address': '0x'+'a'*40}
HASH = '0x'+'b'*64

def log(amount=10**24):
    return {'address': TOKEN['address'], 'removed': False, 'topics': [c.TOPIC, '0x'+'0'*24+'1'*40, '0x'+'0'*24+'2'*40], 'data': '0x'+format(amount,'064x'), 'blockNumber':'0x64', 'logIndex':'0x1', 'transactionHash': HASH, 'blockHash': HASH}

class Fake:
    def __init__(self, logs=None, decimals=18, failure=None, reorg=False):
        self.logs = [log()] if logs is None else logs
        self.decimals,self.failure,self.reorg=decimals,failure,reorg
        self.end_reads=0
    def call(self, method, params):
        if self.failure==method: raise c.Unavailable('rpc_method_unavailable')
        if method=='eth_getBlockByNumber':
            n=c.quantity(params[0])
            if n==100: self.end_reads+=1
            return {'number':hex(n),'timestamp':hex(1700000000+n),'hash': ('0x'+'c'*64) if self.reorg and self.end_reads>2 else HASH}
        if method=='eth_call': return '0x'+format(self.decimals,'064x')
        if method=='eth_getLogs': return self.logs
        raise AssertionError(method)

class Transfers(unittest.TestCase):
    def test_exact_decimal_threshold_and_large_uint(self):
        self.assertEqual(c.threshold_raw('1000000',18),10**24)
        self.assertEqual(c.threshold_raw('1.000001',6),1000001)
        self.assertEqual(c.threshold_raw('1',0),1)
        for value,d in [('1.1',0),('1.0000001',6),('-1',18),('0',18),('1e6',18),('1',256), (None,18)]:
            with self.assertRaises(c.Unavailable): c.threshold_raw(value,d)
    def test_decode_rejects_nft_wrong_contract_removed_malformed(self):
        self.assertEqual(c.decode(log(),TOKEN,100,100)['rawAmount'],str(10**24))
        for key,val in [('address','0x'+'d'*40),('removed',True),('data','0x01'),('transactionHash','x'),('topics',[c.TOPIC,'0x'+'0'*64,'0x'+'0'*64,'0x'+'0'*64])]:
            row=log();row[key]=val
            with self.assertRaises(c.Unavailable): c.decode(row,TOKEN,100,100)
    def test_zero_directions(self):
        row=log();row['topics'][1]='0x'+'0'*64
        self.assertEqual(c.decode(row,TOKEN,100,100)['direction'],'mint')
        row=log();row['topics'][2]='0x'+'0'*64
        self.assertEqual(c.decode(row,TOKEN,100,100)['direction'],'burn')
    def test_threshold_boundary_dedup_and_event_time(self):
        row=c.collect_token(Fake([log(),log(),log(10**24-1)]),TOKEN,100,100,'1000000')
        # Duplicate key with conflicting amount must invalidate, not silently merge.
        self.assertEqual(row['status'],'unavailable')
        row=c.collect_token(Fake([log(),log()]),TOKEN,100,100,'1000000')
        self.assertEqual(row['status'],'ok');self.assertEqual(row['coverage']['matchedCount'],1)
        self.assertEqual(row['events'][0]['eventTime'],c.stamp(1700000100))
        self.assertIsNone(row['events'][0]['fromLabel']);self.assertIsNone(row['events'][0]['usdValue'])
    def test_complete_empty_is_distinct_from_failure(self):
        row=c.collect_token(Fake([]),TOKEN,100,100,'1000000')
        self.assertEqual(row['status'],'ok');self.assertEqual(row['coverage']['matchedCount'],0)
        for method in ('eth_call','eth_getLogs','eth_getBlockByNumber'):
            row=c.collect_token(Fake(failure=method),TOKEN,100,100,'1000000')
            self.assertEqual(row['status'],'unavailable');self.assertIsNone(row['coverage']['matchedCount'])
            self.assertFalse(row['coverage']['complete']);self.assertEqual(row['events'],[])
    def test_unknown_decimals_or_missing_threshold(self):
        self.assertEqual(c.collect_token(Fake(decimals=256),TOKEN,100,100,'1')['status'],'unknown')
        self.assertEqual(c.collect_token(Fake(),TOKEN,100,100,None)['status'],'unknown')
    def test_reorg_rejected(self):
        row=c.collect_token(Fake(reorg=True),TOKEN,100,100,'1000000')
        self.assertEqual(row['reason'],'reorg_detected');self.assertEqual(row['events'],[])
    def test_provider_cap_rejects_full_page(self):
        self.assertEqual(c.collect_token(Fake([log()]*2000),TOKEN,100,100,'1')['reason'],'log_limit_or_invalid_response')
    def test_allowlist_rejects_keys_and_arbitrary_hosts(self):
        for u in ['http://bsc.drpc.org','https://bsc.drpc.org?key=secret','https://user:secret@bsc.drpc.org','https://localhost','https://bsc.drpc.org/secret']:
            with self.assertRaises(c.Unavailable): c.RPC(u)
        rpc=c.RPC(c.DEFAULT_RPC,budget=0)
        with self.assertRaisesRegex(c.Unavailable,'request_budget'): rpc.call('x',[])

if __name__=='__main__': unittest.main()
