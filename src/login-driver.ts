import {mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import type {BrowserContext,Page} from 'playwright';
import {createClient,loggedIn,parseJsonResponse} from './http.js';
import {jarFromSession,trustedCookie,type Session} from './session.js';
import {PiggyError} from './errors.js';
import {hasDecodableQr} from './login-qr.js';
import {classifyBrowserLaunchError} from './browser-runtime.js';
export type LoginInspection={state:'pending';qr?:Buffer}|{state:'authenticated';session:Session}|{state:'verification_required'};
export interface LoginDriver {start():Promise<void>;inspect():Promise<LoginInspection>;close():Promise<void>;}
// This provider is NOT live-accepted in the current restricted environment.
// It uses ordinary official UI only, with no challenge solving or stealth flags.
export const LOGIN_QR_SELECTOR='.qrcode-login .qrcode-img img, .qrcode-main .qrcode-img img, .qrcode-login .qrcode-img canvas, .qrcode-main .qrcode-img canvas, .qrcode-login canvas, .qrcode-login img[alt="登录二维码"]';
const LOGIN_QR_CONTAINER_SELECTOR='.qrcode-login .qrcode-img, .qrcode-main .qrcode-img';
export function isLoginDocument(value:string):boolean {
 try{const url=new URL(value);return url.origin==='https://login.taobao.com'&&(url.pathname==='/member/login.jhtml'||url.pathname.startsWith('/newlogin/'));}catch{return false;}
}
// Frame/document paths below are accepted login-surface families, not proof
// that a particular live website currently uses them. Fixtures are synthetic.
export interface QrCandidate {
 isVisible():Promise<boolean>;
 screenshot(options:{type:'png';timeout:number}):Promise<Buffer>;
 getAttribute(name:string):Promise<string|null>;
 innerText():Promise<string>;
 click(options:{timeout:number}):Promise<void>;
}
export interface QrFrame {url():string;locator(selector:string):{all():Promise<QrCandidate[]>};}
export async function findLoginQr(topUrl:string,frame:QrFrame):Promise<Buffer|undefined>{
 if(!isLoginDocument(topUrl)||!isLoginDocument(frame.url()))return undefined;
 for(const selector of [LOGIN_QR_SELECTOR,LOGIN_QR_CONTAINER_SELECTOR]){
  for(const candidate of await frame.locator(selector).all()){
   if(!await candidate.isVisible())continue;
   const png=await candidate.screenshot({type:'png',timeout:5000});
   if(hasDecodableQr(png))return png;
  }
 }
 return undefined;
}
export async function requestQrMode(topUrl:string,frame:QrFrame):Promise<boolean>{
 if(!isLoginDocument(topUrl)||!isLoginDocument(frame.url()))return false;
 for(const control of await frame.locator('[aria-label="扫码登录"], [aria-label="二维码登录"], [title="扫码登录"], [title="二维码登录"], button').all()){
  if(!await control.isVisible())continue;
  const label=(await control.getAttribute('aria-label')||await control.getAttribute('title')||await control.innerText()).trim();
  if(!/^(扫码登录|二维码登录)$/.test(label))continue;
  await control.click({timeout:5000});return true;
 }
 return false;
}
export function browserQrDriver(profile:string,visible=false):LoginDriver {
 let context:BrowserContext|undefined,page:Page|undefined;
 const switched=new WeakSet<object>();
 return {
  async start(){
   await mkdir(profile,{recursive:true,mode:0o700});
   let chromium;
   try {({chromium}=await import('playwright'));}catch(error){throw classifyBrowserLaunchError(error);}
   try {context=await chromium.launchPersistentContext(profile,{headless:!visible});}catch(error){throw classifyBrowserLaunchError(error);}
   page=context.pages()[0]||await context.newPage();
   const url=new URL('https://login.taobao.com/member/login.jhtml');url.searchParams.set('redirectURL','https://www.fliggy.com/');
   try {await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:30000});}catch{throw new PiggyError('NETWORK_ERROR','Official login page could not be loaded.');}
  },
  async inspect(){
   if(!context||!page)throw new Error('Login driver not started.');
   if(page.isClosed())throw new PiggyError('LOGIN_REQUIRED','Login browser closed before authentication completed.');
   const url=new URL(page.url());
   if(url.protocol==='https:'&&/(^|\.)fliggy\.com$/.test(url.hostname)){
    const response=await context.request.get('https://sijipiao.fliggy.com/ie/isLogin.htm',{timeout:15000});
    const data=parseJsonResponse(await response.text()) as {error?:number;data?:{login?:number}};
    if(data.error===0&&data.data?.login===1){
     const session:Session={version:1,savedAt:new Date().toISOString(),cookies:(await context.cookies()).filter(c=>trustedCookie(c.domain))};
     if(!await loggedIn(createClient(await jarFromSession(session))))throw new PiggyError('LOGIN_REQUIRED','Official redirect completed, but HTTP session verification failed.');
     return {state:'authenticated',session};
    }
   }
   for(const frame of page.frames()){
    let origin:URL;try{origin=new URL(frame.url());}catch{continue;}
    if(origin.protocol!=='https:'||!trustedCookie(origin.hostname))continue;
    if(await frame.locator('#nocaptcha, iframe[src*="punish"], iframe[src*="captcha"]').first().isVisible())return visible?{state:'pending'}:{state:'verification_required'};
    const qr=await findLoginQr(page.url(),frame);
    if(qr)return {state:'pending',qr};
    if(!visible&&!switched.has(frame)&&await requestQrMode(page.url(),frame))switched.add(frame);
   }
   return {state:'pending'};
  },
  async close(){try{await context?.close();}finally{await rm(profile,{recursive:true,force:true});}}
 };
}
