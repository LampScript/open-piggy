import assert from 'node:assert/strict';
import test from 'node:test';
import {searchMarriottPackage} from '../src/marriott-package.js';
import type {WebClient} from '../src/http.js';
import {PiggyError} from '../src/errors.js';
const options={keyword:'310100',checkInDate:'2026-12-01',checkOutDate:'2026-12-02',hotelBrands:'万豪'};
const hotel=(id:number)=>({shid:id,name:`万豪酒店${id}`,address:'公开地址',priceDesp:'652',priceDespStyle:1,level:{desc:'豪华型',star:'5'},rateScore:'4.8',status:0,quota:10});
function hotelResult(brands:string|null,hotels=[hotel(53998029)]){return {code:200,total:hotels.length,isOverseas:0,isGangAoTai:0,
 query:{city:'310100',cityName:'上海',checkIn:'2026-12-01',checkOut:'2026-12-02',keywords:null,currentPage:1,totalPage:1,order:'DEFAULT',dir:'DESC',brands,aNum_1:2,cNum_1:0,roomNum:'1'},
 allHotelBrands:[{text:'万豪',value:'22'}],hotelList:hotels};}
const hasCode=(code:string)=>(e:unknown)=>e instanceof PiggyError&&e.code===code;
function client(offers:unknown,hotels=[hotel(53998029)]):WebClient{return {text:async()=>{throw Error('Unexpected HTML request');},json:async url=>{
 if(url.hostname==='hotel.fliggy.com')return hotelResult(url.searchParams.get('brands'),hotels);
 assert.equal(url.hostname,'tuan.fliggy.com');assert.equal(url.pathname,'/ajax/hotel_tuan_info.json');
 assert.equal(url.searchParams.get('shids'),hotels.map(h=>h.shid).join(','));assert.equal(url.searchParams.get('checkin'),'2026-12-01');assert.equal(url.searchParams.get('checkout'),'2026-12-02');assert.equal(url.searchParams.get('onlyTripSeller'),'true');
 return offers;
}};}

test('uses brand-filtered hotel ids and preserves original per-night display',async()=>{
 const result=await searchMarriottPackage(options,client({code:200,result:[{isTuan:1,shid:53998029,itemId:714644884499,rp:'780/晚'}]})) as {itemList:{title:string;price:string;displayPrice:string;priceScope:string;jumpUrl:string}[];coverage:unknown};
 const item=result.itemList[0]!;assert.equal(item.title,'万豪酒店53998029');assert.equal(item.price,'780');assert.equal(item.displayPrice,'780/晚');assert.equal(item.priceScope,'per-night-starting-price');assert.ok(item.jumpUrl.includes('itemid=714644884499'));assert.ok(item.jumpUrl.includes('tripSeller=true'));
 assert.deepEqual(result.coverage,{hotelPage:1,hotelPages:1,hotelMatches:1,hotelsQueried:1,exhaustive:false});
});

test('numeric prices sort as numbers and unknown official displays remain last',async()=>{
 const result=await searchMarriottPackage({...options,sortType:'price_desc',limit:'3'},client({code:200,result:[{isTuan:1,shid:1,itemId:11,rp:'待询价'},{isTuan:1,shid:2,itemId:12,rp:'90/晚'},{isTuan:1,shid:3,itemId:13,rp:'1000/晚'}]},[hotel(1),hotel(2),hotel(3)])) as {itemList:{price:string|null;displayPrice:string}[]};
 assert.deepEqual(result.itemList.map(i=>i.price),['1000','90',null]);assert.equal(result.itemList[2]?.displayPrice,'待询价');
});

test('empty hotel candidates avoid package requests and empty associations stay empty',async()=>{
 let packageCalls=0;const c=client({code:200,result:[]},[]),wrapped={...c,json:async(url:URL)=>{if(url.hostname==='tuan.fliggy.com')packageCalls++;return c.json(url);}};
 const result=await searchMarriottPackage(options,wrapped) as {itemList:unknown[]};assert.deepEqual(result.itemList,[]);assert.equal(packageCalls,0);
 const empty=await searchMarriottPackage(options,client({code:200,result:[]})) as {itemList:unknown[]};assert.deepEqual(empty.itemList,[]);
});

test('rejects unrelated hotels, missing offer fields, malformed envelopes and business failures',async()=>{
 await assert.rejects(searchMarriottPackage(options,client({code:200,result:[{isTuan:1,shid:9,itemId:11,rp:'780/晚'}]})),hasCode('UPSTREAM_SCHEMA_CHANGED'));
 await assert.rejects(searchMarriottPackage(options,client({code:200,result:[{isTuan:1,shid:53998029}]})),hasCode('UPSTREAM_SCHEMA_CHANGED'));
 await assert.rejects(searchMarriottPackage(options,client({code:200})),hasCode('UPSTREAM_SCHEMA_CHANGED'));
 await assert.rejects(searchMarriottPackage(options,client({code:500})),hasCode('UPSTREAM_ERROR'));
});

test('required dates and conflicting keyword/name semantics are explicit',async()=>{
 const c=client({code:200,result:[]});
 await assert.rejects(searchMarriottPackage({keyword:'上海'},c),hasCode('INVALID_ARGUMENT'));
 await assert.rejects(searchMarriottPackage({...options,keyword:'下午茶',provinceOrCity:'上海',hotelName:'另一家'},c),hasCode('INVALID_ARGUMENT'));
 await assert.rejects(searchMarriottPackage({...options,unknown:'ignored'},c),hasCode('CAPABILITY_UNVERIFIED'));
});

test('explicit location turns keyword into hotel keyword rather than dropping it',async()=>{
 const base=client({code:200,result:[]});let seenKeywords=0;
 const c={...base,json:async(url:URL)=>{
  if(url.hostname==='hotel.alitrip.com')return {code:'200',result:[{cityCode:310100,displayName:'上海市',level:3}]};
  if(url.hostname==='hotel.fliggy.com'){assert.equal(url.searchParams.get('keywords'),'康桥');seenKeywords++;const r=hotelResult(url.searchParams.get('brands'));r.query.keywords='康桥';return r;}
  return base.json(url);
 }};
 await searchMarriottPackage({...options,keyword:'康桥',provinceOrCity:'上海'},c);assert.equal(seenKeywords,2);
});

test('zero per-night display is not advertised as a free package',async()=>{
 const r=await searchMarriottPackage(options,client({code:200,result:[{isTuan:1,shid:53998029,itemId:714644884499,rp:'0/晚'}]})) as {itemList:{price:null;displayPrice:string}[]};
 assert.equal(r.itemList[0]?.price,null);assert.equal(r.itemList[0]?.displayPrice,'0/晚');
});
