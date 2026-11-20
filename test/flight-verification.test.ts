import test from 'node:test';
import assert from 'node:assert/strict';
import { PiggyError } from '../src/errors.js';
import { FlightVerificationRequired, withFlightVerification } from '../src/flight-verification.js';

const page = new URL('https://sijipiao.fliggy.com/ie/flight_search_result.htm?depDate=2027-02-04&arrDate=2027-02-12');
const challenge = new PiggyError('VERIFICATION_REQUIRED','challenge');

test('background run hands off the affected itinerary without retrying', async () => {
  await assert.rejects(withFlightVerification(page, async () => { throw challenge; }),
    error => error instanceof FlightVerificationRequired && error.pageUrl === page.href);
});
test('retries only after the user confirms the default-browser handoff', async () => {
  const steps: string[] = [];
  const result = await withFlightVerification(page, async () => {
    steps.push('query');
    if (steps.length === 1) throw challenge;
    return 42;
  }, async url => { assert.equal(url.href, page.href); steps.push('confirmed'); });
  assert.equal(result, 42);
  assert.deepEqual(steps, ['query','confirmed','query']);
});
test('persistent challenge stops after one handoff, unrelated failures propagate', async () => {
  let attempts = 0;
  await assert.rejects(withFlightVerification(page, async () => { attempts++; throw challenge; },
    async () => {}), FlightVerificationRequired);
  assert.equal(attempts, 2);
  const failure = new PiggyError('RATE_LIMITED','rate limit');
  await assert.rejects(withFlightVerification(page, async () => { throw failure; },
    async () => assert.fail('unexpected browser launch')), error => error === failure);
});
