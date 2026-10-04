#!/usr/bin/env python3
import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
src=Path('/var/minis/workspace/allchain/proposed-registry.json')
out=root/'onchain.registry.json'; universe_out=root/'onchain.universe.json'
d=json.loads(src.read_text())
tokens=[]
for t in d['tokens']:
    tokens.append({k:t[k] for k in ('symbol','baseAsset','quoteAsset','name','chain','chainId','address','mappingStatus','identityMethod','identityVerification','independentlyProjectVerified','denomination','denominationSource','sources','warnings') if k in t})
# Keep all mapped identities; collector records unsupported adapters explicitly.
out.write_text(json.dumps({'schemaVersion':1,'generatedAt':d['generatedAt'],'scope':d['scope'],'coverage':d['coverage'],'tokens':tokens},ensure_ascii=False,separators=(',',':'))+'\n')
cat=[]
for r in d['universe']:
    cat.append({k:r[k] for k in ('symbol','baseAsset','quoteAsset','mappingStatus','identityVerification','chain','chainId','address','reason','warnings','denomination','denominationSource') if k in r})
universe_out.write_text(json.dumps({'schemaVersion':1,'generatedAt':d['generatedAt'],'coverage':d['coverage'],'universe':cat},ensure_ascii=False,separators=(',',':'))+'\n')
print(json.dumps({'mapped':len(tokens),'catalog':len(cat),'registry_bytes':out.stat().st_size,'universe_bytes':universe_out.stat().st_size},ensure_ascii=False))
