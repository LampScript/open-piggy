# open-piggy 🐷

An independent, open-source CLI for publicly served Fliggy website interfaces. Queries use **HTTP only**. A browser is used only for official QR login and redirects, with a dedicated local session. No FlyAI MCP/API key, shared browser cookies, third-party AI model, order creation or payment.

**Preview, not a feature-complete replacement for FlyAI.** Six query categories now have live HTTP evidence: flights, trains, popular attractions, keyword products, mainland hotels and Marriott-brand hotels. Each still has explicit scope limits. Marriott packages and AI search remain blocked rather than faked. See [capabilities](docs/compatibility.md) and [endpoint evidence](docs/endpoints.md).

最新中文进度：[preview.2 对齐情况](docs/alignment-progress.zh-CN.md)。首版详细对比：[preview.1 与官方 CLI 的差异](docs/official-cli-diff.zh-CN.md)。

## Install

Node.js 22 or later. Download `open-piggy-0.1.0-preview.2.tgz` from [GitHub Releases](https://github.com/LampScript/open-piggy/releases), then:

```sh
npm install -g ./open-piggy-0.1.0-preview.2.tgz
open-piggy capabilities
```

Or build from source:

```sh
git clone https://github.com/LampScript/open-piggy.git
cd open-piggy
npm ci --registry=https://registry.npmjs.org
npm run build
node dist/cli.js capabilities
```

There is no npm registry release. The release tarball contains built JavaScript and declarations; dependencies are resolved during installation.

## Search without login

```sh
open-piggy search-poi --city-name 上海
open-piggy search-train --origin 上海 --destination 北京 --dep-date 2027-02-04
```

Attractions are popular recommendations with **starting prices**, not dated ticket inventory. Train schedules can be outside the ticket sales window: `bookable: false` means they are not currently purchasable; do not treat a scheduled train and a reference fare as available inventory.

## Official QR login

Chromium is only needed for login. In the source checkout:

```sh
npx playwright install chromium
node dist/cli.js auth login
node dist/cli.js auth status
node dist/cli.js keyword-search --query 上海 --limit 3
node dist/cli.js auth logout
```

For a global install, install Chromium using the Playwright version installed with open-piggy (see `npm ls -g playwright`); `npx --package playwright@<that-version> playwright install chromium` downloads the matching browser.

`auth login` opens Taobao's official login page and asks you to scan the official QR code. Complete verification yourself. After the official redirect to Fliggy, the CLI checks the official login-status endpoint, exports only its **own** browser context's official-site cookies, and verifies that they work with pure HTTP before saving. It closes and deletes its temporary browser profile afterward. It never reads your existing Chrome profile. Browser closure, timeout or failed HTTP verification does not save a new session.

Local state is `~/.config/open-piggy/session.json` (directory `0700`, file `0600` on POSIX). `OPEN_PIGGY_HOME` overrides this directory. `auth logout` removes this local session only; it does not log out other official browser sessions. Cookie-based access is sensitive: never commit or share this directory. Windows users should protect it with a private user-directory ACL.

## Flight queries

```sh
open-piggy search-flight \
  --origin SHA --destination LAX \
  --dep-date 2027-02-04 --back-date 2027-02-12 \
  --transport-no AC026,AC554,AC551,AC025 \
  --total-duration-hour 20 --sort-type 3 --limit 1
```

This implements the public page's route setup, flight-selection polling and lowest-agent quote polling. **Logged-in fixed-date flight HTTP acceptance passed; full feature parity is still pending.** The legacy `--experimental` flag remains accepted but is no longer mandatory. Partial feature coverage is exposed through capabilities and coverage metadata. Response schemas are checked; business failure, verification and schema drift fail explicitly. Unknown baggage, fare brand and connection protection stay `null`.

The duration ceiling is strict and evaluated separately for each direction, including waiting time using the website's journey duration. All eight sort modes are accepted: price, total itinerary duration, outbound departure, direct first, or provider order for recommended. Hour filters use inclusive local hour buckets; end=23 includes 23:59. Overnight windows need separate searches. Transfer-city filtering uses the returned city labels or IATA codes. `--outbound-flights` / `--return-flights` require an exact ordered segment sequence; legacy `--transport-no` stays a per-segment whitelist.

Date ranges are expanded into sequential fixed-date requests. Default date-pair request budget is49, adjustable with `--max-date-pairs`; there is no silent date sampling. Any failed pair fails the whole operation, rather than claiming complete coverage. `--limit` controls flight candidates examined per direction (default5), so complete date-pair coverage is not exhaustive fare coverage. Booking links preselect returned segments but do not lock a seller price.

```sh
open-piggy search-flight --origin SHA --destination LAX \
  --dep-date-start 2027-02-04 --dep-date-end 2027-02-05 --back-date 2027-02-12 \
  --outbound-flights AC026,AC554 --return-flights AC551,AC025 \
  --transfer-city 温哥华 --seat-class-name economy --total-duration-hour 20 --sort-type 3 --limit 1
```

Train date ranges and independent return-ticket combinations are also supported. Return sums are explicitly labeled `two-one-way-starting-price-sum`, never an official bundled round-trip fare. Impossible return-before-arrival combinations are excluded. Train transfers remain unsupported.

## Mainland hotels and Marriott brands

```sh
open-piggy search-hotel --dest-name 上海 --check-in-date 2026-12-01 --check-out-date 2026-12-02 --sort price_asc --limit 3
open-piggy search-marriott-hotel --dest-name 上海 --check-in-date 2026-12-01 --check-out-date 2026-12-02 --hotel-brands 万豪 --sort price_asc --limit 3
```

Destination resolution, stay dates, official page/price sorting, keywords, and local max-price filtering are supported for mainland destinations. Marriott filters use dynamically resolved official brand facets, not title matching or hardcoded brand IDs. Read [hotel evidence](docs/hotel-evidence.md) for the verified brand labels and actual occupancy. Taxes, bookability and nightly-versus-stay-total basis are unknown. Max-price filters one requested page only. Overseas, POI, hotel type, star, bed and rating/distance sort filters remain explicit unsupported capabilities.

## Command status

| Command | This preview |
|---|---|
| `search-flight` | Partial: live quotes, ranges, all sorts, hours, transfers and exact segment selection; fare rules incomplete |
| `search-train` | Partial: direct trains, ranges, hour filters and independent return ticket combinations; no transfers |
| `search-poi` | Partial: verified popular attractions by city |
| `search-hotel` | Partial: mainland dated hotel queries and limited filters |
| `search-marriott-hotel` | Partial: mainland hotels using verified official Marriott brand facets |
| `search-marriott-package` | Blocked: result API unverified |
| `keyword-search` | Partial: live paginated product keyword search; starting prices only |
| `ai-search` | Blocked: corresponding website capability unverified |

The eight names match the upstream documented command families; **registration is not support**. Unsupported filters exit with a clear error. The stable release gate requires all eight categories to have real HTTP results compared with the website, including supported filters and authentication.

## Output and failures

Success: one JSON line on stdout, `{ "status": 0, "message": "success", "data": ... }`.
Failure: one JSON line with `status: 1` and `error.code/message`; human-readable diagnostics on stderr.

| Exit | Meaning |
|---|---|
| 0 | Success or explicit help/version |
| 1 | Network, upstream business failure or changed response schema |
| 2 | Invalid argument |
| 3 | Login missing/expired |
| 4 | Official verification required |
| 5 | Rate limited |
| 6 | Unverified/unsupported capability |

No automatic failed-request retry loop. Normal flight polling is bounded and follows the website's own continuation protocol. MTop's ordinary token bootstrap is attempted once; there is no captcha solver, device fingerprint emulation or anti-bot bypass. A public webpage interface is not a supported, stable open API contract.

## Development

```sh
npm run check
npm pack --dry-run
```

CI checks Node 22/24 on Linux/macOS/Windows without real credentials. Tests use synthetic credentials and fixtures; live acceptance is separate. See [validation](docs/validation.md).

## Attribution

CLI command design references [alibaba-flyai/flyai-skill](https://github.com/alibaba-flyai/flyai-skill), MIT. Runtime implementation is independently written against publicly served website behavior; no upstream embedded secrets or bundled CLI source are included. This project is not affiliated with Alibaba, Fliggy, Taobao or Marriott.

MIT © 2026 LampScript.
