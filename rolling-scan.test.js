const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),R=require('./rolling-oi.js'),{fixture,NOW}=require('./rolling-oi.test.js');
const src=fs.readFileSync(__dirname+'/rolling-scan.js','utf8');
function host(fetcher){
 const nodes=new Map();const $=s=>{if(!nodes.has(s))nodes.set(s,{textContent:'',disabled:false,style:{},value:s==='#scOiPct'?'30':s==='#scPxPct'?'10':'1000000'});return nodes.get(s)};
 const c={AbortController,crypto:require('node:crypto').webcrypto,console,setTimeout,clearTimeout,Date:class extends Date{static now(){return NOW}}};vm.createContext(c);vm.runInContext(src,c);
 const calls=[],records=new Map(),S={sc:{rows:[],U:50,mode:'pct'},ov:{ready:true,list:[{sym:'BTCUSDT',vol:2},{sym:'ETHUSDT',vol:1}]}};let csv;
 const h={S,$,store:{get:(k,d)=>records.get(k)||d,set:(k,v)=>records.set(k,JSON.parse(JSON.stringify(v)))},toast:()=>{},ban:()=>{},fetchJSON:async(u,o)=>{calls.push([u,o]);return fetcher(u,o)},R,render:()=>{},filtered:()=>S.sc.rows,csvDown:(...x)=>csv=x,relay:'https://relay.test'};
 return {x:c.RollingScanDraft.create(h),S,calls,records,$,csv:()=>csv};
}
test('old backend capability missing blocks before query; rows never daily fallback',async()=>{const h=host(()=>({worker:'online',agentOnline:true}));await h.x.scGo();a.equal(h.calls.length,1);a.equal(h.S.sc.state,'unsupported');a.equal(h.S.sc.rows.length,0);a.equal(h.records.size,0)});
test('valid v2 scan keeps thresholds, next null, isolated storage and UTC CSV',async()=>{
 const h=host(u=>u.endsWith('/health')?{capabilities:{rolling24:{ready:true,schemaVersion:2,maxSymbols:50}}}:u.endsWith('/query')?{jobId:'ab'.repeat(16)}:fixture());await h.x.scGo();a.equal(h.S.sc.state,'ready');a.equal(h.S.sc.rows.length,2);a.equal(h.S.sc.rows[0].pick,true);a.equal(h.S.sc.rows[0].next,null);
 a.equal(h.records.has('oif_lastscan'),false);a.equal(h.records.has('oif_lastscan_rolling24_v2'),true);const body=JSON.parse(h.calls[1][1].body);a.equal(body.mode,'rolling24');a.equal('period' in body,false);a.equal('limit' in body,false);
 h.x.scCsv();const [name,heads,rows]=h.csv();a.equal(name,'OI异动扫描_rolling24.csv');a.ok(heads.includes('窗口起始UTC'));a.match(rows[0][1],/Z$/);a.match(rows[0][14],/klines/);a.equal(h.x.scRestore({rows:[],W:3}),false);
 h.S.sc.rows=[];a.equal(h.x.scRestore(),true);a.equal(h.S.sc.state,'history');h.x.scNextCheck();a.equal(h.S.sc.next,null);
});
test('sigma and more than50 fail before any request and do not adjust thresholds',async()=>{for(const kind of ['sigma','universe']){const h=host(()=>{throw Error('unexpected')});if(kind==='sigma')h.S.sc.mode='z';else{h.S.sc.U=100;h.S.ov.list=Array.from({length:51},(_,i)=>({sym:'COIN'+i+'USDT',vol:1}))}await h.x.scGo();a.equal(h.calls.length,0);a.equal(h.S.sc.state,'unsupported');a.equal(h.$('#scOiPct').value,'30')}});
test('draft only fixed24 and sigma disabled while strong/intraday assets unchanged',()=>{const html=fs.readFileSync(__dirname+'/index.html','utf8');a.match(html,/固定滚动24h/);a.doesNotMatch(html,/<button data-w="[123]"[^>]*>\d天<\/button>[\s\S]*?id="scUni"/);a.match(html,/data-m="z" disabled/);for(const f of ['strong.js','oi-cap-radar.js','radar.js'])a.equal(fs.readFileSync(__dirname+'/'+f,'utf8'),fs.readFileSync('/var/minis/workspace/oi-radar-claude-fix/'+f,'utf8'));for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);});
test('real Python-produced fixture passes JS endpoint validator',()=>{const f=JSON.parse(fs.readFileSync(__dirname+'/fixtures/rolling-backend.json','utf8'));a.equal(R.validateResult(f,f.symbols,f.receivedAt).length,2)});

test('stop during delayed health does not submit a job or overwrite prior record',async()=>{
 let release;const health=new Promise(r=>release=r);const h=host(()=>health);h.S.sc.rows=[{sym:'OLDUSDT'}];const task=h.x.scGo();h.x.stop();release({capabilities:{rolling24:{ready:true,schemaVersion:2,maxSymbols:50}}});await task;
 a.equal(h.calls.length,1);a.equal(h.S.sc.state,'stopped');a.equal(h.S.sc.rows[0].sym,'OLDUSDT');a.equal(h.records.size,0);a.equal(h.$('#scGo').disabled,false);
});
test('in-flight UI edits do not change thresholds or saved universe and collection time is visible',async()=>{
 let release;const delayed=new Promise(r=>release=r);const h=host(u=>u.endsWith('/health')?delayed:u.endsWith('/query')?{jobId:'ab'.repeat(16)}:fixture());const task=h.x.scGo();h.S.sc.U=100;h.$('#scOiPct').value='99';release({capabilities:{rolling24:{ready:true,schemaVersion:2,maxSymbols:50}}});await task;
 a.equal(h.S.sc.params.oiPct,30);a.equal(h.S.sc.config.U,50);a.equal(h.S.sc.rows[0].pick,true);const saved=h.records.get('oif_lastscan_rolling24_v2');a.equal(saved.U,50);a.match(h.$('#scChips').textContent,/采集时间/);a.equal(h.S.sc.t0,h.S.sc.result.receivedAt);h.x.scRestore();a.match(h.$('#scChips').textContent,/历史记录/);
});
test('endpoint validation failure does not save a partial universe or replace prior rows',async()=>{
 const bad=fixture();bad.results[0].data[0].timestamp+=300000;const h=host(u=>u.endsWith('/health')?{capabilities:{rolling24:{ready:true,schemaVersion:2,maxSymbols:50}}}:u.endsWith('/query')?{jobId:'ab'.repeat(16)}:bad);h.S.sc.rows=[{sym:'OLDUSDT'}];await h.x.scGo();a.equal(h.S.sc.rows[0].sym,'OLDUSDT');a.equal(h.records.size,0);a.notEqual(h.S.sc.state,'ready');
});
