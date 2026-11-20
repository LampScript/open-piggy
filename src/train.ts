import { createHash } from 'node:crypto';
import { CookieJar } from 'tough-cookie';
import { z } from 'zod';
import { PiggyError } from './errors.js';
import type { WebClient } from './http.js';

// Observed in the public h5-train-main/1.33.29/pages/list/index.entry.js.
// The companion commons bundle declares this normal MTop gateway and app key.
// This is the website's session request protocol, not its device/captcha code.
const endpoint = 'https://h5api.m.taobao.com/h5/mtop.trip.train.station2stationsearch2/1.0/';
const api = 'mtop.trip.train.station2stationsearch2';
const appKey = '12574478';
const inputSchema = z.object({
  origin: z.string().trim().min(1),
  destination: z.string().trim().min(1),
  depDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  transportNo: z.string().optional(),
  seatClassName: z.string().optional(),
  totalDurationHour: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  maxPrice: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  sortType: z.enum(['1','2','3','4','5','6','7','8']).optional(),
  limit: z.string().regex(/^[1-9]\d*$/).optional(),
  journeyType: z.literal('1').optional(),
});
const envelopeSchema = z.object({
  api: z.literal(api),
  v: z.literal('1.0'),
  ret: z.array(z.string()).min(1),
  data: z.record(z.string(), z.unknown()),
});

const seatSchema = z.object({
  price: z.number().int().nonnegative(), seatName: z.string(),
  seatType: z.number().int(), stock: z.number().int(),
});
const trainSchema = z.object({
  trainNo: z.string(), departStation: z.string(), arriveStation: z.string(),
  depTimeFull: z.string(), arrTimeFull: z.string(),
  costTimeInt: z.number().int().nonnegative(), price: z.number().int().nonnegative(),
  bookable: z.union([z.literal(0), z.literal(1)]),
  preSellDateStr: z.string().optional(), seatTypes: z.array(seatSchema),
});
const resultSchema = z.object({ depDate: z.string(), trains: z.array(trainSchema) });
const supportedOptions = new Set(Object.keys(inputSchema.shape));

async function sessionToken(jar: CookieJar): Promise<string | undefined> {
  const cookie = (await jar.getCookies(endpoint)).find(cookie => cookie.key === '_m_h5_tk');
  return cookie?.value.split('_')[0] || undefined;
}

function requestUrl(data: string, token: string | undefined): URL {
  const url = new URL(endpoint);
  const timestamp = String(Date.now());
  const params: Record<string, string> = {
    jsv: '2.4.12', appKey, t: timestamp, api, v: '1.0',
    type: 'originaljson', dataType: 'json', data,
  };
  if (token) {
    params.sign = createHash('md5').update(`${token}&${timestamp}&${appKey}&${data}`).digest('hex');
  }
  url.search = new URLSearchParams(params).toString();
  return url;
}

function parseEnvelope(value: unknown): z.infer<typeof envelopeSchema> {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new PiggyError('UPSTREAM_SCHEMA_CHANGED', 'Official train response envelope changed.');
  }
  return parsed.data;
}

function throwResponseError(codes: string[]): never {
  // Match only specific protocol errors; never expose response text, tokens,
  // request URLs or upstream diagnostic payloads in public error output.
  if (codes.some(code => /TOKEN_EXPIRED|TOKEN_EMPTY|SESSION_EXPIRED|SESSION_INVALID|ILLEGAL_ACCESS/.test(code))) {
    throw new PiggyError('LOGIN_REQUIRED', 'Official train session is missing or expired; run auth login.');
  }
  if (codes.some(code => /USER_VALIDATE|RGV587|CAPTCHA|VALIDATE|CREEP/.test(code))) {
    throw new PiggyError('VERIFICATION_REQUIRED', 'Official train service requires user verification through auth login.');
  }
  if (codes.some(code => /FLOW_LIMIT|TRAFFIC_LIMIT|FREQUENCY|RATE_LIMIT/.test(code))) {
    throw new PiggyError('RATE_LIMITED', 'Official train service rate limit reached; retry later.');
  }
  throw new PiggyError('UPSTREAM_ERROR', 'Official train service rejected the query.');
}

