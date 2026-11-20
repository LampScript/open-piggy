import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,stat,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';import { join } from 'node:path';
import { saveSession,loadSession,clearSession,jarFromSession } from '../src/session.js';
const session={version:1 as const,savedAt:'2026-11-20T00:00:00.000Z',cookies:[{name:'synthetic',value:'fixture-only',domain:'.fliggy.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'None' as const}]};
test('local session is private, reusable over HTTP, and logout removes only owned file',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'piggy-test-'));
 try {await writeFile(join(dir,'unrelated'),'keep');await saveSession(session,dir);if(process.platform!=='win32'){assert.equal((await stat(join(dir,'session.json'))).mode&0o777,0o600);assert.equal((await stat(dir)).mode&0o777,0o700);}assert.deepEqual(await loadSession(dir),session);const jar=await jarFromSession(session);assert.equal(await jar.getCookieString('https://www.fliggy.com/'),'synthetic=fixture-only');assert.equal(await jar.getCookieString('https://other.example/'),'');await clearSession(dir);await assert.rejects(loadSession(dir));assert.ok(await stat(join(dir,'unrelated')));}finally{await rm(dir,{recursive:true,force:true});}
});
test('host-only cookies are not widened to child subdomains',async()=>{
 const jar=await jarFromSession({...session,cookies:[{...session.cookies[0]!,domain:'login.taobao.com'}]});
 assert.match(await jar.getCookieString('https://login.taobao.com/'),/synthetic=/);
 assert.equal(await jar.getCookieString('https://child.login.taobao.com/'),'');
});
test('malformed local session errors do not disclose file contents',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'piggy-invalid-'));
 try {await writeFile(join(dir,'session.json'),'synthetic-private-secret broken json');await assert.rejects(loadSession(dir),(e:unknown)=>e instanceof Error && !e.message.includes('synthetic-private-secret'));}finally{await rm(dir,{recursive:true,force:true});}
});
