import { z } from 'zod';
import { PiggyError } from './errors.js';
import type { WebClient } from './http.js';

// Observed public website implementation:
// trip/hotel-search/0.5.24/mods/result-body/index-min.js and result-filter/index-min.js.
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value);
const inputSchema=z.object({
 destName:z.string().trim().min(1),checkInDate:date,checkOutDate:date,
 keyWords:z.string().trim().optional(),hotelName:z.string().trim().optional(),
 hotelBrands:z.string().trim().min(1).optional(),
 maxPrice:z.string().regex(/^\d+(\.\d+)?$/).optional(),
 sort:z.enum(['price_asc','price_desc']).optional(),
 page:z.string().regex(/^[1-9]\d*$/).optional(),limit:z.string().regex(/^[1-9]\d*$/).optional(),
}).refine(input=>input.checkOutDate>input.checkInDate);
const citySchema=z.object({code:z.literal('200'),result:z.array(z.object({cityCode:z.union([z.string(),z.number()]),displayName:z.string(),level:z.number()}))});
const brandSchema=z.object({text:z.string(),value:z.string()});
const resultSchema=z.object({
 code:z.literal(200),total:z.number().int().nonnegative(),isOverseas:z.number(),isGangAoTai:z.number(),
 query:z.object({city:z.string(),cityName:z.string(),checkIn:z.string(),checkOut:z.string(),keywords:z.string().nullable(),currentPage:z.number().int().positive(),totalPage:z.number().int().nonnegative(),order:z.string(),dir:z.string(),brands:z.string().nullable(),aNum_1:z.number().int().positive(),cNum_1:z.number().int().nonnegative(),roomNum:z.string()}),
 allHotelBrands:z.array(brandSchema),
 hotelList:z.array(z.object({
  shid:z.number().int().positive(),name:z.string(),address:z.string(),priceDesp:z.string(),priceDespStyle:z.number(),
  level:z.object({desc:z.string(),star:z.string().nullable()}),rateScore:z.string(),
  status:z.number(),quota:z.number(),
 })),
});
type HotelResponse=z.infer<typeof resultSchema>;
type HotelInput=z.infer<typeof inputSchema>;
// Portfolio membership: https://www.marriott.com/brands.mi . Only these labels
// have been matched to actual Fliggy allHotelBrands facets; IDs are NOT hardcoded.
const marriottLabels=new Set(['万豪','JW万豪','喜来登','福朋喜来登','万丽','艾美','瑞吉','丽思卡尔顿','威斯汀','万豪行政公寓','W酒店','豪华精选','万豪万枫','雅乐轩','臻品之选酒店','德尔塔']);

async function resolveCity(destination:string,client:WebClient):Promise<{city:string;cityName:string}>{
 if(/^\d+$/.test(destination))return {city:destination,cityName:''};
 const url=new URL('https://hotel.alitrip.com/ajax/CitySuggest.do');
 url.search=new URLSearchParams({t:'0',q:destination,callback:'openPiggy'}).toString();
 const parsed=citySchema.safeParse(await client.json(url));
 if(!parsed.success)throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official hotel city suggestion schema changed.');
 const candidates=parsed.data.result.filter(city=>city.level===3);
 // Exact city match first; never silently select the first similarly named city.
 const exact=candidates.filter(city=>city.displayName===destination||city.displayName.replace(/市$/,'')===destination.replace(/市$/,''));
 const selected=exact.length===1?exact[0]:candidates.length===1?candidates[0]:undefined;
 if(!selected)throw new PiggyError('INVALID_ARGUMENT','Hotel destination is ambiguous or unsupported; use an official domestic city code.');
 return {city:String(selected.cityCode),cityName:selected.displayName};
}

async function fetchHotels(input:HotelInput,city:{city:string;cityName:string},client:WebClient,brands?:string[]):Promise<HotelResponse>{
 const url=new URL('https://hotel.fliggy.com/ajax/hotelList.htm');
 const params=new URLSearchParams({
  city:city.city,cityName:city.cityName,checkIn:input.checkInDate,checkOut:input.checkOutDate,
  keywords:input.hotelName||input.keyWords||'',region:'0',count:'10',currentPage:input.page||'1',
  order:input.sort?'PRICE':'DEFAULT',dir:input.sort==='price_asc'?'ASC':'DESC',callback:'openPiggy',
 });
 if(brands)params.set('brands',brands.join(','));
 url.search=params.toString();
 const raw=await client.json(url);
 if(typeof raw==='object'&&raw!==null&&'code' in raw&&raw.code!==200)throw new PiggyError('UPSTREAM_ERROR','Official hotel service rejected the query.');
 const parsed=resultSchema.safeParse(raw);
 if(!parsed.success)throw new PiggyError('UPSTREAM_SCHEMA_CHANGED',`Official hotel result schema changed: ${parsed.error.issues.map(issue=>issue.path.join('.')).join(', ')}.`);
 const result=parsed.data,q=result.query;
 if(q.city!==city.city||q.checkIn!==input.checkInDate||q.checkOut!==input.checkOutDate||q.currentPage!==Number(input.page||1)||q.order!==(input.sort?'PRICE':'DEFAULT')||(input.sort&&q.dir!==(input.sort==='price_asc'?'ASC':'DESC'))){
  throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official hotel result changed the requested city, dates, page or sort.');
 }
 if(result.isOverseas!==0||result.isGangAoTai!==0)throw new PiggyError('CAPABILITY_UNVERIFIED','Only mainland domestic hotel pricing has been verified.');
 if((input.hotelName||input.keyWords)&&(q.keywords||'')!==(input.hotelName||input.keyWords))throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official hotel service did not preserve the requested keyword.');
 if(brands&&JSON.stringify((q.brands||'').split(',').sort())!==JSON.stringify([...brands].sort()))throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official hotel service did not preserve the selected brand facets.');
 return result;
}

