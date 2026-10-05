const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const c=require('./transfers.js');
const token={symbol:'TESTUSDT',chain:'bsc',chainId:56,address:'0x'+'a'.repeat(40)},hash='0x'+'b'.repeat(64),at='2026-10-04T13:00:00Z';
function fixture(){return {schemaVersion:1,tokens:{TESTUSDT:{identity:token,status:'ok',fetchedAt:at,decimals:18,decimalsSource:{method:'eth_call:decimals()',blockNumber:100,blockHash:hash},threshold:{kind:'token_units',units:'1000000',raw:'1000000000000000000000000',operator:'>='},coverage:{fromBlock:100,toBlock:100,complete:true,matchedCount:1,displayTruncated:false,fromTime:at,toTime:at},events:[{txHash:hash,blockHash:hash,blockNumber:100,logIndex:0,from:'0x'+'1'.repeat(40),to:'0x'+'2'.repeat(40),rawAmount:'1000000000000000000000000',eventTime:at,direction:'address_to_address',fromLabel:null,toLabel:null,usdValue:null}]}}}}
test('decimal thresholds and huge uint values remain exact',()=>{assert.equal(c.rawThreshold('1000000',18),10n**24n);assert.equal(c.rawThreshold('1.000001',6),1000001n);assert.equal(c.amount('1000000000000000000000001',18),'1000000.000000000000000001');assert.equal(c.amount('100',0),'100');assert.equal(c.amount('1000000000000000000',18),'1');assert.throws(()=>c.rawThreshold('1.1',0));assert.throws(()=>c.rawThreshold('0',18));});
test('strict identity, coverage, decimals and duplicate rejection',()=>{assert.equal(c.validate(fixture(),token).status,'ok');for(const change of [r=>r.identity={...token,address:'0x'+'c'.repeat(40)},r=>r.coverage.complete=false,r=>r.threshold.raw='1',r=>r.events.push({...r.events[0]}),r=>r.events[0].eventTime='2026-01-01T00:00:00Z',r=>r.events[0].direction='exchange_inflow',r=>r.decimalsSource=null,r=>r.coverage.matchedCount=0]){const data=fixture();change(data.tokens.TESTUSDT);assert.throws(()=>c.validate(data,token))}});
test('missing, stale and complete zero have distinct messaging',()=>{assert.match(c.render(null,token),/不可用/);const data=fixture();assert.equal(c.state(data.tokens.TESTUSDT,Date.parse(at)+91*60000),'stale');data.tokens.TESTUSDT.events=[];data.tokens.TESTUSDT.coverage.matchedCount=0;assert.match(c.render(data,token,Date.parse(at)),/完整查询范围内无/);assert.match(c.render(null,null),/未接入已核实链/)});
test('never trust arbitrary labels and never manufacture USD or exchange direction',()=>{const data=fixture();data.tokens.TESTUSDT.events[0].fromLabel={verified:true,label:'Binance <script>',url:'https://evil.example'};const html=c.render(data,token,Date.parse(at));assert.ok(!html.includes('Binance'));assert.ok(!html.includes('<script>'));assert.match(html,/标签未知/);assert.match(html,/USD 估值未知/);assert.match(html,/地址 → 地址/);assert.match(html,/https:\/\/bscscan.com\/tx/)});
test('unavailable records cannot carry events',()=>{const data=fixture();data.tokens.TESTUSDT.status='unknown';assert.throws(()=>c.validate(data,token));data.tokens.TESTUSDT.events=[];data.tokens.TESTUSDT.coverage.complete=false;data.tokens.TESTUSDT.coverage.matchedCount=null;assert.match(c.render(data,token),/未知：decimals/)});
test('standalone page is cache only and does not attach contract scoring',()=>{const s=fs.readFileSync(__dirname+'/transfers.html','utf8');assert.ok(s.includes('transfers.js'));assert.ok(!s.includes('eth_getLogs'));assert.ok(!s.includes('stScore'));});

