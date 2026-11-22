import { z } from 'zod';
import { PiggyError } from './errors.js';

const pair = z.object({departure:z.iso.date(), returnDeparture:z.iso.date().optional()});
const quote = pair.extend({
  roundTripPrice:z.number().nonnegative(), taxIncluded:z.boolean().nullable().optional()
});
const snapshot = z.object({
  currency:z.literal('CNY'), quotes:z.array(quote),
  coverage:z.array(pair.extend({status:z.string()}))
});
type Snapshot = z.infer<typeof snapshot>;

const dates = z.object({depDate:z.iso.date(),backDate:z.iso.date().optional()});
const live = z.object({
  itemList:z.array(z.object({queryDates:dates,ticketPrice:z.number().nonnegative(),
    currency:z.literal('CNY'),taxIncluded:z.boolean().nullable()})),
  coverage:z.object({queries:z.array(z.object({dates}))})
});

export function liveFlightTable(data:unknown):string {
  const {itemList,coverage}=live.parse(data);
  return table({
    currency:'CNY',
    coverage:coverage.queries.map(({dates:d})=>({departure:d.depDate,returnDeparture:d.backDate,status:'no_match'})),
    quotes:itemList.map(({queryDates:d,ticketPrice,taxIncluded})=>({
      departure:d.depDate,returnDeparture:d.backDate,roundTripPrice:ticketPrice,taxIncluded
    }))
  });
}

export function savedFlightTable(raw:unknown):string {
  const parsed=snapshot.safeParse(raw);
  if(parsed.success)return table(parsed.data);
  const envelope=z.object({status:z.literal(0),data:live}).safeParse(raw);
  if(envelope.success)return liveFlightTable(envelope.data.data);
  throw new PiggyError('INVALID_ARGUMENT','Expected successful search-flight JSON or a dated coverage and quotes snapshot.');
}

function table(data:Snapshot):string {
  const key=(dep:string,ret:string)=>dep+'/'+ret;
  const cells=new Map<string,string>();
  const options=new Map<string,z.infer<typeof quote>>();
  const departures=new Set<string>(),returns=new Set<string>();
  for(const row of data.coverage){
    const ret=row.returnDeparture ?? '单程';
    departures.add(row.departure);returns.add(ret);
    const status=row.status==='short'?'停留不足':row.status==='no_match'?'无匹配':'未核价';
    cells.set(key(row.departure,ret),status);
  }
  for(const q of data.quotes){
    const k=key(q.departure,q.returnDeparture ?? '单程');
    if(!cells.has(k))throw new PiggyError('INVALID_ARGUMENT','Quote dates missing from coverage.');
    const prev=options.get(k);
    if(!prev || q.roundTripPrice<prev.roundTripPrice ||
      (q.roundTripPrice===prev.roundTripPrice && q.taxIncluded))options.set(k,q);
  }
  for(const [k,q] of options){
    const qualifier=q.taxIncluded===true?'':q.taxIncluded===false?'（未含税）':'（税费未明）';
    cells.set(k,'¥'+q.roundTripPrice.toLocaleString('en-US')+qualifier);
  }
  const cols=[...returns].sort();
  const row=(values:string[])=>'| '+values.join(' | ')+' |';
  return ['每组日期已查到的最低报价（人民币，默认含税）','',
    row(['去程 ＼ 返程',...cols]),row(['---',...cols.map(()=> '---:')]),
    ...[...departures].sort().map(dep=>row([dep,...cols.map(ret=>cells.get(key(dep,ret)) ?? '未查询')]))
  ].join('\n');
}
