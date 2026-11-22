import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { PiggyError } from './errors.js';

export async function reuseFlightTab(page:URL):Promise<'matched'|'navigated'|'absent'|'unsupported'> {
  if(process.platform!=='darwin') return 'unsupported';
  const script=fileURLToPath(new URL('../native/reuse-flight-tab.js',import.meta.url));
  let stdout:string;
  try {
    ({stdout}=await promisify(execFile)('/usr/bin/osascript',['-l','JavaScript',script,page.href],{timeout:10000}));
  } catch {
    throw new PiggyError('PAGE_NOT_READY','无法控制默认浏览器。请在已有飞猪标签页打开该行程。',{stage:'browser'});
  }
  const result=stdout.trim();
  if(result==='matched'||result==='navigated'||result==='absent'||result==='unsupported')return result;
  throw new Error('Unexpected default browser tab result.');
}
