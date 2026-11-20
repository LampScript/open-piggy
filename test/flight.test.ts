import { test } from 'node:test';import assert from 'node:assert/strict';
import { pollFlights,readFlightQuery,flightUrl } from '../src/flight.js';import type { WebClient } from '../src/http.js';
test('route query comes from official page config without executing page scripts',()=>{
 const html='window.g_config={iflightSearch:{query:{depCity:"SHA",arrCity:"LAX",depCityName:"上海",arrCityName:"洛杉矶",isValid:true}}}; var searchJourney';assert.deepEqual(readFlightQuery(html),{depCity:'SHA',arrCity:'LAX',depCityName:'上海',arrCityName:'洛杉矶'});
 assert.equal(flightUrl({origin:'SHA',destination:'LAX',depDate:'2027-02-04',backDate:'2027-02-12'}).searchParams.get('tripType'),'1');
});
test('official business failure is never presented as zero results',async()=>{
 const client:WebClient={text:async()=>'',json:async()=>({status:503,msg:'synthetic'})};await assert.rejects(pollFlights(client,[],'1','0'),/business status 503/);
});
test('polling token is used only internally and not exposed in result',async()=>{
 let calls=0;const client:WebClient={text:async()=>'',json:async url=>{calls++;if(calls===2)assert.equal(url.searchParams.get('iesToken'),'synthetic-token');return calls===1?{status:200,data:{isContinue:true,iesToken:'synthetic-token',delayForNextPoll:1}}:{status:200,data:{isContinue:false,flightItems:[]}};}};
 const result=await pollFlights(client,[],'1','0');assert.deepEqual(result,{flights:[],products:[]});assert.equal(calls,2);
});
import { searchFlight } from '../src/flight.js';
test('live flight money is cents, cabin filtering excludes business, strict duration checks each direction',async()=>{
 const route='window.g_config={iflightSearch:{query:{depCity:"SHA",arrCity:"LAX",depCityName:"上海",arrCityName:"洛杉矶",isValid:true}}}; var searchJourney';
 const mk=(no:string,duration:number)=>({duration,depTimeStr:'2027-02-04 17:35:00',arrTimeStr:'2027-02-04 16:41:00',flightSegments:[{marketingFlightNo:no,depTimeStr:'2027-02-04 17:35:00',depCityCode:'SHA',arrCityCode:'LAX',depAirportCode:'PVG',arrAirportCode:'LAX'}]});
 const client:WebClient={text:async()=>route,json:async url=>{
  const mode=url.searchParams.get('searchMode');const journeys=JSON.parse(url.searchParams.get('searchJourney')!);
  if(mode==='0')return {status:200,data:{flightItems:[{flightInfo:[mk('AC026',906)]}]}};
  if(mode==='1'){assert.deepEqual(journeys[1].selectedFlights,[]);return {status:200,data:{flightItems:[{flightInfo:[mk('AC025',1000)]},{flightInfo:[mk('AC025',1200)]}]}};}
  assert.equal(mode,'2');return {status:200,data:{productItems:[{totalAdultPrice:600500,adultTax:319800,cabinInfo:[[{cabinClass:'Y',cabinClassName:'经济舱'}]]},{totalAdultPrice:4448800,adultTax:459500,cabinInfo:[[{cabinClass:'C',cabinClassName:'公务舱'}]]}]}};
 }};
 const result=await searchFlight({origin:'SHA',destination:'LAX',depDate:'2027-02-04',backDate:'2027-02-12',seatClassName:'economy',maxPrice:'6500',totalDurationHour:'20'},client) as {itemList:{ticketPrice:number;adultTax:number}[]};
 assert.equal(result.itemList.length,1);assert.equal(result.itemList[0]!.ticketPrice,6005);assert.equal(result.itemList[0]!.adultTax,3198);
});
