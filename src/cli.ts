#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { CookieJar } from 'tough-cookie';
import { z } from 'zod';
import { authLogin, authLogout, authStatus } from './auth.js';
import { PiggyError, exitCode } from './errors.js';
import { createClient, loggedIn } from './http.js';
import { jarFromSession, loadSession } from './session.js';
import { searchFlight, type FlightOptions } from './flight.js';
import { searchPoi } from './poi.js';
import { searchKeyword } from './keyword.js';
import { searchTrain } from './train.js';
export const capabilities = [
 {command:'search-flight',status:'experimental',evidence:'Fixed-date live own-session HTTP quotes verified; incomplete filters and fare rules remain preview limitations.'},
 {command:'search-train',status:'partial',evidence:'Direct station-to-station MTop search verified; unsupported filters fail explicitly.'},
 {command:'search-poi',status:'partial',evidence:'City popular-attraction recommendations verified over public HTTP.'},
 {command:'keyword-search',status:'partial',evidence:'Live own-session HTTP product search with explicit website pagination; starting prices only.'},
 ...['search-hotel','search-marriott-hotel','search-marriott-package','ai-search'].map(command=>({command,status:'blocked',evidence:'No corresponding pure-HTTP result query has been verified. See docs/endpoints.md.'}))
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
 if(o.backDate && String(o.backDate)<String(o.depDate))throw new PiggyError('INVALID_ARGUMENT','Return date must not precede departure date.');
 for(const key of ['totalDurationHour','maxPrice','limit'])if(o[key]!==undefined && (!/^\d+(\.\d+)?$/.test(String(o[key])) || Number(o[key])<=0))throw new PiggyError('INVALID_ARGUMENT',`${key} must be positive.`);
 if(o.limit!==undefined && (!Number.isInteger(Number(o.limit)) || Number(o.limit)>100))throw new PiggyError('INVALID_ARGUMENT','limit must be an integer from 1 through 100.');
}
function transport(command:Command):Command {
 return command.requiredOption('--origin <city>').option('--destination <city>').option('--dep-date <date>').option('--dep-date-start <date>').option('--dep-date-end <date>').option('--back-date <date>').option('--back-date-start <date>').option('--back-date-end <date>').option('--journey-type <1|2>').option('--seat-class-name <name>').option('--transport-no <numbers>').option('--transfer-city <city>').option('--dep-hour-start <hour>').option('--dep-hour-end <hour>').option('--arr-hour-start <hour>').option('--arr-hour-end <hour>').option('--total-duration-hour <hours>').option('--max-price <cny>').option('--sort-type <sort>');
}
const program=new Command().name('open-piggy').description('Independent Fliggy website HTTP CLI — preview; run capabilities for honest coverage.').version('0.1.0-preview.1').exitOverride().configureOutput({outputError:()=>{}});
program.command('capabilities').description('Show verified capabilities and release blockers').action(()=>output({stableReady:false,capabilities}));
const auth=program.command('auth').description('Official QR login; browser is used only here');
auth.command('login').action(async()=>output(await authLogin()));auth.command('status').action(async()=>output(await authStatus()));auth.command('logout').action(async()=>output(await authLogout()));
transport(program.command('search-flight').description('Experimental fixed-date flight queries using official web polling')).option('--limit <number>','Candidates examined per direction; coverage is explicit').option('--experimental','Allow statically derived, not yet live-accepted flight parser').action(async o=>{
 supported(o,['origin','destination','depDate','backDate','transportNo','totalDurationHour','journeyType','sortType','limit','maxPrice','seatClassName','experimental']);dates(o);
 if(!o.destination || !o.depDate)throw new PiggyError('INVALID_ARGUMENT','Fixed destination and --dep-date are required in this preview.');
 if(o.journeyType && !['1','2'].includes(o.journeyType))throw new PiggyError('INVALID_ARGUMENT','journey-type must be 1 or 2.');
 if(o.sortType && !['1','3'].includes(o.sortType))throw new PiggyError('CAPABILITY_UNVERIFIED','Only price sort 1 and 3 have been implemented for flight quotes.');
 if(!o.experimental)throw new PiggyError('CAPABILITY_UNVERIFIED','Flight query is experimental pending live logged-in acceptance. Pass --experimental to explicitly test it.');
 const client=createClient(await jarFromSession(await loadSession()));if(!await loggedIn(client))throw new PiggyError('LOGIN_REQUIRED','Official session expired; run auth login.');
 output(await searchFlight(o as FlightOptions,client));
});
transport(program.command('search-train').description('Verified direct train search; may return future presale schedules')).option('--limit <number>','Limit returned trains after filtering').action(async o=>{
 supported(o,['origin','destination','depDate','journeyType','seatClassName','transportNo','totalDurationHour','sortType','maxPrice','limit']);dates(o);
 if(!o.destination || !o.depDate)throw new PiggyError('INVALID_ARGUMENT','--destination and --dep-date are required.');
 const jar=new CookieJar();output(await searchTrain(o,createClient(jar),jar));
});
program.command('search-poi').description('Verified popular attractions by city; no dated ticket inventory').requiredOption('--city-name <city>').option('--keyword <text>').option('--poi-level <level>').option('--category <category>').action(async o=>{
 supported(o,['cityName']);output(await searchPoi(o.cityName,createClient(new CookieJar())));
});
for(const name of ['search-hotel','search-marriott-hotel']) {
 const cmd=program.command(name).description('BLOCKED: unverified website result interface').requiredOption('--dest-name <destination>').option('--key-words <text>').option('--poi-name <name>').option('--check-in-date <date>').option('--check-out-date <date>').option('--hotel-bed-types <beds>').option('--max-price <cny>').option('--sort <order>');
 if(name==='search-hotel')cmd.option('--hotel-types <types>').option('--hotel-stars <stars>');else cmd.option('--hotel-brands <brands>').option('--hotel-name <name>');
 cmd.action(()=>blocked(name));
}
program.command('search-marriott-package').description('BLOCKED: unverified website result interface').requiredOption('--keyword <text>').option('--sort-type <price_asc|price_desc>').action(()=>blocked('search-marriott-package'));
program.command('keyword-search').description('Verified paginated product keyword search').requiredOption('--query <text>').option('--page <number>').option('--limit <number>').action(async o=>{
 const client=createClient(await jarFromSession(await loadSession()));if(!await loggedIn(client))throw new PiggyError('LOGIN_REQUIRED','Official session expired; run auth login.');
 output(await searchKeyword(o,client));
});
for(const name of ['ai-search'])program.command(name).description('BLOCKED: unverified website result interface').requiredOption('--query <text>').action(()=>blocked(name));
try { await program.parseAsync(); }
catch(e) {
 if(e instanceof CommanderError && e.exitCode===0)process.exitCode=0;
 else {
  const error=e instanceof PiggyError?e:e instanceof CommanderError?new PiggyError('INVALID_ARGUMENT',e.message):new PiggyError('UPSTREAM_ERROR','Unexpected error; no response or credentials have been logged.');
  console.error(error.message);console.log(JSON.stringify({status:1,error:{code:error.code,message:error.message}}));process.exitCode=exitCode(error.code);
 }
}
