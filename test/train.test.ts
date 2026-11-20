import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { CookieJar } from 'tough-cookie';
import { PiggyError } from '../src/errors.js';
import type { WebClient } from '../src/http.js';
import { searchTrain } from '../src/train.js';

const api = 'mtop.trip.train.station2stationsearch2';
const options = { origin: '上海', destination: '北京', depDate: '2027-02-04' };
const envelope = (ret: string[]) => ({ api, v: '1.0', ret, data: {} });
// Minimal public response fields observed for the 2027-02-04 Shanghai–Beijing route.
const train = {
  trainNo: 'G532', departStation: '上海虹桥', arriveStation: '北京南',
  depTimeFull: '2027-02-04 06:31:00', arrTimeFull: '2027-02-04 12:18:00',
  costTimeInt: 347, price: 57600, bookable: 0, preSellDateStr: '2027-01-21 13:45:00',
  seatTypes: [{price: 57600, seatName: '二等座', seatType: 14, stock: 0},
    {price: 96700, seatName: '一等座', seatType: 13, stock: 0}],
};
const success = (trains = [train]) => ({ ...envelope(['SUCCESS::调用成功']), data: {depDate: '2027-02-04', trains} });
const hasCode = (code: string) => (error: unknown) => error instanceof PiggyError && error.code === code;
function clientFor(json: WebClient['json']): WebClient {
  return { json, text: async () => { throw new Error('Unexpected raw-text request'); } };
}

test('missing train arguments fail before any network request', async () => {
  let called = false;
  const client = clientFor(async () => { called = true; return {}; });
  await assert.rejects(searchTrain({ origin: '上海' }, client, new CookieJar()), hasCode('INVALID_ARGUMENT'));
  assert.equal(called, false);
});

test('train bootstrap signs only the second request using its own jar token', async () => {
  const jar = new CookieJar();
  let calls = 0;
  const client = clientFor(async url => {
    calls++;
    assert.equal(url.origin, 'https://h5api.m.taobao.com');
    assert.equal(url.pathname, '/h5/mtop.trip.train.station2stationsearch2/1.0/');
    const params = url.searchParams;
    assert.deepEqual(JSON.parse(params.get('data')!), {
      depLocation: '上海', arrLocation: '北京', depDate: '2027-02-04', sceneType: 0, passengerType: 0,
    });
    if (calls === 1) {
      assert.equal(params.has('sign'), false);
      await jar.setCookie('_m_h5_tk=synthetic-token_9999999999999; Domain=.taobao.com; Path=/; Secure', url.href);
      return envelope(['FAIL_SYS_TOKEN_EMPTY::令牌为空']);
    }
    const expected = createHash('md5').update(`synthetic-token&${params.get('t')}&12574478&${params.get('data')}`).digest('hex');
    assert.equal(params.get('sign'), expected);
    return success();
  });
  const result = await searchTrain(options, client, jar) as {itemList: {ticketPrice:number;bookable:boolean;preSaleDateTime:string}[]};
  assert.equal(result.itemList[0]?.ticketPrice, 576);
  assert.equal(result.itemList[0]?.bookable, false);
  assert.equal(result.itemList[0]?.preSaleDateTime, '2027-01-21 13:45:00');
  assert.equal(calls, 2);
});

test('token empty without a bootstrap cookie does not loop', async () => {
  let calls = 0;
  const client = clientFor(async () => { calls++; return envelope(['FAIL_SYS_TOKEN_EMPTY::令牌为空']); });
  await assert.rejects(searchTrain(options, client, new CookieJar()), hasCode('LOGIN_REQUIRED'));
  assert.equal(calls, 1);
});

test('session expiry, verification and rate limits remain distinct and redact response details', async () => {
  for (const [ret, code] of [
    ['FAIL_SYS_TOKEN_EXPIRED', 'LOGIN_REQUIRED'],
    ['FAIL_SYS_SESSION_EXPIRED', 'LOGIN_REQUIRED'],
    ['FAIL_SYS_USER_VALIDATE', 'VERIFICATION_REQUIRED'],
    ['FAIL_SYS_FLOW_LIMIT', 'RATE_LIMITED'],
    ['FAIL_BIZ_ERROR', 'UPSTREAM_ERROR'],
  ]) {
    let calls = 0;
    const client = clientFor(async () => { calls++; return envelope([`${ret}::SENSITIVE_UPSTREAM_DIAGNOSTIC`]); });
    await assert.rejects(searchTrain(options, client, new CookieJar()), error => {
      assert.ok(error instanceof PiggyError);
      assert.equal(error.code, code);
      assert.equal(error.message.includes('SENSITIVE_UPSTREAM_DIAGNOSTIC'), false);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('successful unknown train payload does not become a fabricated result', async () => {
  const client = clientFor(async () => ({ ...envelope(['SUCCESS::调用成功']), data: { trains: [{ unknown: true }] } }));
  await assert.rejects(searchTrain(options, client, new CookieJar()), hasCode('UPSTREAM_SCHEMA_CHANGED'));
});

test('malformed envelope is reported as schema changed', async () => {
  for (const response of [null, {}, { api, v: '1.0', ret: [], data: {} }, { api, v: '1.0', ret: ['SUCCESS'], data: [] }]) {
    await assert.rejects(searchTrain(options, clientFor(async () => response), new CookieJar()), hasCode('UPSTREAM_SCHEMA_CHANGED'));
  }
});


test('unknown train filters fail explicitly instead of being silently ignored', async () => {
  const client = clientFor(async () => { throw new Error('Must not send query'); });
  await assert.rejects(searchTrain({...options,backDate:'2027-02-10'},client,new CookieJar()),hasCode('CAPABILITY_UNVERIFIED'));
});

test('seat selection uses corresponding cents price; strict duration excludes equality', async () => {
  const second = {...train,trainNo:'G100',price:40000,costTimeInt:360};
  const client=clientFor(async()=>success([train,second]));
  const result=await searchTrain({...options,seatClassName:'first class',totalDurationHour:'6',maxPrice:'1000'},client,new CookieJar()) as {itemList:{trainNo:string;ticketPrice:number;seats:unknown[]}[]};
  assert.deepEqual(result.itemList.map(x=>[x.trainNo,x.ticketPrice,x.seats.length]),[['G532',967,1]]);
});

test('train number and price filters compose with sorting and limit', async () => {
  const client=clientFor(async()=>success([train,{...train,trainNo:'G100',price:40000}]));
  const result=await searchTrain({...options,transportNo:'G100,G532',sortType:'3',limit:'1',maxPrice:'500'},client,new CookieJar()) as {itemList:{trainNo:string;ticketPrice:number}[]};
  assert.deepEqual(result.itemList.map(x=>[x.trainNo,x.ticketPrice]),[['G100',400]]);
});

test('empty official result remains empty; incorrect result date fails', async()=>{
  const empty=await searchTrain(options,clientFor(async()=>success([])),new CookieJar()) as {itemList:unknown[]};
  assert.deepEqual(empty.itemList,[]);
  await assert.rejects(searchTrain(options,clientFor(async()=>({...success(),data:{depDate:'2027-02-05',trains:[train]}})),new CookieJar()),hasCode('UPSTREAM_SCHEMA_CHANGED'));
});
