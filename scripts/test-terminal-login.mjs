// Real CLI process, synthetic existing task only; never launch a login provider.
import {spawn} from 'node:child_process';import {mkdir,mkdtemp,rm} from 'node:fs/promises';import {resolve,join} from 'node:path';import assert from 'node:assert/strict';
import {syntheticQr} from '../test/qr-fixture.ts';import {startLogin,readTask} from '../dist/login-task.js';import {runLoginTask} from '../dist/login-worker.js';
const base=resolve(process.env.OPEN_PIGGY_FIXTURE_DIR||'artifacts/login-terminal-fixture');await mkdir(base,{recursive:true,mode:0o700});const home=await mkdtemp(join(base,'run-'));
let child,worker,release;let stdout='',stderr='',printed=false,stdoutEmptyAtPrint=false,hasBlocks=false;
try{
 const task=await startLogin(home,()=>{});let inspections=0,prepared;
 const ready=new Promise(resolve=>{prepared=resolve;});const scanned=new Promise(resolve=>{release=resolve;});
 const session={version:1,savedAt:new Date().toISOString(),cookies:[{name:'fixture',value:'synthetic-not-a-real-session',domain:'.fliggy.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'None'}]};
 worker=runLoginTask(task.loginId,{start:async()=>{},inspect:async()=>++inspections===1?{state:'pending',qr:syntheticQr()}:{state:'authenticated',session},close:async()=>{}},home,async()=>{prepared();await scanned;});
 await Promise.race([ready,worker.then(()=>{throw Error('Synthetic worker ended before QR preparation');})]);
 child=spawn(process.execPath,['--import','tsx','src/cli.ts','auth','login','--qr','--wait'],{cwd:process.cwd(),env:{...process.env,OPEN_PIGGY_HOME:home,PLAYWRIGHT_BROWSERS_PATH:join(home,'intentionally-absent-browser-cache')},stdio:['ignore','pipe','pipe']});
 // Existing synthetic task is reused. The absent cache additionally prevents
 // any unintended replacement worker from launching a real browser.
 child.stdout.on('data',chunk=>{stdout+=chunk;});
 child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.includes('Scan this official QR')&&!printed){printed=true;stdoutEmptyAtPrint=stdout==='';hasBlocks=/[\u2580-\u259f]/.test(stderr);release();}});
 const timer=setTimeout(()=>{release();child.kill();},15000);
 let code;try{code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});}finally{clearTimeout(timer);}
 release();await worker;assert.equal(code,0);assert.equal(hasBlocks,true);assert.equal(printed,true);assert.equal(stdoutEmptyAtPrint,true);assert.equal(stdout.trim().split('\n').length,1);
 const result=JSON.parse(stdout);assert.equal(result.status,0);assert.equal(result.data.state,'authenticated');assert.equal(result.data.loginId,task.loginId);assert.equal((await readTask(task.loginId,home)).state,'authenticated');assert.ok(!stdout.includes('synthetic-not-a-real-session'));
 console.log(JSON.stringify({status:0,scope:'offline-real-cli-terminal-fixture',qrPrinted:true,pendingJsonNotPrinted:true,waitedForSyntheticConfirmation:true,finalAuthenticatedFixture:true,officialLoginVerified:false}));
}finally{release?.();child?.kill();await worker;await rm(home,{recursive:true,force:true});}
