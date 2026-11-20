import {createRequire} from 'node:module';import {PNG} from 'pngjs';
const require=createRequire(import.meta.url);
export function syntheticQr():Buffer {
 const Code=require('qrcode-terminal/vendor/QRCode');const levels=require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
 const code=new Code(-1,levels.L);code.addData('open-piggy-synthetic-login-fixture');code.make();
 const modules=code.getModuleCount(),scale=4,pad=4,size=(modules+pad*2)*scale;const png=new PNG({width:size,height:size});png.data.fill(255);
 for(let y=0;y<modules;y++)for(let x=0;x<modules;x++)if(code.isDark(y,x))for(let py=0;py<scale;py++)for(let px=0;px<scale;px++){const at=(((y+pad)*scale+py)*size+(x+pad)*scale+px)*4;png.data[at]=0;png.data[at+1]=0;png.data[at+2]=0;}
 return PNG.sync.write(png);
}
export function blankImage():Buffer {const png=new PNG({width:128,height:128});png.data.fill(255);return PNG.sync.write(png);}
