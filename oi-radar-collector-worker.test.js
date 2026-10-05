'use strict';
const test=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs');
const s=fs.readFileSync(__dirname+'/oi-radar-collector-worker.js','utf8');
test('worker only accepts the official Pages origin and CORS preflight',()=>{a.match(s,/origin!==ORIGIN/);a.match(s,/Access-Control-Allow-Origin/);a.match(s,/POST, OPTIONS/)});
test('in-page collection uses a scoped GitHub secret and no browser credential',()=>{a.match(s,/env\.GITHUB_TOKEN/);a.doesNotMatch(s,/ghp_[A-Za-z0-9]{20,}/);a.match(s,/actions\/workflows\/oi-radar-cache\.yml\/dispatches/);a.match(s,/已有采集任务运行中/)});
test('only fixed repository workflow and Top50 are dispatchable',()=>{a.match(s,/repos\/Alchemyoo\/oi-radar\/actions\/workflows\/oi-radar-cache\.yml\/dispatches/);a.match(s,/limit:'50'/);a.match(s,/status\/latest/)});
test('no arbitrary URL proxy or client-selected repository',()=>{a.doesNotMatch(s,/body\.url|body\.repo|fetch\(body/);a.match(s,/futures\/data\/openInterestHist/)});
