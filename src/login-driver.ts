import {mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import type {BrowserContext,Page} from 'playwright';
import {createClient,loggedIn,parseJsonResponse} from './http.js';
import {jarFromSession,trustedCookie,type Session} from './session.js';
import {PiggyError} from './errors.js';
export type LoginInspection={state:'pending';qr?:Buffer}|{state:'authenticated';session:Session}|{state:'verification_required'};
export interface LoginDriver {start():Promise<void>;inspect():Promise<LoginInspection>;close():Promise<void>;}
// This provider is NOT live-accepted in the current restricted environment.
// It uses ordinary official UI only, with no challenge solving or stealth flags.
export const LOGIN_QR_SELECTOR='.qrcode-login .qrcode-img img, .qrcode-main .qrcode-img img, .qrcode-login img[alt="登录二维码"]';
export function isLoginDocument(value:string):boolean {
 try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='login.taobao.com'&&url.pathname==='/member/login.jhtml';}catch{return false;}
}
export function browserQrDriver(profile:string,visible=false):LoginDriver {
 let context:BrowserContext|undefined,page:Page|undefined;
 return {
  async start(){
   await mkdir(profile,{recursive:true,mode:0o700});
   let chromium;
   try {({chromium}=await import('playwright'));}catch{throw new PiggyError('CAPABILITY_UNVERIFIED','QR login requires Playwright and its matching Chromium installation.');}
   try {context=await chromium.launchPersistentContext(profile,{headless:!visible});}catch{throw new PiggyError('UPSTREAM_ERROR','Cannot launch login browser; install matching Playwright Chromium.');}
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
    // Widget detection is intentionally narrow; an unrelated image must never
    // be advertised as an official login QR. This selector awaits live QA.
    if(!isLoginDocument(page.url())||!isLoginDocument(frame.url()))continue;
    const qr=frame.locator(LOGIN_QR_SELECTOR).first();
    if(await qr.isVisible())return {state:'pending',qr:await qr.screenshot({type:'png',timeout:5000})};
   }
   return {state:'pending'};
  },
  async close(){try{await context?.close();}finally{await rm(profile,{recursive:true,force:true});}}
 };
}
