import assert from 'node:assert/strict';
import test from 'node:test';
import {searchKeyword} from '../src/keyword.js';
import type {WebClient} from '../src/http.js';
import {PiggyError} from '../src/errors.js';
const item=(fields:Record<string,unknown>={})=>({trip_main_busness_type:'hotel',fields:{name:'上海酒店',price:'833',discountPrice:null,pc_url:'https://hotel.alitrip.com/hotel_detail2.htm?shid=100',...fields}});
const response=(items=[item()])=>({success:true,data:{success:true,data:{mainsearch:{data:{keyword:'上海',searchType:'product'}},itemProducts:{data:{list:[{has_more:false,docsFound:1000,auctions:items}]}},itemPagenum:{data:{count:100,current:1}}}}});
const client=(json:WebClient['json']):WebClient=>({json,text:async()=>{throw Error('Unexpected text query');}});
const hasCode=(code:string)=>(e:unknown)=>e instanceof PiggyError&&e.code===code;

test('queries observed keyword endpoint and preserves page coverage',async()=>{
 const result=await searchKeyword({query:'上海'},client(async u=>{
  assert.equal(u.origin,'https://travelsearch.fliggy.com');assert.equal(u.pathname,'/async/queryItemResult.do');assert.equal(u.searchParams.get('keyword'),'上海');assert.equal(u.searchParams.get('searchType'),'product');assert.equal(u.searchParams.get('pagenum'),'1');return response();
 })) as {itemList:{price:string}[];coverage:{page:number;pageCount:number;exhaustive:boolean}};
 assert.equal(result.itemList[0]?.price,'833');assert.deepEqual(result.coverage,{page:1,pageCount:100,exhaustive:false});
});

test('normalizes official discount and hides zero/absent prices instead of claiming free inventory',async()=>{
 const result=await searchKeyword({query:'上海'},client(async()=>response([item({price:'0'}),item({price:undefined}),item({price:'833',discountPrice:'700'}),item({name:null,title:'<em>上海</em>套餐<script>alert(1)</script>',price:123})]))) as {itemList:{price:string|null;title:string}[]};
 assert.deepEqual(result.itemList.map(i=>i.price),[null,null,'700','123']);
 assert.equal(result.itemList[3]?.title,'上海套餐');
});

test('rejects changed response, query mismatch, invalid page and non-official links',async()=>{
 await assert.rejects(searchKeyword({query:'上海'},client(async()=>({success:true}))),hasCode('UPSTREAM_SCHEMA_CHANGED'));
 await assert.rejects(searchKeyword({query:'北京'},client(async()=>response())),hasCode('UPSTREAM_SCHEMA_CHANGED'));
 await assert.rejects(searchKeyword({query:'上海',page:'0'},client(async()=>response())),hasCode('INVALID_ARGUMENT'));
 await assert.rejects(searchKeyword({query:'上海'},client(async()=>response([item({pc_url:'https://attacker.invalid/'})]))),hasCode('UPSTREAM_SCHEMA_CHANGED'));
});

test('empty results remain empty and business failure does not become success',async()=>{
 const result=await searchKeyword({query:'上海'},client(async()=>response([]))) as {itemList:unknown[]};assert.deepEqual(result.itemList,[]);
 await assert.rejects(searchKeyword({query:'上海'},client(async()=>({success:false}))),hasCode('UPSTREAM_ERROR'));
});

test('unsupported filters fail without network activity, local limit is explicit',async()=>{
 await assert.rejects(searchKeyword({query:'上海',sort:'unknown'},client(async()=>{throw Error('Should not request');})),hasCode('CAPABILITY_UNVERIFIED'));
 const result=await searchKeyword({query:'上海',limit:'1'},client(async()=>response([item(),item()]))) as {itemList:unknown[]};assert.equal(result.itemList.length,1);
});
