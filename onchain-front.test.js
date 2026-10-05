'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('./onchain.js'),Chains=require('./chains.js'),source=fs.readFileSync(__dirname+'/onchain.js','utf8');
const read=name=>JSON.parse(fs.readFileSync(__dirname+'/'+name,'utf8'));
const registry=read('onchain.registry.json'),universe=read('onchain.universe.json');
const t={symbol:'TESTUSDT',chain:'bsc',chainId:56,address:'0x'+'a'.repeat(40),mappingStatus:'mapped',identityVerification:'provider_matched',independentlyProjectVerified:false,sources:[{url:'https://provider.invalid/identity'}]};
const entry=(symbol,status='mapped',verification=status==='mapped'?'provider_matched':'unmapped')=>({symbol,baseAsset:symbol.replace(/USDT$/,''),quoteAsset:'USDT',mappingStatus:status,identityVerification:verification,reason:'fixture_reason',warnings:[],denomination:1});
const snapshot=()=>({schemaVersion:1,collectionMode:'manual',tokens:{TESTUSDT:{identity:t,status:'ok',fetchedAt:new Date().toISOString(),liquidityUsd:null,volumeUsd:{h1:null,h24:0},txns:{h1:{buys:70,sells:30}},pools:[]}}});
const smallUniverse=()=>({schemaVersion:1,universe:[entry('TESTUSDT'),entry('BTCUSDT','native_no_dex_contract'),entry('ADAPTUSDT','no_adapter'),entry('AMBIGUSDT','ambiguous_identity'),entry('PENDUSDT','pending_verification')]});

