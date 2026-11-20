import { z } from 'zod';
import { PiggyError } from './errors.js';
import type { WebClient } from './http.js';
import { searchMarriottHotel } from './hotel.js';

const inputSchema=z.object({
 keyword:z.string().trim().min(1),provinceOrCity:z.string().trim().min(1).optional(),
 hotelName:z.string().trim().min(1).optional(),hotelBrands:z.string().trim().min(1).optional(),
 checkInDate:z.string(),checkOutDate:z.string(),
 sortType:z.enum(['price_asc','price_desc']).optional(),
 page:z.string().regex(/^[1-9]\d*$/).optional(),limit:z.string().regex(/^[1-9]\d*$/).optional(),
});
const resultSchema=z.object({code:z.literal(200),result:z.array(z.object({
 isTuan:z.union([z.literal(0),z.literal(1)]),shid:z.number().int().positive(),
 itemId:z.number().int().positive().optional(),rp:z.string().optional(),
}))});
// Internal searchMarriottHotel already validates its HTTP response. This type
// describes that trusted internal result; there is no duplicate runtime parse.
type HotelLookup={
 itemList:{id:string;title:string}[];
 query:{cityCode:string;cityName:string;checkInDate:string;checkOutDate:string;occupancy:{rooms:number;adults:number;children:number}};
 coverage:{page:number;totalPages:number;totalMatches:number;exhaustive:boolean};
 selectedBrands:{text:string;value:string}[];
};

export async function searchMarriottPackage(options:Record<string,string|undefined>,client:WebClient):Promise<unknown>{
 const unsupported=Object.entries(options).filter(([key,value])=>value!==undefined&&!Object.hasOwn(inputSchema.shape,key));
 if(unsupported.length)throw new PiggyError('CAPABILITY_UNVERIFIED',`Marriott package options are not verified: ${unsupported.map(([key])=>key).join(', ')}.`);
 const parsed=inputSchema.safeParse(options);
 if(!parsed.success)throw new PiggyError('INVALID_ARGUMENT','Package preview requires keyword and explicit check-in/check-out dates; sort-type supports price_asc or price_desc.');
 const input=parsed.data,city=input.provinceOrCity||input.keyword;
 const keywordIsPlace=input.keyword===city;
 if(input.hotelName&&!keywordIsPlace&&input.keyword!==input.hotelName){
  throw new PiggyError('INVALID_ARGUMENT','When hotel-name is supplied, keyword must be the selected city or that same hotel name.');
 }
 const hotelName=input.hotelName||(input.provinceOrCity&&!keywordIsPlace?input.keyword:undefined);
 const hotelOptions:Record<string,string|undefined>={destName:city,checkInDate:input.checkInDate,checkOutDate:input.checkOutDate};
 if(hotelName)hotelOptions.hotelName=hotelName;
 if(input.hotelBrands)hotelOptions.hotelBrands=input.hotelBrands;
 if(input.page)hotelOptions.page=input.page;
 // Do not limit hotel candidates before package lookup: output limit applies
 // to package items only. One actual hotel page bounds this query's coverage.
 const hotels=await searchMarriottHotel(hotelOptions,client) as HotelLookup;
 const hotelById=new Map(hotels.itemList.map(hotel=>[hotel.id,hotel]));
 let items:{itemId:string;hotelId:string;title:string;price:string|null;displayPrice:string;currency:string;priceScope:string;taxIncluded:null;availability:null;jumpUrl:string}[]=[];
 if(hotels.itemList.length){
  // Actual public source result-body/index-min.js: getMealData -> q, with
  // shids/checkin/checkout/onlyTripSeller. host module resolves q to tuan.fliggy.com.
  const url=new URL('https://tuan.fliggy.com/ajax/hotel_tuan_info.json');
  url.search=new URLSearchParams({shids:hotels.itemList.map(hotel=>hotel.id).join(','),checkin:input.checkInDate,checkout:input.checkOutDate,onlyTripSeller:'true',callback:'openPiggy'}).toString();
  const raw=await client.json(url);
  if(typeof raw==='object'&&raw!==null&&'code' in raw&&raw.code!==200)throw new PiggyError('UPSTREAM_ERROR','Official hotel package service rejected the query.');
  const result=resultSchema.safeParse(raw);
  if(!result.success)throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official hotel package result schema changed.');
  for(const offer of result.data.result){
   const hotel=hotelById.get(String(offer.shid));
   if(!hotel)throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official package response contains a hotel outside the selected Marriott facets.');
   if(offer.isTuan===0)continue;
   if(offer.itemId===undefined||offer.rp===undefined)throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official package offer lacks its item or displayed price.');
   const displayNumber=/^(\d+(?:\.\d+)?)\/晚$/.exec(offer.rp)?.[1];
   const price=displayNumber&&Number(displayNumber)>0?displayNumber:null;
   const link=new URL('https://tuan.fliggy.com/detail.htm');
   link.search=new URLSearchParams({itemid:String(offer.itemId),shid:String(offer.shid),tripSeller:'true'}).toString();
   items.push({itemId:String(offer.itemId),hotelId:String(offer.shid),title:hotel.title,price,displayPrice:offer.rp,currency:'CNY',priceScope:price===null?'unparsed-official-display':'per-night-starting-price',taxIncluded:null,availability:null,jumpUrl:link.href});
  }
 }
 if(input.sortType)items.sort((a,b)=>a.price===null?(b.price===null?0:1):b.price===null?-1:(input.sortType==='price_desc'?-1:1)*(Number(a.price)-Number(b.price)));
 if(input.limit)items=items.slice(0,Number(input.limit));
 return {verification:'live-logged-in-http',scope:'dated-mainland-marriott-hotel-package-associations',itemList:items,query:hotels.query,selectedBrands:hotels.selectedBrands,
  coverage:{hotelPage:hotels.coverage.page,hotelPages:hotels.coverage.totalPages,hotelMatches:hotels.coverage.totalMatches,hotelsQueried:hotels.itemList.length,exhaustive:false},
  warnings:[
   'Package associations for one page of officially brand-filtered mainland hotels; not the complete Marriott package catalogue.',
   'keyword means a domestic city by default; with province-or-city it becomes the hotel keyword unless it repeats that city. Provinces and arbitrary selling-point searches are unverified.',
   'Official displayPrice is retained verbatim. Only the exact numeric /晚 format is parsed as a per-night starting price, never a tax-inclusive package/stay total.',
   'Output sorting and limit apply only to these package candidates. Unknown numeric prices sort last; bookability, inclusions and membership benefits require the official detail page.',
  ]};
}