test('fresh fetch cannot revive old or future block window',()=>{const r=fixture().tokens.TESTUSDT;r.fetchedAt='2026-10-04T15:00:00Z';assert.equal(c.state(r,Date.parse(r.fetchedAt)),'stale');r.coverage.toTime='2026-10-04T16:00:00Z';assert.equal(c.state(r,Date.parse(r.fetchedAt)),'unavailable')});
test('main detail reads Transfer independently without claiming automated scans',()=>{const html=fs.readFileSync(__dirname+'/index.html','utf8'),js=fs.readFileSync(__dirname+'/onchain.js','utf8');assert.ok(html.indexOf('src="transfers.js')<html.indexOf('src="onchain.js'));assert.match(js,/read\('data\/transfers.json'\)/);assert.match(js,/Promise\.all\(/);assert.match(js,/TransferEvidence.render\(OC.transferCache,t\)/);assert.match(js,/Transfer 由 Actions 独立采样/);assert.match(js,/不代表自动扫描已完成/)});

test('chain adapter rejects forged identities even when cache and caller agree',()=>{
 for(const t of [{...token,chain:'ethereum'},{...token,chainId:1},{...token,chain:'bogus'}]){
  const data=fixture();data.tokens.TESTUSDT.identity=t;assert.throws(()=>c.validate(data,t),/identity_or_schema_mismatch/);
 }
});
test('all supported EVM chains link to the actual chain explorer',()=>{
 const Chains=require('./chains.js');
 for(const [chain,[chainId,url]] of Object.entries(Chains.E)){
  const t={...token,chain,chainId},data=fixture();data.tokens.TESTUSDT.identity=t;
  const html=c.render(data,t,Date.parse(at)),base=url.replace(/\/token\/$/,'');
  assert.ok(html.includes(base+'/tx/'));assert.ok(html.includes(base+'/address/'));
  if(chain!=='bsc')assert.ok(!html.includes('bscscan.com'));
 }
});
test('unsupported SOL and SUI render unknown coverage rather than empty successful scans',()=>{
 for(const t of [{symbol:'SOLUSDT',chain:'solana',chainId:'CT_501',address:'11111111111111111111111111111111'},
                 {symbol:'SUIUSDT',chain:'sui',chainId:'CT_784',address:'0x2::sui::SUI'}]){
  const row={identity:t,status:'unsupported',reason:'non_evm_transfer_adapter_unavailable',events:[],coverage:{complete:false,matchedCount:null}},data={schemaVersion:1,tokens:{[t.symbol]:row}};
  assert.equal(c.validate(data,t).status,'unsupported');assert.equal(c.state(row),'unsupported');
  const html=c.render(data,t,Date.parse(at));assert.match(html,/不支持/);assert.match(html,/覆盖未知/);assert.ok(!html.includes('完整查询范围内无'));
  row.coverage.matchedCount=0;assert.throws(()=>c.validate(data,t),/unavailable_with_known_count/);
 }
});
test('Actions mode uses explicit chain buffer and cannot assert finality',()=>{
 const data=fixture(),r=data.tokens.TESTUSDT;data.collectionMode='github_actions';
 assert.throws(()=>c.validate(data,token),/unknown_automated_buffer/);
 r.coverage.finalized=false;r.coverage.confirmationBlocksBuffer=64;
 const html=c.render(data,token,Date.parse(at));assert.match(html,/GitHub Actions/);assert.match(html,/64 区块缓冲/);assert.ok(!html.includes('；20 区块缓冲'));assert.match(html,/不保证最终性/);
 r.coverage.finalized=true;assert.throws(()=>c.validate(data,token),/invalid_finality/);
});
test('manual legacy buffer remains unknown and labels or USD estimates are never trusted',()=>{
 const data=fixture();data.collectionMode='manual';data.tokens.TESTUSDT.events[0].usdValue=1e12;
 const html=c.render(data,token,Date.parse(at));assert.match(html,/手动运行/);assert.match(html,/缓冲未知/);assert.match(html,/USD 估值未知/);assert.ok(!html.includes('1000000000000 USD'));
});
test('both fetchedAt and toTime must remain inside TTL independently',()=>{
 for(const field of ['fetchedAt','toTime']){
  const r=fixture().tokens.TESTUSDT;
  if(field==='fetchedAt')r.fetchedAt=new Date(Date.parse(at)-91*60000).toISOString();else r.coverage.toTime=new Date(Date.parse(at)-91*60000).toISOString();
  assert.equal(c.state(r,Date.parse(at)),'stale');
 }
});
