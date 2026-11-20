import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { PiggyError } from './errors.js';
import type { WebClient } from './http.js';
import { withinHours,sortTransport } from './transport.js';
const numeric=z.union([z.number(),z.string().regex(/^\d+(\.\d+)?$/)]).transform(Number);
const segment=z.object({marketingFlightNo:z.string(),operatingFlightNo:z.string().optional(),depTimeStr:z.string(),depCityCode:z.string(),arrCityCode:z.string(),depAirportCode:z.string(),arrAirportCode:z.string(),marketingAirlineCode:z.string().optional(),operatingAirlineCode:z.string().optional(),codeShare:z.boolean().optional(),depTerm:z.string().optional(),arrTerm:z.string().optional()});
const info=z.object({flightSegments:z.array(segment).min(1),duration:numeric,depTimeStr:z.string(),arrTimeStr:z.string(),transferCities:z.array(z.string()).optional()});
const item=z.object({flightInfo:z.array(info).min(1)});
const product=z.object({totalAdultPrice:numeric,adultPrice:numeric.optional(),adultTax:z.union([z.number(),z.string().regex(/^-?\d+(\.\d+)?$/)]).transform(Number).optional(),cabinInfo:z.array(z.array(z.object({cabinClass:z.string(),cabinClassName:z.string()}))).optional(),agentInfo:z.object({showName:z.string().optional()}).optional()});
const envelope=z.object({status:z.number(),msg:z.string().optional(),data:z.object({isContinue:z.boolean().optional(),flightItems:z.array(item).optional(),productItems:z.array(product).optional(),delayForNextPoll:numeric.optional(),iesToken:z.string().optional(),queryRecordId:z.string().optional()}).optional()});
type Journey = {depCityCode:string;arrCityCode:string;depCityName:string;arrCityName:string;depDate:string;selectedFlights:Record<string,unknown>[]};
export type FlightOptions={origin:string;destination:string;depDate:string;backDate?:string;transportNo?:string;totalDurationHour?:string;journeyType?:string;sortType?:string;limit?:string;maxPrice?:string;seatClassName?:string;transferCity?:string;depHourStart?:string;depHourEnd?:string;arrHourStart?:string;arrHourEnd?:string;outboundFlights?:string;returnFlights?:string};
export function flightUrl(options:FlightOptions):URL {
 const u=new URL('https://sijipiao.fliggy.com/ie/flight_search_result.htm');
 u.search=new URLSearchParams({depCity:options.origin,arrCity:options.destination,depDate:options.depDate,tripType:options.backDate?'1':'0',...(options.backDate?{arrDate:options.backDate}:{})}).toString();return u;
}
function queryField(html:string,name:string):string {
 const start=html.indexOf('window.g_config=');const end=html.indexOf('var searchJourney',start);
 const fragment=html.slice(start,end);const match=new RegExp(`\\b${name}\\s*:\\s*"([^"\\n]*)"`).exec(fragment);
 if(!match)throw new PiggyError('UPSTREAM_SCHEMA_CHANGED',`Official flight page is missing ${name}.`);
 return match[1]!;
}
export function readFlightQuery(html:string):{depCity:string;arrCity:string;depCityName:string;arrCityName:string} {
 if(!/isValid\s*:\s*true/.test(html))throw new PiggyError('INVALID_ARGUMENT','Official website did not recognize the route. Use IATA city/airport codes.');
 return {depCity:queryField(html,'depCity'),arrCity:queryField(html,'arrCity'),depCityName:queryField(html,'depCityName'),arrCityName:queryField(html,'arrCityName')};
}
export async function pollFlights(client:WebClient, journeys:Journey[], tripType:string, mode:string):Promise<{flights:z.infer<typeof item>[];products:z.infer<typeof product>[]}> {
 const url=new URL('https://sijipiao.fliggy.com/ie/flight_search_result_poller.do');
 url.search=new URLSearchParams({supportMultiTrip:'true',searchBy:'',childPassengerNum:'0',infantPassengerNum:'0',searchJourney:JSON.stringify(journeys),tripType,searchCabinType:'0',agentId:'-1',controller:'1',searchMode:mode,b2g:'0',formNo:'-1',cardId:'',needMemberPrice:'false',callback:'openPiggy'}).toString();
 let flights:z.infer<typeof item>[]=[];let products:z.infer<typeof product>[]=[];
 const deadline=Date.now()+60000;
 for(let count=0;count<20 && Date.now()<deadline;count++) {
  const parsed=envelope.safeParse(await client.json(url));
  if(!parsed.success)throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official flight response no longer matches the observed webpage schema.');
  const r=parsed.data;
  if(r.status!==200)throw new PiggyError(r.status===401?'LOGIN_REQUIRED':'UPSTREAM_ERROR',`Official flight endpoint failed (business status ${r.status}).`);
  if(!r.data)throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Flight response lacks data.');
  if(r.data.flightItems)flights=r.data.flightItems;
  if(r.data.productItems)products=r.data.productItems;
  if(!r.data.isContinue)return {flights,products};
  if(r.data.iesToken)url.searchParams.set('iesToken',r.data.iesToken);
  if(r.data.queryRecordId)url.searchParams.set('queryRecordId',r.data.queryRecordId);
  url.searchParams.set('count',String(count+1));
  // Bounded polling follows the public page protocol; this is not retrying failed requests.
  await delay(Math.min(10000,Math.max(250,r.data.delayForNextPoll ?? 1000)));
 }
 throw new PiggyError('UPSTREAM_ERROR','Official flight polling did not complete; no complete price is reported.');
}
function selected(f:z.infer<typeof info>):Record<string,unknown>[] {
 return f.flightSegments.map(s=>({marketFlightNo:s.marketingFlightNo,operatFlightNo:s.operatingFlightNo,flightTime:s.depTimeStr,depCityCode:s.depCityCode,arrCityCode:s.arrCityCode,depAirportCode:s.depAirportCode,arrAirportCode:s.arrAirportCode,marketingAirlineCode:s.marketingAirlineCode,operatingAirlineCode:s.operatingAirlineCode,codeShare:s.codeShare,depTerm:s.depTerm,arrTerm:s.arrTerm}));
}

