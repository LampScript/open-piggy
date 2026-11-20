import { createInterface } from 'node:readline/promises';
import { stdin, stderr } from 'node:process';
import { classifyBrowserLaunchError } from './browser-runtime.js';
import { PiggyError } from './errors.js';
import { trustedCookie, type Session } from './session.js';

export class FlightVerificationRequired extends PiggyError {
  constructor(readonly pageUrl: string, outcome: 'required' | 'retried' | 'cancelled') {
    super('VERIFICATION_REQUIRED', outcome === 'cancelled'
      ? '已取消人工验证，本次查票已停止。' : outcome === 'retried'
      ? '人工处理后查票仍需验证。请打开飞猪行程页查看，或稍后重试。'
      : '查票需要人工验证。请打开飞猪行程页处理，交互终端可在验证后重试。');
  }
}

export async function withFlightVerification<T>(
  page: URL, query: (session: Session) => Promise<T>, session: Session,
  verify?: (page: URL, session: Session) => Promise<Session>
): Promise<T> {
  try { return await query(session); }
  catch (error) {
    if (!(error instanceof PiggyError) || error.code !== 'VERIFICATION_REQUIRED') throw error;
    if (!verify) throw new FlightVerificationRequired(page.href, 'required');
  }
  const verified = await verify(page, session);
  try { return await query(verified); }
  catch (error) {
    if (!(error instanceof PiggyError) || error.code !== 'VERIFICATION_REQUIRED') throw error;
    throw new FlightVerificationRequired(page.href, 'retried');
  }
}

export async function verifyInBrowser(pageUrl: URL, session: Session): Promise<Session> {
  stderr.write(`飞猪要求人工验证。正在打开行程页：${pageUrl.href}\n`);
  const browser = await import('playwright')
    .then(({chromium}) => chromium.launch({headless:false}))
    .catch(error => { throw classifyBrowserLaunchError(error); });
  try {
    const context = await browser.newContext({storageState:{cookies:session.cookies, origins:[]}});
    const page = await context.newPage();
    const controller = new AbortController();
    page.once('close', () => controller.abort());
    browser.once('disconnected', () => controller.abort());
    await page.goto(pageUrl.href, {waitUntil:'commit'});
    const terminal = createInterface({input:stdin, output:stderr});
    terminal.once('SIGINT', () => controller.abort());
    try {
      await terminal.question('请在浏览器完成验证，确认可以查看行程后按回车重试。关闭窗口或 Ctrl+C 可取消。\n', {signal:controller.signal});
      return {...session, cookies:(await context.cookies()).filter(c => trustedCookie(c.domain))};
    } catch (error) {
      if (controller.signal.aborted) throw new FlightVerificationRequired(pageUrl.href, 'cancelled');
      throw error;
    } finally { terminal.close(); }
  } finally { await browser.close(); }
}
