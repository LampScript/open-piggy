import test from 'node:test';import assert from 'node:assert/strict';
import {planDates,searchDatePairs,sortTransport,withinHours} from '../src/transport.js';
test('expands departure and return calendar ranges and omits returns before departure',()=>{
 assert.deepEqual(planDates({depDateStart:'2027-02-03',depDateEnd:'2027-02-04',backDateStart:'2027-02-03',backDateEnd:'2027-02-05'}),[{depDate:'2027-02-03',backDate:'2027-02-03'},{depDate:'2027-02-03',backDate:'2027-02-04'},{depDate:'2027-02-03',backDate:'2027-02-05'},{depDate:'2027-02-04',backDate:'2027-02-04'},{depDate:'2027-02-04',backDate:'2027-02-05'}]);
});
test('dates reject ambiguity, missing endpoints, impossible dates and explicit query-budget overflow before network',()=>{
 for(const o of [{depDate:'2027-02-04',depDateStart:'2027-02-01'}, {depDateStart:'2027-02-01'}, {depDate:'2027-02-30'}, {depDateStart:'2027-02-01',depDateEnd:'2027-02-03',maxDatePairs:'2'}])assert.throws(()=>planDates(o));
});
test('date-pair orchestration preserves per-query dates and globally sorts real quotes',async()=>{
 const options={depDateStart:'2027-02-03',depDateEnd:'2027-02-04',sortType:'3'};let calls=0;
 const result=await searchDatePairs(options,planDates(options),async o=>{calls++;assert.equal(o.depDateStart,undefined);return {itemList:[{ticketPrice:o.depDate==='2027-02-03'?7000:6000}]};});
 assert.equal(calls,2);assert.equal(result.itemList[0]!.ticketPrice,6000);assert.deepEqual(result.itemList[0]!.queryDates,{depDate:'2027-02-04'});
});
test('a failed date query is not silently skipped and presented as complete coverage',async()=>{
 let calls=0;await assert.rejects(searchDatePairs({},[{depDate:'2027-02-03'},{depDate:'2027-02-04'}],async()=>{calls++;if(calls===2)throw Error('verification');return {itemList:[]};}),/verification/);
});
test('local hour buckets and whole-trip duration/departure/direct sorting match declared semantics',()=>{
 assert.equal(withinHours('2027-02-04 23:59:00','23','23'),true);assert.equal(withinHours('2027-02-04 00:00:00','1'),false);
 const direct={ticketPrice:600,journeys:[{totalDuration:200,depDateTime:'2027-02-04 10:00:00',journeyType:'直达',segments:[{}]}]};const transfer={ticketPrice:500,journeys:[{totalDuration:300,depDateTime:'2027-02-04 09:00:00',journeyType:'中转',segments:[{},{}]}]};
 assert.equal(sortTransport([transfer,direct],'8')[0],direct);assert.equal(sortTransport([transfer,direct],'4')[0],direct);assert.equal(sortTransport([transfer,direct],'6')[0],transfer);
});
test('huge mistaken ranges stop at the date-pair budget without building the Cartesian product',()=>{
 assert.throws(()=>planDates({depDateStart:'2000-01-01',depDateEnd:'9999-12-31',backDateStart:'2000-01-01',backDateEnd:'9999-12-31',maxDatePairs:'2'}),/exceeds max-date-pairs=2/);
});

test('baseline and flexible results reuse one query and budget slot per distinct round trip', async()=>{
 const options={depDateStart:'2027-02-02',depDateEnd:'2027-02-06',backDateStart:'2027-02-10',backDateEnd:'2027-02-14',baselinePair:'2027-02-04,2027-02-12',maxDatePairs:'25'};
 const calls:string[]=[];
 const result=await searchDatePairs(options,planDates(options),async fixed=>{
  assert.equal(fixed.baselinePair,undefined);
  calls.push([fixed.depDate,fixed.backDate].join(','));
  return {itemList:[{ticketPrice:42}]};
 });
 assert.equal(calls[0],options.baselinePair);
 assert.equal(calls.length,25);
 assert.equal(new Set(calls).size,25);
 assert.equal(result.itemList.length,25);
 assert.throws(()=>planDates({...options,baselinePair:'2027-02-01,2027-02-12'}),/exceeds/);
 assert.equal(planDates({...options,baselinePair:'2027-02-01,2027-02-12',maxDatePairs:'26'}).length,26);
});
