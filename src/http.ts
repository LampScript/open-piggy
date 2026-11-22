import makeFetchCookie from 'fetch-cookie';
import { CookieJar } from 'tough-cookie';
import { z } from 'zod';
import { PiggyError } from './errors.js';
import { trustedHost } from './session.js';
function verificationPage(body: string): boolean {
  return body.trimStart().startsWith('<') &&
    /renderTo\s*:\s*['"]#nocaptcha|\bid\s*=\s*['"](?:no)?captcha['"]|\/_____tmd_____\/(?:punish|verify)\b|\bx5secdata\s*[:=]|\bpunishFlowType\s*[:=]/i.test(body);
}
export function parseJsonResponse(text: string): unknown {
  const trimmed=text.trim();
  if (verificationPage(trimmed)) throw new PiggyError('VERIFICATION_REQUIRED','Official page requires human verification.');
  if (trimmed.startsWith('<')) throw new PiggyError('UPSTREAM_ERROR','The official endpoint returned HTML instead of query data.');
  // JSON, parenthesized JSON, and JSONP only. Never eval server content.
  const json=trimmed.startsWith('(')?trimmed.replace(/^\(/,'').replace(/\);?$/,''):trimmed.replace(/^[A-Za-z_$][\w.$]*\s*\(/,'').replace(/\);?$/,'');
  let parsed;
  try { parsed = JSON.parse(json); } catch { throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official response is not valid JSON/JSONP.'); }
  if (Array.isArray(parsed?.ret) && parsed.ret.some((code:unknown) =>
    typeof code === 'string' && /^FAIL_SYS_USER_VALIDATE(?:$|::)/.test(code))) {
    throw new PiggyError('VERIFICATION_REQUIRED','Official endpoint requested user verification.');
  }
  return parsed;
}
export interface WebClient { text(url: URL, stage?:string): Promise<string>; json(url: URL, stage?:string): Promise<unknown>; }
export function createClient(jar: CookieJar, fetcher: typeof fetch=fetch): WebClient {
  const fetchCookie=makeFetchCookie(fetcher,jar);
  async function request(initial: URL, stage?:string) {
    let url=initial;
    for(let i=0;i<6;i++) {
      if(url.protocol!=='https:' || !trustedHost(url.hostname)) throw new PiggyError('UPSTREAM_ERROR','Refusing a non-official HTTPS destination.');
      let response: Response;
      try { response=await fetchCookie(url,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0 open-piggy/0.1 (independent CLI)','Referer':'https://www.fliggy.com/','Accept':'application/json,text/plain,*/*'},signal:AbortSignal.timeout(30000)}); }
      catch { throw new PiggyError('NETWORK_ERROR','Official endpoint request failed or timed out.',{stage}); }
      const context = {httpStatus:response.status, stage};
      if([301,302,303,307,308].includes(response.status)) {
        const location=response.headers.get('location');
        if(!location) throw new PiggyError('UPSTREAM_ERROR','Official redirect has no location.',context);
        url=new URL(location,url);
        if(url.protocol==='https:' && trustedHost(url.hostname) && /\/_____tmd_____\/(?:punish|verify)\b/i.test(url.pathname))
          throw new PiggyError('VERIFICATION_REQUIRED','Official site redirected to human verification.',context);
        if(url.hostname==='login.taobao.com') throw new PiggyError('LOGIN_REQUIRED','Official session expired; run auth login.',context);
        continue;
      }
      if(response.status===401) throw new PiggyError('LOGIN_REQUIRED','Official endpoint requires login.',context);
      if(response.status===429) throw new PiggyError('RATE_LIMITED','Official site rate limit reached; retry later.',context);
      if(response.status===451) throw new PiggyError('ACCESS_DENIED','Official site reports access restricted for legal reasons.',context);
      if(!response.ok && response.status!==403) throw new PiggyError('UPSTREAM_ERROR',`Official endpoint returned HTTP ${response.status}.`,context);
      const charset=/charset=([^;]+)/i.exec(response.headers.get('content-type')||'')?.[1] || 'utf-8';
      const body=new TextDecoder(charset).decode(await response.arrayBuffer());
      if (verificationPage(body)) throw new PiggyError('VERIFICATION_REQUIRED','Official page requires human verification.',context);
      if(response.status===403) {
        // A structured challenge can accompany a 403; all other bodies remain denials.
        if (!body.trimStart().startsWith('<')) {
          try { parseJsonResponse(body); }
          catch (error) {
            if (!(error instanceof PiggyError)) throw error;
            if (error.code==='VERIFICATION_REQUIRED') throw new PiggyError(error.code,error.message,context);
          }
        }
        throw new PiggyError('ACCESS_DENIED','Official site denied access (HTTP 403).',context);
      }
      return {body,context};
    }
    throw new PiggyError('UPSTREAM_ERROR','Official endpoint redirected too many times.');
  }
  return {
    text:async (url,stage)=>(await request(url,stage)).body,
    json:async (url,stage)=>{
      const {body,context}=await request(url,stage);
      try { return parseJsonResponse(body); }
      catch(e) { if(e instanceof PiggyError) throw new PiggyError(e.code,e.message,context); throw e; }
    }
  };
}
const loginSchema=z.object({error:z.literal(0),data:z.object({login:z.union([z.literal(0),z.literal(1)])})});
export async function loggedIn(client: WebClient): Promise<boolean> {
  const result=loginSchema.safeParse(await client.json(new URL('https://sijipiao.fliggy.com/ie/isLogin.htm'),'login-status'));
  if(!result.success) throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official login-status response changed.');
  return result.data.data.login===1;
}
