#!/usr/bin/env python3
"""Publish only validated current collection attempts, including honest failure states."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parents[1]

def read(path):
    raw=path.read_bytes()
    if len(raw)>16*1024*1024: raise ValueError('oversize cache')
    d=json.loads(raw)
    if not isinstance(d,dict) or d.get('schemaVersion')!=1: raise ValueError('invalid schema')
    return d

def collect_step(command,path,timeout,run=subprocess.run):
    before=path.read_bytes() if path.exists() else None
    p=run(command,cwd=ROOT,timeout=timeout,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if p.returncode not in (0,1,2): raise ValueError('collector exited unexpectedly')
    if not path.exists() or path.read_bytes()==before: raise ValueError('collector wrote no new validated attempt')
    d=read(path)
    at=datetime.fromisoformat(d['generatedAt'].replace('Z','+00:00'))
    age=(datetime.now(timezone.utc)-at).total_seconds()
    if at.tzinfo is None or not -300<=age<=timeout+60: raise ValueError('stale generation')
    if not isinstance(d.get('tokens'),dict): raise ValueError('invalid tokens')
    return d

def coverage(registry,universe,dex,transfers):
    mapped={t['symbol'] for t in registry['tokens']}
    rows=[]
    for item in universe['universe']:
        symbol=item['symbol'];r=dex['tokens'].get(symbol);tr=transfers['tokens'].get(symbol)
        rows.append({'symbol':symbol,'mappingStatus':item['mappingStatus'],
                     'dexStatus':r.get('status') if r else 'not_applicable' if item['mappingStatus']=='native_no_dex_contract' else 'unmapped',
                     'dexError':r.get('error') if r else None,
                     'dexFetchedAt':r.get('fetchedAt') if r else None,
                     'transferStatus':tr.get('status') if tr else 'unmapped',
                     'transferReason':tr.get('reason') if tr else None,
                     'transferFetchedAt':tr.get('fetchedAt') if tr else None})
    if set(dex['tokens'])!=mapped or set(transfers['tokens'])!=mapped: raise ValueError('collector coverage mismatch')
    counts={}
    for key in ['mappingStatus','dexStatus','transferStatus']:
        counts[key]={}
        for r in rows: counts[key][r[key]]=counts[key].get(r[key],0)+1
    return {'schemaVersion':1,'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'totalSymbols':len(rows),'mappedSymbols':len(mapped),'counts':counts,'symbols':rows,
            'note':'Statuses are not fabricated values. Transfer quantity filtering has no historical USD valuation or address labels.'}

def main(argv=None):
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--data-dir',type=Path,default=ROOT/'data');a=ap.parse_args(argv)
    a.data_dir.mkdir(parents=True,exist_ok=True)
    dex=collect_step([sys.executable,'scripts/collect_onchain.py','--registry','onchain.registry.json','--data-dir',str(a.data_dir)],a.data_dir/'onchain.json',240)
    tr=collect_step([sys.executable,'scripts/collect_transfers.py','--registry','onchain.registry.json','--blocks','100','--deadline','180','--output',str(a.data_dir/'transfers.json')],a.data_dir/'transfers.json',210)
    report=coverage(read(ROOT/'onchain.registry.json'),read(ROOT/'onchain.universe.json'),dex,tr)
    from collect_onchain import atomic_json
    atomic_json(a.data_dir/'onchain-coverage.json',report)
    print(json.dumps({'total':report['totalSymbols'],'mapped':report['mappedSymbols'],'counts':report['counts']},ensure_ascii=False))
    return 0
if __name__=='__main__':raise SystemExit(main())
