# Mainland hotel HTTP evidence

Verified on 2026-11-20 using only open-piggy's independently saved official QR-login session and the existing HTTP client. No browser is started by these queries. No cookies, request headers, session identifiers, client IPs, or full authenticated payloads are retained in this document or emitted by the module.

## Public website sources

- Homepage search form: https://g.alicdn.com/trip/rc-pc-home/1.1.28/index.js . Declares domestic city suggestions and constructs the official hotel search URL using `city`, `cityName`, `checkIn`, `checkOut`, `keywords`.
- Module loading: https://g.alicdn.com/trip/hotel-search/0.5.24/config-min.js and https://g.alicdn.com/trip/hotel-search/0.5.24/deps-min.js . The latter declares the result-body and result-filter modules.
- Actual result transport and display: https://g.alicdn.com/trip/hotel-search/0.5.24/mods/result-body/index-min.js . Declares the hotel host plus `/ajax/hotelList.htm`; `getRemoteDataByQuery` performs a JSONP GET and accepts `code == 200`. `attachOrderEvent` sends `order` and `dir`; `attachPageEvent` sends `currentPage`. Domestic result markup displays `priceDesp` when `priceDespStyle` is set. It does not establish a final stay total or tax inclusion.
- Filters: https://g.alicdn.com/trip/hotel-search/0.5.24/mods/result-filter/index-min.js and https://g.alicdn.com/trip/hotel-search/0.5.24/mods/result-filter/filter-price-min.js . Brand IDs come from official filter metadata and are sent as `brands`; no hotel-title heuristic is needed.

## Implemented ordinary HTTP requests

City lookup:

```text
GET https://hotel.alitrip.com/ajax/CitySuggest.do?t=0&q=<destination>&callback=openPiggy
```

Observed `code: "200"`, `result[]` with `cityCode`, `displayName`, `level`. Mainland city `上海` resolves to `310100`. Ambiguous suggestions fail; numeric official city codes skip this lookup.

Hotel results:

```text
GET https://hotel.fliggy.com/ajax/hotelList.htm
  ?city=<official code>&cityName=<resolved name>
  &checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD
  &keywords=<optional keyword/name>&region=0&count=10
  &currentPage=<page>&order=DEFAULT|PRICE&dir=ASC|DESC
  &callback=openPiggy
```

Observed schema: `code:200`, `total`, `isOverseas`, `isGangAoTai`, `query`, `allHotelBrands`, `hotelList[]`. Selected non-private query fields are validated and returned, never the original query object. Each hotel exposes `shid`, `name`, `address`, `priceDesp`, `priceDespStyle`, `level`, `rateScore`, `status`, and `quota`.

`priceDesp` is already a display amount in yuan, not integer cents. For example, one actual result had `price:65200`, `priceDesp:"652"`; the module uses the observed domestic display field rather than guessing units from the raw price. A non-price message (`priceDespStyle:0`) becomes `price:null`.

Domestic results only. Tax inclusion, nightly-versus-entire-stay basis, room/bed configuration, cancellation rules and actual availability remain unverified and are not inferred from `status` or `quota`. Default actual response occupancy is one room, two adults, no children; the module returns the server's whitelisted occupancy fields rather than silently claiming a different party size.

## Live acceptance

For Shanghai, 2026-12-01 to 2026-12-02:

- City resolution succeeded.
- Generic result request succeeded with 10 returned hotels and official `total:22174` (not an exhaustive fetch).
- `order=PRICE&dir=ASC` was echoed by the server and displayed prices were ascending.
- `maxPrice=100` is intentionally a local post-filter of the requested page. The upstream accepted `highPrice=100` but also returned displayed prices above 100; the module does not trust that parameter as an enforced maximum.
- Implemented module returned two matching first-page offers at CNY42 and CNY93, clearly marked as starting search prices, not confirmed bookable totals.

Earlier hotel HTML navigation encountered an official challenge. No challenge was solved or bypassed. Later ordinary same-session requests to the source-declared result endpoint succeeded. Any future challenge propagates as `VERIFICATION_REQUIRED`; there is no alternate identity, IP, Chrome-cookie import, or browser-query fallback.

## Marriott portfolio subset

Portfolio membership reference: https://www.marriott.com/brands.mi . Actual Fliggy `allHotelBrands` contains explicit labels and opaque IDs. The module dynamically resolves the labels below from that metadata; it does not hardcode numeric IDs or match the word Marriott in hotel titles.

Verified label vocabulary: `万豪`, `JW万豪`, `喜来登`, `福朋喜来登`, `万丽`, `艾美`, `瑞吉`, `丽思卡尔顿`, `威斯汀`, `万豪行政公寓`, `W酒店`, `豪华精选`, `万豪万枫`, `雅乐轩`, `臻品之选酒店`, `德尔塔`.

`search-marriott-hotel` selects available official facets from this bounded vocabulary by default. Explicit `--hotel-brands` requires exact labels and fails if the official destination response does not contain one. This is a mainland portfolio subset, not guaranteed complete global Marriott coverage or Marriott member rates.

Real test `brands=22` (resolved from the official label `万豪`) returned `query.brands:"22"`, seven matching results, and these first three ascending display prices:

| Hotel | Starting display price CNY |
|---|---:|
| 上海中优城市万豪酒店 | 652 |
| 上海松江临云万豪酒店 | 815 |
| 上海康桥万豪酒店 | 840 |

The implemented `searchMarriottHotel` produced the same filtered results. It validates that the response preserves the selected brand IDs.

## Supported and unsupported options

Both functions take camelCase CLI options:

- Required: `destName`, `checkInDate`, `checkOutDate` (valid dates, check-out later).
- Supported: `keyWords`, `sort` (`price_asc`, `price_desc`), `maxPrice`, `page`, `limit`.
- Marriott adds `hotelBrands` (comma-separated exact labels) and `hotelName` (keyword-style name search); `hotelName` and `keyWords` are mutually exclusive.
- One page per call. `limit` and `maxPrice` only filter that page. Output always reports nonexhaustive coverage.
- Unsupported: overseas/Gang-Ao-Tai results, implicit dates, bed/type/star/POI filters, distance/rating sort. These fail explicitly rather than silently relaxing the request.
- Dates, city, requested page, price sort and brand filter are checked against official echoes. Schema changes fail; no default prices or fabricated inventory are emitted.
