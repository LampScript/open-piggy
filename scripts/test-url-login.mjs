// Same-host URL handoff; synthetic task, no official login provider invocation.
import {spawn} from 'node:child_process';import {mkdir,mkdtemp,rm} from 'node:fs/promises';import {resolve,join} from 'node:path';import assert from 'node:assert/strict';
import {syntheticQr} from '../test/qr-fixture.ts';import {startLogin,readTask} from '../dist/login-task.js';import {runLoginTask} from '../dist/login-worker.js';import {loadSession} from '../dist/session.js';
const base=resolve(process.env.OPEN_PIGGY_FIXTURE_DIR||'artifacts/login-url-fixture');await mkdir(base,{recursive:true,mode:0o700});const home=await mkdtemp(join(base,'run-'));
let child,worker,release,stdout='',stderr='';
try{
 const task=await startLogin(home,()=>{});let count=0,readyResolve;const ready=new Promise(resolve=>{readyResolve=resolve;});const finish=new Promise(resolve=>{release=resolve;});
 const session={version:1,savedAt:new Date().toISOString(),cookies:[{name:'fixture',value:'synthetic-not-exported-cookie',domain:'.fliggy.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'None'}]};
 worker=runLoginTask(task.loginId,{start:async()=>{},inspect:async()=>++count===1?{state:'pending',qr:syntheticQr()}:{state:'authenticated',session},close:async()=>{}},home,async()=>{readyResolve();await finish;});
 await Promise.race([ready,worker.then(()=>{throw Error('Fixture ended before handoff');})]);
 child=spawn(process.execPath,['--import','tsx','src/cli.ts','auth','login','--url','--plain'],{cwd:process.cwd(),env:{...process.env,OPEN_PIGGY_HOME:home,PLAYWRIGHT_BROWSERS_PATH:join(home,'intentionally-absent-cache')},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});const timer=setTimeout(()=>child.kill(),15000);
 let code;try{code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});}finally{clearTimeout(timer);}
 assert.equal(code,0);assert.equal(stdout.trim().split('\n').length,1);const url=new URL(stdout.trim());assert.equal(url.hostname,'127.0.0.1');assert.equal((await readTask(task.loginId,home)).state,'pending');
 const response=await fetch(url);const html=await response.text();assert.equal(response.headers.get('set-cookie'),null);assert.ok(!html.includes('synthetic-not-exported-cookie'));const status=await(await fetch(new URL('status',url))).json();assert.equal(status.state,'pending');assert.equal(status.cookies,undefined);assert.equal(status.qrReady,true);
 release();await worker;assert.equal((await loadSession(home)).cookies[0].value,'synthetic-not-exported-cookie');assert.ok(!stdout.includes('synthetic-not-exported-cookie'));assert.ok(!stderr.includes('synthetic-not-exported-cookie'));
 console.log(JSON.stringify({status:0,scope:'offline-same-host-url-cli-fixture',onePlainUrlPrinted:true,loopbackOnly:true,notAuthenticatedAtHandoff:true,cookiesReturned:false,cookieImportEndpoint:false,syntheticCookiePersistedOnSameHost:true,officialLoginVerified:false}));
}finally{release?.();child?.kill();await worker;await rm(home,{recursive:true,force:true});}
