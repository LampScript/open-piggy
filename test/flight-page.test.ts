import {test} from 'node:test';
import assert from 'node:assert/strict';
import {itineraryPage,parseFlightPage} from '../src/flight-page.js';

test('handoff is restricted to an official dated flight itinerary', () => {
  const url = 'https://sijipiao.fliggy.com/ie/flight_search_result.htm?depCity=SHA&arrCity=LAX&depDate=2027-02-04&tripType=1&arrDate=2027-02-12';
  assert.equal(itineraryPage(url+'&unused=1').href,url);
  for (const bad of [url.replace('fliggy.com','example.com'),url.split('&arrDate')[0],'about:blank']) {
    assert.throws(()=>itineraryPage(bad));
  }
});
test('challenge and outbound list do not yield confirmed round-trip offers', () => {
  assert.equal(parseFlightPage('请完成验证'),null);
  const list = parseFlightPage('选择去程：\n加拿大航空\n航班详情\n往返含税\n￥\n5996\n选为去程');
  assert.equal(list?.options[0]?.displayPriceCNY,5996);
  assert.deepEqual(list?.offers,[]);
});
test('expanded return selection ties the two directions to cabin and seller price', () => {
  const page=parseFlightPage('选择返程：\n去程\n已选定\nAC026\n重选去程航班\n返程\n已选定\nAC025\n重选返程航班\n去程\n经济舱\n返程\n经济舱\n￥\n5996\n往返总价');
  assert.deepEqual(page?.inbound,['AC025']);
  assert.deepEqual(page?.offers,[{outboundCabin:'经济舱',returnCabin:'经济舱',roundTripPrice:5996,currency:'CNY'}]);
});
