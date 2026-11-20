import assert from 'node:assert/strict';
import test from 'node:test';
import {searchHotel,searchMarriottHotel} from '../src/hotel.js';
import type {WebClient} from '../src/http.js';
import {PiggyError} from '../src/errors.js';
const input={destName:'上海',checkInDate:'2026-12-01',checkOutDate:'2026-12-02'};
const hotel={shid:63446025,name:'上海中优城市万豪酒店',address:'公开酒店地址',priceDesp:'652',priceDespStyle:1,level:{desc:'豪华型',star:'5'},rateScore:'4.8',status:0,quota:10};
const response=(patch:Record<string,unknown>={})=>({code:200,total:7,isOverseas:0,isGangAoTai:0,
 query:{city:'310100',cityName:'上海',checkIn:'2026-12-01',checkOut:'2026-12-02',keywords:null,currentPage:1,totalPage:1,order:'DEFAULT',dir:'DESC',brands:null,aNum_1:2,cNum_1:0,roomNum:'1',userSessionId:'SECRET_NOT_OUTPUT',userClientIp:'PRIVATE_NOT_OUTPUT'},
 allHotelBrands:[{text:'万豪',value:'22'},{text:'JW万豪',value:'1585'},{text:'希尔顿',value:'100'}],hotelList:[hotel],...patch});
const city={code:'200',result:[{cityCode:310100,displayName:'上海市',level:3}]};
const client=(json:WebClient['json']):WebClient=>({json,text:async()=>{throw Error('Unexpected text query');}});
const hasCode=(code:string)=>(e:unknown)=>e instanceof PiggyError&&e.code===code;

test('resolves official city then returns whitelisted domestic dated hotel data',async()=>{
 let calls=0;
 const result=await searchHotel(input,client(async u=>{
  calls++;
  if(calls===1){assert.equal(u.pathname,'/ajax/CitySuggest.do');assert.equal(u.searchParams.get('q'),'上海');return city;}
  assert.equal(u.pathname,'/ajax/hotelList.htm');assert.equal(u.searchParams.get('city'),'310100');assert.equal(u.searchParams.get('checkIn'),'2026-12-01');assert.equal(u.searchParams.get('checkOut'),'2026-12-02');return response();
 })) as {itemList:{price:string;taxIncluded:null;detailUrl:string}[];query:{occupancy:unknown};coverage:unknown};
 assert.equal(calls,2);assert.equal(result.itemList[0]?.price,'652');assert.equal(result.itemList[0]?.taxIncluded,null);
 assert.ok(result.itemList[0]?.detailUrl.includes('checkIn=2026-12-01'));
 assert.deepEqual(result.query.occupancy,{rooms:1,adults:2,children:0});
 assert.equal(JSON.stringify(result).includes('SECRET_NOT_OUTPUT'),false);assert.equal(JSON.stringify(result).includes('PRIVATE_NOT_OUTPUT'),false);
});

test('numeric city code avoids suggestions; price sort is sent upstream and max-price is post-filtered',async()=>{
 const fixture=response();fixture.query.order='PRICE';fixture.query.dir='ASC';
 fixture.hotelList=[hotel,{...hotel,shid:2,priceDesp:'900'},{...hotel,shid:3,priceDesp:'满房',priceDespStyle:0}];
 let calls=0;
 const result=await searchHotel({...input,destName:'310100',sort:'price_asc',maxPrice:'700'},client(async u=>{
  calls++;assert.equal(u.searchParams.get('order'),'PRICE');assert.equal(u.searchParams.get('dir'),'ASC');return fixture;
 })) as {itemList:{price:string}[]};
 assert.equal(calls,1);assert.deepEqual(result.itemList.map(i=>i.price),['652']);
});

test('Marriott brands resolve actual returned facets instead of matching titles or hardcoding ids',async()=>{
 let calls=0;
 const result=await searchMarriottHotel({...input,destName:'310100',hotelBrands:'万豪'},client(async u=>{
  calls++;if(calls===1)return response();
  assert.equal(u.searchParams.get('brands'),'22');const r=response();r.query.brands='22';return r;
 })) as {selectedBrands:unknown;itemList:unknown[]};
 assert.equal(calls,2);assert.deepEqual(result.selectedBrands,[{text:'万豪',value:'22'}]);assert.equal(result.itemList.length,1);
});

test('default Marriott search excludes other brands using official facet ids',async()=>{
 let calls=0;
 const result=await searchMarriottHotel({...input,destName:'310100'},client(async u=>{
  calls++;if(calls===1)return response();
  assert.equal(u.searchParams.get('brands'),'22,1585');const r=response();r.query.brands='22,1585';return r;
 })) as {selectedBrands:{text:string}[]};
 assert.deepEqual(result.selectedBrands.map(b=>b.text),['万豪','JW万豪']);
});

test('ambiguous city, invalid dates and unsupported filters never silently relax constraints',async()=>{
 await assert.rejects(searchHotel(input,client(async()=>({code:'200',result:[{cityCode:1,displayName:'上海A',level:3},{cityCode:2,displayName:'上海B',level:3}]}))),hasCode('INVALID_ARGUMENT'));
 await assert.rejects(searchHotel({...input,checkOutDate:'2026-02-30'},client(async()=>{throw Error('Must not request');})),hasCode('INVALID_ARGUMENT'));
 await assert.rejects(searchHotel({...input,hotelBedTypes:'大床房'},client(async()=>{throw Error('Must not request');})),hasCode('CAPABILITY_UNVERIFIED'));
});

test('schema drift, wrong dates, unapplied brand filters and verification remain errors',async()=>{
 await assert.rejects(searchHotel({...input,destName:'310100'},client(async()=>({code:200}))),hasCode('UPSTREAM_SCHEMA_CHANGED'));
 const wrong=response();wrong.query.checkOut='2026-12-03';
 await assert.rejects(searchHotel({...input,destName:'310100'},client(async()=>wrong)),hasCode('UPSTREAM_SCHEMA_CHANGED'));
 await assert.rejects(searchMarriottHotel({...input,destName:'310100',hotelBrands:'万豪'},client(async()=>response())),hasCode('UPSTREAM_SCHEMA_CHANGED'));
 await assert.rejects(searchHotel({...input,destName:'310100'},client(async()=>{throw new PiggyError('VERIFICATION_REQUIRED','Official challenge');})),hasCode('VERIFICATION_REQUIRED'));
});

test('missing requested Marriott facet is not treated as zero inventory',async()=>{
 const r=response();r.allHotelBrands=[];
 await assert.rejects(searchMarriottHotel({...input,destName:'310100',hotelBrands:'万豪'},client(async()=>r)),hasCode('CAPABILITY_UNVERIFIED'));
});

test('empty hotel results remain empty and nonnumeric displayed prices cannot become zero',async()=>{
 const r=response();r.hotelList=[];
 const result=await searchHotel({...input,destName:'310100'},client(async()=>r)) as {itemList:unknown[]};assert.deepEqual(result.itemList,[]);
 await assert.rejects(searchHotel({...input,destName:'310100'},client(async()=>response({hotelList:[{...hotel,priceDesp:'未知价格'}]}))),hasCode('UPSTREAM_SCHEMA_CHANGED'));
});

test('ignored keyword cannot silently return unfiltered hotels',async()=>{
 await assert.rejects(searchHotel({...input,destName:'310100',keyWords:'指定酒店'},client(async()=>response())),hasCode('UPSTREAM_SCHEMA_CHANGED'));
});
