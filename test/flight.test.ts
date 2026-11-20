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
 const mk=(no:string,duration:number)=>({duration,depTimeStr:(no==='AC025'?'2027-02-12':'2027-02-04')+' 17:35:00',arrTimeStr:(no==='AC025'?'2027-02-13':'2027-02-04')+' 16:41:00',flightSegments:[{marketingFlightNo:no,depTimeStr:(no==='AC025'?'2027-02-12':'2027-02-04')+' 17:35:00',depCityCode:'SHA',arrCityCode:'LAX',depAirportCode:'PVG',arrAirportCode:'LAX'}]});
 const client:WebClient={text:async()=>route,json:async url=>{
  const mode=url.searchParams.get('searchMode');const journeys=JSON.parse(url.searchParams.get('searchJourney')!);
  if(mode==='0')return {status:200,data:{flightItems:[{flightInfo:[mk('AC026',906)]}]}};
  if(mode==='1'){assert.deepEqual(journeys[1].selectedFlights,[]);return {status:200,data:{flightItems:[{flightInfo:[mk('AC025',1000)]},{flightInfo:[mk('AC025',1200)]}]}};}
  assert.equal(mode,'2');return {status:200,data:{productItems:[{totalAdultPrice:600500,adultTax:319800,cabinInfo:[[{cabinClass:'Y',cabinClassName:'经济舱'}]]},{totalAdultPrice:4448800,adultTax:459500,cabinInfo:[[{cabinClass:'C',cabinClassName:'公务舱'}]]}]}};
 }};
 const result=await searchFlight({origin:'SHA',destination:'LAX',depDate:'2027-02-04',backDate:'2027-02-12',seatClassName:'economy',maxPrice:'6500',totalDurationHour:'20'},client) as {itemList:{ticketPrice:number;adultTax:number;jumpUrl:string}[]};
 assert.equal(result.itemList.length,1);assert.equal(result.itemList[0]!.ticketPrice,6005);assert.equal(result.itemList[0]!.adultTax,3198);assert.equal(new URL(result.itemList[0]!.jumpUrl).searchParams.get('pcTripType'),'1');
});
test('exact segment order, transfer city, hour filters and selected-flight URL are honored',async()=>{
 const route='window.g_config={iflightSearch:{query:{depCity:"SHA",arrCity:"LAX",depCityName:"上海",arrCityName:"洛杉矶",isValid:true}}}; var searchJourney';
 const flight={duration:906,depTimeStr:'2027-02-04 17:35:00',arrTimeStr:'2027-02-04 16:41:00',transferCities:['温哥华'],flightSegments:[{marketingFlightNo:'AC026',depTimeStr:'2027-02-04 17:35:00',depCityCode:'SHA',arrCityCode:'YVR',depAirportCode:'PVG',arrAirportCode:'YVR'},{marketingFlightNo:'AC554',depTimeStr:'2027-02-04 14:40:00',depCityCode:'YVR',arrCityCode:'LAX',depAirportCode:'YVR',arrAirportCode:'LAX'}]};
 let products=0;
 const client:WebClient={text:async()=>route,json:async u=>{if(u.searchParams.get('searchMode')==='0')return {status:200,data:{flightItems:[{flightInfo:[flight]}]}};products++;return {status:200,data:{productItems:[{totalAdultPrice:300000,adultTax:100000}]}};}};
 const base={origin:'SHA',destination:'LAX',depDate:'2027-02-04',transferCity:'温哥华',depHourStart:'17',depHourEnd:'17',arrHourEnd:'16'};
 const match=await searchFlight({...base,outboundFlights:'AC026,AC554'},client) as {itemList:{jumpUrl:string;journeys:{segments:unknown[]}[]}[]};assert.equal(match.itemList.length,1);assert.equal(products,1);const url=new URL(match.itemList[0]!.jumpUrl);assert.equal(url.searchParams.get('pcTripType'),'0');assert.equal(url.searchParams.get('pcLeaveFlightNo'),'AC026,AC554');assert.equal(JSON.parse(url.searchParams.get('selectedSegments')!).length,2);assert.equal(match.itemList[0]!.journeys[0]!.segments.length,2);
 const wrong=await searchFlight({...base,outboundFlights:'AC554,AC026'},client) as {itemList:unknown[]};assert.equal(wrong.itemList.length,0);assert.equal(products,1);
 const hour=await searchFlight({...base,depHourEnd:'16'},client) as {itemList:unknown[]};assert.equal(hour.itemList.length,0);
});
test('upstream flight departures on the wrong requested date are rejected before price labeling',async()=>{
 const route='window.g_config={iflightSearch:{query:{depCity:"SHA",arrCity:"LAX",depCityName:"上海",arrCityName:"洛杉矶",isValid:true}}}; var searchJourney';
 const client:WebClient={text:async()=>route,json:async()=>({status:200,data:{flightItems:[{flightInfo:[{duration:600,depTimeStr:'2027-02-05 12:00:00',arrTimeStr:'2027-02-05 13:00:00',flightSegments:[{marketingFlightNo:'AC026',depTimeStr:'2027-02-05 12:00:00',depCityCode:'SHA',arrCityCode:'LAX',depAirportCode:'PVG',arrAirportCode:'LAX'}]}]}]}})};
 await assert.rejects(searchFlight({origin:'SHA',destination:'LAX',depDate:'2027-02-04'},client),/different departure date/);
});
