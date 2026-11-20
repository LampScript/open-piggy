import { z } from 'zod';
import { PiggyError } from './errors.js';
export type TransportOptions = Record<string,string|undefined>;
export type SearchResult = {itemList:Record<string,unknown>[];[key:string]:unknown};
export type DatePair = {depDate:string;backDate?:string};
const dateSchema=z.iso.date();
function date(value:string,label:string):string {
 if(!dateSchema.safeParse(value).success)throw new PiggyError('INVALID_ARGUMENT',`${label} must be a real YYYY-MM-DD date.`);
 return value;
}
function dateWindow(fixed:string|undefined,start:string|undefined,end:string|undefined,label:string):{start:string;end:string} {
 if(fixed && (start||end))throw new PiggyError('INVALID_ARGUMENT',`${label}: fixed date and date range cannot be combined.`);
 if(fixed){date(fixed,label);return {start:fixed,end:fixed};}
 if(!start||!end)throw new PiggyError('INVALID_ARGUMENT',`${label} requires a fixed date or both range endpoints.`);
 date(start,label);date(end,label);
 if(start>end)throw new PiggyError('INVALID_ARGUMENT',`${label} range start must not follow end.`);
 return {start,end};
}
export function planDates(o:TransportOptions):DatePair[] {
 const budget=o.maxDatePairs===undefined?49:Number(o.maxDatePairs);
 if(!Number.isSafeInteger(budget)||budget<1)throw new PiggyError('INVALID_ARGUMENT','max-date-pairs must be a positive integer.');
 const departures=dateWindow(o.depDate,o.depDateStart,o.depDateEnd,'Departure');
 const returns=o.backDate||o.backDateStart||o.backDateEnd?dateWindow(o.backDate,o.backDateStart,o.backDateEnd,'Return'):undefined;
 const pairs:DatePair[]=[];
 const epoch=(value:string)=>Date.parse(`${value}T00:00:00Z`);
 const end=epoch(returns && returns.end<departures.end?returns.end:departures.end);
 for(let day=epoch(departures.start);day<=end;day+=86400000){
  const depDate=new Date(day).toISOString().slice(0,10);
  const first=returns?Math.max(day,epoch(returns.start)):day;
  const last=returns?epoch(returns.end):day;
  for(let back=first;back<=last;back+=86400000){
   pairs.push(returns?{depDate,backDate:new Date(back).toISOString().slice(0,10)}:{depDate});
   if(pairs.length>budget)throw new PiggyError('INVALID_ARGUMENT',`Date range exceeds max-date-pairs=${budget}. Narrow the range or explicitly increase the budget.`);
  }
 }
 if(!pairs.length)throw new PiggyError('INVALID_ARGUMENT','No return date is on or after departure.');
 for(const key of ['depHourStart','depHourEnd','arrHourStart','arrHourEnd'])if(o[key]!==undefined && (!/^\d+$/.test(o[key]!)||Number(o[key])>23))throw new PiggyError('INVALID_ARGUMENT',`${key} must be an integer hour from 0 to 23.`);
 for(const side of ['dep','arr'])if(o[`${side}HourStart`]!==undefined&&o[`${side}HourEnd`]!==undefined&&Number(o[`${side}HourStart`])>Number(o[`${side}HourEnd`]))throw new PiggyError('INVALID_ARGUMENT',`${side} hour start must not follow end; overnight windows require separate searches.`);
 if(o.sortType && !/^[1-8]$/.test(o.sortType))throw new PiggyError('INVALID_ARGUMENT','sort-type must be 1 through 8.');
 return pairs;
}
export function withinHours(time:string,start?:string,end?:string):boolean {
 const m=/\b(\d{2}):\d{2}/.exec(time);
 if(!m)throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official journey lacks a usable local time.');
 const hour=Number(m[1]);return (start===undefined||hour>=Number(start))&&(end===undefined||hour<=Number(end));
}
function journeys(i:Record<string,unknown>):Record<string,unknown>[] { return (i.journeys as Record<string,unknown>[]|undefined)??[i]; }
export function sortTransport<T extends Record<string,unknown>>(items:T[],sort='3'):T[] {
 const price=(i:T)=>Number(i.ticketPrice);
 const duration=(i:T)=>journeys(i).reduce((n,j)=>n+Number(j.totalDuration),0);
 const departure=(i:T)=>String(journeys(i)[0]!.depDateTime);
 const direct=(i:T)=>journeys(i).every(j=>j.journeyType==='直达'||!j.segments||(j.segments as unknown[]).length===1)?0:1;
 if(sort==='1'||sort==='3')items.sort((a,b)=>(price(a)-price(b))*(sort==='1'?-1:1));
 if(sort==='4'||sort==='5')items.sort((a,b)=>(duration(a)-duration(b))*(sort==='5'?-1:1));
 if(sort==='6'||sort==='7')items.sort((a,b)=>departure(a).localeCompare(departure(b))*(sort==='7'?-1:1));
 if(sort==='8')items.sort((a,b)=>direct(a)-direct(b)||price(a)-price(b));
 return items;
}
export async function searchDatePairs(o:TransportOptions,pairs:DatePair[],run:(options:TransportOptions)=>Promise<unknown>):Promise<SearchResult> {
 const items:Record<string,unknown>[]=[];const coverages:unknown[]=[];const warnings=new Set<string>();const verifications=new Set<unknown>();
 for(const pair of pairs){
  const fixed:TransportOptions={...o,...pair};
  for(const key of ['depDateStart','depDateEnd','backDateStart','backDateEnd','maxDatePairs'])delete fixed[key];
  const result=await run(fixed) as SearchResult;
  for(const warning of (result.warnings as string[]|undefined)??[])warnings.add(warning);
  if(result.verification)verifications.add(result.verification);
  items.push(...result.itemList.map(i=>({...i,queryDates:pair})));coverages.push({dates:pair,coverage:result.coverage??null});
 }
 return {verification:verifications.size===1?[...verifications][0]:null,itemList:sortTransport(items,o.sortType),verifications:[...verifications],coverage:{requestedDatePairs:pairs.length,completedDatePairs:pairs.length,datePairsComplete:true,itinerariesExhaustive:false,queries:coverages},warnings:[...warnings,'Dates are queried sequentially with the same session; no failed query is silently skipped. Prices are observed at different times.','All requested valid date pairs completed, but itinerary candidate limits may still exclude fares.']};
}
