import {readFile} from 'node:fs/promises';
import {PNG} from 'pngjs';
import {createRequire} from 'node:module';
import type {QRCode} from 'jsqr';
const jsQR=createRequire(import.meta.url)('jsqr') as (data:Uint8ClampedArray,width:number,height:number)=>QRCode|null;
import qrTerminal from 'qrcode-terminal';
export async function terminalQr(path:string):Promise<string|undefined>{
 const png=PNG.sync.read(await readFile(path));
 const decoded=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);
 if(!decoded)return undefined;
 // The official QR payload is transient authentication data. Never log it as
 // text, include it in status JSON, or persist it separately.
 return new Promise(resolve=>qrTerminal.generate(decoded.data,{small:true},value=>resolve(value)));
}
