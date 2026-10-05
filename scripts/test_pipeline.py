import unittest
from datetime import datetime,timezone
from pathlib import Path
import tempfile,json
from types import SimpleNamespace
import collect_pipeline as p

class PipelineTests(unittest.TestCase):
 def test_all_failed_attempts_are_publishable_not_zeros(self):
  reg={'tokens':[{'symbol':'A'}]};uni={'universe':[{'symbol':'A','mappingStatus':'mapped'},{'symbol':'B','mappingStatus':'native_no_dex_contract'},{'symbol':'C','mappingStatus':'pending_verification'}]}
  dex={'tokens':{'A':{'status':'error','error':'network_error','fetchedAt':None}}};tr={'tokens':{'A':{'status':'unavailable','reason':'rpc_network_error','fetchedAt':None}}}
  r=p.coverage(reg,uni,dex,tr)
  self.assertEqual(r['totalSymbols'],3);self.assertEqual(r['mappedSymbols'],1)
  self.assertEqual(r['counts']['dexStatus'],{'error':1,'not_applicable':1,'unmapped':1})
  self.assertNotIn('matchedCount',r['symbols'][0])
 def test_partial_or_wrong_symbol_cache_rejected(self):
  with self.assertRaisesRegex(ValueError,'coverage mismatch'):
   p.coverage({'tokens':[{'symbol':'A'},{'symbol':'B'}]},{'universe':[]},{'tokens':{'A':{}}},{'tokens':{}})
 def test_nonzero_provider_exit_with_current_attempt_can_be_published(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'cache.json'
   def run(*args,**kw):
    path.write_text(json.dumps({'schemaVersion':1,'generatedAt':datetime.now(timezone.utc).isoformat(),'tokens':{'A':{'status':'error'}}}));return SimpleNamespace(returncode=1)
   r=p.collect_step(['test'],path,20,run)
   self.assertEqual(r['tokens']['A']['status'],'error')
 def test_unchanged_cache_or_bad_collector_exit_cannot_be_relabelled(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'cache.json';path.write_text('{}')
   with self.assertRaisesRegex(ValueError,'no new'):
    p.collect_step([],path,20,lambda *a,**kw:SimpleNamespace(returncode=1))
   with self.assertRaisesRegex(ValueError,'unexpected'):
    p.collect_step([],path,20,lambda *a,**kw:SimpleNamespace(returncode=42))
