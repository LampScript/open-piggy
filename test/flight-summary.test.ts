import test from 'node:test';
import assert from 'node:assert/strict';
import {liveFlightTable,savedFlightTable} from '../src/flight-summary.js';

test('table preserves incomplete coverage, distinguishes short stays and collapses sellers',()=>{
 const a={departure:'2027-02-02',returnDeparture:'2027-02-10'};
 const report=savedFlightTable({currency:'CNY',coverage:[{...a,status:'quoted'},
  {...a,departure:'2027-02-03',status:'short'},{...a,returnDeparture:'2027-02-11',status:'PAGE_NOT_READY'}],
  quotes:[{...a,roundTripPrice:6010,taxIncluded:true},{...a,roundTripPrice:5996,taxIncluded:null}]});
 assert.match(report,/¥5,996（税费未明） \| 未核价/);
 assert.match(report,/停留不足 \| 未查询/);
 assert.doesNotMatch(report,/6,010/);
});
test('successful single-direction CLI output can be rendered from memory or disk',()=>{
 const dates={depDate:'2027-02-02'};
 const result={itemList:[],coverage:{queries:[{dates}]}};
 const table=liveFlightTable(result);
 assert.match(table,/单程/);
 assert.match(table,/无匹配/);
 assert.equal(savedFlightTable({status:0,data:result}),table);
 assert.throws(()=>savedFlightTable({status:1,error:{}}));
});
