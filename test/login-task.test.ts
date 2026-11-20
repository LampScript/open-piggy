import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,readFile,access} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {startLogin,readTask,writeTask,activeId,cancelTask,cancelActive,taskDirectory} from '../src/login-task.js';
import {runLoginTask} from '../src/login-worker.js';import {startHandoff} from '../src/login-handoff.js';
import {loadSession,saveSession,clearSession,type Session} from '../src/session.js';import type {LoginDriver} from '../src/login-driver.js';
import {PNG} from 'pngjs';import {request as httpRequest} from 'node:http';
const session:Session={version:1,savedAt:'2026-11-20T00:00:00.000Z',cookies:[{name:'synthetic',value:'fixture-only-private',domain:'.fliggy.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'None'}]};
const qr=PNG.sync.write(new PNG({width:2,height:2}));
async function home(){return mkdtemp(join(tmpdir(),'piggy-login-test-'));}
async function cleanup(dir:string){await rm(dir,{recursive:true,force:true});}

test('creating a QR task returns immediately, reuses a pending task and keeps files private',async()=>{
 const dir=await home();let launches=0;
 try{const first=await startLogin(dir,()=>{launches++;});const second=await startLogin(dir,()=>{launches++;});assert.equal(first.state,'pending');assert.equal(first.qrPath,null);assert.equal(second.loginId,first.loginId);assert.equal(launches,1);assert.equal(await activeId(dir),first.loginId);if(process.platform!=='win32'){assert.equal((await stat(taskDirectory(first.loginId,dir))).mode&0o777,0o700);assert.equal((await stat(join(taskDirectory(first.loginId,dir),'status.json'))).mode&0o777,0o600);}}finally{await cleanup(dir);}
});
test('successful task exposes QR then saves only provider-verified session and cleans artifacts',async()=>{
 const dir=await home();let inspected=0,closed=false;const task=await startLogin(dir,()=>{});
 const driver:LoginDriver={start:async()=>{},inspect:async()=>++inspected===1?{state:'pending',qr}:{state:'authenticated',session},close:async()=>{closed=true;}};
 try{await runLoginTask(task.loginId,driver,dir,async()=>{const s=await readTask(task.loginId,dir);assert.ok(s.qrPath);assert.ok(s.handoffUrl?.startsWith('http://127.0.0.1:'));assert.ok(!JSON.stringify(s).includes('fixture-only-private'));if(process.platform!=='win32')assert.equal((await stat(s.qrPath!)).mode&0o777,0o600);});
 const done=await readTask(task.loginId,dir);assert.equal(done.state,'authenticated');assert.equal(done.qrPath,null);assert.equal(done.handoffUrl,null);assert.equal(closed,true);assert.deepEqual(await loadSession(dir),session);assert.equal(await activeId(dir),undefined);await assert.rejects(access(join(taskDirectory(task.loginId,dir),'qr.png')));
 }finally{await cleanup(dir);}
});
test('worker failure does not overwrite prior credentials or expose provider errors',async()=>{
 const dir=await home();await saveSession(session,dir);const task=await startLogin(dir,()=>{});let closed=false;
 const driver:LoginDriver={start:async()=>{throw Error('sensitive-provider-payload');},inspect:async()=>{throw Error('unreachable');},close:async()=>{closed=true;}};
 try{await runLoginTask(task.loginId,driver,dir,async()=>{});const s=await readTask(task.loginId,dir);assert.equal(s.state,'failed');assert.equal(closed,true);assert.ok(!JSON.stringify(s).includes('sensitive-provider-payload'));assert.deepEqual(await loadSession(dir),session);assert.equal(await activeId(dir),undefined);}finally{await cleanup(dir);}
});
test('verification-required is explicit and QR/browser resources are cleaned',async()=>{
 const dir=await home();const task=await startLogin(dir,()=>{});let closed=false;
 try{await runLoginTask(task.loginId,{start:async()=>{},inspect:async()=>({state:'verification_required'}),close:async()=>{closed=true;}},dir);const s=await readTask(task.loginId,dir);assert.equal(s.state,'verification_required');assert.equal(s.error?.code,'VERIFICATION_REQUIRED');assert.equal(closed,true);await assert.rejects(loadSession(dir));}finally{await cleanup(dir);}
});
test('expired tasks do not launch a driver or publish a session',async()=>{
 const dir=await home();const task=await startLogin(dir,()=>{});await writeTask({...task,expiresAt:'2000-01-01T00:00:00.000Z'},dir);let started=false;
 try{await runLoginTask(task.loginId,{start:async()=>{started=true;},inspect:async()=>({state:'authenticated',session}),close:async()=>{}},dir);assert.equal(started,false);assert.equal((await readTask(task.loginId,dir)).state,'expired');await assert.rejects(loadSession(dir));}finally{await cleanup(dir);}
});
test('a provider completing after expiry cannot publish credentials',async t=>{
 const dir=await home();const task=await startLogin(dir,()=>{});
 try{await runLoginTask(task.loginId,{start:async()=>{},inspect:async()=>{t.mock.method(Date,'now',()=>Date.parse(task.expiresAt)+1);return {state:'authenticated',session};},close:async()=>{}},dir);assert.equal((await readTask(task.loginId,dir)).state,'expired');await assert.rejects(loadSession(dir));}finally{t.mock.restoreAll();await cleanup(dir);}
});
test('cancel before completion prevents a session from being saved',async()=>{
 const dir=await home();const task=await startLogin(dir,()=>{});await cancelTask(task.loginId,dir);
 try{await runLoginTask(task.loginId,{start:async()=>{},inspect:async()=>({state:'authenticated',session}),close:async()=>{}},dir);assert.equal((await readTask(task.loginId,dir)).state,'cancelled');await assert.rejects(loadSession(dir));}finally{await cleanup(dir);}
});
for(const mode of ['qr','browser'] as const)test(`${mode} logout waits for the provider and prevents session recreation`,async()=>{
 const dir=await home();await saveSession(session,dir);const task=await startLogin(dir,()=>{},mode);assert.equal(task.mode,mode);
 let entered!:()=>void,complete!:(v:{state:'authenticated';session:Session})=>void;const entering=new Promise<void>(resolve=>{entered=resolve;});const result=new Promise<{state:'authenticated';session:Session}>(resolve=>{complete=resolve;});
 try{const worker=runLoginTask(task.loginId,{start:async()=>{},inspect:async()=>{entered();return result;},close:async()=>{}},dir);
 await entering;const cancelling=cancelActive(dir).then(()=>clearSession(dir));
 while(!(await readTask(task.loginId,dir)).cancelRequested)await new Promise(r=>setTimeout(r,1));
 complete({state:'authenticated',session});await Promise.all([worker,cancelling]);assert.equal((await readTask(task.loginId,dir)).state,'cancelled');await assert.rejects(loadSession(dir));
 }finally{await cleanup(dir);}
});
test('handoff serves only token-authorized loopback routes and no sensitive task paths',async()=>{
 const dir=await home();const task=await startLogin(dir,()=>{});const server=await startHandoff(task.loginId,dir);
 try{const url=new URL(server.url);assert.equal(url.hostname,'127.0.0.1');const wrong=await fetch(new URL('/',url));assert.equal(wrong.status,404);const invalidHost=await new Promise<number|undefined>((resolve,reject)=>{const req=httpRequest(server.url,{headers:{Host:'attacker.example'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();});assert.equal(invalidHost,403);const post=await fetch(server.url,{method:'POST'});assert.equal(post.status,405);
 const state=await(await fetch(server.url+'status')).json() as Record<string,unknown>;assert.equal(state.state,'pending');assert.equal(state.qrReady,false);assert.equal(state.qrPath,undefined);assert.equal(state.handoffUrl,undefined);const page=await fetch(server.url);assert.equal(page.headers.get('cache-control'),'no-store');assert.equal(page.headers.get('referrer-policy'),'no-referrer');assert.match(await page.text(),/open-piggy/);
 }finally{await server.close();await cleanup(dir);}
});
test('login id is validated before task files can be accessed',async()=>{await assert.rejects(readTask('../../session.json'),/login-id/);});
test('launcher failure releases the concurrency lock',async()=>{
 const dir=await home();try{await assert.rejects(startLogin(dir,()=>{throw Error('launch failed');}),/launch failed/);assert.equal(await activeId(dir),undefined);}finally{await cleanup(dir);}
});
test('an empty legacy lock is recovered rather than blocking login forever',async()=>{
 const dir=await home();try{const {mkdir}=await import('node:fs/promises');await mkdir(join(dir,'active-login'));const task=await startLogin(dir,()=>{});assert.equal(await activeId(dir),task.loginId);}finally{await cleanup(dir);}
});
test('cancelled-before-start task never launches its provider',async()=>{
 const dir=await home();const task=await startLogin(dir,()=>{});await cancelTask(task.loginId,dir);let starts=0;
 try{await runLoginTask(task.loginId,{start:async()=>{starts++;},inspect:async()=>({state:'authenticated',session}),close:async()=>{}},dir);assert.equal(starts,0);assert.equal((await readTask(task.loginId,dir)).state,'cancelled');}finally{await cleanup(dir);}
});
test('expired task with no live worker can be cancelled so logout and browser restart recover',async()=>{
 const dir=await home();await saveSession(session,dir);const task=await startLogin(dir,()=>{});await writeTask({...task,expiresAt:'2000-01-01T00:00:00.000Z'},dir);
 try{await cancelActive(dir);await clearSession(dir);assert.equal((await readTask(task.loginId,dir)).state,'cancelled');assert.equal(await activeId(dir),undefined);await assert.rejects(loadSession(dir));const next=await startLogin(dir,()=>{},'browser');assert.equal(next.mode,'browser');assert.notEqual(next.loginId,task.loginId);}finally{await cleanup(dir);}
});
test('QR task with no extracted widget fails explicitly instead of staying pending until task expiry',async t=>{
 const dir=await home();const task=await startLogin(dir,()=>{});
 try{const driver:LoginDriver={start:async()=>{},inspect:async()=>{t.mock.method(Date,'now',()=>Date.parse(task.createdAt)+31000);return {state:'pending'};},close:async()=>{}};
 await runLoginTask(task.loginId,driver,dir,async()=>{await cancelTask(task.loginId,dir);});
 const state=await readTask(task.loginId,dir);assert.equal(state.state,'failed');assert.equal(state.error?.code,'CAPABILITY_UNVERIFIED');assert.match(state.error?.message||'',/QR/);await assert.rejects(loadSession(dir));
 }finally{t.mock.restoreAll();await cleanup(dir);}
});
test('browser startup failure does not advertise a dead handoff URL',async()=>{
 const dir=await home();const task=await startLogin(dir,()=>{});
 try{await runLoginTask(task.loginId,{start:async()=>{assert.equal((await readTask(task.loginId,dir)).handoffUrl,null);throw Error('synthetic startup failure');},inspect:async()=>({state:'pending'}),close:async()=>{}},dir);const s=await readTask(task.loginId,dir);assert.equal(s.state,'failed');assert.equal(s.handoffUrl,null);}finally{await cleanup(dir);}
});
test('handoff never accepts or returns cookies and retains only its own machine session',async()=>{
 const dir=await home();await saveSession(session,dir);const task=await startLogin(dir,()=>{});const server=await startHandoff(task.loginId,dir);
 try{const page=await fetch(server.url);assert.equal(page.headers.get('set-cookie'),null);const html=await page.text();assert.ok(!html.includes('fixture-only-private'));const response=await fetch(server.url+'status',{headers:{Cookie:'synthetic-client-cookie=not-imported'}});const body=await response.text();assert.equal(response.headers.get('set-cookie'),null);assert.ok(!body.includes('fixture-only-private'));assert.ok(!body.includes('synthetic-client-cookie'));assert.deepEqual(await loadSession(dir),session);const upload=await fetch(server.url,{method:'POST',body:'cookie=not-accepted'});assert.equal(upload.status,405);assert.deepEqual(await loadSession(dir),session);}finally{await server.close();await cleanup(dir);}
});
