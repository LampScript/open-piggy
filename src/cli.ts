#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { liveFlightTable, savedFlightTable } from './flight-summary.js';
import { Command, CommanderError } from 'commander';
import { CookieJar } from 'tough-cookie';
import { z } from 'zod';
import { authLogout, authStatus } from './auth.js';
import {startLogin,waitForLoginReady,readTask,activeId,cancelTask,cancelActive} from './login-task.js';
import {shouldWaitForLogin,watchLoginTask} from './login-terminal.js';
import {browserDoctor,installBrowser} from './browser-runtime.js';
import { PiggyError, exitCode } from './errors.js';
import { createClient, loggedIn } from './http.js';
import { jarFromSession, loadSession } from './session.js';
import { resumeFlightPage } from './flight-page.js';
import { FlightVerificationRequired, verifyInBrowser, withFlightVerification } from './flight-verification.js';
import { flightUrl, searchFlight, type FlightOptions } from './flight.js';
import { searchPoi } from './poi.js';
import { searchKeyword } from './keyword.js';
import { searchHotel,searchMarriottHotel } from './hotel.js';
import { searchMarriottPackage } from './marriott-package.js';
import { searchTrainJourney } from './train-query.js';
import {planDates,searchDatePairs,type TransportOptions} from './transport.js';
export const capabilities = [
 {command:'search-flight',status:'partial',evidence:'Live HTTP flights, date-pair ranges, all sort orders, hour/transfer filters and exact segment matching; fare rules remain incomplete.'},
 {command:'search-train',status:'partial',evidence:'Direct trains with date ranges, independent return tickets and hour filters; transfer inventory remains unverified.'},
 {command:'search-poi',status:'partial',evidence:'City popular-attraction recommendations verified over public HTTP.'},
 {command:'keyword-search',status:'partial',evidence:'Live own-session HTTP product search with explicit website pagination; starting prices only.'},
 {command:'search-hotel',status:'partial',evidence:'Mainland dated hotel results, actual city resolution, price sorting and pagination verified.'},
 {command:'search-marriott-hotel',status:'partial',evidence:'Marriott portfolio filters use dynamically resolved official brand facets; mainland destinations only.'},
 {command:'search-marriott-package',status:'partial',evidence:'Dated package associations for officially brand-filtered mainland hotels; not global or arbitrary-keyword catalogue parity.'},
 ...['ai-search'].map(command=>({command,status:'blocked',evidence:'No corresponding pure-HTTP result query has been verified. See docs/endpoints.md.'}))
];
function output(data: unknown) { console.log(JSON.stringify({status:0,message:'success',data})); }
function blocked(command:string):never { throw new PiggyError('CAPABILITY_UNVERIFIED',`${command} is not implemented: no verified website HTTP result contract. This preview is not feature-aligned with FlyAI.`); }
function supported(options:Record<string,unknown>,keys:string[]):void {
 const unsupported=Object.keys(options).filter(k=>options[k]!==undefined && !keys.includes(k));
 if(unsupported.length)throw new PiggyError('CAPABILITY_UNVERIFIED',`Unsupported in this preview: ${unsupported.join(', ')}. No filters have been silently ignored.`);
}
const date=z.iso.date();
function dates(o:Record<string,unknown>):void {
 for(const key of ['depDate','backDate'])if(o[key]!==undefined && !date.safeParse(o[key]).success)throw new PiggyError('INVALID_ARGUMENT',`${key} must be a real YYYY-MM-DD date.`);
 if(o.backDate && o.depDate && String(o.backDate)<String(o.depDate))throw new PiggyError('INVALID_ARGUMENT','Return date must not precede departure date.');
 for(const key of ['totalDurationHour','maxPrice','limit'])if(o[key]!==undefined && (!/^\d+(\.\d+)?$/.test(String(o[key])) || Number(o[key])<=0))throw new PiggyError('INVALID_ARGUMENT',`${key} must be positive.`);
 if(o.limit!==undefined && (!Number.isInteger(Number(o.limit)) || Number(o.limit)>100))throw new PiggyError('INVALID_ARGUMENT','limit must be an integer from 1 through 100.');
}
function transport(command:Command):Command {
 return command.requiredOption('--origin <city>').option('--destination <city>').option('--dep-date <date>').option('--dep-date-start <date>').option('--dep-date-end <date>').option('--back-date <date>').option('--back-date-start <date>').option('--back-date-end <date>').option('--journey-type <1|2>').option('--seat-class-name <name>').option('--transport-no <numbers>').option('--transfer-city <city>').option('--dep-hour-start <hour>').option('--dep-hour-end <hour>').option('--arr-hour-start <hour>').option('--arr-hour-end <hour>').option('--total-duration-hour <hours>').option('--max-price <cny>').option('--sort-type <sort>').option('--max-date-pairs <number>','Sequential date-pair request budget (default 49)');
}
let plainAuthUrl=false;
const program=new Command().name('open-piggy').description('Independent Fliggy website HTTP CLI — preview; run capabilities for honest coverage.').version('0.1.0-preview.8').exitOverride().configureOutput({outputError:()=>{}});
program.command('capabilities').description('Show verified capabilities and release blockers').action(()=>output({stableReady:false,capabilities}));
const browser=program.command('browser').description('Install and diagnose the matching login browser without opening any website');
browser.command('install').action(async()=>output(await installBrowser()));
browser.command('doctor').action(async()=>{const report=await browserDoctor();if(report.ready){output(report);return;}console.log(JSON.stringify({status:1,error:report.error,data:report}));process.exitCode=exitCode(report.error?.code??'UPSTREAM_ERROR');});
const auth=program.command('auth').description('Manage the official login session');
auth.command('login').description('Scan official QR in terminals; use --detach for background Agent tasks').option('--qr','Print QR and wait for login in interactive terminals').option('--url','Print the same-host private QR handoff URL; does not transfer cookies').option('--plain','With --url: print only the handoff URL on stdout (no JSON)').option('--browser','Run a tracked visible-browser task for manual official verification').option('--wait','Print QR on stderr and wait for authentication, including non-TTY shells').option('--detach','Return task JSON without foreground waiting (Agent mode)').action(async o=>{
 plainAuthUrl=Boolean(o.plain);
 if([o.qr,o.url,o.browser].filter(Boolean).length>1)throw new PiggyError('INVALID_ARGUMENT','Choose only one of --qr, --url or --browser.');
 if(o.plain&&(!o.url||o.wait))throw new PiggyError('INVALID_ARGUMENT','--plain requires --url and cannot be combined with --wait.');
 const foreground=shouldWaitForLogin(o,Boolean(process.stderr.isTTY));
 if(o.browser)await cancelActive();
 const started=await startLogin(undefined,undefined,o.browser?'browser':'qr');
 let task;
 let interrupted=false;
 if(foreground){
  const controller=new AbortController();const onInterrupt=()=>{interrupted=true;controller.abort();};process.once('SIGINT',onInterrupt);
  try{task=await watchLoginTask(started.loginId,{signal:controller.signal,showUrl:Boolean(o.url)});}finally{process.removeListener('SIGINT',onInterrupt);}
 }else task=await waitForLoginReady(started.loginId,undefined,o.url?60000:15000,o.url||o.browser?'url':'qr');
 const data={...task,statusCommand:`open-piggy auth status --login-id ${task.loginId}`,cancelCommand:`open-piggy auth cancel --login-id ${task.loginId}`,validation:'New browser provider is offline-tested; live acceptance is pending',warnings:['expiresAt is the task deadline, not the official QR expiry; qrExpiresAt is unknown.','QR images and handoff links are transient authentication data; do not publish them.']};
 if(interrupted){output(data);process.exitCode=130;return;}
 if(task.state==='failed'||task.state==='verification_required'||task.state==='expired'||task.state==='cancelled'){if(o.plain)console.error(task.error?.message??'Login task did not authenticate.');else console.log(JSON.stringify({status:1,error:task.error??{code:'LOGIN_REQUIRED',message:'Login task did not authenticate.'},data}));process.exitCode=task.error?.code.startsWith('BROWSER_')?7:task.state==='verification_required'?4:1;return;}
 if(o.url&&!foreground&&task.state==='pending'){
  if(!task.handoffUrl)throw new PiggyError('UPSTREAM_ERROR','The same-host browser login handoff is not ready; no usable login URL was produced.');
  if(o.plain){console.log(task.handoffUrl);return;}
  console.error(`Private same-host login URL: ${task.handoffUrl}`);
 }
 if(o.plain){console.error('Login already completed; no handoff URL is needed.');return;}
 output(data);
});
auth.command('status').option('--login-id <id>','Read a login task without browser or network').option('--pending','Read the active login task').action(async o=>{
 if(o.loginId&&o.pending)throw new PiggyError('INVALID_ARGUMENT','Use either login-id or pending.');
 if(o.loginId){output(await readTask(o.loginId));return;}
 if(o.pending){const id=await activeId();output(id?await readTask(id):{state:'idle'});return;}
 output(await authStatus());
});
auth.command('cancel').requiredOption('--login-id <id>').action(async o=>output(await cancelTask(o.loginId)));
auth.command('logout').action(async()=>output(await authLogout()));
program.command('flight-summary <file>').description('Display a Markdown fare table from a saved query').action(async file=>{
 let raw:unknown;
 try { raw=JSON.parse(await readFile(file,'utf8')); }
 catch(e){if(e instanceof SyntaxError || (e as NodeJS.ErrnoException).code==='ENOENT')throw new PiggyError('INVALID_ARGUMENT','Provide an existing flight result JSON file.');throw e;}
 console.log(savedFlightTable(raw));
});
program.command('resume-flight').description('Read the verified itinerary in the default browser (macOS)').requiredOption('--url <url>').option('--outbound <index>','Select a displayed outbound row').option('--return <index>','Select a displayed return row').action(async o => output(await resumeFlightPage(o.url,o)));
transport(program.command('search-flight').description('Live HTTP flights with date ranges, journey filters and exact segment sequences')).option('--table','Print the Markdown fare table on stdout').option('--limit <number>','Candidates examined per direction; coverage is explicit').option('--baseline-pair <departure,return>','Query this round trip first and reuse it in the date range').option('--experimental','Compatibility flag; fixed-date HTTP flight transport has passed live acceptance').option('--outbound-flights <numbers>','Exact outbound segment sequence').option('--return-flights <numbers>','Exact return segment sequence').action(async o=>{
 supported(o,['table','origin','destination','depDate','backDate','transportNo','totalDurationHour','journeyType','sortType','limit','maxPrice','seatClassName','experimental','baselinePair','depDateStart','depDateEnd','backDateStart','backDateEnd','maxDatePairs','transferCity','depHourStart','depHourEnd','arrHourStart','arrHourEnd','outboundFlights','returnFlights']);dates(o);
 const pairs=planDates(o as TransportOptions);
 if(!o.destination)throw new PiggyError('INVALID_ARGUMENT','--destination is required.');
 if(o.returnFlights && !pairs.some(p=>p.backDate))throw new PiggyError('INVALID_ARGUMENT','--return-flights requires return dates.');
 if(o.journeyType && !['1','2'].includes(o.journeyType))throw new PiggyError('INVALID_ARGUMENT','journey-type must be 1 or 2.');

 const client = createClient(await jarFromSession(await loadSession()));
 let checkedLogin = false;
 const result=await searchDatePairs(o as TransportOptions, pairs, async fixed => {
  const flight = fixed as FlightOptions;
  return withFlightVerification(flightUrl(flight), async () => {
   if (!checkedLogin) {
    if (!await loggedIn(client)) throw new PiggyError('LOGIN_REQUIRED','Official session expired; run auth login.');
    checkedLogin = true;
   }
   return searchFlight(flight, client);
  }, process.stdin.isTTY && process.stderr.isTTY ? verifyInBrowser : undefined);
 });
 if(o.table) console.log(liveFlightTable(result));
 else { output(result); if(process.stdout.isTTY && process.stderr.isTTY) console.error(liveFlightTable(result)); }
});
transport(program.command('search-train').description('Verified direct train search; may return future presale schedules')).option('--limit <number>','Limit returned trains after filtering').action(async o=>{
 supported(o,['origin','destination','depDate','journeyType','seatClassName','transportNo','totalDurationHour','sortType','maxPrice','limit','depDateStart','depDateEnd','backDate','backDateStart','backDateEnd','maxDatePairs','depHourStart','depHourEnd','arrHourStart','arrHourEnd']);dates(o);
 const pairs=planDates(o as TransportOptions);
 if(!o.destination)throw new PiggyError('INVALID_ARGUMENT','--destination is required.');
 const jar=new CookieJar();const client=createClient(jar);const result=await searchDatePairs(o as TransportOptions,pairs,fixed=>searchTrainJourney(fixed,client,jar));if(o.limit)result.itemList=result.itemList.slice(0,Number(o.limit));output(result);
});
program.command('search-poi').description('Verified popular attractions by city; no dated ticket inventory').requiredOption('--city-name <city>').option('--keyword <text>').option('--poi-level <level>').option('--category <category>').action(async o=>{
 supported(o,['cityName']);output(await searchPoi(o.cityName,createClient(new CookieJar())));
});
for(const name of ['search-hotel','search-marriott-hotel']) {
 const cmd=program.command(name).description('Verified mainland dated hotel queries; unsupported filters fail explicitly').requiredOption('--dest-name <destination>').option('--key-words <text>').option('--poi-name <name>').option('--check-in-date <date>').option('--check-out-date <date>').option('--hotel-bed-types <beds>').option('--max-price <cny>').option('--sort <order>').option('--page <number>').option('--limit <number>');
 if(name==='search-hotel')cmd.option('--hotel-types <types>').option('--hotel-stars <stars>');else cmd.option('--hotel-brands <brands>').option('--hotel-name <name>');
 cmd.action(async o=>{const client=createClient(await jarFromSession(await loadSession()));if(!await loggedIn(client))throw new PiggyError('LOGIN_REQUIRED','Official session expired; run auth login.');output(await (name==='search-hotel'?searchHotel(o,client):searchMarriottHotel(o,client)));});
}
program.command('search-marriott-package').description('Dated package associations for verified mainland Marriott hotels').requiredOption('--keyword <text>').option('--hotel-name <name>').option('--province-or-city <place>').option('--hotel-brands <brands>').option('--check-in-date <date>').option('--check-out-date <date>').option('--page <number>').option('--limit <number>').option('--sort-type <price_asc|price_desc>').action(async o=>{const client=createClient(await jarFromSession(await loadSession()));if(!await loggedIn(client))throw new PiggyError('LOGIN_REQUIRED','Official session expired; run auth login.');output(await searchMarriottPackage(o,client));});
program.command('keyword-search').description('Verified paginated product keyword search').requiredOption('--query <text>').option('--page <number>').option('--limit <number>').action(async o=>{
 const client=createClient(await jarFromSession(await loadSession()));if(!await loggedIn(client))throw new PiggyError('LOGIN_REQUIRED','Official session expired; run auth login.');
 output(await searchKeyword(o,client));
});
for(const name of ['ai-search'])program.command(name).description('Verified mainland dated hotel queries; unsupported filters fail explicitly').requiredOption('--query <text>').action(()=>blocked(name));
try { await program.parseAsync(); }
catch(e) {
 if(e instanceof CommanderError && e.exitCode===0)process.exitCode=0;
 else {
  const error=e instanceof PiggyError?e:e instanceof CommanderError?new PiggyError('INVALID_ARGUMENT',e.message):new PiggyError('UPSTREAM_ERROR','Unexpected error; no response or credentials have been logged.');
  const handoff = error instanceof FlightVerificationRequired ? {action:'manual_verification',url:error.pageUrl,instructions:'请在默认浏览器完成验证，保留该行程标签页。回复好了后，调用 resumeArgs 读取网页报价。',resumeArgs:['resume-flight','--url',error.pageUrl]} : undefined;
  console.error(error.message);if(!plainAuthUrl)console.log(JSON.stringify({status:1,error:{code:error.code,message:error.message,...error.context,...(handoff ? {handoff} : {})}}));process.exitCode=exitCode(error.code);
 }
}
