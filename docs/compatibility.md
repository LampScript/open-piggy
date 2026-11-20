# FlyAI command compatibility

This is the compatibility target for **open-piggy**, not a declaration that every command works. Command registration, a generated booking URL, or a successful browser search alone does not establish a working pure-HTTP query.

Reviewed on 2026-11-20 against the official [FlyAI skill repository](https://github.com/alibaba-flyai/flyai-skill/tree/7a05a82fa0bda1c92e86230b07d375ed56ea90cb), commit `7a05a82fa0bda1c92e86230b07d375ed56ea90cb`. The upstream repository provides skill documentation; its advertised CLI uses FlyAI MCP. Open-piggy implements its own website-backed transport and does not use that service or its credentials.

## Coverage gate

| Command | Required documented argument | Pure-HTTP live verification |
| --- | --- | --- |
| `search-flight` | `--origin` | Partial: live quotes, sequential date ranges, eight sort modes, hour/city filters and exact segment selection; fare rules pending |
| `search-train` | `--origin` | Partial: direct schedules, ranges, hour filters and independent return ticket sums; no transfer inventory |
| `search-hotel` | `--dest-name` | Partial: mainland dated queries, price sorting, city resolution, page and keyword verified |
| `search-poi` | `--city-name` | Partial: city popular recommendations verified, not full POI filtering |
| `search-marriott-hotel` | `--dest-name` | Partial: mainland official brand-facet filtering verified; not full global portfolio |
| `search-marriott-package` | `--keyword` | Not yet verified |
| `keyword-search` | `--query` | Partial: own-session HTTP product search and website pagination verified; starting prices only |
| `ai-search` | `--query` | Not yet verified |

A preview may expose an unavailable command with an explicit failure. It must not return fabricated data, unrelated search results, or a generic booking-page URL as a successful query. The feature-aligned stable release is gated on all eight categories passing live verification. Website endpoints and per-command evidence are tracked in [endpoints.md](endpoints.md).

## Transport searches

The documented flag names below apply to both `search-flight` and `search-train`, unless noted. Only `--origin` is documented as required upstream; the website's actual requirements must be reported explicitly if stricter.

| Flag | Documented meaning / values |
| --- | --- |
| `--origin` | Departure city, airport, or train station |
| `--destination` | Arrival city, airport, or train station |
| `--dep-date` | Departure date, `YYYY-MM-DD` |
| `--dep-date-start`, `--dep-date-end` | Departure date interval |
| `--back-date` | Return date |
| `--back-date-start`, `--back-date-end` | Return date interval |
| `--journey-type` | `1` direct; `2` connecting / transit |
| `--seat-class-name` | Cabin name for flights; comma-separated seat names for trains |
| `--transport-no` | Flight number or comma-separated train numbers |
| `--transfer-city` | Connection city; train docs explicitly permit comma-separated cities |
| `--dep-hour-start`, `--dep-hour-end` | Departure-hour interval, 24-hour clock |
| `--arr-hour-start`, `--arr-hour-end` | Arrival-hour interval, 24-hour clock |
| `--total-duration-hour` | Maximum itinerary duration in hours |
| `--max-price` | Price ceiling in CNY |
| `--sort-type` | Numeric ordering listed below |

Transport sorting: `1` price descending; `2` recommended; `3` price ascending; `4` duration ascending; `5` duration descending; `6` departure ascending; `7` departure descending; `8` direct first.

Train seat-name examples from upstream: `second class`, `first class`, `business class`, `hard sleeper`, `soft sleeper`. Do not silently translate an unsupported seat or cabin into a different one.

Sources: [flight reference](https://github.com/alibaba-flyai/flyai-skill/blob/7a05a82fa0bda1c92e86230b07d375ed56ea90cb/skills/flyai/references/search-flight.md), [train reference](https://github.com/alibaba-flyai/flyai-skill/blob/7a05a82fa0bda1c92e86230b07d375ed56ea90cb/skills/flyai/references/search-train.md).

## Hotel searches

| Flag | `search-hotel` | `search-marriott-hotel` |
| --- | --- | --- |
| `--dest-name` | Required destination | Required destination |
| `--key-words` | Keywords | Keywords |
| `--poi-name` | Nearby POI | Nearby POI |
| `--check-in-date`, `--check-out-date` | `YYYY-MM-DD` | `YYYY-MM-DD` |
| `--hotel-bed-types` | Comma-separated `大床房`, `双床房`, `多床房` | Same values |
| `--max-price` | Nightly CNY ceiling | Nightly CNY ceiling |
| `--sort` | `distance_asc`, `rate_desc`, `price_asc`, `price_desc`, `no_rank` | Same values |
| `--hotel-types` | `酒店`, `民宿`, `客栈` | Not documented |
| `--hotel-stars` | Comma-separated ratings, 1–5 | Not documented |
| `--hotel-brands` | Not documented | Comma-separated Marriott brands |
| `--hotel-name` | Not documented | Exact or fuzzy hotel name |

The destination is documented as a country, province, city, or district. This is a target capability, not proof that the website accepts all such labels without resolution.

Sources: [hotel reference](https://github.com/alibaba-flyai/flyai-skill/blob/7a05a82fa0bda1c92e86230b07d375ed56ea90cb/skills/flyai/references/search-hotel.md), [Marriott hotel reference](https://github.com/alibaba-flyai/flyai-skill/blob/7a05a82fa0bda1c92e86230b07d375ed56ea90cb/skills/flyai/references/search-marriott-hotel.md).

## POI searches

`search-poi` takes required `--city-name`, optional `--keyword`, `--poi-level` (1–5), and single-valued `--category`.

The documented category vocabulary is:

`自然风光`, `山湖田园`, `森林丛林`, `峡谷瀑布`, `沙滩海岛`, `沙漠草原`, `人文古迹`, `古镇古村`, `历史古迹`, `园林花园`, `宗教场所`, `公园乐园`, `主题乐园`, `水上乐园`, `影视基地`, `动物园`, `植物园`, `海洋馆`, `体育场馆`, `演出赛事`, `剧院剧场`, `博物馆`, `纪念馆`, `展览馆`, `地标建筑`, `市集`, `文创街区`, `城市观光`, `户外活动`, `滑雪`, `漂流`, `冲浪`, `潜水`, `露营`, `温泉`.

Source: [POI reference](https://github.com/alibaba-flyai/flyai-skill/blob/7a05a82fa0bda1c92e86230b07d375ed56ea90cb/skills/flyai/references/search-poi.md).

## Package and natural-language searches

- `search-marriott-package`: required `--keyword`; optional `--sort-type` accepts **strings** `price_asc` or `price_desc`. A keyword identifies one dimension (province, city, brand, hotel name, or selling point). This sort flag must not reuse the numeric transport-sort parser.
- `keyword-search`: required `--query`, a keyword or natural-language travel search.
- `ai-search`: required `--query`, a natural-language travel request. Support requires a real corresponding Fliggy website capability; there is no third-party model integration or keyword-search substitution.

Sources: [package reference](https://github.com/alibaba-flyai/flyai-skill/blob/7a05a82fa0bda1c92e86230b07d375ed56ea90cb/skills/flyai/references/search-marriott-package.md), [keyword reference](https://github.com/alibaba-flyai/flyai-skill/blob/7a05a82fa0bda1c92e86230b07d375ed56ea90cb/skills/flyai/references/keyword-search.md), [AI reference](https://github.com/alibaba-flyai/flyai-skill/blob/7a05a82fa0bda1c92e86230b07d375ed56ea90cb/skills/flyai/references/ai-search.md).

## Deliberate behavior differences

- `open-piggy` is the executable name; it does not replace or impersonate `flyai`.
- Login is handled by `auth login`, `auth status`, and `auth logout`. Queries use only the tool's own saved website session over HTTP. No FlyAI API key or MCP endpoint is required.
- Success is one JSON line with `status: 0`. A website business failure is a nonzero process exit, even when its HTTP response was 200.
- No fake ten-result cap is introduced. Report the website's real pagination/coverage and whether the results are complete.
- Unknown tax inclusion, currency, baggage allowance, fare brand, and connection protection remain unknown. Do not derive them from an airline's general policy.
- The flight time limit is evaluated for each direction, including transfer waiting time. A range result is not a promise to cover every date or all date combinations.

## Upstream discrepancies to avoid copying

- In official CLI 1.0.16, `search-marriott-hotel --help` lacks the documented `--hotel-brands` and `--hotel-name` flags. A maintainer linked a pending fix. Open-piggy targets the documented intent but may only call a filter supported by observed website behavior; it must not silently ignore these arguments. [Issue #67](https://github.com/alibaba-flyai/flyai-skill/issues/67).
- Official flight examples use `adultPrice`, while reported live output uses `ticketPrice`; examples are not a reliable wire schema. [Issue #65](https://github.com/alibaba-flyai/flyai-skill/issues/65).
- The upstream ten-result policy was confirmed by a maintainer; date-range search is a selection of candidates rather than exhaustive coverage. [Issue #54](https://github.com/alibaba-flyai/flyai-skill/issues/54).
- `status: 1` with process exit 0 has been reported for routes for which the website has results. Open-piggy must distinguish transport success from business success. [Issue #74](https://github.com/alibaba-flyai/flyai-skill/issues/74).
