import { z } from 'zod';
import type { WebClient } from './http.js';
import { PiggyError } from './errors.js';
const schema=z.object({code:z.literal(200),data:z.array(z.object({name:z.string(),price:z.union([z.string(),z.number()]),scenicId:z.union([z.string(),z.number()]),pic_url:z.string().optional()}))});
export async function searchPoi(city:string,client:WebClient):Promise<unknown> {
 const url=new URL('https://s.alitrip.com/scenic/ajax/HotScenicByDest.htm');url.search=new URLSearchParams({num:'10',format:'json',q:city}).toString();
 const parsed=schema.safeParse(await client.json(url));
 if(!parsed.success)throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official popular-attraction response changed.');
 return {verification:'live-public-http',scope:'popular-attractions-by-city',itemList:parsed.data.data.map(p=>({title:p.name,price:String(p.price),currency:'CNY',priceScope:'starting-price',taxIncluded:null,availability:null,jumpUrl:`https://s.fliggy.com/scenic/detail.htm?sid=${encodeURIComponent(p.scenicId)}`})),warnings:['Popular recommendations only; no keyword, category, grade or dated ticket availability filtering.']};
}
