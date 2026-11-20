# Website endpoint evidence

Reviewed 2026-11-20. Publicly served website interfaces are not supported/stable developer APIs. Only successful pure-HTTP results count as implemented; finding a URL or registering a command does not count. Login and queries use only open-piggy's independent, user-authorized session. No private cookie/header values or full authenticated captures are retained in this repository.

## Verified HTTP behavior

### Login

- Browser: `https://login.taobao.com/member/login.jhtml?redirectURL=https%3A%2F%2Fwww.fliggy.com%2F`.
- HTTP status: GET `https://sijipiao.fliggy.com/ie/isLogin.htm` returns parenthesized JSON `{error:0,data:{login:0|1}}`.
- Real user QR login and redirect completed 2026-11-20; saved session subsequently returned `login:1` through pure HTTP, with no browser running for the query.
- Playwright only reads its own context's official-domain cookies, never the user's existing browser profile. MTop uses its own bootstrap tokens. Session cookies are not published.

### International flights (partial)

Source scripts under `https://g.alicdn.com/trip/iflight-search/1.10.94/`:

- `global/conf/index-min.js`: URLs and request parameters.
- `mods/main/index-min.js`: journey/selection construction.
- `widgets/loader/index-min.js`: continuation polling (`isContinue`, `iesToken`, `queryRecordId`, `count`, `delayForNextPoll`).
- `mods/agent/index-min.js`: lowest-agent `searchMode=2`; premium GDS `3` not implemented.
- `global/util/juicer-fn-min.js`: money renderer divides integer values by 100; journey duration is minutes.

GET `https://sijipiao.fliggy.com/ie/flight_search_result.htm` resolves route fields from returned configuration without executing scripts. Query: `depCity`, `arrCity`, `depDate`, optional `arrDate`, `tripType` (`0` single / `1` return).

GET `https://sijipiao.fliggy.com/ie/flight_search_result_poller.do`:
`supportMultiTrip`, `searchBy`, `childPassengerNum`, `infantPassengerNum`, `searchJourney` JSON, `tripType`, `searchCabinType`, `agentId`, `controller`, `searchMode`, `b2g`, `formNo`, `cardId`, `needMemberPrice`, `callback`. Modes `0` departure, `1` return after selecting departure, `2` quotes after selecting both. `selectedFlights` is constructed from actual returned segments, never invented identifiers.

Business success is `status:200`, flight candidates under `data.flightItems[].flightInfo[]`, seller quotes under `data.productItems[]`. Parser strips session/query identifiers from output. `totalAdultPrice`, `adultTax` are integer cents. Tax inclusion follows the page's nonnegative `adultTax` branch. Negative tax sentinel remains unknown. Cabin filtering uses actual `cabinInfo` names.

Live own-session HTTP acceptance: SHA–LAX 2027-02-04 / 2027-02-12, AC026+AC554 / AC551+AC025. Durations 906 / 1000 minutes. Quote data returned real sellers and multiple cabin classes, prompting tested cents conversion and explicit cabin filtering. Historical quotes are not current offers. Lowest-agent tab only; candidate selection is bounded and explicitly nonexhaustive. Baggage, fare brand and protected-connection conditions remain unverified. Full fixed-date and filter parity is not claimed.

### Direct trains (partial)

Sources:

- `https://g.alicdn.com/trip/h5-train-main/1.33.29/pages/list/index.entry.js`
- `https://g.alicdn.com/trip/h5-train-main/1.33.29/h5-train-main-commons.entry.js`

GET `https://h5api.m.taobao.com/h5/mtop.trip.train.station2stationsearch2/1.0/`; public website app key `12574478`. Data: `depLocation`, `arrLocation`, `depDate`, `sceneType:0`, `passengerType:0`. Normal MTop session protocol signs the site's own session token + timestamp + public app key + JSON data with MD5. Missing-token bootstrap is attempted once; no device/captcha algorithm is reproduced.

Success: `ret` includes `SUCCESS`, result data includes matching date and train list. Prices are cents; the official renderer divides by 100. Live anonymous fresh-cookie-jar request Shanghai–Beijing 2027-02-04 returned 55 schedules, including G532: 347 minutes, second class starting price CNY576. `bookable:0` and future `preSellDateStr` are preserved, not interpreted as available tickets. CLI live acceptance matched these fields.

Supported subset: direct one-way, number/seat/price/duration filters and sorting. No round trips, transfer search, date ranges or hour-window filters.

### Popular attractions (partial)

Source: `https://g.alicdn.com/qua-mod/ticket-channel-productlist/0.0.11/index.js`.

GET `https://s.alitrip.com/scenic/ajax/HotScenicByDest.htm?num=10&format=json&q=<city>` returns `{code:200,data:[{name,price,scenicId,...}]}`. Live Shanghai query returned 10 recommendations (Disney reference starting price CNY549). Booking link from source: `https://s.fliggy.com/scenic/detail.htm?sid=<scenicId>`.

No dated availability, grade/category or keyword filters. Prices are starting prices; currency CNY follows the consumer site's presentation, tax unknown.

## Remaining blocks

- Hotels: own-session GET `https://hotel.fliggy.com/hotel_list3.htm?city=310100&cityName=上海&checkIn=2026-12-01&checkOut=2026-12-02` returned server-rendered hotel detail links, but later requests encountered official verification. Exact normalized result parsing and accepted filters are not yet verified. Do not continue around the challenge.
- City suggestions: `https://hotel.alitrip.com/ajax/CitySuggest.do?t=0&q=上海&callback=openPiggy` returned real `cityCode:310100` with own session. This alone is not hotel search.
- Keyword search (HTTP verified, partial): GET `https://travelsearch.fliggy.com/async/queryItemResult.do?searchType=product&keyword=<query>&pagenum=<page>`, declared in the public search script's `requestRemoteData`. Business success requires nested `success:true`. Actual items under `data.data.itemProducts.data.list[].auctions[].fields`; page metadata under `itemPagenum`. Title uses `title || name`, price uses `discountPrice || price`, zero/absent price is unknown. Own-session query 上海 returned real product titles and prices, with validated requested query/page. `--page` requests one actual page and `--limit` only limits local output; no exhaustive inventory, dated price, availability or brand claims. Titles are stripped of markup and links are constrained to official HTTPS hosts.
- Marriott hotel / package: no verified dedicated inventory/filter contract found in the bounded inspected resources.
- AI search: no verified corresponding consumer-web natural-language endpoint found; no external model substitute.

Homepage evidence: `https://g.alicdn.com/trip/rc-pc-home/1.1.28/index.js`. Keyword script: `https://travelsearch.fliggy.com/assets/index/index.js?t=1730169098172`. Hotel scripts: `https://g.alicdn.com/trip/hotel-search/0.5.24/config-min.js`, `deps-min.js`.

## Release gate

A feature-aligned stable release requires all eight categories to pass live HTTP and website comparison. This repository only publishes a clearly marked prerelease while any category or required filter remains blocked. CLI reports unsupported options and schema drift with nonzero exit codes instead of silently dropping constraints.
