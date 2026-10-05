'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const s=fs.readFileSync(__dirname+'/index.html','utf8');
test('fetchX exposes Retry-After cooldown and scoped abort',()=>{assert.match(s,/apiCooldownUntil/);assert.match(s,/retryAfter/);assert.match(s,/scope\.signal/);});
test('OI all is bounded and partial failures remain retryable',()=>{assert.match(s,/pool\(todo,6/);assert.match(s,/S\.oiAll=failed===0/);});
test('funding uses fundingInfo interval and unknown is not zero',()=>{assert.match(s,/fapi\/v1\/fundingInfo/);assert.match(s,/fundingIntervalHours\|\|8/);assert.match(s,/fr==null\?0/);});
test('intraday excludes open 5m candle and rejects stale generation',()=>{assert.match(s,/x\.t\+5\*MIN<=now/);assert.match(s,/generation!==\(S\.id\.generation\|\|0\)/);});
test('MegaGlass remarks are escaped',()=>{assert.match(s,/const esc=v=>String\(v\?\?''\)/);assert.match(s,/title=\"\$\{esc\(tip\)\}/);});
test('unsupported liquidation language removed from quadrant copy',()=>{assert.doesNotMatch(s,/暴跌\+OI逆势增=新空涌入→轧空候选/);assert.match(s,/不构成清算、挤压或交易指令/);});
