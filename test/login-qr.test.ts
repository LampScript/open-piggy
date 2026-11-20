import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {terminalQr,hasDecodableQr} from '../src/login-qr.js';import {syntheticQr,blankImage} from './qr-fixture.js';
test('terminal QR rendering decodes a synthetic PNG without returning its raw payload',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'piggy-qr-'));try{const path=join(dir,'qr.png');await writeFile(path,syntheticQr());const rendered=await terminalQr(path);assert.ok(rendered);assert.ok(!rendered.includes('open-piggy-synthetic-login-fixture'));}finally{await rm(dir,{recursive:true,force:true});}
});
test('candidate validation distinguishes an actual QR from a decorative image',()=>{assert.equal(hasDecodableQr(blankImage()),false);assert.equal(hasDecodableQr(syntheticQr()),true);});
