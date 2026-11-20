import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {createRequire} from 'node:module';
import type {QRCode} from 'jsqr';
const jsQR=createRequire(import.meta.url)('jsqr') as (data:Uint8ClampedArray,width:number,height:number)=>QRCode|null;
import qrTerminal from 'qrcode-terminal';
function decode(pngBytes:Buffer):QRCode|null {
 const png=PNG.sync.read(pngBytes);
 return jsQR(new Uint8ClampedArray(png.data),png.width,png.height);
}
export function hasDecodableQr(png:Buffer):boolean {return decode(png)!==null;}
export async function terminalQrFrame(path:string):Promise<{rendered:string;fingerprint:string}|undefined>{
 const decoded=decode(await readFile(path));
 if(!decoded)return undefined;
 // The official QR payload is transient authentication data. Never log it as
 // text, include it in status JSON, or persist it separately.
 const fingerprint=createHash('sha256').update(decoded.data).digest('hex');
 return new Promise(resolve=>qrTerminal.generate(decoded.data,{small:true},value=>resolve({rendered:value,fingerprint})));
}
export async function terminalQr(path:string):Promise<string|undefined>{
 return (await terminalQrFrame(path))?.rendered;
}
