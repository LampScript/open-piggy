// End-to-end component fixture: real Chromium, synthetic local DOM only.
// Never navigate to official login URLs. All page HTTP requests in the test context are aborted.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,access,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {syntheticQr,blankImage} from '../test/qr-fixture.ts';
import {findLoginQr,requestQrMode} from '../dist/login-driver.js';
import {hasDecodableQr,terminalQr} from '../dist/login-qr.js';
import {startLogin,readTask,taskDirectory,activeId} from '../dist/login-task.js';
import {runLoginTask} from '../dist/login-worker.js';
import {loadSession} from '../dist/session.js';
import {watchLoginTask} from '../dist/login-terminal.js';
const base=resolve(process.env.OPEN_PIGGY_FIXTURE_DIR||'artifacts/login-browser-fixture');
await mkdir(base,{recursive:true,mode:0o700});const root=await mkdtemp(join(base,'run-'));const profile=join(root,'browser-profile');let context;
try{
 context=await chromium.launchPersistentContext(profile,{headless:true});let externalRequests=0;
 await context.route('**/*',async route=>{if(/^https?:/.test(route.request().url()))externalRequests++;await route.abort();});
 const page=context.pages()[0]||await context.newPage();await page.goto('about:blank');
 const qr=syntheticQr().toString('base64'),blank=blankImage().toString('base64');
 const html=`<div class="qrcode-login"><button title="扫码登录" onclick="document.getElementById('widget').hidden=false">扫码登录</button><div class="qrcode-img"><img hidden src="data:image/png;base64,${qr}"><img alt="logo" src="data:image/png;base64,${blank}"></div><div class="qrcode-img" id="widget" hidden><canvas id="code"></canvas></div></div><footer><img alt="二维码" src="data:image/png;base64,${qr}"></footer><script>const i=new Image();i.onload=()=>{const c=document.getElementById('code');c.width=i.width;c.height=i.height;c.getContext('2d').drawImage(i,0,0);c.dataset.ready='true';};i.src='data:image/png;base64,${qr}';</script>`;
 await page.setContent('<iframe id="fixture" style="width:640px;height:600px"></iframe>');
 await page.locator('#fixture').evaluate((el,value)=>{el.srcdoc=value;},html);
 const frame=await page.locator('#fixture').contentFrame();assert.ok(frame);
 // URL values are synthetic policy metadata; actual documents remain about:blank/srcdoc.
 const scoped={url:()=> 'https://login.taobao.com/newlogin/synthetic-fixture.htm',locator:selector=>frame.locator(selector)};
 const top='https://login.taobao.com/member/login.jhtml';
 await frame.locator('#code[data-ready="true"]').waitFor({state:'attached'});
 assert.equal(page.url(),'about:blank');
 assert.equal(await findLoginQr(top,scoped),undefined);
 assert.equal(await requestQrMode(top,scoped),true);
 const image=await findLoginQr(top,scoped);assert.ok(image);assert.equal(hasDecodableQr(image),true);
 const home=join(root,'isolated-home');const task=await startLogin(home,()=>{});let inspections=0,handoffVerified=false,terminalVerified=false;
 let scanRendered;const scan=new Promise(resolve=>{scanRendered=resolve;});
 const terminal=watchLoginTask(task.loginId,{home,pollMs:25,write:text=>{if(text.includes('Scan this official QR')){assert.ok(/[\u2580-\u259f]/.test(text));terminalVerified=true;scanRendered();}}});
 const session={version:1,savedAt:new Date().toISOString(),cookies:[{name:'fixture',value:'synthetic-not-a-real-session',domain:'.fliggy.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'None'}]};
 await runLoginTask(task.loginId,{start:async()=>{},inspect:async()=>++inspections===1?{state:'pending',qr:image}:{state:'authenticated',session},close:async()=>{await context.close();context=undefined;}},home,async()=>{
  const s=await readTask(task.loginId,home);const status=await(await fetch(s.handoffUrl+'status')).json();assert.equal(status.qrReady,true);handoffVerified=true;
  assert.ok(await terminalQr(s.qrPath));await scan;
 });
 assert.equal((await terminal).state,'authenticated');assert.equal((await readTask(task.loginId,home)).state,'authenticated');assert.equal((await loadSession(home)).cookies[0].value,'synthetic-not-a-real-session');assert.equal(await activeId(home),undefined);
 await assert.rejects(access(join(taskDirectory(task.loginId,home),'qr.png')));assert.equal(externalRequests,0);
 console.log(JSON.stringify({status:0,scope:'offline-real-chromium-fixture',iframeCanvasQr:true,explicitModeSwitch:true,handoffVerified,terminalVerified,terminalWorkflow:'printed-qr-then-awaited-confirmation',syntheticSessionPersistence:true,qrCleanup:true,externalBrowserRequests:externalRequests,requestScope:'playwright-context-page-http',officialLoginVerified:false}));
}finally{await context?.close();await rm(root,{recursive:true,force:true});}
