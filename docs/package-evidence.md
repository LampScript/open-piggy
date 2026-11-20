# Dated Marriott hotel package associations

Verified 2026-11-20. This capability uses only open-piggy's independently saved official QR-login session and ordinary HTTPS requests. No browser query, identity change, copied Chrome cookies, or challenge bypass is used. No raw authenticated responses or personal session fields are retained.

## Source evidence

Public first-party code:

- https://g.alicdn.com/trip/hotel-search/0.5.24/mods/result-body/index-min.js
- https://g.alicdn.com/trip/hotel-search/0.5.24/widgets/host/index-min.js
- https://g.alicdn.com/trip/hotel-search/0.5.24/widgets/global/index-min.js

The result-body module declares `q = B + "/ajax/hotel_tuan_info.json"`, where `B = host.url("tuan")`. The host/global modules resolve this to `https://tuan.fliggy.com` on the consumer Fliggy site. Its `getMealData` invokes JSONP GET with:

```text
shids = e.shids.join(",")
checkin = e.query.checkIn
checkout = e.query.checkOut
onlyTripSeller = "tbsearch" != e.searchBy
```

The renderer tests `code == 200` and consumes `result[]`. The same source constructs the official package detail URL with `itemid`, `shid`, and `tripSeller`.

## Implemented request

First, `searchMarriottHotel` resolves the requested mainland city and official Marriott brand facet IDs as described in [hotel evidence](hotel-evidence.md). It queries one real result page; package candidates are only those returned hotel IDs, not generic keyword-search products or hotel-title matches.

```text
GET https://tuan.fliggy.com/ajax/hotel_tuan_info.json
  ?shids=<comma-separated verified Marriott hotel IDs>
  &checkin=YYYY-MM-DD&checkout=YYYY-MM-DD
  &onlyTripSeller=true&callback=openPiggy
```

Response fields parsed at the HTTP boundary:

```json
{
  "code": 200,
  "result": [{
    "isTuan": 1,
    "itemId": 714644884499,
    "shid": 53998029,
    "rp": "780/晚"
  }]
}
```

This is a real observed public product response, not an invented fixture. It refers to 上海康桥万豪酒店 for 2026-12-01 to 2026-12-02. The module requires every response hotel ID to belong to the already verified hotel candidates and accepts only `isTuan:1` as a package association.

Official detail URL:

```text
https://tuan.fliggy.com/detail.htm?itemid=<itemId>&shid=<shid>&tripSeller=true
```

`rp` is preserved verbatim as `displayPrice`. Only a strictly positive exact numeric `number/晚` display is additionally parsed as a per-night starting price. Other display formats and zero prices yield `price:null`, never a fabricated free offer or a guessed total. Currency CNY follows this domestic consumer UI. Taxes, bundle contents, final stay/package total, current bookability, loyalty points and membership benefits remain unverified.

## Preview command semantics

`searchMarriottPackage(options, client)` accepts:

- Required `keyword`, `checkInDate`, `checkOutDate`.
- Optional `provinceOrCity`, `hotelName`, `hotelBrands`, `sortType`, `page`, `limit`.
- Without `provinceOrCity`, `keyword` means a mainland domestic city/name/code (resolved by the existing official city lookup). A brand or selling-point keyword alone is not silently converted into a place.
- With `provinceOrCity`, that field selects the city. A differing `keyword` becomes the hotel keyword; if it repeats the city, no hotel keyword is added.
- An explicit `hotelName` may replace the identical hotel keyword, or accompany a city keyword. Conflicting independent keyword/name values fail instead of dropping one.
- `hotelBrands` uses exact official facet labels documented in [hotel evidence](hotel-evidence.md).
- `sortType` accepts `price_asc` or `price_desc`; only observed numeric per-night prices are sorted numerically, unknown prices last. `limit` applies after package lookup/sorting, not before selecting the hotel page.
- `page` selects the source hotel result page. Coverage explicitly reports hotel page, total hotel pages/matches, hotels queried and `exhaustive:false`.

Example:

```bash
open-piggy search-marriott-package --keyword 上海 \
  --check-in-date 2026-12-01 --check-out-date 2026-12-02 \
  --hotel-brands 万豪 --sort-type price_asc
```

This is a verified dated hotel-to-package lookup for a bounded mainland Marriott portfolio subset. It does **not** establish the official FlyAI command's entire province/brand/hotel/selling-point keyword catalogue, worldwide packages, flexible dates, member inventory or final package pricing. Stable feature-alignment remains gated on those missing dimensions.