async function search(options:Record<string,string|undefined>,client:WebClient,marriott:boolean):Promise<unknown>{
 const allowed=new Set(['destName','checkInDate','checkOutDate','keyWords','maxPrice','sort','page','limit',...(marriott?['hotelBrands','hotelName']:[])]);
 const unsupported=Object.entries(options).filter(([key,value])=>value!==undefined&&!allowed.has(key));
 if(unsupported.length)throw new PiggyError('CAPABILITY_UNVERIFIED',`Hotel options are not verified: ${unsupported.map(([key])=>key).join(', ')}.`);
 const parsed=inputSchema.safeParse(options);
 if(!parsed.success)throw new PiggyError('INVALID_ARGUMENT','Hotel search requires destination and valid check-in/check-out dates, with check-out later than check-in; sort supports price_asc or price_desc.');
 const input=parsed.data;
 if(input.hotelName&&input.keyWords)throw new PiggyError('INVALID_ARGUMENT','Use either hotel-name or key-words, not both.');
 const city=await resolveCity(input.destName,client);
 let response=await fetchHotels(input,city,client);
 let selectedBrands:z.infer<typeof brandSchema>[]=[];
 if(marriott){
  const requested=input.hotelBrands?.split(',').map(value=>value.trim());
  if(requested?.some(label=>!marriottLabels.has(label)))throw new PiggyError('INVALID_ARGUMENT','hotel-brands must use verified Marriott portfolio Chinese facet labels; see docs/hotel-evidence.md.');
  selectedBrands=response.allHotelBrands.filter(brand=>marriottLabels.has(brand.text)&&(!requested||requested.includes(brand.text)));
  if(!selectedBrands.length||requested?.some(label=>!selectedBrands.some(brand=>brand.text===label)))throw new PiggyError('CAPABILITY_UNVERIFIED','The requested Marriott brand facet is not available in the official destination response.');
  response=await fetchHotels(input,city,client,selectedBrands.map(brand=>brand.value));
 }
 let items=response.hotelList.map(hotel=>{
  // The actual mainland renderer displays priceDesp when priceDespStyle is set.
  // priceDespStyle=0 is a message (e.g. no price), not a zero-cost offer.
  const price=hotel.priceDespStyle===0?null:/^\d+(\.\d+)?$/.test(hotel.priceDesp)?Number(hotel.priceDesp):undefined;
  if(price===undefined)throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official domestic hotel displayed price is no longer numeric.');
  const link=new URL('https://hotel.fliggy.com/hotel_detail2.htm');
  link.search=new URLSearchParams({shid:String(hotel.shid),city:city.city,checkIn:input.checkInDate,checkOut:input.checkOutDate}).toString();
  return {id:String(hotel.shid),title:hotel.name,address:hotel.address,price:price===null?null:String(price),currency:'CNY',priceScope:'hotel-search-starting-price',taxIncluded:null,availability:null,starLabel:hotel.level.desc,rating:hotel.rateScore||null,detailUrl:link.href};
 });
 if(input.maxPrice)items=items.filter(item=>item.price!==null&&Number(item.price)<=Number(input.maxPrice));
 if(input.limit)items=items.slice(0,Number(input.limit));
 return {verification:'live-logged-in-http',scope:marriott?'mainland-hotels-official-marriott-brand-facets':'mainland-domestic-hotel-search',itemList:items,
  query:{cityCode:city.city,cityName:response.query.cityName,checkInDate:input.checkInDate,checkOutDate:input.checkOutDate,occupancy:{rooms:Number(response.query.roomNum),adults:response.query.aNum_1,children:response.query.cNum_1}},
  ...(marriott?{selectedBrands}:{}),
  coverage:{page:response.query.currentPage,totalPages:response.query.totalPage,totalMatches:response.total,exhaustive:false},
  warnings:[
   'Starting search prices only; nightly/stay-total basis, taxes, room conditions and bookability require the official detail page.',
   'One official result page; max-price and limit filter only this page, not all destination inventory.',
   'Only mainland domestic hotel results and price sorting have been verified; no bed, star, hotel-type, POI or distance/rating-sort filters.',
   ...(marriott?['Marriott scope is the listed official Fliggy brand facets, not guaranteed complete worldwide Marriott portfolio or member offers.']:[]),
  ]};
}
export function searchHotel(options:Record<string,string|undefined>,client:WebClient):Promise<unknown>{return search(options,client,false);}
export function searchMarriottHotel(options:Record<string,string|undefined>,client:WebClient):Promise<unknown>{return search(options,client,true);}