export async function searchTrain(
  options: Record<string, string | undefined>,
  client: WebClient,
  jar: CookieJar,
): Promise<unknown> {
  const unsupported = Object.entries(options).filter(([key, value]) => value !== undefined && !supportedOptions.has(key));
  if (unsupported.length) {
    throw new PiggyError('CAPABILITY_UNVERIFIED', `Train options are not verified: ${unsupported.map(([key]) => key).join(', ')}.`);
  }
  const input = inputSchema.safeParse(options);
  if (!input.success) {
    throw new PiggyError('INVALID_ARGUMENT', 'Train search requires origin, destination and dep-date (YYYY-MM-DD).');
  }
  const data = JSON.stringify({
    depLocation: input.data.origin,
    arrLocation: input.data.destination,
    depDate: input.data.depDate,
    sceneType: 0,
    passengerType: 0,
  });
  let token = await sessionToken(jar);
  let response = parseEnvelope(await client.json(requestUrl(data, token)));
  const codes = () => response.ret.map(value => value.split('::')[0]!);

  // An anonymous request may obtain this tool's own MTop cookie through
  // WebClient's Set-Cookie handling. Bootstrap once, only for TOKEN_EMPTY.
  if (!token && codes().includes('FAIL_SYS_TOKEN_EMPTY')) {
    token = await sessionToken(jar);
    if (!token) throwResponseError(codes());
    response = parseEnvelope(await client.json(requestUrl(data, token)));
  }
  if (!codes().includes('SUCCESS')) throwResponseError(codes());

  const parsed = resultSchema.safeParse(response.data);
  if (!parsed.success || parsed.data.depDate !== input.data.depDate) {
    throw new PiggyError('UPSTREAM_SCHEMA_CHANGED', 'Official train result schema or requested date changed.');
  }
  const wantedTrains = input.data.transportNo?.split(',').map(value => value.trim().toUpperCase());
  const englishSeats: Record<string, string> = {
    'second class': '二等座', 'first class': '一等座', 'business class': '商务座',
    'hard sleeper': '硬卧', 'soft sleeper': '软卧',
  };
  const wantedSeats = input.data.seatClassName?.split(',').map(value => englishSeats[value.trim()] ?? value.trim());
  let trains = parsed.data.trains.filter(train =>
    (!wantedTrains || wantedTrains.includes(train.trainNo.toUpperCase())) &&
    (!input.data.totalDurationHour || train.costTimeInt < Number(input.data.totalDurationHour) * 60),
  ).map(train => {
    const seats = train.seatTypes.filter(seat => !wantedSeats || wantedSeats.includes(seat.seatName));
    // Official list renderer displays props.price / 100 as 元起.
    const price = wantedSeats ? (seats.length ? Math.min(...seats.map(seat => seat.price)) / 100 : null) : train.price / 100;
    return {
      trainNo: train.trainNo, depStationName: train.departStation, arrStationName: train.arriveStation,
      depDateTime: train.depTimeFull, arrDateTime: train.arrTimeFull,
      totalDuration: train.costTimeInt, ticketPrice: price, currency: 'CNY',
      priceScope: 'one-way-starting-price', taxIncluded: null,
      bookable: train.bookable === 1, preSaleDateTime: train.preSellDateStr || null,
      seats: seats.map(seat => ({ name: seat.seatName, price: seat.price / 100, stockCode: seat.stock })),
      jumpUrl: 'https://market.m.taobao.com/app/trip/h5-train-main/pages/list/index.html?' + new URLSearchParams({
        depCity: input.data.origin, arrCity: input.data.destination, depDate: input.data.depDate,
      }).toString(),
    };
  }).filter(train => train.ticketPrice !== null &&
    (!input.data.maxPrice || train.ticketPrice <= Number(input.data.maxPrice)));
  const sort = input.data.sortType;
  if (sort === '1' || sort === '3') trains.sort((a, b) => (sort === '1' ? -1 : 1) * (a.ticketPrice! - b.ticketPrice!));
  if (sort === '4' || sort === '5') trains.sort((a, b) => (sort === '5' ? -1 : 1) * (a.totalDuration - b.totalDuration));
  if (sort === '6' || sort === '7') trains.sort((a, b) => (sort === '7' ? -1 : 1) * a.depDateTime.localeCompare(b.depDateTime));
  if (input.data.limit) trains = trains.slice(0, Number(input.data.limit));
  return {
    verification: 'live-public-http', scope: 'one-way-direct-trains', itemList: trains,
    warnings: [
      'Schedule and starting prices only: bookable=false and future presale dates do not establish currently purchasable tickets.',
      'Seat stockCode is the upstream value, not a promised number of available seats.',
      'No transfer, round-trip, date-range or departure-hour filtering; unsupported options fail explicitly.',
      'The booking link opens the official route list, not a guaranteed reservation.',
    ],
  };
}