// Dependency-free minimal DOM: real nodes/selector traversal, property writes and
// asynchronous child-list observation, rather than source-only regex UI assertions.
function minimalDOM(){
 const doc={writes:0,observers:[],batches:0,hidden:false};
 const decode=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.nodeType=1;this.children=[];this.parentNode=null;this.attrs={};this._text='';this._disabled=false;this.open=false;
   this.dataset=new Proxy({}, {set:(o,k,v)=>{o[k]=String(v);this.attrs['data-'+k.replace(/[A-Z]/g,x=>'-'+x.toLowerCase())]=String(v);doc.writes++;return true}});
   this.classList={contains:c=>this.className.split(/\s+/).includes(c),toggle:(c,on)=>{const a=new Set(this.className.split(/\s+/).filter(Boolean));if(on)a.add(c);else a.delete(c);this.className=[...a].join(' ')}};
  }
  get parentElement(){return this.parentNode}
  get id(){return this.attrs.id||''} set id(v){this.attrs.id=v;doc.writes++}
  get className(){return this.attrs.class||''} set className(v){this.attrs.class=v;doc.writes++}
  get title(){return this.attrs.title||''} set title(v){this.attrs.title=v;doc.writes++}
  get disabled(){return this._disabled} set disabled(v){this._disabled=!!v;doc.writes++}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join('')}
  set textContent(v){this._text=String(v);this.children=[];doc.writes++;notify(this,[{nodeType:3}])}
  get innerHTML(){return this._html||''}
  set innerHTML(html){this._html=html;this._text='';this.children=[];doc.writes++;const stack=[this];
   for(const part of html.match(/<[^>]+>|[^<]+/g)||[]){
    if(part.startsWith('</')){if(stack.length>1)stack.pop();continue}
    if(part.startsWith('<')){const m=/^<([\w-]+)/.exec(part);if(!m)continue;const node=new Element(m[1]);
     for(const a of part.matchAll(/([\w-]+)="([^"]*)"/g)){const key=a[1],value=decode(a[2]);node.attrs[key]=value;if(key.startsWith('data-'))node.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value}
     node._disabled=/\sdisabled(?:\s|>)/.test(part);stack.at(-1).append(node);if(!['BR','INPUT','HR','IMG','META','LINK'].includes(node.tagName))stack.push(node);
    }else stack.at(-1)._text+=decode(part);
   }
  }
  matches(selector){return selector.split(',').some(s=>{s=s.trim();const id=/#([\w-]+)/.exec(s),cl=/\.([\w-]+)/.exec(s),attr=/\[([\w-]+)\]/.exec(s),tag=/^[\w-]+/.exec(s);return (!id||this.id===id[1])&&(!cl||this.classList.contains(cl[1]))&&(!attr||Object.hasOwn(this.attrs,attr[1]))&&(!tag||this.tagName===tag[0].toUpperCase())})}
  querySelectorAll(s){return this.children.flatMap(c=>[...(c.matches(s)?[c]:[]),...c.querySelectorAll(s)])}
  querySelector(s){return this.querySelectorAll(s)[0]||null}
  closest(s){for(let n=this;n;n=n.parentNode)if(n.matches(s))return n;return null}
  append(node){node.parentNode=this;this.children.push(node);doc.writes++;notify(this,[node])}
  prepend(node){node.parentNode=this;this.children.unshift(node);doc.writes++;notify(this,[node])}
  after(node){const p=this.parentNode;node.parentNode=p;p.children.splice(p.children.indexOf(this)+1,0,node);doc.writes++;notify(p,[node])}
  remove(){const p=this.parentNode;if(p){p.children.splice(p.children.indexOf(this),1);this.parentNode=null;doc.writes++;notify(p,[])}}
 }
 function notify(target,addedNodes){for(const o of doc.observers){if(o.targets.some(t=>{for(let n=target;n;n=n.parentNode)if(n===t)return true;return false})){o.records.push({target,addedNodes});if(!o.queued){o.queued=true;queueMicrotask(()=>{o.queued=false;const records=o.records.splice(0);doc.batches++;o.callback(records)})}}}}
 doc.root=new Element('body');doc.createElement=tag=>new Element(tag);doc.querySelector=s=>doc.root.querySelector(s);doc.querySelectorAll=s=>doc.root.querySelectorAll(s);
 doc.root.innerHTML='<div><div><input id="ovSearch"></div></div><p id="opHelp"></p><div id="v-detail"></div>'+['ovTbl','scTbl','qdTbl','idTbl','stTbl','rtTbl'].map(id=>'<table id="'+id+'"><tbody></tbody></table>').join('');
 doc.MutationObserver=class{constructor(callback){this.callback=callback;this.targets=[];this.records=[];doc.observers.push(this)}observe(n){this.targets.push(n)}};
 return doc;
}
function frontend(files={},failures=new Set()){
 const doc=minimalDOM(),requests=[],intervals=[],defaults={'onchain.registry.json':{schemaVersion:1,tokens:[t]},'onchain.universe.json':smallUniverse(),'data/onchain.json':snapshot(),'data/transfers.json':{schemaVersion:1,tokens:{}}};let scans=0;
 const ctx={URL,AbortController,TextDecoder,TextEncoder,Blob,ChainAdapters:Chains,document:doc,MutationObserver:doc.MutationObserver,setTimeout,clearTimeout,setInterval:(fn,ms)=>intervals.push({fn,ms}),fC:String,fN:String,S:{ov:{favOnly:false,ready:false,page:1},dt:{sym:'TESTUSDT'},rt:{on:false},sc:{run:false},st:{run:false},id:{on:false}},ovRender(){},jumpSym(){},startScan(){scans++},fetch:async(path,options)=>{const name=path.split('?')[0];requests.push({name,options});if(failures.has(name))throw Error('fixture offline');return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify(files[name]??defaults[name])}}};
 vm.createContext(ctx);vm.runInContext(source,ctx);ctx.onchainInit();
 return {ctx,doc,requests,intervals,failures,get scans(){return scans}};
}
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};

