import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
import {startLogin,writeTask,taskDirectory,readTask} from '../src/login-task.js';import {shouldWaitForLogin,watchLoginTask} from '../src/login-terminal.js';
import {syntheticQr} from './qr-fixture.js';import {PNG} from 'pngjs';import {terminalQrFrame} from '../src/login-qr.js';
test('interactive QR login waits by default; Agent detach and redirected shells retain async mode',()=>{
 assert.equal(shouldWaitForLogin({},true),true);assert.equal(shouldWaitForLogin({},false),false);assert.equal(shouldWaitForLogin({wait:true},false),true);assert.equal(shouldWaitForLogin({detach:true},true),false);assert.equal(shouldWaitForLogin({url:true},true),false);assert.throws(()=>shouldWaitForLogin({wait:true,detach:true},true));
});
test('terminal follows a QR that appears after the initial pending result and waits for confirmation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'piggy-terminal-'));const task=await startLogin(dir,()=>{});let output='',finished=false,scanned!:()=>void;const seen=new Promise<void>(resolve=>{scanned=resolve;});
 const watching=watchLoginTask(task.loginId,{home:dir,pollMs:5,write:text=>{output+=text;if(text.includes('Scan this official QR'))scanned();}}).then(result=>{finished=true;return result;});
 try{await delay(20);assert.equal(finished,false);assert.ok(!output.includes('Scan this official QR'));
 const qrPath=join(taskDirectory(task.loginId,dir),'qr.png');await writeFile(qrPath,syntheticQr(),{mode:0o600});await writeTask({...task,qrPath,phase:'qr_ready'},dir);await seen;assert.equal(finished,false);assert.ok(!output.includes('open-piggy-synthetic-login-fixture'));
 await writeTask({...task,state:'authenticated',qrPath:null,handoffUrl:null},dir);assert.equal((await watching).state,'authenticated');assert.match(output,/Login successful/);
 }finally{await writeTask({...task,state:'cancelled',qrPath:null,handoffUrl:null},dir);await watching;await rm(dir,{recursive:true,force:true});}
});
test('QR redraw uses payload fingerprint rather than PNG byte changes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'piggy-fingerprint-'));try{const image=PNG.sync.read(syntheticQr());const one=PNG.sync.write(image,{deflateLevel:0}),two=PNG.sync.write(image,{deflateLevel:9});assert.notDeepEqual(one,two);const path=join(dir,'qr.png');await writeFile(path,one);const first=await terminalQrFrame(path);await writeFile(path,two);const second=await terminalQrFrame(path);assert.equal(first?.fingerprint,second?.fingerprint);assert.ok(first?.rendered);}finally{await rm(dir,{recursive:true,force:true});}
});
test('Ctrl+C signal requests cancellation without claiming authentication or deleting saved sessions',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'piggy-terminal-cancel-'));const task=await startLogin(dir,()=>{});const signal=new AbortController();signal.abort();
 try{const result=await watchLoginTask(task.loginId,{home:dir,signal:signal.signal,write:()=>{}});assert.equal(result.state,'pending');assert.equal(result.cancelRequested,true);assert.equal((await readTask(task.loginId,dir)).cancelRequested,true);}finally{await rm(dir,{recursive:true,force:true});}
});
test('terminal ends on explicit failure without printing a fabricated QR',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'piggy-terminal-failed-'));const task=await startLogin(dir,()=>{});await writeTask({...task,state:'failed',error:{code:'CAPABILITY_UNVERIFIED',message:'No QR widget'}},dir);let output='';
 try{const result=await watchLoginTask(task.loginId,{home:dir,write:s=>{output+=s;}});assert.equal(result.state,'failed');assert.match(output,/No QR widget/);assert.ok(!output.includes('Scan this official QR'));}finally{await rm(dir,{recursive:true,force:true});}
});
