import test from 'node:test';import assert from 'node:assert/strict';import { CookieJar } from 'tough-cookie';
import {searchTrainJourney} from '../src/train-query.js';import type {WebClient} from '../src/http.js';
test('train return journey queries both directions and labels sum as independent tickets',async()=>{
 const seen:{depLocation:string;arrLocation:string;depDate:string}[]=[];
 const client:WebClient={text:async()=>'',json:async url=>{
 const d=JSON.parse(url.searchParams.get('data')!);seen.push(d);
 return {api:'mtop.trip.train.station2stationsearch2',v:'1.0',ret:['SUCCESS::成功'],data:{depDate:d.depDate,trains:[{trainNo:seen.length===1?'G1':'G2',departStation:d.depLocation,arriveStation:d.arrLocation,depTimeFull:d.depDate+' 06:00:00',arrTimeFull:d.depDate+' 10:00:00',costTimeInt:240,price:10000,bookable:0,preSellDateStr:'2027-01-20 00:00:00',seatTypes:[{price:10000,seatName:'二等座',seatType:14,stock:0}]}]}};
 }};
 const result=await searchTrainJourney({origin:'上海',destination:'北京',depDate:'2027-02-04',backDate:'2027-02-12',maxPrice:'210'},client,new CookieJar()) as {itemList:{ticketPrice:number;priceScope:string;bookable:boolean;journeys:unknown[]}[]};
 assert.equal(seen.length,2);assert.equal(seen[1]!.depLocation,'北京');assert.equal(seen[1]!.arrLocation,'上海');assert.equal(seen[1]!.depDate,'2027-02-12');assert.equal(result.itemList[0]!.ticketPrice,200);assert.equal(result.itemList[0]!.priceScope,'two-one-way-starting-price-sum');assert.equal(result.itemList[0]!.bookable,false);assert.equal(result.itemList[0]!.journeys.length,2);
});
test('same-day train return before outbound arrival is excluded',async()=>{
 let calls=0;const client:WebClient={text:async()=>'',json:async url=>{calls++;const d=JSON.parse(url.searchParams.get('data')!);return {api:'mtop.trip.train.station2stationsearch2',v:'1.0',ret:['SUCCESS'],data:{depDate:d.depDate,trains:[{trainNo:'G1',departStation:d.depLocation,arriveStation:d.arrLocation,depTimeFull:d.depDate+' 06:00:00',arrTimeFull:d.depDate+' 10:00:00',costTimeInt:240,price:10000,bookable:1,seatTypes:[{price:10000,seatName:'二等座',seatType:14,stock:1}]}]}};}};
 const result=await searchTrainJourney({origin:'上海',destination:'北京',depDate:'2027-02-04',backDate:'2027-02-04'},client,new CookieJar()) as {itemList:unknown[]};assert.equal(calls,2);assert.deepEqual(result.itemList,[]);
});
