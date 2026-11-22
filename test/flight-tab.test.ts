import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const script=readFileSync(new URL('../native/reuse-flight-tab.js',import.meta.url),'utf8');
const base='https://sijipiao.fliggy.com/ie/flight_search_result.htm?depCity=SHA&arrCity=LAX&tripType=1&depDate=2027-02-02&arrDate=2027-02-10';

function run(urls:string[]){
 const tabs=urls.map(url=>({url:()=>url}));
 const win={tabs:()=>tabs,activeTabIndex:0,index:0};
 const app={running:()=>true,windows:()=>[win],activate:()=>{}};
 const components=(s:string)=>{
  const u=new URL(s);
  const items=Array.from(u.searchParams,([name,value])=>({name,value}));
  return {URL:u,scheme:u.protocol.slice(0,-1),host:u.hostname,path:u.pathname,
   queryItems:{count:items.length,objectAtIndex:(i:number)=>items[i]}};
 };
 const result=runInNewContext(script+'\nrun([target])',{target:base, Application:()=>app,
  ObjC:{import:()=>{},unwrap:(s:unknown)=>s},$:{NSURLComponents:{componentsWithString:components},
  NSWorkspace:{sharedWorkspace:{URLForApplicationToOpenURL:()=>({})}},NSBundle:{bundleWithURL:()=>({bundleIdentifier:'com.google.Chrome'})}}});
 return {result,tabs,win};
}

test('an exact background tab wins over an earlier same-route tab without reloading',()=>{
 const {result,win,tabs}=run([base.replace('02-02','02-03'),base+'&foo=bar']);
 assert.equal(result,'matched');assert.equal(win.activeTabIndex,2);
 assert.equal(typeof tabs[1]!.url,'function');
});
test('different dates reuse a route tab, while unrelated pages stay untouched',()=>{
 const {result,tabs}=run(['https://example.com/',base.replace('02-02','02-03')]);
 assert.equal(result,'navigated');assert.equal(tabs[1]!.url,base);
 assert.equal(typeof tabs[0]!.url,'function');
 const absent=run([base.replace('LAX','SFO'),'https://sijipiao.fliggy.com/order']);
 assert.equal(absent.result,'absent');assert.equal(absent.win.activeTabIndex,0);
});
