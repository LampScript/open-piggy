import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { PiggyError } from './errors.js';
import { FlightVerificationRequired } from './flight-verification.js';

export function itineraryPage(input: string): URL {
  const url = URL.canParse(input) ? new URL(input) : undefined;
  if (!url || url.origin !== 'https://sijipiao.fliggy.com' || url.username || url.password ||
      url.pathname !== '/ie/flight_search_result.htm') {
    throw new PiggyError('INVALID_ARGUMENT','Use the official itinerary URL from the verification handoff.');
  }
  const clean = new URL(url.pathname, url.origin);
  const trip = url.searchParams.get('tripType');
  if (trip !== '0' && trip !== '1') throw new PiggyError('INVALID_ARGUMENT','Invalid trip type.');
  for (const key of ['depCity','arrCity','depDate','tripType',...(trip === '1' ? ['arrDate'] : [])]) {
    const value = url.searchParams.get(key);
    if (!value || (key.endsWith('Date') && !/^\d{4}-\d{2}-\d{2}$/.test(value)))
      throw new PiggyError('INVALID_ARGUMENT','Missing or invalid itinerary parameters.');
    clean.searchParams.set(key,value);
  }
  return clean;
}

export function parseFlightPage(raw: string) {
  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean);
  const heading = lines.findIndex(line => /^选择[去返]程[：:]/.test(line));
  if (heading < 0) return null;
  const stage = lines[heading]!.includes('返程') ? 'return' : 'outbound';
  const optionEnd = stage === 'return' ? '选为返程' : '选为去程';
  const options = [];
  let previous = heading;
  for (const [i,line] of lines.entries()) {
    if (line !== optionEnd) continue;
    const detail = lines.lastIndexOf('航班详情',i);
    if (detail <= previous) throw new PiggyError('UPSTREAM_SCHEMA_CHANGED','Flight option details changed.');
    const carrier = lines.slice(previous + 1,detail).reverse().find(label => /航空|国航|南航|东航|海航|川航|厦航|深航|航班号/.test(label) && !label.startsWith('等'));
    const details = lines.slice(detail + 1,i);
    const fare = details.join('\n').match(/(?:往返|单程)含税\n[￥¥]\n(\d+(?:\.\d+)?)(?:\n|$)/);
    options.push({index:options.length + 1, carrier:carrier ?? null, details, displayPriceCNY:fare ? Number(fare[1]) : null});
    previous = i;
  }
  const selected = (label: string) => {
    const start = lines.findIndex((line,i) => line === label && lines[i+1] === '已选定');
    const end = lines.indexOf('重选'+label+'航班',start);
    return start >= 0 && end > start ? lines.slice(start+2,end) : null;
  };
  const outbound = selected('去程'), inbound = selected('返程');
  // Seller offers are expanded below their selected return row.
  const offers = outbound && inbound ? [...lines.join('\n').matchAll(/去程\n([^\n]+舱)\n返程\n([^\n]+舱)\n[￥¥]\n(\d+(?:\.\d+)?)\n往返总价/g)]
    .map(m => ({outboundCabin:m[1],returnCabin:m[2],roundTripPrice:Number(m[3]),currency:'CNY'})) : [];
  return {stage, outbound, inbound, options, offers};
}

export async function resumeFlightPage(input: string, selection: {outbound?:string;return?:string}) {
  const page = itineraryPage(input);
  if (selection.outbound && selection.return) throw new PiggyError('INVALID_ARGUMENT','Select one direction at a time.');
  const index = selection.outbound ?? selection.return;
  if (index !== undefined && !/^[1-9]\d*$/.test(index)) throw new PiggyError('INVALID_ARGUMENT','Use a displayed option index.');
  if (process.platform !== 'darwin') throw new PiggyError('CAPABILITY_UNVERIFIED','Reading the default browser currently requires macOS.');
  const helper = fileURLToPath(new URL('../native/flight-page.swift',import.meta.url));
  const read = async (...args:string[]) => {
    try { return (await promisify(execFile)('/usr/bin/swift',[helper,page.href,...args],{timeout:30000,maxBuffer:4*1024*1024})).stdout; }
    catch (e) {
      const msg = (e as {stderr?:string}).stderr?.trim();
      if (msg === '请将对应日期的飞猪行程标签页切到前台。' || msg === '请在默认浏览器中打开飞猪行程。')
        throw new PiggyError('PAGE_NOT_READY',msg,{stage:'browser'});
      throw new PiggyError('UPSTREAM_ERROR', '读取默认浏览器失败。请检查 Swift 命令行工具和辅助功能权限。'+(msg?.startsWith('当前页面没有') ? msg : ''));
    }
  };
  if (index) await read(selection.outbound ? '选为去程' : '选为返程',index);
  for (let attempt=0; attempt<8; attempt++) {
    const raw = await read();
    if (/请完成(?:安全|滑块)?验证|请拖动滑块|请通过安全验证/.test(raw)) throw new FlightVerificationRequired(page.href,'required',{stage:'browser'});
    const state = parseFlightPage(raw);
    if (state && (state.options.length || state.offers.length) &&
        (!selection.outbound || state.outbound) && (!selection.return || state.offers.length)) {
      return {source:'default-browser',observedAt:new Date().toISOString(),url:page.href,...state};
    }
    if (!index) break;
    await delay(500);
  }
  throw new PiggyError('PAGE_NOT_READY','对应行程或报价尚未加载。',{stage:'browser'});
}
