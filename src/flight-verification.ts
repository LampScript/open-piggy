import { createInterface } from 'node:readline/promises';
import { stdin, stderr } from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { reuseFlightTab } from './flight-tab.js';
import { PiggyError } from './errors.js';

export class FlightVerificationRequired extends PiggyError {
  constructor(readonly pageUrl: string, outcome: 'required' | 'retried' | 'cancelled', context?:PiggyError['context']) {
    super('VERIFICATION_REQUIRED', outcome === 'cancelled'
      ? '已取消人工验证，本次查票已停止。' : outcome === 'retried'
      ? '人工处理后查票仍需验证。请打开飞猪行程页查看，或稍后重试。'
      : '查票需要人工验证。请打开飞猪行程页处理，交互终端可在验证后重试。',context);
  }
}

export async function withFlightVerification<T>(
  page: URL, query: () => Promise<T>,
  verify?: (page: URL) => Promise<void>
): Promise<T> {
  try { return await query(); }
  catch (error) {
    if (!(error instanceof PiggyError) || error.code !== 'VERIFICATION_REQUIRED') throw error;
    if (!verify) throw new FlightVerificationRequired(page.href, 'required',error.context);
  }
  await verify(page);
  try { return await query(); }
  catch (error) {
    if (!(error instanceof PiggyError) || error.code !== 'VERIFICATION_REQUIRED') throw error;
    throw new FlightVerificationRequired(page.href, 'retried',error.context);
  }
}

export async function verifyInBrowser(pageUrl: URL): Promise<void> {
  stderr.write(`请在系统默认浏览器中查看飞猪行程：${pageUrl.href}\n`);
  const launch = promisify(execFile);
  try {
    const reused = await reuseFlightTab(pageUrl);
    if (reused === 'absent') await launch('open',[pageUrl.href]);
    else if (reused === 'unsupported') {
      stderr.write('请在现有浏览器标签页打开上方行程链接。\n');
    }
  } catch {
    stderr.write('无法自动打开默认浏览器，请手动打开上方链接。\n');
  }
  const terminal = createInterface({input:stdin, output:stderr});
  const controller = new AbortController();
  terminal.once('SIGINT', () => controller.abort());
  terminal.once('close', () => controller.abort());
  try {
    await terminal.question('完成网页验证后按回车，用 CLI 自己的会话重试一次。Ctrl+C 可取消。\n', {signal:controller.signal});
  } catch (error) {
    if (controller.signal.aborted) throw new FlightVerificationRequired(pageUrl.href, 'cancelled');
    throw error;
  } finally { terminal.close(); }
}
