import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CookieJar } from 'tough-cookie';
import { createClient, loggedIn, parseJsonResponse } from '../src/http.js';
import { PiggyError } from '../src/errors.js';
test('JSON/JSONP parsing never evaluates response code',()=>{
 for(const s of ['{"ok":true}','({"ok":true})','openPiggy({"ok":true});'])assert.deepEqual(parseJsonResponse(s),{ok:true});
 assert.throws(()=>parseJsonResponse('openPiggy({}); process.exit(0)'),PiggyError);
});
test('captcha is not treated as empty inventory',()=>assert.throws(()=>parseJsonResponse('<html>x5secdata</html>'),(e:unknown)=>e instanceof PiggyError&&e.code==='VERIFICATION_REQUIRED'));
test('cookie jar persists Set-Cookie across HTTP calls',async()=>{
 const jar=new CookieJar();let called=0;
 const fake=(async (_url:unknown,init:RequestInit)=>{called++;if(called===2)assert.match(new Headers(init.headers).get('cookie')||'',/test=local/);const response=new Response('{"error":0,"data":{"login":1}}',{headers:{'set-cookie':'test=local; Domain=sijipiao.fliggy.com; Path=/; Secure'}});Object.defineProperty(response,'url',{value:String(_url)});return response;}) as typeof fetch;
 const client=createClient(jar,fake);assert.equal(await loggedIn(client),true);assert.equal(await loggedIn(client),true);
});
test('redirects cannot transmit a session to an unofficial host',async()=>{
 let calls=0;const fake=(async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://evil.example/'}});}) as typeof fetch;
 await assert.rejects(createClient(new CookieJar(),fake).text(new URL('https://www.fliggy.com/')),(e:unknown)=>e instanceof PiggyError&&e.code==='UPSTREAM_ERROR');assert.equal(calls,1);
});
test('HTTP 200 business login denial remains unauthenticated',async()=>{
 const client=createClient(new CookieJar(),(async()=>new Response('({"error":0,"data":{"login":0}})')) as typeof fetch);assert.equal(await loggedIn(client),false);
});
test('rate limit has explicit non-inventory outcome',async()=>{
 const client=createClient(new CookieJar(),(async()=>new Response('',{status:429})) as typeof fetch);await assert.rejects(client.json(new URL('https://www.fliggy.com/')),(e:unknown)=>e instanceof PiggyError&&e.code==='RATE_LIMITED');
});
test('HTML nocaptcha block is recognized before any parser sees it',async()=>{
 const client=createClient(new CookieJar(),(async()=>new Response('<html><script>window._config_={renderTo:"#nocaptcha"}</script></html>')) as typeof fetch);
 await assert.rejects(client.text(new URL('https://hotel.fliggy.com/hotel_list3.htm')),(e:unknown)=>e instanceof PiggyError&&e.code==='VERIFICATION_REQUIRED');
});
