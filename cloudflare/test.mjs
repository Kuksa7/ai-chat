import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{AgentState,validateFiles,appName,modelConfig,GitHubMCP,parseRPC} from './worker.mjs';
const files=[{path:'index.html',content:'<!doctype html><h1>Demo</h1>'}];
class Storage {
 constructor(){this.rows=new Map();this.alarm=null;this.sql={exec:(query,...args)=>{
  if(query.startsWith('CREATE TABLE'))return {toArray:()=>[]};
  if(query.startsWith('SELECT value'))return {toArray:()=>this.rows.has(args[0])?[{value:this.rows.get(args[0]).value}]:[]};
  if(query.startsWith('INSERT')){this.rows.set(args[0],{value:args[1],expires:args[2]});return {toArray:()=>[]};}
  if(query.startsWith('DELETE')){for(const [k,v]of this.rows)if(v.expires>0&&v.expires<args[0])this.rows.delete(k);return {toArray:()=>[]};}
  throw Error('Unexpected SQL '+query);
 }};}
 async setAlarm(value){this.alarm=value;}
}
function setup(){const storage=new Storage();const env={GITHUB_OWNER:'Kuksa7',SOURCE_REPO:'ai-chat',GITHUB_TOKEN:'fake'};return {agent:new AgentState({storage},env),storage,env};}
function request(path,body){return new Request('https://agent.test'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
test('Path, source-file, name and model endpoint guardrails',()=>{
 assert.equal(validateFiles(files).length,1);assert.equal(appName('aiapp-demo'),'aiapp-demo');
 for(const path of ['../index.html','.github/workflows/test.yml','a/../x.js','/index.html','a//x.js','node_modules/a.js','x.exe'])assert.throws(()=>validateFiles([{path,content:'x'}]));
 assert.throws(()=>validateFiles([...files,...files]));assert.throws(()=>validateFiles([{path:'index.html',content:'x'.repeat(200001)}]));assert.throws(()=>validateFiles([{path:'secret.json',content:'x'}],true));
 assert.throws(()=>appName('ai-chat'));assert.throws(()=>modelConfig({baseUrl:'https://evil.example/v1',key:'key',model:'x'},{}));
 assert.equal(modelConfig({baseUrl:'https://openrouter.ai/api/v1',key:'key',model:'x'},{}).key,'key');
});
test('MCP parses JSON, SSE and JSON-RPC errors',async()=>{
 assert.deepEqual(await parseRPC(Response.json({jsonrpc:'2.0',id:1,result:{ok:true}}),1),{ok:true});
 const s='event: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/foo"}\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","id":3,"result":{"tools":[]}}\r\n\r\n';
 assert.deepEqual(await parseRPC(new Response(s,{headers:{'content-type':'text/event-stream'}}),3),{tools:[]});
 await assert.rejects(parseRPC(Response.json({id:2,error:{message:'Denied'}}),2),/Denied/);
});
test('MCP performs real protocol lifecycle and enforces advertised tool names',async()=>{
 const methods=[];const client=new GitHubMCP({GITHUB_TOKEN:'test'},async(url,options)=>{
  assert.equal(url,'https://api.githubcopilot.com/mcp/');assert.equal(options.headers.Authorization,'Bearer test');const body=JSON.parse(options.body);methods.push(body.method);
  if(body.method==='notifications/initialized')return new Response(null,{status:202});
  let result=body.method==='initialize'?{protocolVersion:'2025-03-26'}:body.method==='tools/list'?{tools:[{name:'get_me'}]}:{content:[{type:'text',text:'user'}]};return Response.json({id:body.id,result},{headers:{'Mcp-Session-Id':'abc'}});
 });await client.init();await client.call('get_me',{});await assert.rejects(client.call('delete_repository',{}));assert.deepEqual(methods,['initialize','notifications/initialized','tools/list','tools/call']);
});
test('Outer Worker rejects wrong origin, missing password and incorrect password',async()=>{
 const env={ALLOWED_ORIGIN:'https://kuksa7.github.io',AGENT_PASSWORD:'a'.repeat(64)};
 assert.equal((await worker.fetch(new Request('https://agent.test/api/status'),env)).status,403);
 const req=(auth,method='GET')=>new Request('https://agent.test/api/status',{method,headers:{Origin:env.ALLOWED_ORIGIN,Authorization:auth}});
 assert.equal((await worker.fetch(req('Bearer wrong'),env)).status,401);
 assert.equal((await worker.fetch(req('Bearer '+env.AGENT_PASSWORD),env)).status,503);
 const opt=await worker.fetch(req('', 'OPTIONS'),env);assert.equal(opt.status,204);assert.equal(opt.headers.get('Access-Control-Allow-Origin'),env.ALLOWED_ORIGIN);
});
test('Writes are staged, require explicit approval, block duplicate execution and preserve source main',async()=>{
 const {agent,storage}=setup();let writes=0;
 agent.gh=async(path)=>{if(path==='/user')return {login:'Kuksa7'};if(path==='/repos/Kuksa7/aiapp-demo')throw Object.assign(Error('Not found'),{githubStatus:404});throw Error('Unexpected '+path);};
 const plan=await agent.prepare('create_web_app',{name:'aiapp-demo',files},{});assert.equal(writes,0);
 assert.throws(()=>agent.assertRepo('ai-chat',true));assert.throws(()=>agent.assertRepo('unmanaged',false));
 const c={messages:[{role:'assistant',content:null,tool_calls:[{id:'tool1',type:'function',function:{name:'create_web_app',arguments:'{}'}}]}],pending:{...plan,id:'p1',callId:'tool1',expiresAt:Date.now()+10000,status:'prepared'},log:[]};
 agent.save('chat:abc123',c);
 let response=await agent.handle(request('/api/decision',{conversationId:'abc123',planId:'p1',approve:false}));assert.equal(response.status,200);assert.equal(writes,0);assert.equal(agent.read('chat:abc123').pending,null);
 agent.save('chat:abc123',c);const originalInit=GitHubMCP.prototype.init;
 GitHubMCP.prototype.init=async function(){};
 agent.execute=async()=>{writes++;return {message:'done',repoUrl:'https://github.com/Kuksa7/aiapp-demo'};};
 try{
  response=await agent.handle(request('/api/decision',{conversationId:'abc123',planId:'p1',approve:true}));assert.equal(response.status,200);assert.equal(writes,1);
  response=await agent.handle(request('/api/decision',{conversationId:'abc123',planId:'p1',approve:true}));assert.equal(response.status,409);assert.equal(writes,1);
 }finally{GitHubMCP.prototype.init=originalInit;}
 assert.equal([...storage.rows.values()].some(r=>r.value.includes('model-secret')),false);
});
test('App updates require current reads and reject stale heads',async()=>{
 const {agent}=setup();agent.save('registry',{'aiapp-demo':{status:'ready',branch:'main'}},0);agent.gh=async()=>({object:{sha:'current'}});
 await assert.rejects(agent.prepare('update_web_app',{repo:'aiapp-demo',files},{}),/прочитайте/);
 const p=await agent.prepare('update_web_app',{repo:'aiapp-demo',files},{readHeads:{'aiapp-demo':'current'}});assert.equal(p.baseSha,'current');
 agent.gh=async()=>({object:{sha:'changed'}});await assert.rejects(agent.execute(p,{}),/изменился/);
});
test('Agent loop stages tools without executing and keeps model key out of storage',async()=>{
 const {agent,storage}=setup();agent.gh=async()=>{throw Object.assign(Error('Not found'),{githubStatus:404});};
 agent.llm=async()=>({role:'assistant',content:'Готово к проверке',tool_calls:[{id:'1',type:'function',function:{name:'create_web_app',arguments:JSON.stringify({name:'aiapp-demo',files})}}]});
 const c={messages:[],pending:null,log:[]};const result=await agent.loop(c,'chat:test123',{key:'model-secret'},{});
 assert.ok(result.pending);assert.equal(result.pending.files[0].path,'index.html');assert.equal(agent.read('chat:test123').pending.status,'prepared');assert.equal([...storage.rows.values()].some(r=>r.value.includes('model-secret')),false);
});
