import childProcess from 'node:child_process';
import {constants} from 'node:fs';
import {access,mkdtemp,readFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {PiggyError,type ErrorCode} from './errors.js';

// Launch output can contain command arguments, profile paths, URLs and tokens.
// Match known failure classes, but never return the original error or stack.
export function classifyBrowserLaunchError(error:unknown):PiggyError {
 const message=error instanceof Error?error.message:typeof error==='string'?error:'';
 const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';
 if((code==='ERR_MODULE_NOT_FOUND'||code==='MODULE_NOT_FOUND')&&/cannot find (?:package|module).*playwright(?:-core)?/i.test(message)) {
  return new PiggyError('BROWSER_RUNTIME_NOT_INSTALLED','The optional Playwright runtime is not installed. Reinstall open-piggy with optional dependencies enabled, then run open-piggy browser install.');
 }
 if(/executable doesn['’]?t exist|executable (?:was )?not found|browser executable.*missing/i.test(message)) {
  return new PiggyError('BROWSER_NOT_INSTALLED','The browser executable required by the installed Playwright version is missing. Run open-piggy browser install on this machine; do not install an unrelated latest Playwright browser.');
 }
 const versions=[...new Set(message.match(/\bGLIBC(?:XX)?_\d+(?:\.\d+){1,2}\b/g)||[])].sort();
 if((versions.length>0&&/not found|version .*required/i.test(message))||/CXXABI_\d+(?:\.\d+)+.*not found/i.test(message)||/exec format error|bad cpu type|unsupported (?:architecture|platform)|not supported on this (?:platform|architecture)/i.test(message)) {
  return new PiggyError('BROWSER_UNSUPPORTED_RUNTIME',`The matching Chromium binary is incompatible with this system runtime${versions.length?` (reported requirements: ${versions.join(', ')})`:''}. Use a compatible OS/runtime; open-piggy does not change system libraries or browser security settings.`);
 }
 if(/missing x server|\$DISPLAY|cannot open display|no (?:x11 )?display|without having a xserver/i.test(message)) {
  return new PiggyError('BROWSER_DISPLAY_REQUIRED','Visible browser mode requires a working graphical display. Use the default headless QR mode on a server, or provide a display for --browser.');
 }
 if(/host system is missing dependencies|missing libraries:|error while loading shared libraries|cannot open shared object file/i.test(message)) {
  const libraries=[...new Set(message.match(/\blib[A-Za-z0-9_+.-]+\.so(?:\.\d+)*\b/g)||[])].sort().slice(0,16);
  return new PiggyError('BROWSER_SYSTEM_DEPENDENCIES',`The matching Chromium browser cannot load required system libraries${libraries.length?`: ${libraries.join(', ')}`:'.'} Install the required OS packages manually on a supported environment, then rerun open-piggy browser doctor. No OS packages are installed automatically.`);
 }
 if(/sandbox.*(?:failed|not supported|permission)|no usable sandbox|running as root without/i.test(message)) {
  return new PiggyError('BROWSER_UNSUPPORTED_RUNTIME','Chromium could not initialize in this sandbox environment. Use an environment supported by the browser; open-piggy does not disable security protections to repair this error.');
 }
 if(code==='EACCES'||/spawn.*EACCES/i.test(message)) {
  return new PiggyError('BROWSER_UNSUPPORTED_RUNTIME','The OS refused to execute the matching Chromium binary. Check executable permissions and execution policy, then rerun open-piggy browser doctor.');
 }
 return new PiggyError('UPSTREAM_ERROR','Chromium could not start for an unclassified reason. No raw launch arguments, profile paths or URLs have been disclosed. Verify the matching browser installation and system runtime.');
}

const require=createRequire(import.meta.url);
type Runtime={chromium:typeof import('playwright')['chromium'];version:string;cliPath:string};
async function runtime():Promise<Runtime> {
 let playwright:typeof import('playwright');let packagePath:string;
 try {playwright=await import('playwright');packagePath=require.resolve('playwright/package.json');}
 catch(error) {throw classifyBrowserLaunchError(error);}
 const metadata:unknown=JSON.parse(await readFile(packagePath,'utf8'));
 if(typeof metadata!=='object'||metadata===null||!('version' in metadata)||typeof metadata.version!=='string')throw new PiggyError('UPSTREAM_ERROR','Installed Playwright package metadata is invalid.');
 return {chromium:playwright.chromium,version:metadata.version,cliPath:join(dirname(packagePath),'cli.js')};
}
async function executableExists(path:string):Promise<boolean> {
 try {await access(path,process.platform==='win32'?constants.F_OK:constants.X_OK);return true;}
 catch(error) {if(['ENOENT','EACCES'].includes((error as NodeJS.ErrnoException).code||''))return false;throw error;}
}
export type BrowserDoctorReport={
 ready:boolean;platform:string;arch:string;nodeVersion:string;playwrightVersion:string|null;
 binaryExists:boolean;headlessBlankSmoke:'passed'|'failed'|'not_run';cleanup:'complete'|'failed';
 error?:{code:ErrorCode;message:string};
};
export async function browserDoctor():Promise<BrowserDoctorReport> {
 const report:BrowserDoctorReport={ready:false,platform:process.platform,arch:process.arch,nodeVersion:process.versions.node,playwrightVersion:null,binaryExists:false,headlessBlankSmoke:'not_run',cleanup:'complete'};
 let profile:string|undefined;let context:Awaited<ReturnType<Runtime['chromium']['launchPersistentContext']>>|undefined;
 try {
  const installed=await runtime();report.playwrightVersion=installed.version;
  report.binaryExists=await executableExists(installed.chromium.executablePath());
  if(!report.binaryExists)throw new PiggyError('BROWSER_NOT_INSTALLED','The browser executable required by the installed Playwright version is missing. Run open-piggy browser install on this machine.');
  profile=await mkdtemp(join(tmpdir(),'open-piggy-browser-doctor-'));
  // Match the login provider's persistent, headless context. No custom launch
  // flags, credential profile, remote page or official login URL is used.
  context=await installed.chromium.launchPersistentContext(profile,{headless:true,timeout:15000});
  const page=context.pages()[0]||await context.newPage();
  await page.goto('about:blank',{waitUntil:'domcontentloaded',timeout:5000});
  if(page.url()!=='about:blank')throw new PiggyError('UPSTREAM_ERROR','The local browser diagnostic did not remain on about:blank.');
  report.headlessBlankSmoke='passed';report.ready=true;
 }catch(error) {
  const classified=error instanceof PiggyError?error:classifyBrowserLaunchError(error);
  report.error={code:classified.code,message:classified.message};
  if(profile)report.headlessBlankSmoke='failed';
 }finally {
  try {await context?.close();}
  catch {report.ready=false;report.cleanup='failed';report.error??={code:'UPSTREAM_ERROR',message:'Browser diagnostic shutdown failed; temporary profile cleanup was attempted.'};}
  if(profile)try {await rm(profile,{recursive:true,force:true});}
  catch {report.ready=false;report.cleanup='failed';report.error??={code:'UPSTREAM_ERROR',message:'Temporary browser diagnostic profile could not be removed.'};}
 }
 return report;
}
export async function installBrowser():Promise<{installed:true;browser:'chromium';playwrightVersion:string;nextCommand:string}> {
 const installed=await runtime();
 await new Promise<void>((resolve,reject)=>{
  // Resolve the CLI from the installed dependency, never npx/latest. Vendor
  // progress belongs on stderr so the caller keeps stdout as one JSON line.
  const child=childProcess.spawn(process.execPath,[installed.cliPath,'install','chromium'],{stdio:['inherit','pipe','pipe'],env:process.env});
  child.stdout?.on('data',(chunk:Buffer)=>process.stderr.write(chunk));
  child.stderr?.on('data',(chunk:Buffer)=>process.stderr.write(chunk));
  child.once('error',()=>reject(new PiggyError('UPSTREAM_ERROR','The installed Playwright browser installer could not start.')));
  child.once('close',(status,signal)=>status===0&&!signal?resolve():reject(new PiggyError('UPSTREAM_ERROR','The matching Playwright browser installation failed. Review vendor progress on stderr and correct download, storage or execution permissions before retrying.')));
 });
 if(!await executableExists(installed.chromium.executablePath()))throw new PiggyError('BROWSER_NOT_INSTALLED','The installer completed but the matching Chromium executable is still missing. Check the browser cache configuration and retry open-piggy browser install.');
 return {installed:true,browser:'chromium',playwrightVersion:installed.version,nextCommand:'open-piggy browser doctor'};
}
