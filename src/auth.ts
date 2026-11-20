import { mkdir, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PiggyError } from './errors.js';
import { clearSession, jarFromSession, loadSession, saveSession, sessionDirectory, trustedCookie } from './session.js';
import { createClient, loggedIn, parseJsonResponse } from './http.js';
export async function authStatus(): Promise<unknown> {
 const session=await loadSession();const valid=await loggedIn(createClient(await jarFromSession(session)));
 if(!valid)throw new PiggyError('LOGIN_REQUIRED','Official session expired; run auth login.');
 return {authenticated:true,savedAt:session.savedAt};
}
export async function authLogout(): Promise<unknown> { await clearSession();return {authenticated:false,scope:'Local open-piggy session removed; official account sessions elsewhere are unaffected.'}; }
export async function authLogin(): Promise<unknown> {
 const directory=sessionDirectory();await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
 let chromium;
 try { ({chromium}=await import('playwright')); } catch { throw new PiggyError('CAPABILITY_UNVERIFIED','Login requires the optional playwright package and Chromium. Install them as documented.'); }
 const profile=join(directory,`login-${process.pid}`);
 let context;
 try { context=await chromium.launchPersistentContext(profile,{headless:false}); }
 catch { await rm(profile,{recursive:true,force:true});throw new PiggyError('UPSTREAM_ERROR','Cannot launch login browser. Run npx playwright install chromium, then retry auth login.'); }
 try {
  const page=context.pages()[0] || await context.newPage();
  const login=new URL('https://login.taobao.com/member/login.jhtml'); login.searchParams.set('redirectURL','https://www.fliggy.com/');
  console.error('Complete the official QR login and redirect in the opened browser. Verification remains manual; timeout: 5 minutes.');
  await page.goto(login.href,{waitUntil:'domcontentloaded',timeout:30000});
  const deadline=Date.now()+300000;
  while(Date.now()<deadline) {
   if(page.isClosed())throw new PiggyError('LOGIN_REQUIRED','Login browser was closed before verification.');
   if(new URL(page.url()).protocol==='https:' && new URL(page.url()).hostname.match(/(^|\.)fliggy\.com$/)) {
    const response=await context.request.get('https://sijipiao.fliggy.com/ie/isLogin.htm',{timeout:15000});
    const status=parseJsonResponse(await response.text()) as {error?:number;data?:{login?:number}};
    if(status.error===0 && status.data?.login===1) {
     const cookies=(await context.cookies()).filter(c=>trustedCookie(c.domain));
     const session={version:1 as const,savedAt:new Date().toISOString(),cookies};
     if(!await loggedIn(createClient(await jarFromSession(session)))) throw new PiggyError('LOGIN_REQUIRED','Browser login succeeded, but pure HTTP session verification failed; session was not saved.');
     await saveSession(session);return {authenticated:true,transport:'http',savedAt:session.savedAt};
    }
   }
   await delay(2000);
  }
  throw new PiggyError('LOGIN_REQUIRED','Official QR login timed out; no session saved.');
 } finally { await context.close();await rm(profile,{recursive:true,force:true}); }
}
