import { mkdir, readFile, rename, rm, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { z } from 'zod';
import { PiggyError } from './errors.js';
const cookieSchema = z.object({name:z.string(),value:z.string(),domain:z.string(),path:z.string(),expires:z.number(),httpOnly:z.boolean(),secure:z.boolean(),sameSite:z.enum(['Strict','Lax','None'])});
const stateSchema = z.object({version:z.literal(1),savedAt:z.string().datetime(),cookies:z.array(cookieSchema)});
export type Session = z.infer<typeof stateSchema>;
export function sessionDirectory(): string { return process.env.OPEN_PIGGY_HOME || join(homedir(), '.config', 'open-piggy'); }
export function trustedHost(host: string): boolean { return ['fliggy.com','taobao.com','alitrip.com','feizhu.com','fliggy.hk'].some(d=>host===d || host.endsWith('.'+d)); }
export function trustedCookie(domain: string): boolean { return trustedHost(domain.replace(/^\./,'')); }
export async function loadSession(directory = sessionDirectory()): Promise<Session> {
  let text: string;
  try { text=await readFile(join(directory,'session.json'),'utf8'); }
  catch(e) { if ((e as NodeJS.ErrnoException).code==='ENOENT') throw new PiggyError('LOGIN_REQUIRED','Run open-piggy auth login first.'); throw e; }
  let raw: unknown;
  try { raw=JSON.parse(text); } catch { throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Invalid local session JSON; run auth login again.'); }
  const result = stateSchema.safeParse(raw);
  if (!result.success || !result.data.cookies.every(c=>trustedCookie(c.domain))) throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Invalid local session; run auth login again.');
  return result.data;
}
export async function saveSession(session: Session, directory = sessionDirectory()): Promise<void> {
  await mkdir(directory,{recursive:true,mode:0o700}); await chmod(directory,0o700);
  const temporary=join(directory,`session.${process.pid}.tmp`);
  await writeFile(temporary,JSON.stringify(session),{mode:0o600,flag:'wx'});
  await rename(temporary,join(directory,'session.json')); await chmod(join(directory,'session.json'),0o600);
}
export async function clearSession(directory = sessionDirectory()): Promise<void> { await rm(join(directory,'session.json'),{force:true}); }
export async function jarFromSession(session: Session): Promise<CookieJar> {
  const jar=new CookieJar();
  for (const c of session.cookies) {
    const cookie=[`${c.name}=${c.value}`,c.domain.startsWith('.')?`Domain=${c.domain}`:'',`Path=${c.path}`,c.secure?'Secure':'',c.httpOnly?'HttpOnly':'',`SameSite=${c.sameSite}`,c.expires>0?`Expires=${new Date(c.expires*1000).toUTCString()}`:''].filter(Boolean).join('; ');
    await jar.setCookie(cookie,`https://${c.domain.replace(/^\./,'')}${c.path}`);
  }
  return jar;
}
