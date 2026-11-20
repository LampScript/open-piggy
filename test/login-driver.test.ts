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
