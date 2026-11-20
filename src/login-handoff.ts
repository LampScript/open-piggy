import {createServer,type Server} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {readTask,taskDirectory} from './login-task.js';
export async function startHandoff(id:string,home:string):Promise<{url:string;close():Promise<void>}> {
 const token=randomBytes(24).toString('hex');let port=0;
 const server:Server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  const allowed=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
  if(!allowed.has(req.headers.host||'')){res.writeHead(403).end();return;}
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  const path=new URL(req.url||'/',`http://127.0.0.1:${port}`).pathname;
  if(!path.startsWith(`/${token}/`)){res.writeHead(404).end();return;}
  try{
   const task=await readTask(id,home);
   if(path===`/${token}/status`){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state:task.state,expiresAt:task.expiresAt,qrReady:Boolean(task.qrPath),error:task.error}));return;}
   if(path===`/${token}/qr.png`&&task.state==='pending'&&task.qrPath){res.setHeader('Content-Type','image/png');res.end(await readFile(join(taskDirectory(id,home),'qr.png')));return;}
   if(path===`/${token}/`){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><title>open-piggy 扫码登录</title><body><h1>open-piggy 扫码登录</h1><p>请使用官方 App 扫描下方官方登录二维码，并在 App 中确认。</p><p id="state">准备二维码…</p><img id="qr" alt="官方登录二维码" hidden><script>async function poll(){try{const s=await(await fetch('./status')).json();document.querySelector('#state').textContent=s.state==='pending'?'等待扫码确认':s.state;if(s.qrReady){const q=document.querySelector('#qr');q.hidden=false;q.src='./qr.png?t='+Date.now();}if(s.state==='pending')setTimeout(poll,2000);else document.querySelector('#qr').hidden=true;}catch{document.querySelector('#state').textContent='任务已结束，请使用 CLI 查询最终状态';}}poll();</script></body></html>`);return;}
   res.writeHead(404).end();
  }catch{res.writeHead(404).end();}
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
 const address=server.address();if(!address||typeof address==='string')throw new Error('Loopback server address missing.');port=address.port;
 return {url:`http://127.0.0.1:${port}/${token}/`,close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
