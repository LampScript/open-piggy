import { load } from 'cheerio';
import { z } from 'zod';
import { PiggyError } from './errors.js';
import type { WebClient } from './http.js';
import { trustedHost } from './session.js';

// Public website source: travelsearch.fliggy.com/assets/index/index.js
// requestRemoteData -> /async/queryItemResult.do, GET with current query params.
const inputSchema = z.object({query:z.string().trim().min(1),page:z.string().regex(/^[1-9]\d*$/).optional(),limit:z.string().regex(/^[1-9]\d*$/).optional()});
const priceSchema = z.union([z.number().nonnegative(),z.string().regex(/^\d+(\.\d+)?$/)]).nullable().optional();
const fieldsSchema = z.object({
  title:z.string().nullable().optional(),name:z.string().nullable().optional(),
  price:priceSchema,discountPrice:priceSchema,pc_url:z.string().min(1),
  type:z.string().nullable().optional(),picUrl:z.string().nullable().optional(),
}).refine(fields=>Boolean(fields.title||fields.name));
const resultSchema=z.object({success:z.literal(true),data:z.object({
  success:z.literal(true),data:z.object({
    mainsearch:z.object({data:z.object({keyword:z.string(),searchType:z.literal('product')})}),
    itemProducts:z.object({data:z.object({list:z.array(z.object({
      docsFound:z.number().int().nonnegative(),has_more:z.boolean(),
      auctions:z.array(z.object({trip_main_busness_type:z.string(),fields:fieldsSchema})),
    }))})}),
    itemPagenum:z.object({data:z.object({count:z.number().int().nonnegative(),current:z.number().int().positive()})}),
  }),
})});
function plainText(html:string):string {const $=load(html);$('script,style').remove();return $.text().trim();}
function officialLink(value:string):string {
  let url:URL;
  try{url=new URL(value,'https://travelsearch.fliggy.com/');}catch{throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official product link changed.');}
  if(url.protocol!=='https:'||!trustedHost(url.hostname))throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Product result contains a non-official HTTPS booking link.');
  return url.href;
}

export async function searchKeyword(options:Record<string,string|undefined>,client:WebClient):Promise<unknown>{
  const unsupported=Object.entries(options).filter(([key,value])=>value!==undefined&&!Object.hasOwn(inputSchema.shape,key));
  if(unsupported.length)throw new PiggyError('CAPABILITY_UNVERIFIED',`Keyword options are not verified: ${unsupported.map(([key])=>key).join(', ')}.`);
  const parsed=inputSchema.safeParse(options);
  if(!parsed.success)throw new PiggyError('INVALID_ARGUMENT','Keyword search requires query and positive integer page/limit values.');
  const input=parsed.data,page=Number(input.page||1);
  const url=new URL('https://travelsearch.fliggy.com/async/queryItemResult.do');
  url.search=new URLSearchParams({searchType:'product',keyword:input.query,pagenum:String(page)}).toString();
  const raw=await client.json(url);
  if(typeof raw==='object'&&raw!==null&&'success' in raw&&raw.success===false)throw new PiggyError('UPSTREAM_ERROR','Official keyword service rejected the query.');
  const result=resultSchema.safeParse(raw);
  if(!result.success)throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official keyword result schema changed.');
  const data=result.data.data.data;
  if(data.mainsearch.data.keyword!==input.query||data.itemPagenum.data.current!==page)throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Official keyword service returned a different query or page.');
  let items=data.itemProducts.data.list.flatMap(group=>group.auctions).map(({trip_main_busness_type,fields})=>{
    // The official renderer uses discountPrice || price and hides zero prices.
    const value=fields.discountPrice||fields.price;
    const numeric=value===undefined||value===null?0:Number(value);
    return {title:plainText(fields.title||fields.name!),price:numeric>0?String(numeric):null,currency:'CNY',priceScope:'starting-price',taxIncluded:null,availability:null,category:fields.type||trip_main_busness_type,jumpUrl:officialLink(fields.pc_url)};
  });
  if(input.limit)items=items.slice(0,Number(input.limit));
  return {verification:'live-logged-in-http',scope:'keyword-product-search',itemList:items,coverage:{page,pageCount:data.itemPagenum.data.count,exhaustive:false},warnings:[
    'Product starting prices are not dated inventory or guaranteed booking totals; zero/absent website prices are reported as unknown.',
    'One requested website page only; a limited output does not cover all matches.',
    'Keyword matching is not AI search or proof that a hotel belongs to a particular brand.',
  ]};
}
