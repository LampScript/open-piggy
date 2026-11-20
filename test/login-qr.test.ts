import test from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {PNG} from 'pngjs';import {terminalQr} from '../src/login-qr.js';
const require=createRequire(import.meta.url);
test('terminal QR rendering decodes a synthetic PNG without returning its raw payload',async()=>{
 // Fixture generation uses the already installed QR encoder; no real login URL.
 const Code=require('qrcode-terminal/vendor/QRCode');const levels=require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
 const code=new Code(-1,levels.L);code.addData('open-piggy-synthetic-login-fixture');code.make();const modules=code.getModuleCount(),scale=4,pad=4;const size=(modules+pad*2)*scale;const png=new PNG({width:size,height:size});png.data.fill(255);
 for(let y=0;y<modules;y++)for(let x=0;x<modules;x++)if(code.isDark(y,x))for(let py=0;py<scale;py++)for(let px=0;px<scale;px++){const at=(((y+pad)*scale+py)*size+(x+pad)*scale+px)*4;png.data[at]=0;png.data[at+1]=0;png.data[at+2]=0;}
 const dir=await mkdtemp(join(tmpdir(),'piggy-qr-'));try{const path=join(dir,'qr.png');await writeFile(path,PNG.sync.write(png));const rendered=await terminalQr(path);assert.ok(rendered);assert.ok(!rendered.includes('open-piggy-synthetic-login-fixture'));}finally{await rm(dir,{recursive:true,force:true});}
});
