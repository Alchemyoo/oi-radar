'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const script=html.match(/<script>\s*'use strict';([\s\S]*?)<\/script>/)[1];
function fn(name){const m=new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\(').exec(script);assert.ok(m);return script.slice(m.index,script.indexOf('\n}',m.index)+2)}
function harness(){
  const nodes=new Map(),records=new Map();
  const $=s=>{if(!nodes.has(s))nodes.set(s,{value:({'#scOiPct':30,'#scPxPct':10,'#scMinOi':1000000})[s],style:{},classList:{add(){},remove(){}},innerHTML:'',textContent:''});return nodes.get(s)};
  class Clock extends Date{static now(){return Date.parse('2026-10-05T08:00:00Z')}}
  const c=vm.createContext({Date:Clock,DAY:86400000,MIN:60000,Map,Set,console,$,
    S:{ov:{ready:true,list:[{sym:'BTCUSDT',vol:1}]},sc:{W:3,U:1,mode:'pct',filter:'all',sort:'net',dir:-1,rows:[]},qd:{W:3,U:1,rows:[]}},
    dstr:t=>new Date(t).toISOString().slice(0,10),utcToday0:()=>Date.parse('2026-10-05T00:00:00Z'),
    store:{set:(k,v)=>records.set(k,JSON.parse(JSON.stringify(v))),get:(k,d)=>records.get(k)||d},
    ban(){},toast(){},scNextCheck(){},qdStatsBuild(){},qdRender(){},fC:String,fP:String,clsP:()=>'',
  });
  vm.runInContext(fs.readFileSync(__dirname+'/radar.js','utf8'),c);
  for(const n of ['pool','scGo','scOne','scSave','scRestore','scFiltered','scRender','scMeta','scCsv','qdOne','qdGo','dailyEnd']){
    if(n==='dailyEnd')vm.runInContext(script.slice(script.indexOf('const dailyEnd='),script.indexOf('async function scOne')),c);
    else vm.runInContext(fn(n),c);
  }
  return {c,$,records};
}
const valid={oiS:2000000,oiE:2100000,coinS:100,coinE:140,px:1,z:3,src:'hist'};
const hist=c=>{const w=c.OiRadar.scWindow(3,c.Date.now());return [{t:w.startMs,oiv:2000000,oi:100},{t:w.endMs,oiv:2100000,oi:140}]};
test('quadrant TypeError cannot poison scanner history; scanner flag cannot skip quadrant',async()=>{
  const {c}=harness();c.S.sc.noHist=true;let calls=0;c.loadOiHist=async()=>{calls++;throw new TypeError('network')};c.fetchDay=async()=>[];
  await c.qdOne('BTCUSDT',3);assert.equal(calls,1);assert.equal(c.S.qd.noHist,true);
  c.S.sc.noHist=false;await c.qdOne('BTCUSDT',3);assert.equal(c.S.sc.noHist,false);assert.equal(calls,1);
  c.loadOiHist=async()=>{calls++;return hist(c)};c.loadKlines=async()=>[];
  const r=await c.scOne('BTCUSDT',c.OiRadar.scWindow(3,c.Date.now()),{mode:'pct',noHist:false});assert.equal(r.src,'hist');assert.equal(calls,2);
});
test('quadrant new run resets only its own degradation flag',async()=>{
  const {c}=harness();c.S.qd.noHist=true;c.S.sc.noHist=true;c.qdOne=async()=>{assert.equal(c.S.qd.noHist,false);return null};
  await c.qdGo();assert.equal(c.S.sc.noHist,true);
});
test('in-flight mode/window/universe edits do not alter decision or saved config',async()=>{
  const {c,records}=harness();c.scOne=async(sym,win,ctx)=>{assert.equal(win.W,3);assert.equal(ctx.mode,'pct');c.S.sc.mode='z';c.S.sc.W=1;c.S.sc.U=100;return {...valid,z:null}};
  await c.scGo();assert.equal(c.S.sc.rows[0].pick,true);assert.equal(c.S.sc.err,0);
  const r=records.get('oif_lastscan');assert.equal(r.mode,'pct');assert.equal(r.W,3);assert.equal(r.U,1);assert.equal(r.params.oiPct,30);
});
test('scOne uses snapshot mode and exact window request sizes after UI edits',async()=>{
  const {c}=harness();const w=c.OiRadar.scWindow(3,c.Date.now());c.S.sc.W=1;c.S.sc.mode='z';const sizes=[];
  c.loadOiHist=async(s,n)=>{sizes.push(n);return hist(c)};c.loadKlines=async(s,n)=>{sizes.push(n);return []};
  const r=await c.scOne('BTCUSDT',w,{mode:'pct',noHist:false});assert.deepEqual(sizes,[7,6]);assert.equal(r.z,null);
});
test('nonfinite or overflowing notional endpoints fail without retaining invalid row',async()=>{
  for(const bad of [{oiS:NaN},{oiE:Infinity},{oiS:0},{oiE:-1},{oiS:Number.MIN_VALUE,oiE:Number.MAX_VALUE}]){
    const {c}=harness();c.scOne=async()=>({...valid,...bad});await c.scGo();assert.equal(c.S.sc.err,1);assert.equal(c.S.sc.rows.length,0);
  }
});
test('nonfinite price/coin ratio/z count one failure and cannot qualify',async()=>{
  for(const [mode,bad] of [['pct',{px:NaN}],['pct',{px:Infinity}],['pct',{coinS:Number.MIN_VALUE,coinE:Number.MAX_VALUE}],['pct',{coinE:Infinity}],['z',{z:NaN}],['z',{z:Infinity}]]){
    const {c}=harness();c.S.sc.mode=mode;c.scOne=async()=>({...valid,...bad});await c.scGo();assert.equal(c.S.sc.err,1);assert.equal(c.S.sc.rows[0].pick,false);
  }
});
test('source summary follows actual rows including mixed and legacy sources',async()=>{
  const {c,$}=harness();c.S.sc.U=0;c.S.ov.list.push({sym:'ETHUSDT',vol:.5});c.scOne=async s=>({...valid,src:s==='BTCUSDT'?'hist':'archive'});
  await c.scGo();assert.match($('#scChips').innerHTML,/历史接口 \+ 归档 zip/);
  c.S.sc.rows.push({...valid});delete c.S.sc.rows[2].src;c.scMeta();assert.match($('#scChips').innerHTML,/未知（旧记录）/);
});
test('exact-endpoint history miss reports successful archive source without TypeError',async()=>{
  const {c}=harness();const w=c.OiRadar.scWindow(3,c.Date.now());c.loadOiHist=async()=>[];
  c.fetchDay=async(s,d)=>[{t:Date.parse(d+'T23:55:00Z'),oiv:2000000,oi:100}];c.loadKlines=async()=>[];
  const ctx={mode:'pct',noHist:false};const r=await c.scOne('BTCUSDT',w,ctx);assert.equal(r.src,'archive');assert.equal(r.oiS,2000000);assert.equal(ctx.noHist,false);
});
test('stop discards pending symbol, starts no more archive/price work and persists coverage',async()=>{
  const {c,records,$}=harness();c.loadOiHist=async()=>{c.S.sc.stop=true;throw new TypeError('aborted')};let extra=0;
  c.fetchDay=c.loadKlines=async()=>{extra++;return []};await c.scGo();assert.equal(extra,0);assert.equal(c.S.sc.done,0);assert.equal(c.S.sc.err,0);assert.equal(c.S.sc.rows.length,0);
  assert.match($('#scStat').textContent,/已停止 0\/1/);const r=records.get('oif_lastscan');assert.equal(r.stop,true);assert.equal(r.total,1);
});
test('failure and stop state survive JSON save/restore including zero successful rows and U=0',async()=>{
  const {c,records,$}=harness();c.S.sc.U=0;c.scOne=async()=>({...valid,px:null});await c.scGo();c.S.sc.stop=true;c.scSave();
  const r=records.get('oif_lastscan');r.rows=[];c.S.sc.err=0;c.S.sc.stop=false;c.S.sc.U=100;
  assert.equal(c.scRestore(r),true);c.scRender();c.scMeta();assert.equal(c.S.sc.err,1);assert.equal(c.S.sc.stop,true);assert.equal(c.S.sc.U,0);assert.equal(c.S.sc.done,1);assert.equal(c.S.sc.total,1);
  assert.match($('#scStat').textContent,/已停止 1\/1 · 失败 1/);assert.match($('#scTbl tbody').innerHTML,/数据不完整/);assert.match($('#scChips').innerHTML,/已停止/);
});
test('init synchronizes restored universe button including U=0',()=>{
  const body=fn('init');
  for(const U of [0,50,100]){
    const buttons=[0,50,100].map(u=>({dataset:{u:String(u)},classList:{toggle(k,on){this.on=on}}}));
    const line=body.split('\n').find(s=>s.includes("$$('#scUni button')"));
    assert.ok(line,'init must synchronize universe controls');
    vm.runInNewContext(line,{S:{sc:{U}},$$:()=>buttons});
    assert.deepEqual(buttons.map(b=>b.classList.on),[0,50,100].map(u=>u===U));
  }
});
test('legacy saved records restore safely without invented failures',()=>{
  const {c}=harness();assert.equal(c.scRestore(null),false);assert.equal(c.scRestore({rows:{}}),false);
  assert.equal(c.scRestore({rows:[valid],W:3,t:c.Date.now()}),true);assert.equal(c.S.sc.err,0);assert.equal(c.S.sc.stop,false);assert.equal(c.S.sc.done,1);assert.equal(c.S.sc.total,1);
});
test('CSV window belongs to result, not subsequent UI selection',async()=>{
  const {c}=harness();c.scOne=async()=>valid;await c.scGo();c.S.sc.W=1;let name;c.csvDown=n=>name=n;c.scCsv();assert.equal(name,'OI异动扫描_3d.csv');
});
