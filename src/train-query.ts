import type { WebClient } from './http.js';
import type { CookieJar } from 'tough-cookie';
import { searchTrain } from './train.js';
import { sortTransport,type TransportOptions,type SearchResult } from './transport.js';
export async function searchTrainJourney(options:TransportOptions,client:WebClient,jar:CookieJar):Promise<unknown> {
 if(!options.backDate)return searchTrain(options,client,jar);
 const {backDate,...outgoing}=options;
 const inbound:TransportOptions={...outgoing,origin:options.destination,destination:options.origin,depDate:backDate};
 delete outgoing.limit;delete inbound.limit;
 const out=await searchTrain(outgoing,client,jar) as SearchResult;
 const back=await searchTrain(inbound,client,jar) as SearchResult;
 const combinations:Record<string,unknown>[]=[];
 for(const first of out.itemList)for(const second of back.itemList){
  if(String(second.depDateTime)<String(first.arrDateTime))continue;
  const price=Number(first.ticketPrice)+Number(second.ticketPrice);
  if(options.maxPrice && price>Number(options.maxPrice))continue;
  const journeys=[first,second].map(train=>({journeyType:'直达',totalDuration:train.totalDuration,depDateTime:train.depDateTime,arrDateTime:train.arrDateTime,segments:[train]}));
  combinations.push({ticketPrice:price,currency:'CNY',priceScope:'two-one-way-starting-price-sum',taxIncluded:null,bookable:first.bookable===true&&second.bookable===true,journeys,protectedConnection:null,jumpUrls:[first.jumpUrl,second.jumpUrl]});
 }
 const sorted=sortTransport(combinations,options.sortType);
 return {itemList:options.limit?sorted.slice(0,Number(options.limit)):sorted,verification:'live-public-http',scope:'independent-outbound-and-return-trains',warnings:['Outbound and return are separate one-way tickets; this sum is not an official bundled round-trip offer.','Future schedules and starting prices do not establish purchasable seat availability.']};
}
