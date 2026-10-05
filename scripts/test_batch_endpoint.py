import io,json,unittest
from urllib.error import HTTPError
import collect_onchain as c

class CorrectBatchTests(unittest.TestCase):
 def token(self,symbol,address='0x'+'a'*40,chain='bsc',chain_id=56):
  return {'symbol':symbol,'chain':chain,'chainId':chain_id,'address':address,'adapterSupported':True}
 def test_exact_batch_endpoint_and_alias_address_dedup(self):
  calls=[];t=self.token('AAAUSDT');alias=self.token('AAAUSDC')
  def opener(req,timeout):
   calls.append(req.full_url)
   self.assertEqual(req.full_url,c.BATCH_API+'/bsc/'+t['address'])
   return io.BytesIO(json.dumps([{'chainId':'bsc','baseToken':{'address':t['address'].upper()}}]).encode())
  rows,err=c.fetch_pairs_batched([t,alias],opener=opener,workers=1,interval=0)
  self.assertEqual(len(calls),1);self.assertEqual(set(rows),{'AAAUSDT','AAAUSDC'});self.assertEqual(err,{})
  self.assertEqual(len(rows['AAAUSDT']),1)
 def test_429_halts_unstarted_batches_and_does_not_retry(self):
  ts=[self.token('T'+str(i)+'USDT','0x'+format(i+1,'040x'))for i in range(65)];calls=[]
  def opener(req,timeout):
   calls.append(req.full_url);raise HTTPError(req.full_url,429,'fixture',{},None)
  rows,err=c.fetch_pairs_batched(ts,opener=opener,workers=1,interval=0)
  self.assertEqual(len(calls),1);self.assertEqual(rows,{});self.assertEqual(len(err),65);self.assertEqual(set(err.values()),{'rate_limited'})
 def test_failed_alias_group_is_not_reported_as_empty_pool(self):
  t=self.token('XUSDT');alias=self.token('XUSDC')
  def opener(req,timeout):raise HTTPError(req.full_url,503,'fixture',{},None)
  rows,err=c.fetch_pairs_batched([t,alias],opener=opener,pause=lambda _:None,workers=1,interval=0)
  self.assertEqual(rows,{});self.assertEqual(err,{'XUSDT':'http_503','XUSDC':'http_503'})
