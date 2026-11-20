import test from 'node:test';import assert from 'node:assert/strict';import {load} from 'cheerio';
import {isLoginDocument,LOGIN_QR_SELECTOR} from '../src/login-driver.js';
test('QR discovery is limited to the explicit official login document',()=>{
 assert.equal(isLoginDocument('https://login.taobao.com/member/login.jhtml?redirectURL=example'),true);
 for(const url of ['https://www.fliggy.com/','https://login.taobao.com/','https://evil.taobao.com/member/login.jhtml','https://login.taobao.com.attacker.invalid/member/login.jhtml','http://login.taobao.com/member/login.jhtml','about:blank'])assert.equal(isLoginDocument(url),false,url);
});
test('login QR selector excludes generic app-download and footer QR images',()=>{
 const $=load('<main><div class="qrcode-login"><div class="qrcode-img"><img id="login"></div></div><footer class="app-qrcode"><img alt="二维码" id="download"></footer></main>');
 assert.deepEqual($(LOGIN_QR_SELECTOR).toArray().map(e=>$(e).attr('id')),['login']);
});
test('official embedded login frames are not rejected just because their document path differs',()=>{
 assert.equal(isLoginDocument('https://login.taobao.com/newlogin/mini_login.htm'),true);
 assert.equal(isLoginDocument('https://login.taobao.com/marketing/download'),false);
});
test('login QR discovery supports canvas widgets as well as img widgets',()=>{
 const $=load('<div class="qrcode-login"><div class="qrcode-img"><canvas id="login-canvas"></canvas></div></div>');
 assert.equal($(LOGIN_QR_SELECTOR).filter('canvas').length,1);
});
import {findLoginQr,requestQrMode,type QrCandidate,type QrFrame} from '../src/login-driver.js';
import {syntheticQr,blankImage} from './qr-fixture.js';
const login='https://login.taobao.com/member/login.jhtml';
function candidate(visible:boolean,png:Buffer,onScreenshot=()=>{}):QrCandidate{return {isVisible:async()=>visible,screenshot:async()=>{onScreenshot();return png;},getAttribute:async()=>null,innerText:async()=>'',click:async()=>{}};}
test('QR discovery skips a hidden first match and a visible non-QR logo, then returns the visible QR',async()=>{
 const valid=syntheticQr();let hiddenScreenshots=0,visibleScreenshots=0;
 const frame:QrFrame={url:()=> 'https://login.taobao.com/newlogin/synthetic-widget.htm',locator:()=>({all:async()=>[candidate(false,valid,()=>hiddenScreenshots++),candidate(true,blankImage(),()=>visibleScreenshots++),candidate(true,valid,()=>visibleScreenshots++)]})};
 assert.deepEqual(await findLoginQr(login,frame),valid);assert.equal(hiddenScreenshots,0);assert.equal(visibleScreenshots,2);
});
test('background/container QR is supported without accepting an undecodable image',async()=>{
 const valid=syntheticQr();const frame:QrFrame={url:()=>login,locator:selector=>({all:async()=>selector===LOGIN_QR_SELECTOR?[candidate(true,blankImage())]:[candidate(true,valid)]})};
 assert.deepEqual(await findLoginQr(login,frame),valid);
});
test('QR discovery never inspects app-download pages or nonofficial frame origins',async()=>{
 let inspected=0;const frame=(url:string):QrFrame=>({url:()=>url,locator:()=>{inspected++;return {all:async()=>[]};}});
 assert.equal(await findLoginQr('https://www.fliggy.com/',frame(login)),undefined);assert.equal(await findLoginQr(login,frame('https://attacker.invalid/newlogin/widget')),undefined);assert.equal(await findLoginQr(login,frame('https://login.taobao.com:8443/newlogin/widget')),undefined);assert.equal(inspected,0);
});
test('QR mode switch clicks only a visible explicitly labeled login action',async()=>{
 let paymentClicks=0,loginClicks=0;const image=blankImage();
 const payment={...candidate(true,image),innerText:async()=> '扫码付款',click:async()=>{paymentClicks++;}};
 const button={...candidate(true,image),getAttribute:async(name:string)=>name==='title'?'扫码登录':null,click:async()=>{loginClicks++;}};
 const frame:QrFrame={url:()=>login,locator:()=>({all:async()=>[payment,button]})};
 assert.equal(await requestQrMode(login,frame),true);assert.equal(loginClicks,1);assert.equal(paymentClicks,0);
 assert.equal(await requestQrMode('https://www.fliggy.com/',frame),false);
});
