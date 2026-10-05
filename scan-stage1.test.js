'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const script=html.match(/<script>\s*'use strict';([\s\S]*?)<\/script>/)[1];
function fn(name){const m=new RegExp('(?:async\\s+)?function\\s+'+name+'\\s*\\(').exec(script);assert.ok(m);const end=script.indexOf('\n}',m.index);return script.slice(m.index,end+2)}
function harness(){
  const nodes=new Map();const $=s=>{if(!nodes.has(s))nodes.set(s,{value:({'#scOiPct':30,'#scPxPct':10,'#scMinOi':1000000})[s],style:{},classList:{add(){},remove(){}},innerHTML:'',textContent:''});return nodes.get(s)};
  class Clock extends Date {static now(){return Date.parse('2026-10-05T08:00:00Z')}}
  const c=vm.createContext({Date:Clock,DAY:86400000,Map,Set,console,$,
    S:{ov:{ready:true,list:[{sym:'BTCUSDT',vol:1}]},sc:{W:3,U:1,mode:'pct',filter:'pick',sort:'net',dir:-1,rows:[]}},
    dstr:t=>new Date(t).toISOString().slice(0,10),
    pool:async(items,n,cb)=>{for(const x of items)await cb(x)},
    ban(){},toast(){},scSave(){},scNextCheck(){},fC:String,fP:String,clsP:()=>''});
  vm.runInContext(fs.readFileSync(__dirname+'/radar.js','utf8'),c);
  for(const n of ['scGo','scFiltered','scRender','scMeta'])vm.runInContext(fn(n),c);
  return {c,$};
}
const valid={oiS:2000000,oiE:2100000,coinS:100,coinE:140,px:1,z:null};
test('price request failure is counted, never reported as successful zero picks',async()=>{
  const {c,$}=harness();vm.runInContext(fn('scOne'),c);
  c.loadOiHist=async()=>{const w=c.OiRadar.scWindow(3,c.Date.now());return [{t:w.startMs,oiv:2000000,oi:100},{t:w.endMs,oiv:2100000,oi:140}]};
  c.loadKlines=async()=>{throw Error('price unavailable')};c.fetchDay=async()=>{throw Error('must not fall back')};
  await c.scGo();assert.equal(c.S.sc.rows.length,1);assert.equal(c.S.sc.rows[0].px,null);assert.equal(c.S.sc.rows[0].pick,false);assert.equal(c.S.sc.err,1);
  assert.match($('#scTbl tbody').innerHTML,/数据不完整/);assert.match($('#scChips').innerHTML,/数据不完整/);
});
test('TypeError degradation is local to one scan; next scan retries history',async()=>{
  const {c}=harness();vm.runInContext(fn('scOne'),c);let histCalls=0;
  c.loadOiHist=async()=>{histCalls++;if(histCalls===1)throw new TypeError('temporary network failure');const w=c.OiRadar.scWindow(3,c.Date.now());return [{t:w.startMs,oiv:2000000,oi:100},{t:w.endMs,oiv:2100000,oi:140}]};
  c.loadKlines=async()=>{const w=c.OiRadar.scWindow(3,c.Date.now());return [{t:w.startMs-86400000,c:100},{t:w.endMs-86400000,c:101}]};
  c.fetchDay=async()=>{throw Error('archive unavailable')};
  await c.scGo();assert.equal(c.S.sc.err,1);assert.equal(c.S.sc.noHist,true);
  await c.scGo();assert.equal(histCalls,2);assert.equal(c.S.sc.err,0);assert.equal(c.S.sc.rows[0].pick,true);
});
test('all OI failures render failure, not plain no-data or zero eligible claim',async()=>{
  const {c,$}=harness();c.scOne=async()=>({oiS:null,oiE:null,px:1});await c.scGo();assert.equal(c.S.sc.err,1);assert.match($('#scTbl tbody').innerHTML,/数据不完整/);assert.match($('#scTbl tbody').innerHTML,/1/);
});
test('complete data below unchanged threshold is an honest no-match result',async()=>{
  const {c,$}=harness();c.scOne=async()=>({...valid,coinE:110});await c.scGo();assert.equal(c.S.sc.err,0);assert.equal(c.S.sc.params.oiPct,30);assert.equal(c.S.sc.params.pxPct,10);assert.equal(c.S.sc.params.minOi,1000000);assert.match($('#scTbl tbody').innerHTML,/当前筛选无匹配/);assert.doesNotMatch($('#scChips').innerHTML,/数据不完整/);
});
test('missing coin endpoints and unavailable z are incomplete, not zero signals',async()=>{
  for(const mode of ['pct','z']){const {c}=harness();c.S.sc.mode=mode;c.scOne=async()=>({...valid,coinS:null,coinE:null});await c.scGo();assert.equal(c.S.sc.err,1);assert.equal(c.S.sc.rows[0].pick,false)}
});
test('mixed failure keeps valid selected row and counts only incomplete symbol',async()=>{
  const {c,$}=harness();c.S.sc.U=0;c.S.ov.list.push({sym:'ETHUSDT',vol:.5});c.scOne=async sym=>sym==='BTCUSDT'?valid:({...valid,px:null});await c.scGo();assert.equal(c.S.sc.done,2);assert.equal(c.S.sc.err,1);assert.equal(c.S.sc.rows.filter(r=>r.pick).length,1);assert.match($('#scChips').innerHTML,/数据不完整/);
});
test('missing exact endpoints remain null; no neighbouring or live substitution',async()=>{
  const {c}=harness();vm.runInContext(fn('scOne'),c);const w=c.OiRadar.scWindow(3,c.Date.now());c.loadOiHist=async()=>[{t:w.startMs,oiv:2,oi:2},{t:w.endMs-86400000,oiv:3,oi:3}];c.fetchDay=async(sym,d)=>[{t:Date.parse(d+'T20:00:00Z'),oiv:3,oi:3}];c.loadKlines=async()=>[{t:w.startMs-86400000,c:100},{t:w.endMs,c:999}];const r=await c.scOne('BTCUSDT',w);assert.equal(r.oiS,null);assert.equal(r.oiE,null);assert.equal(r.px,null);
});
