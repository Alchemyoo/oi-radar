const test=require('node:test'),a=require('node:assert/strict'),R=require('./rolling-oi.js');
const NOW=Date.parse('2026-10-06T12:02:00Z'),END=Date.parse('2026-10-06T12:00:00Z'),START=END-R.DAY;
const row=(s,t,oi=100,v=2000000)=>({symbol:s,timestamp:t,sumOpenInterest:String(oi),sumOpenInterestValue:String(v)});
function fixture(syms=['BTCUSDT','ETHUSDT']){return {schemaVersion:2,mode:'rolling24',period:'5m',source:R.SOURCE,symbols:syms,serverTime:NOW,receivedAt:NOW,window:{mode:'rolling24',period:'5m',durationMs:R.DAY,startMs:START,endMs:END},errors:[],results:syms.map(symbol=>({symbol,fetchedAt:NOW,sampleCount:2,candidateTimestamps:[END-R.STEP,END],data:[row(symbol,START),row(symbol,END,130,2100000)],prices:[START,END].map((timestamp,i)=>({source:R.PRICE_SOURCE,timestamp,openTime:timestamp-R.STEP,closeTime:timestamp-1,close:i?'101':'100'}))}))}}
module.exports={fixture,NOW,END,START,row};
if(require.main===module){
 test('latest common endpoint is intersection, not max/min guessed across gaps',()=>{
  const xs=[{symbol:'BTCUSDT',data:[row('BTCUSDT',END-2*R.STEP),row('BTCUSDT',END)]},{symbol:'ETHUSDT',data:[row('ETHUSDT',END-2*R.STEP),row('ETHUSDT',END-R.STEP)]}];
  a.equal(R.commonWindow(xs,['BTCUSDT','ETHUSDT'],END).endMs,END-2*R.STEP);
  a.throws(()=>R.commonWindow(xs,['BTCUSDT','ETHUSDT'],NOW),/stale_end/);
 });
 test('all symbols required; duplicate symbol, bad OI and timestamps are errors',()=>{
  const good=[{symbol:'BTCUSDT',data:[row('BTCUSDT',END)]}];
  for(const mutate of [x=>x[0].data.push(row('BTCUSDT',END)),x=>x[0].data[0].timestamp++,x=>x[0].data[0].sumOpenInterest='NaN',x=>x[0].data[0].symbol='ETHUSDT',x=>x[0].data[0].sumOpenInterest=true,x=>x[0].data[0].sumOpenInterest=' ',x=>x[0].data[0].sumOpenInterest='Infinity']){const x=structuredClone(good);mutate(x);a.throws(()=>R.commonWindow(x,['BTCUSDT'],NOW))}
  a.throws(()=>R.commonWindow(good,['BTCUSDT','ETHUSDT'],NOW));
  a.throws(()=>R.commonWindow([...good,...good],['BTCUSDT','ETHUSDT'],NOW));
 });
 test('future timestamps fail, lag exactly ten minutes allowed but older rejected',()=>{
  a.throws(()=>R.commonWindow([{symbol:'BTCUSDT',data:[row('BTCUSDT',END+R.STEP)]}],['BTCUSDT'],NOW),/future/);
  const x=[{symbol:'BTCUSDT',data:[row('BTCUSDT',END)]}];a.equal(R.commonWindow(x,['BTCUSDT'],END+R.LAG).endMs,END);a.throws(()=>R.commonWindow(x,['BTCUSDT'],END+R.LAG+1),/stale/);
 });
 test('strict 24h and endpoint equality, not nearby substituted samples',()=>{
  const f=fixture();R.validateResult(f,f.symbols,NOW);
  for(const mutate of [f=>f.window.startMs+=R.STEP,f=>f.results[0].data[0].timestamp-=R.STEP,f=>f.results[0].data[1].timestamp-=R.STEP,f=>f.results[0].data.push(f.results[0].data[1]),f=>f.results[0].sampleCount=288]){const x=structuredClone(f);mutate(x);a.throws(()=>R.validateResult(x,x.symbols,NOW))}
 });
 test('price is prior exact closed5m close; ticker, unclosed and shifted price fail',()=>{
  const f=fixture();a.ok(Math.abs(R.validateResult(f,f.symbols,NOW)[0].px-1)<1e-8);
  for(const mutate of [f=>f.results[0].prices[1].source='/ticker/price',f=>f.results[0].prices[1].closeTime=NOW,f=>f.results[0].prices[1].timestamp-=R.STEP,f=>f.results[0].prices[0].openTime+=R.STEP,f=>f.results[0].prices[0].close='NaN']){const x=structuredClone(f);mutate(x);a.throws(()=>R.validateResult(x,x.symbols,NOW))}
 });
 test('all results atomically complete, latest common proof checked',()=>{
  for(const mutate of [f=>f.results.pop(),f=>f.results[1]=f.results[0],f=>f.errors.push({symbol:'ETHUSDT',error:'missing'}),f=>f.results[0].candidateTimestamps=[END-R.STEP],f=>f.limit=300,f=>f.serverTime=NOW+1,f=>f.results[0].fetchedAt=NOW+1]){const x=fixture();mutate(x);a.throws(()=>R.validateResult(x,x.symbols,NOW))}
 });
 test('percent thresholds unchanged and based on coin quantity, next always null',()=>{
  const f=fixture(),r=R.validateResult(f,f.symbols,NOW)[0];a.equal(R.pick(r,{oiPct:30,pxPct:10,minOi:1000000}),true);a.equal(r.next,null);a.equal(r.z,null);a.equal(R.pick({...r,coinNet:0,net:500},{oiPct:30,pxPct:10,minOi:1000000}),false);a.throws(()=>R.pick(r,{oiPct:2,pxPct:10,minOi:1000000},'z'),/sigma_unsupported/);
 });
 test('50 coins compact endpoint result remains below 1MiB',()=>{const f=fixture(Array.from({length:50},(_,i)=>'COIN'+i+'USDT'));a.equal(R.validateResult(f,f.symbols,NOW).length,50);a.ok(Buffer.byteLength(JSON.stringify(f))<1048576)});
}
