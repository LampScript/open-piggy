import {setTimeout as delay} from 'node:timers/promises';
import {readTask,cancelTask,type LoginTask} from './login-task.js';
import {sessionDirectory} from './session.js';
import {terminalQrFrame} from './login-qr.js';
import {PiggyError} from './errors.js';
export function shouldWaitForLogin(options:{wait?:boolean;detach?:boolean;url?:boolean},interactive:boolean):boolean {
 if(options.wait&&options.detach)throw new PiggyError('INVALID_ARGUMENT','--wait and --detach cannot be combined.');
 return Boolean(options.wait||(!options.detach&&!options.url&&interactive));
}
export async function watchLoginTask(id:string,options:{home?:string;write?:(text:string)=>void;pollMs?:number;signal?:AbortSignal;showUrl?:boolean}={}):Promise<LoginTask>{
 const home=options.home??sessionDirectory(),write=options.write??(text=>process.stderr.write(text));
 let lastQr='',lastPhase='',lastUrl='';
 write('Waiting for official login. Press Ctrl+C to request cancellation.\n');
 for(;;){
  let task=await readTask(id,home);
  if(options.signal?.aborted&&task.state==='pending'){
   await cancelTask(id,home);write('Cancellation requested; check the task status for cleanup completion.\n');return readTask(id,home);
  }
  if(task.state!=='pending'){
   write(task.state==='authenticated'?'Login successful; session saved.\n':`Login ended: ${task.state}${task.error?` (${task.error.message})`:''}\n`);return task;
  }
  if(task.phase&&task.phase!==lastPhase){lastPhase=task.phase;if(task.phase!=='qr_ready')write(`Login phase: ${task.phase}\n`);}
  if(options.showUrl&&task.handoffUrl&&task.handoffUrl!==lastUrl){lastUrl=task.handoffUrl;write(`Private local handoff: ${lastUrl}\n`);}
  if(task.mode==='qr'&&task.qrPath){
   try{
    const qr=await terminalQrFrame(task.qrPath);
    if(qr&&qr.fingerprint!==lastQr){lastQr=qr.fingerprint;write(qr.rendered+'\nScan this official QR in the official app and confirm login.\n');}
   }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;task=await readTask(id,home);if(task.state==='pending')throw e;continue;}
  }
  await delay(options.pollMs??500);
 }
}
