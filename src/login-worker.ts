import {writeFile,rm,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {sessionDirectory,saveSession} from './session.js';
import {activeId,cancelled,readTask,writeTask,releaseLoginLock,taskDirectory,type LoginTask} from './login-task.js';
import {browserQrDriver,type LoginDriver} from './login-driver.js';
import {startHandoff} from './login-handoff.js';
import {PiggyError} from './errors.js';
export async function runLoginTask(id:string,driver:LoginDriver,home=sessionDirectory(),pause:(ms:number)=>Promise<void>=delay):Promise<void>{
 let task=await readTask(id,home);let handoff:Awaited<ReturnType<typeof startHandoff>>|undefined;
 try{
  if(task.state!=='pending')return;
  task={...task,workerPid:process.pid};await writeTask(task,home);
  if(await cancelled(id,home)||await activeId(home)!==id){task={...task,state:'cancelled'};return;}
  task={...task,phase:'opening_login'};await writeTask(task,home);
  await driver.start();
  handoff=await startHandoff(id,home);task={...task,handoffUrl:handoff.url};await writeTask(task,home);
  let qrHash='';const qrDeadline=Date.now()+30000;
  task={...task,phase:task.mode==='qr'?'waiting_for_qr':'waiting_for_user'};await writeTask(task,home);
  while(Date.now()<Date.parse(task.expiresAt)){
   if(await cancelled(id,home)||await activeId(home)!==id){task={...task,state:'cancelled'};break;}
   const state=await driver.inspect();
   if(state.state==='verification_required'){task={...task,state:'verification_required',error:{code:'VERIFICATION_REQUIRED',message:'Complete official verification using auth login --browser.'}};break;}
   if(state.state==='authenticated'){
    if(Date.now()>=Date.parse(task.expiresAt)){task={...task,state:'expired'};break;}
    if(await cancelled(id,home)||await activeId(home)!==id){task={...task,state:'cancelled'};break;}
    await saveSession(state.session,home);task={...task,state:'authenticated'};break;
   }
   if(state.qr){const hash=createHash('sha256').update(state.qr).digest('hex');if(hash!==qrHash){const qrPath=join(taskDirectory(id,home),'qr.png');const temp=join(taskDirectory(id,home),'qr.tmp');await writeFile(temp,state.qr,{mode:0o600});await rename(temp,qrPath);qrHash=hash;task={...task,qrPath,phase:'qr_ready'};await writeTask(task,home);}}
   if(task.mode==='qr'&&!task.qrPath&&Date.now()>=qrDeadline){task={...task,state:'failed',error:{code:'CAPABILITY_UNVERIFIED',message:'No official login QR widget was extracted within 30 seconds. QR login is not ready; use explicit --browser mode for manual login.'}};break;}
   await pause(2000);
  }
  if(task.state==='pending')task={...task,state:'expired'};
 }catch(e){const error=e instanceof PiggyError?e:new PiggyError('UPSTREAM_ERROR','Login worker failed; no credentials or page details have been logged.');task={...task,state:'failed',error:{code:error.code,message:error.message}};}
 finally{
  try{await driver.close();}catch{task={...task,state:'failed',error:{code:'UPSTREAM_ERROR',message:'Login browser cleanup failed.'}};}
  await writeTask({...task,qrPath:null,handoffUrl:null,phase:undefined},home);
  await handoff?.close();await rm(join(taskDirectory(id,home),'qr.png'),{force:true});
  await releaseLoginLock(id,home);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const id=process.argv[2];if(!id)throw new Error('Login worker requires task ID.');
 const home=sessionDirectory();const task=await readTask(id,home);await runLoginTask(id,browserQrDriver(join(taskDirectory(id,home),'profile'),task.mode==='browser'),home);
}
