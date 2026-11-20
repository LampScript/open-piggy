import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile,rename,rm,chmod,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {sessionDirectory} from './session.js';
import {PiggyError} from './errors.js';
const schema=z.object({loginId:z.string().regex(/^[a-f0-9]{32}$/),state:z.enum(['pending','authenticated','expired','cancelled','verification_required','failed']),mode:z.enum(['qr','browser']),workerPid:z.number().int().positive().max(2147483647).optional(),qrExpiresAt:z.null(),createdAt:z.string().datetime(),expiresAt:z.string().datetime(),qrPath:z.string().nullable(),handoffUrl:z.string().nullable(),cancelRequested:z.boolean().optional(),error:z.object({code:z.string(),message:z.string()}).optional()});
export type LoginTask=z.infer<typeof schema>;
export function taskDirectory(id:string,home=sessionDirectory()):string {
 if(!/^[a-f0-9]{32}$/.test(id))throw new PiggyError('INVALID_ARGUMENT','login-id must be the ID returned by auth login.');
 return join(home,'logins',id);
}
export async function writeTask(task:LoginTask,home=sessionDirectory()):Promise<void> {
 const dir=taskDirectory(task.loginId,home);await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
 const temp=join(dir,`status.${process.pid}.tmp`);await writeFile(temp,JSON.stringify(task),{mode:0o600});await rename(temp,join(dir,'status.json'));
}
export async function readTaskRecord(id:string,home=sessionDirectory()):Promise<LoginTask> {
 let raw:unknown;
 try {raw=JSON.parse(await readFile(join(taskDirectory(id,home),'status.json'),'utf8'));}
 catch(e){if(e instanceof PiggyError)throw e;if((e as NodeJS.ErrnoException).code==='ENOENT')throw new PiggyError('INVALID_ARGUMENT','Login task does not exist.');throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Local login task state is invalid.');}
 const parsed=schema.safeParse(raw);if(!parsed.success||parsed.data.loginId!==id)throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Local login task state is invalid.');
 const task=parsed.data;
 if(task.state==='pending' && await cancelled(id,home))task.cancelRequested=true;
 return task;
}
export async function readTask(id:string,home=sessionDirectory()):Promise<LoginTask> {
 const task=await readTaskRecord(id,home);
 return task.state==='pending'&&Date.parse(task.expiresAt)<=Date.now()?{...task,state:'expired',qrPath:null,handoffUrl:null}:task;
}
export async function activeId(home=sessionDirectory()):Promise<string|undefined> {
 try {const id=await readFile(join(home,'active-login','id'),'utf8');taskDirectory(id,home);return id;}
 catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}
}
export async function releaseLoginLock(id:string,home=sessionDirectory()):Promise<void> {
 if(await activeId(home)===id)await rm(join(home,'active-login'),{recursive:true,force:true});
}
export async function cancelTask(id:string,home=sessionDirectory()):Promise<LoginTask> {
 const task=await readTask(id,home);
 if(task.state==='pending')await writeFile(join(taskDirectory(id,home),'cancel'),'',{mode:0o600});
 return task.state==='pending'?{...task,cancelRequested:true}:task;
}
export async function cancelled(id:string,home=sessionDirectory()):Promise<boolean> {
 try {await readFile(join(taskDirectory(id,home),'cancel'));return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}
}
export async function cancelActive(home=sessionDirectory()):Promise<void> {
 const id=await activeId(home);if(!id)return;await cancelTask(id,home);
 const deadline=Date.now()+35000;
 while(Date.now()<deadline){const task=await readTaskRecord(id,home);if(task.state!=='pending')return;
  let alive=false;
  if(task.workerPid!==undefined){try{process.kill(task.workerPid,0);alive=true;}catch(e){if((e as NodeJS.ErrnoException).code==='EPERM')alive=true;else if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}}
  if(!alive){await writeTask({...task,state:'cancelled',qrPath:null,handoffUrl:null,cancelRequested:true},home);await rm(join(taskDirectory(id,home),'qr.png'),{force:true});await rm(join(taskDirectory(id,home),'profile'),{recursive:true,force:true});await releaseLoginLock(id,home);return;}
  await delay(250);}
 throw new PiggyError('LOGIN_REQUIRED','Login cancellation is still pending; retry logout after the task finishes.');
}
async function launch(id:string):Promise<void> {
 const ts=import.meta.url.endsWith('.ts');const worker=new URL(ts?'./login-worker.ts':'./login-worker.js',import.meta.url);
 const child=spawn(process.execPath,[...(ts?['--import','tsx']:[]),fileURLToPath(worker),id],{detached:true,stdio:'ignore',env:process.env});
 await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
}
export async function startLogin(home=sessionDirectory(),launcher:(id:string)=>void|Promise<void>=launch,mode:'qr'|'browser'='qr'):Promise<LoginTask> {
 await mkdir(home,{recursive:true,mode:0o700});await chmod(home,0o700);await mkdir(join(home,'logins'),{recursive:true,mode:0o700});
 const existing=await activeId(home);
 if(existing){const task=await readTask(existing,home);if(task.state==='pending'&&!await cancelled(existing,home))return task;if(task.state==='expired'||task.state!=='pending')await releaseLoginLock(existing,home);else throw new PiggyError('LOGIN_REQUIRED','Previous login is cancelling; retry after its worker exits.');}
 const loginId=randomBytes(16).toString('hex');
 const staging=join(home,`active-login-${loginId}`),lock=join(home,'active-login');
 const task:LoginTask={loginId,state:'pending',mode,qrExpiresAt:null,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString(),qrPath:null,handoffUrl:null};
 await writeTask(task,home);
 await mkdir(staging,{mode:0o700});await writeFile(join(staging,'id'),loginId,{mode:0o600});
 try {
  // Publish a complete owner record atomically, never an empty active lock.
  // rmdir only recovers an empty lock left by older versions; a live lock is
  // nonempty and cannot be removed this way.
  try{await rmdir(lock);}catch(e){if(!['ENOENT','ENOTEMPTY','EEXIST'].includes((e as NodeJS.ErrnoException).code||''))throw e;}
  try{await rename(staging,lock);}catch(e){
   if(['EEXIST','ENOTEMPTY','EPERM'].includes((e as NodeJS.ErrnoException).code||''))throw new PiggyError('LOGIN_REQUIRED','Another login is starting. Retry auth login to obtain its task ID.');throw e;
  }
  await launcher(loginId);return task;
 }catch(e){await writeTask({...task,state:'failed',error:{code:'UPSTREAM_ERROR',message:'Login task could not start.'}},home);await releaseLoginLock(loginId,home);throw e;}
 finally{await rm(staging,{recursive:true,force:true});}
}

export async function waitForLoginReady(id:string,home=sessionDirectory(),milliseconds=15000,mode:'qr'|'url'='qr'):Promise<LoginTask> {
 const deadline=Date.now()+milliseconds;let task=await readTask(id,home);
 while(task.state==='pending'&&!(mode==='url'?task.handoffUrl:task.qrPath)&&Date.now()<deadline){await delay(250);task=await readTask(id,home);}
 return task;
}
