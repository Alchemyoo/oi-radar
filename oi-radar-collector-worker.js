const ORIGIN='https://alchemyoo.github.io';
const REPO='https://api.github.com/repos/Alchemyoo/oi-radar';
const WORKFLOW='oi-radar-cache.yml';
const cors={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin','Cache-Control':'no-store'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
const brief=x=>x?({id:x.id,status:x.status,conclusion:x.conclusion,event:x.event,created_at:x.created_at,updated_at:x.updated_at}):null;
async function github(env,path,body){
 const r=await fetch(REPO+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'oi-radar-live','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 if(!r.ok)throw Error('GitHub HTTP '+r.status);return r.status===204?null:r.json();
}
export default {async fetch(req,env){
 if(req.headers.get('Origin')!==ORIGIN)return new Response('Forbidden',{status:403});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const u=new URL(req.url);
 try{
  if(u.pathname==='/status/latest'&&req.method==='GET'){
   const d=await github(env,'/actions/workflows/'+WORKFLOW+'/runs?event=workflow_dispatch&per_page=5');
   return reply({runs:(d.workflow_runs||[]).map(brief),run:brief(d.workflow_runs?.[0])});
  }
  if(u.pathname==='/status'&&req.method==='GET'){
   const id=Number(u.searchParams.get('run'));if(!Number.isSafeInteger(id)||id<=0)return reply({error:'run id required'},400);
   const [x,w]=await Promise.all([github(env,'/actions/runs/'+id),github(env,'/actions/workflows/'+WORKFLOW)]);
   if(x.workflow_id!==w.id)return reply({error:'Not a collector run'},403);return reply({run:brief(x)});
  }
  if(u.pathname!=='/collect')return reply({error:'Not found'},404);
  if(req.method!=='POST')return reply({error:'POST required'},405);
  let body;try{body=await req.json()}catch{return reply({error:'Invalid JSON'},400)}
  const limit=body.limit??50;if(![50,100].includes(limit))return reply({error:'limit must be 50 or 100'},400);
  const ip=(req.headers.get('CF-Connecting-IP')||'unknown').slice(0,80);
  const last=await env.OI_RADAR_TRIGGER.get(ip);if(last&&Date.now()-Number(last)<60000)return reply({error:'刚刚已请求采集，请等待1分钟'},429);
  await env.OI_RADAR_TRIGGER.put(ip,String(Date.now()),{expirationTtl:3600});
  const d=await github(env,'/actions/workflows/'+WORKFLOW+'/runs?per_page=5');
  const busy=(d.workflow_runs||[]).find(x=>!['completed'].includes(x.status));
  if(busy)return reply({error:'已有采集任务运行中',run:brief(busy)},409);
  const acceptedAt=Date.now();
  await github(env,'/actions/workflows/'+WORKFLOW+'/dispatches',{ref:'main',inputs:{limit:String(limit)}});
  return reply({accepted:true,message:'官方OI采集已启动',limit,acceptedAt,previousRunId:d.workflow_runs?.[0]?.id||0},202);
 }catch{return reply({error:'采集服务暂时不可用，请稍后重试'},502)}
}};