function selectedFlightUrl(page:URL,flights:z.infer<typeof info>[]):string {
 const url=new URL(page);url.searchParams.set('pcOtaMode','1');url.searchParams.set('pcTripType',flights.length===2?'1':'0');
 url.searchParams.set('pcLeaveFlightNo',flights[0]!.flightSegments.map(s=>s.marketingFlightNo).join(','));
 if(flights[1])url.searchParams.set('pcBackFlightNo',flights[1].flightSegments.map(s=>s.marketingFlightNo).join(','));
 const segments=flights.flatMap((f,index)=>f.flightSegments.map(s=>({arrAirportCode:s.arrAirportCode,arrCityCode:s.arrCityCode,depAirportCode:s.depAirportCode,depCityCode:s.depCityCode,depDate:s.depTimeStr,journeySeq:index+1,marketingFlightNo:s.marketingFlightNo})));
 url.searchParams.set('selectedSegments',JSON.stringify(segments));return url.href;
}

export async function searchFlight(options:FlightOptions,client:WebClient):Promise<unknown> {
 const page=flightUrl(options);const route=readFlightQuery(await client.text(page));
 const journey:Journey={depCityCode:route.depCity,arrCityCode:route.arrCity,depCityName:encodeURIComponent(route.depCityName),arrCityName:encodeURIComponent(route.arrCityName),depDate:options.depDate,selectedFlights:[]};
 const journeys=[journey];
 if(options.backDate)journeys.push({depCityCode:route.arrCity,arrCityCode:route.depCity,depCityName:journey.arrCityName,arrCityName:journey.depCityName,depDate:options.backDate,selectedFlights:[]});
 const tripType=options.backDate?'1':'0';const limit=Number(options.limit||5);const wanted=options.transportNo?.split(',').map(s=>s.trim().toUpperCase());
 function accepts(f:z.infer<typeof info>,sequence?:string):boolean {
  const exact=sequence?.split(',').map(n=>n.trim().toUpperCase());
  const actual=f.flightSegments.map(s=>s.marketingFlightNo.toUpperCase());
  const transfer=oTransfer(f);
  if(exact && (exact.length!==actual.length || !exact.every((n,i)=>n===actual[i])))return false;
  if(options.transferCity && !options.transferCity.split(',').some(c=>transfer.includes(c.trim())))return false;
  if(!withinHours(f.depTimeStr,options.depHourStart,options.depHourEnd)||!withinHours(f.arrTimeStr,options.arrHourStart,options.arrHourEnd))return false;
  return (!options.totalDurationHour || f.duration<Number(options.totalDurationHour)*60) && (!wanted || f.flightSegments.every(s=>wanted.includes(s.marketingFlightNo.toUpperCase()))) && (!options.journeyType || (options.journeyType==='1'?f.flightSegments.length===1:f.flightSegments.length>1));
 }
 function oTransfer(f:z.infer<typeof info>):string[]{return [...(f.transferCities??[]),...f.flightSegments.slice(0,-1).map(s=>s.arrCityCode),...f.flightSegments.slice(0,-1).map(s=>s.arrAirportCode)];}
 function direction(result:Awaited<ReturnType<typeof pollFlights>>,day:string):z.infer<typeof info>[] {
  const flights=result.flights.flatMap(i=>i.flightInfo);
  if(flights.some(f=>f.depTimeStr.slice(0,10)!==day || f.flightSegments[0]!.depTimeStr.slice(0,10)!==day))throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official flight response returned a different departure date.');
  return flights;
 }
 const outbound=direction(await pollFlights(client,journeys,tripType,'0'),options.depDate).filter(f=>accepts(f,options.outboundFlights));
 const results:unknown[]=[];let combinations=0;
 for(const departure of outbound.slice(0,limit)) {
  journeys[0]!.selectedFlights=selected(departure);
  if(options.backDate)journeys[1]!.selectedFlights=[];
  const returns=options.backDate?direction(await pollFlights(client,journeys,tripType,'1'),options.backDate).filter(f=>accepts(f,options.returnFlights)):[undefined];
  for(const arrival of returns.slice(0,limit)) {
   if(arrival)journeys[1]!.selectedFlights=selected(arrival);
   const products=(await pollFlights(client,journeys,tripType,'2')).products;combinations++;
   for(const quote of products) {
    const cabins=quote.cabinInfo?.flat();
    const wantedCabins=options.seatClassName?.split(',').map(s=>({economy:'经济舱',business:'公务舱',first:'头等舱'}[s.trim()] ?? s.trim()));
    if(wantedCabins && (!cabins?.length || !cabins.every(c=>wantedCabins.includes(c.cabinClassName))))continue;
    if(options.maxPrice && quote.totalAdultPrice/100>Number(options.maxPrice))continue;
    results.push({ticketPrice:quote.totalAdultPrice/100,currency:'CNY',priceScope:options.backDate?'round-trip':'one-way',taxIncluded:quote.adultTax!==undefined && quote.adultTax>=0?true:null,adultTax:quote.adultTax!==undefined && quote.adultTax>=0?quote.adultTax/100:null,seller:quote.agentInfo?.showName??null,cabins:quote.cabinInfo??null,baggage:null,fareBrand:null,protectedConnection:null,journeys:[departure,arrival].filter(f=>f!==undefined).map(f=>({journeyType:f.flightSegments.length===1?'直达':'中转',totalDuration:f.duration,depDateTime:f.depTimeStr,arrDateTime:f.arrTimeStr,segments:f.flightSegments.map(s=>({marketingTransportNo:s.marketingFlightNo,depStationCode:s.depAirportCode,arrStationCode:s.arrAirportCode,depDateTime:s.depTimeStr})),flights:f.flightSegments.map(s=>({marketingTransportNo:s.marketingFlightNo,depStationCode:s.depAirportCode,arrStationCode:s.arrAirportCode,depDateTime:s.depTimeStr}))})),jumpUrl:selectedFlightUrl(page,[departure,arrival].filter(f=>f!==undefined))});
   }
  }
 }
 const sorted=sortTransport(results as Record<string,unknown>[],options.sortType);
 return {verification:'live-session-http',itemList:sorted,coverage:{combinationsQueried:combinations,candidateLimitPerDirection:limit,exhaustive:false},warnings:['Lowest-agent tab only; GDS premium tab is not queried.','Prices are live HTTP search quotes, not a final ticketing guarantee.','Booking link preselects the returned flight segments, but does not lock a seller quote or create an order.','Baggage, fare brand and connection protection have not been verified.']};
}
