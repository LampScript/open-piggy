import test from 'node:test';
import assert from 'node:assert/strict';
import { PiggyError } from '../src/errors.js';
import { FlightVerificationRequired, withFlightVerification } from '../src/flight-verification.js';
import { type Session } from '../src/session.js';

const page = new URL('https://sijipiao.fliggy.com/ie/flight_search_result.htm?depDate=2027-02-04&arrDate=2027-02-12');
const session: Session = {version:1, savedAt:new Date().toISOString(), cookies:[]};
const challenge = new PiggyError('VERIFICATION_REQUIRED','challenge');

test('background run hands off the affected itinerary without retrying', async () => {
  await assert.rejects(withFlightVerification(page, async () => { throw challenge; }, session),
    error => error instanceof FlightVerificationRequired && error.pageUrl === page.href);
});
test('only a human-confirmed session is used for the second attempt', async () => {
  const confirmed = {...session};
  const result = await withFlightVerification(page, async current => {
    if (current === session) throw challenge;
    assert.equal(current, confirmed);
    return 42;
  }, session, async url => { assert.equal(url.href, page.href); return confirmed; });
  assert.equal(result, 42);
});
test('persistent challenge stops after one handoff, unrelated failures propagate', async () => {
  let attempts = 0;
  await assert.rejects(withFlightVerification(page, async () => { attempts++; throw challenge; },
    session, async () => session), FlightVerificationRequired);
  assert.equal(attempts, 2);
  const failure = new PiggyError('RATE_LIMITED','rate limit');
  await assert.rejects(withFlightVerification(page, async () => { throw failure; }, session,
    async () => assert.fail('unexpected browser launch')), error => error === failure);
});
