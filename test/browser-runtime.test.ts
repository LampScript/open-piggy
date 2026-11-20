import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import childProcess from 'node:child_process';
import {PassThrough} from 'node:stream';
import {mkdtemp,writeFile,chmod,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {classifyBrowserLaunchError,browserDoctor,installBrowser} from '../src/browser-runtime.js';

test('missing optional Playwright and missing matching executable are distinct sanitized errors',()=>{
 const missing=Object.assign(new Error("Cannot find package 'playwright' imported from /private/profile-secret/module.js"),{code:'ERR_MODULE_NOT_FOUND'});
 assert.equal(classifyBrowserLaunchError(missing).code,'BROWSER_RUNTIME_NOT_INSTALLED');
 const binary=classifyBrowserLaunchError(new Error("browserType.launchPersistentContext: Executable doesn't exist at /private/user-data/chrome?token=private-token"));
 assert.equal(binary.code,'BROWSER_NOT_INSTALLED');assert.ok(!binary.message.includes('private-token'));assert.ok(!binary.message.includes('/private/'));
});
test('system-library errors expose only safe missing library basenames',()=>{
 const error=classifyBrowserLaunchError(new Error('/private/user/chrome --user-data-dir=/secret/profile: error while loading shared libraries: libnss3.so: cannot open shared object file; URL=https://private.example/?token=secret'));
 assert.equal(error.code,'BROWSER_SYSTEM_DEPENDENCIES');assert.match(error.message,/libnss3\.so/);assert.ok(!error.message.includes('/private'));assert.ok(!error.message.includes('private.example'));assert.ok(!error.message.includes('token=secret'));
});
test('GLIBC requirements identify runtime incompatibility without guessing from distribution name',()=>{
 const error=classifyBrowserLaunchError(new Error("/lib/libc.so.6: version `GLIBC_2.29' not found; /private/user/x: version `GLIBCXX_3.4.26' not found"));
 assert.equal(error.code,'BROWSER_UNSUPPORTED_RUNTIME');assert.match(error.message,/GLIBC_2\.29/);assert.match(error.message,/GLIBCXX_3\.4\.26/);assert.ok(!error.message.includes('/private'));
 assert.equal(classifyBrowserLaunchError(new Error('Debian10 launch failed unknown-secret')).code,'UPSTREAM_ERROR');
 assert.equal(classifyBrowserLaunchError(new Error("version `CXXABI_1.3.9' not found /private/path")).code,'BROWSER_UNSUPPORTED_RUNTIME');
});
test('display, architecture, sandbox and unknown launch failures remain distinguishable and redacted',()=>{
 assert.equal(classifyBrowserLaunchError(new Error('Missing X server or $DISPLAY')).code,'BROWSER_DISPLAY_REQUIRED');
 assert.equal(classifyBrowserLaunchError(new Error('Exec format error /private/browser')).code,'BROWSER_UNSUPPORTED_RUNTIME');
 assert.equal(classifyBrowserLaunchError(new Error('No usable sandbox! token=secret')).code,'BROWSER_UNSUPPORTED_RUNTIME');
 const unknown=classifyBrowserLaunchError({message:'private'});assert.equal(unknown.code,'UPSTREAM_ERROR');assert.ok(!unknown.message.includes('[object Object]'));
});
async function fakeBinary(){
 const dir=await mkdtemp(join(tmpdir(),'piggy-browser-fixture-'));const binary=join(dir,process.platform==='win32'?'chromium.exe':'chromium');await writeFile(binary,'synthetic fixture only');await chmod(binary,0o700);return {dir,binary};
}
test('doctor smoke uses an owned temporary persistent profile and only about:blank, then cleans it',async t=>{
 const {dir,binary}=await fakeBinary();let profile='',closed=false;const visits:string[]=[];
 t.mock.method(chromium,'executablePath',()=>binary);
 t.mock.method(chromium,'launchPersistentContext',async(path:string,options:Record<string,unknown>)=>{
  profile=path;assert.equal(options.headless,true);assert.equal(options.args,undefined);assert.equal(options.chromiumSandbox,undefined);
  return {pages:()=>[{goto:async(url:string)=>{visits.push(url);},url:()=> 'about:blank'}],close:async()=>{closed=true;}};
 });
 try {const result=await browserDoctor();assert.equal(result.ready,true);assert.equal(result.binaryExists,true);assert.equal(result.headlessBlankSmoke,'passed');assert.equal(result.cleanup,'complete');assert.ok(result.playwrightVersion);assert.deepEqual(visits,['about:blank']);assert.equal(closed,true);await assert.rejects(access(profile));assert.ok(!JSON.stringify(result).includes(profile));}
 finally{await rm(dir,{recursive:true,force:true});}
});
test('doctor reports missing binary before attempting any browser launch',async t=>{
 t.mock.method(chromium,'executablePath',()=>join(tmpdir(),'open-piggy-nonexistent-test-binary'));
 t.mock.method(chromium,'launchPersistentContext',async()=>{throw Error('Should not launch');});
 const result=await browserDoctor();assert.equal(result.ready,false);assert.equal(result.binaryExists,false);assert.equal(result.headlessBlankSmoke,'not_run');assert.equal(result.error?.code,'BROWSER_NOT_INSTALLED');
});
test('doctor classifies a launch error and removes its temporary profile',async t=>{
 const {dir,binary}=await fakeBinary();let profile='';
 t.mock.method(chromium,'executablePath',()=>binary);
 t.mock.method(chromium,'launchPersistentContext',async(path:string)=>{profile=path;throw Error('error while loading shared libraries: libatk-1.0.so.0: cannot open shared object file /private-token');});
 try {const result=await browserDoctor();assert.equal(result.ready,false);assert.equal(result.headlessBlankSmoke,'failed');assert.equal(result.error?.code,'BROWSER_SYSTEM_DEPENDENCIES');assert.ok(!JSON.stringify(result).includes('private-token'));await assert.rejects(access(profile));}finally{await rm(dir,{recursive:true,force:true});}
});
test('browser install invokes the installed vendor CLI and forwards both progress streams to stderr only',async t=>{
 const {dir,binary}=await fakeBinary();const logs:string[]=[];let stdoutWrites=0;
 t.mock.method(chromium,'executablePath',()=>binary);
 t.mock.method(process.stderr,'write',(chunk:unknown)=>{logs.push(String(chunk));return true;});
 t.mock.method(process.stdout,'write',()=>{stdoutWrites++;return true;});
 t.mock.method(childProcess,'spawn',(executable:string,args:string[],options:{stdio:unknown})=>{
  assert.equal(executable,process.execPath);assert.match(args[0]!,/playwright[/\\]cli\.js$/);assert.deepEqual(args.slice(1),['install','chromium']);assert.deepEqual(options.stdio,['inherit','pipe','pipe']);
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough()});
  queueMicrotask(()=>{child.stdout.write('vendor stdout progress');child.stderr.write('vendor stderr progress');child.stdout.end();child.stderr.end();child.emit('close',0,null);});return child;
 });
 try{const result=await installBrowser();assert.equal(result.installed,true);assert.ok(result.playwrightVersion);assert.deepEqual(logs,['vendor stdout progress','vendor stderr progress']);assert.equal(stdoutWrites,0);}finally{await rm(dir,{recursive:true,force:true});}
});
test('browser installer failure emits a sanitized error rather than vendor payload',async t=>{
 t.mock.method(childProcess,'spawn',()=>{const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough()});queueMicrotask(()=>child.emit('close',1,null));return child;});
 await assert.rejects(installBrowser(),(error:unknown)=>error instanceof Error&&error.message.includes('installation failed')&&!error.message.includes('user-data-dir'));
});
