import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {createApp} from '../../agent-server/src/server.ts';
import {loadConfig} from '../../agent-server/src/config.ts';
import {WikiIndex} from '../../agent-server/src/search.ts';

const directory=process.argv[2];
const site=process.argv[3];
assert.ok(directory&&site);
assert.equal(new URL(site).hostname,'127.0.0.1');
assert.ok(process.env.ANTHROPIC_API_KEY);
assert.equal(process.env.ANTHROPIC_BASE_URL,'http://127.0.0.1:0');
const config=loadConfig({...process.env,ANTHROPIC_BASE_URL:'http://127.0.0.1:0',
  SITE_BASE:site,ALLOWED_ORIGINS:site,SEARCH_INDEX_URL:site+'/search/search_index.json',
  API_KEY:'',SCRATCH_DIR:directory+'/sdk-scratch',RATE_LIMIT_MAX:'2',RATE_LIMIT_WINDOW_MS:'60000'});
const index=new WikiIndex(config.searchIndexUrl,config.indexRefreshMs,site);
await index.load();
const {server}=createApp({config,index});
const requests=[];
server.on('request',(request,response)=>response.on('finish',()=>{
  requests.push({method:request.method,path:request.url,status:response.statusCode});
  void writeFile(directory+'/rate-requests.json',JSON.stringify(requests,null,2));
}));
server.listen(0,'127.0.0.1');
await once(server,'listening');
const base='http://127.0.0.1:'+server.address().port;
await writeFile(directory+'/rate-runtime.json',JSON.stringify({base,pid:process.pid}));
process.on('SIGTERM',()=>{index.stop();server.close(()=>process.exit(0));});