test('universe validates all five states, Chinese symbols, uniqueness and the 2000 cap',()=>{
 assert.equal(C.validateUniverse(universe).length,571);const one=entry('龙虾USDT');
 assert.equal(C.validateUniverse({schemaVersion:1,universe:[one]}).length,1);
 for(const data of [{...smallUniverse(),schemaVersion:2},{schemaVersion:1,universe:[one,one]},{schemaVersion:1,universe:[{...one,mappingStatus:'invented'}]},{schemaVersion:1,universe:[{...one,identityVerification:'unmapped'}]},{schemaVersion:1,universe:[{...one,warnings:['<script>'],denomination:0}]},{schemaVersion:1,universe:[{...one,symbol:'BAD\nUSDT'}]}])assert.throws(()=>C.validateUniverse(data));
 const many=n=>({schemaVersion:1,universe:Array.from({length:n},(_,i)=>entry('T'+i+'USDT'))});assert.equal(C.validateUniverse(many(2000)).length,2000);assert.throws(()=>C.validateUniverse(many(2001)));
});
test('repository counts are recomputed, not trusted coverage claims or filled DEX data',()=>{
 const reg=C.validateRegistry(registry),cat=C.validateUniverse({...universe,coverage:{totalPerpetualSymbols:9999,mappedSymbols:9999}}),c=C.catalogCounts(cat,reg);
 assert.deepEqual(c.counts,{mapped:275,native_no_dex_contract:61,no_adapter:20,ambiguous_identity:7,pending_verification:208});
 assert.equal(c.total,571);assert.equal(c.valid,275);assert.equal(c.official,66);assert.equal(c.provider,209);assert.equal(c.fresh,0);assert.equal(c.missing,275);
});
test('Node uses actual multi-chain adapters without a global ChainAdapters',()=>{
 for(const chain of ['ethereum','solana','sui']){const token=registry.tokens.find(r=>r.chain===chain);assert.equal(C.validateRegistry({schemaVersion:1,tokens:[token]}).length,1);assert.equal(C.identity(token,token),true);assert.match(C.chainExplorer(token),/^https:/)}
 const sol=registry.tokens.find(r=>r.chain==='solana');assert.match(C.poolLink(sol,{pairAddress:sol.address,dexId:'fixture'}),/href="https:\/\/dexscreener.com\/solana\//);assert.doesNotMatch(C.poolLink(sol,{pairAddress:'0x'+'a'.repeat(40)}),/href=/);assert.doesNotMatch(C.poolLink(sol,{pairAddress:'javascript:alert(1)'}),/href=/);
});
test('catalog badges, detail reasons and provider disclosure use actual minimal DOM',async()=>{
 const f=frontend();await f.ctx.onchainLoad();await settle();
 assert.match(f.doc.querySelector('#ocSummary').textContent,/全市场目录 5 个.*目录已映射 1 个.*provider_matched 1.*有效快照 1/);
 for(const u of smallUniverse().universe.slice(1)){f.ctx.S.dt.sym=u.symbol;f.ctx.onchainDetailChanged();const html=f.doc.querySelector('#ocDetailBody').innerHTML;assert.ok(html.includes(u.mappingStatus));assert.ok(html.includes(u.reason));assert.doesNotMatch(html,/oc-metrics|data-oc-sym/);assert.match(f.ctx.onchainBadge(u.symbol),new RegExp(u.mappingStatus));assert.match(f.ctx.onchainAlertTag(u.symbol),/未接入可验证链上数据/)}
 f.ctx.S.dt.sym=t.symbol;f.ctx.onchainRender();const html=f.doc.querySelector('#ocDetailBody').innerHTML;
 assert.match(html,/provider_matched/);assert.match(html,/未经项目方独立核验/);assert.match(html,/不是项目方官方合约核验/);assert.match(html,/可计量池流动性<\/span><b>暂无/);assert.match(html,/24h DEX 成交额<\/span><b>\$0/);
});
test('full 571 catalog and 275 registry never create 275 shortcuts or launch scans',async()=>{
 const f=frontend({'onchain.registry.json':registry,'onchain.universe.json':universe});assert.equal(f.requests.length,4);await f.ctx.onchainLoad();await settle();
 assert.equal(f.ctx.Onchain.registryBySymbol.size,275);assert.equal(f.ctx.Onchain.universeBySymbol.size,571);assert.match(f.doc.querySelector('#ocSummary').textContent,/571.*275.*official 66 \/ provider_matched 209/);
 assert.equal(f.doc.querySelector('#ocPilotList'),null);assert.equal(f.doc.querySelectorAll('[data-oc-sym]').length,0);assert.equal(f.requests.length,4);assert.equal(f.scans,0);
 assert.equal(f.ctx.S.rt.on,false);assert.equal(f.ctx.S.sc.run,false);assert.equal(f.ctx.S.st.run,false);assert.equal(f.ctx.S.id.on,false);assert.equal(f.intervals.length,1);
 const mapped=registry.tokens[0].symbol;f.ctx.Onchain.registry.find=()=>{throw Error('linear lookup forbidden')};f.ctx.Onchain.universe.find=()=>{throw Error('linear lookup forbidden')};f.ctx.Onchain.registry.map=()=>{throw Error('index must be reused')};
 for(let i=0;i<100;i++){f.ctx.onchainBadge(mapped);f.ctx.onchainAlertTag(mapped)}assert.equal(f.requests.length,4);
 f.ctx.Onchain.only.market=true;assert.deepEqual(Array.from(f.ctx.onchainFilter([{sym:mapped},{sym:'BTCUSDT'}]),r=>r.sym),[mapped]);f.ctx.S.ov.favOnly=true;assert.equal(f.ctx.onchainFilter([{sym:mapped},{sym:'BTCUSDT'}]).length,2);
 f.ctx.onchainInit();assert.equal(f.doc.querySelectorAll('#ocOnly').length,1);assert.equal(f.intervals.length,1);
});
test('decorator deduplicates same-row symbols and no-op renders perform zero DOM writes',async()=>{
 const f=frontend();await f.ctx.onchainLoad();const body=f.doc.querySelector('#ovTbl').querySelector('tbody');
 body.innerHTML='<tr><td><a data-sym="TESTUSDT">TEST</a><a data-sym="TESTUSDT">again</a><span class="oc-badge">old</span><span class="oc-badge">duplicate</span></td></tr>';await settle();
 assert.equal(body.querySelectorAll('.oc-badge').length,1);assert.match(body.querySelector('.oc-badge').textContent,/提供方匹配/);assert.equal(body.querySelector('.oc-badge').dataset.ocStatus,'mapped');
 const writes=f.doc.writes,batches=f.doc.batches;for(let i=0;i<20;i++){f.ctx.onchainDecorate();f.ctx.onchainRender()}await settle();assert.equal(f.doc.writes,writes);assert.equal(f.doc.batches,batches);assert.equal(f.requests.length,4);
 body.innerHTML='<tr><td><a data-st-sym="BTCUSDT">BTC</a></td></tr>';await settle();assert.equal(body.querySelector('.oc-badge').dataset.ocStatus,'native_no_dex_contract');
});
test('all four cache requests start independently; DEX failure retains mapping, catalog, Transfer',async()=>{
 const f=frontend({},new Set(['data/onchain.json']));assert.deepEqual(f.requests.map(r=>r.name),['onchain.registry.json','onchain.universe.json','data/onchain.json','data/transfers.json']);await f.ctx.onchainLoad();
 assert.equal(f.ctx.Onchain.registry.length,1);assert.equal(f.ctx.Onchain.universe.length,5);assert.ok(f.ctx.Onchain.transferCache);assert.match(f.ctx.Onchain.error,/DEX/);assert.equal(f.ctx.Onchain.counts.valid,1);assert.match(f.ctx.onchainBadge(t.symbol),/链上快照暂无/);
});
test('failed DEX reload marks old rows stale, Transfer remains independent, then recovers',async()=>{
 const f=frontend();await f.ctx.onchainLoad();f.failures.add('data/onchain.json');await f.ctx.onchainLoad(true);assert.equal(f.ctx.Onchain.rows.TESTUSDT.status,'stale');assert.equal(f.ctx.Onchain.counts.fresh,0);assert.ok(f.ctx.Onchain.transferCache);assert.match(f.ctx.onchainAlertTag(t.symbol),/旧快照待更新/);
 f.failures.delete('data/onchain.json');f.failures.add('data/transfers.json');await f.ctx.onchainLoad(true);assert.equal(f.ctx.Onchain.counts.fresh,1);assert.equal(f.ctx.Onchain.transferCache,null);assert.match(f.ctx.Onchain.transferError,/不可用/);assert.equal(f.ctx.Onchain.error,'');
});
test('bad catalog, missing registry and identity mismatches fail closed without fake metrics',async()=>{
 const bad=frontend({'onchain.universe.json':{schemaVersion:1,universe:[{...entry('TESTUSDT'),mappingStatus:'bad'}]}});await bad.ctx.onchainLoad();assert.match(bad.ctx.Onchain.error,/目录/);assert.equal(bad.ctx.Onchain.counts.valid,1);assert.equal(bad.ctx.Onchain.counts.fresh,1);
 const f=frontend({},new Set(['onchain.registry.json']));await f.ctx.onchainLoad();assert.equal(f.ctx.Onchain.universe.length,5);assert.equal(f.ctx.Onchain.counts.valid,0);assert.match(f.ctx.onchainBadge(t.symbol),/地址登记暂无/);assert.doesNotMatch(f.doc.querySelector('#ocDetailBody').innerHTML,/oc-metrics/);
 const wrong=snapshot();wrong.tokens.TESTUSDT.identity={...t,address:'0x'+'b'.repeat(40)};const mismatch=frontend({'data/onchain.json':wrong});await mismatch.ctx.onchainLoad();assert.equal(mismatch.ctx.Onchain.counts.fresh,0);assert.match(mismatch.ctx.onchainBadge(t.symbol),/快照暂无/);
 const blocked=smallUniverse();blocked.universe[0]=entry('TESTUSDT','ambiguous_identity');const conflict=frontend({'onchain.universe.json':blocked});await conflict.ctx.onchainLoad();assert.equal(conflict.ctx.Onchain.counts.valid,0);assert.match(conflict.ctx.onchainBadge(t.symbol),/身份有歧义/);
});

test('JSON reader accepts multi-megabyte snapshots but enforces a 16 MiB byte cap',async()=>{
 const old=global.fetch;let textCalls=0,released=false,signal;
 try{
  const payload=JSON.stringify({padding:'x'.repeat(3*1024*1024),ok:true});global.fetch=async()=>({ok:true,headers:{get:()=>null},text:async()=>{textCalls++;return payload}});
  assert.equal((await C.getJson('data/onchain.json')).ok,true);assert.equal(textCalls,1);assert.equal(C.MAX_JSON_BYTES,16*1024*1024);
  global.fetch=async()=>({ok:true,headers:{get:()=>String(C.MAX_JSON_BYTES+1)},text:async()=>{throw Error('must reject before text read')}});await assert.rejects(C.getJson('too-large.json'),/16 MiB/);
  const chunk=new TextEncoder().encode(' '.repeat(4*1024*1024));let reads=0;
  global.fetch=async(path,options)=>{signal=options.signal;return {ok:true,headers:{get:()=>null},body:{getReader:()=>({read:async()=>({done:false,value:++reads<=4?chunk:new Uint8Array([32])}),releaseLock(){released=true}})}}};
  await assert.rejects(C.getJson('too-large-stream.json'),/16 MiB/);assert.equal(reads,5);assert.equal(signal.aborted,true);assert.equal(released,true);
  // UTF-8 byte count, not UTF-16 character count, bounds the fallback too.
  global.fetch=async()=>({ok:true,headers:{get:()=>null},text:async()=>'"'+'中'.repeat(Math.floor(C.MAX_JSON_BYTES/3)+1)+'"'});await assert.rejects(C.getJson('utf8-too-large.json'),/16 MiB/);
 }finally{global.fetch=old}
});
