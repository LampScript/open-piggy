import makeFetchCookie from 'fetch-cookie';
import { CookieJar } from 'tough-cookie';
import { z } from 'zod';
import { PiggyError } from './errors.js';
import { trustedHost } from './session.js';
export function parseJsonResponse(text: string): unknown {
  const trimmed=text.trim();
  if (/_____tmd_____|captcha|验证码拦截|x5secdata|punishFlowType/i.test(trimmed)) throw new PiggyError('VERIFICATION_REQUIRED','Official site requires verification; complete it through auth login.');
  if (trimmed.startsWith('<')) throw new PiggyError('UPSTREAM_ERROR','The official endpoint returned HTML instead of query data.');
  // JSON, parenthesized JSON, and JSONP only. Never eval server content.
  const json=trimmed.startsWith('(')?trimmed.replace(/^\(/,'').replace(/\);?$/,''):trimmed.replace(/^[A-Za-z_$][\w.$]*\s*\(/,'').replace(/\);?$/,'');
  try { return JSON.parse(json); } catch { throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official response is not valid JSON/JSONP.'); }
}
export interface WebClient { text(url: URL): Promise<string>; json(url: URL): Promise<unknown>; }
export function createClient(jar: CookieJar, fetcher: typeof fetch=fetch): WebClient {
  const fetchCookie=makeFetchCookie(fetcher,jar);
  async function text(initial: URL): Promise<string> {
    let url=initial;
    for(let i=0;i<6;i++) {
      if(url.protocol!=='https:' || !trustedHost(url.hostname)) throw new PiggyError('UPSTREAM_ERROR','Refusing a non-official HTTPS destination.');
      let response: Response;
      try { response=await fetchCookie(url,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0 open-piggy/0.1 (independent CLI)','Referer':'https://www.fliggy.com/','Accept':'application/json,text/plain,*/*'},signal:AbortSignal.timeout(30000)}); }
      catch { throw new PiggyError('NETWORK_ERROR','Official endpoint request failed or timed out.'); }
      if([301,302,303,307,308].includes(response.status)) {
        const location=response.headers.get('location');
        if(!location) throw new PiggyError('UPSTREAM_ERROR','Official redirect has no location.');
        url=new URL(location,url);
        if(url.hostname==='login.taobao.com') throw new PiggyError('LOGIN_REQUIRED','Official session expired; run auth login.');
        continue;
      }
      if(response.status===429) throw new PiggyError('RATE_LIMITED','Official site rate limit reached; retry later.');
      if([403,451].includes(response.status)) throw new PiggyError('VERIFICATION_REQUIRED','Official site refused the request; complete verification through auth login.');
      if(!response.ok) throw new PiggyError('UPSTREAM_ERROR',`Official endpoint returned HTTP ${response.status}.`);
      const charset=/charset=([^;]+)/i.exec(response.headers.get('content-type')||'')?.[1] || 'utf-8';
      const body=new TextDecoder(charset).decode(await response.arrayBuffer());
      if (/_____tmd_____|x5secdata|punishFlowType|renderTo\s*:\s*['\"]#nocaptcha/i.test(body)) throw new PiggyError('VERIFICATION_REQUIRED','Official page requires verification; complete it manually through auth login.');
      return body;
    }
    throw new PiggyError('UPSTREAM_ERROR','Official endpoint redirected too many times.');
  }
  return {text,json:async url=>parseJsonResponse(await text(url))};
}
const loginSchema=z.object({error:z.literal(0),data:z.object({login:z.union([z.literal(0),z.literal(1)])})});
export async function loggedIn(client: WebClient): Promise<boolean> {
  const result=loginSchema.safeParse(await client.json(new URL('https://sijipiao.fliggy.com/ie/isLogin.htm')));
  if(!result.success) throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official login-status response changed.');
  return result.data.data.login===1;
}
