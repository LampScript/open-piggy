# open-piggy 🐷

An independent, open-source CLI for publicly served Fliggy website interfaces. Queries use **HTTP only**. A browser is used only for official QR login and redirects, with a dedicated local session. No FlyAI MCP/API key, shared browser cookies, third-party AI model, order creation or payment.

**Preview, not a feature-complete replacement for FlyAI.** Seven query categories now have live HTTP evidence: flights, trains, popular attractions, keyword products, mainland hotels, Marriott-brand hotels and dated hotel-package associations. Each has explicit scope limits. AI search remains blocked rather than faked. See [capabilities](docs/compatibility.md) and [endpoint evidence](docs/endpoints.md).

最新中文进度：[preview.2 对齐情况](docs/alignment-progress.zh-CN.md)。首版详细对比：[preview.1 与官方 CLI 的差异](docs/official-cli-diff.zh-CN.md)。

## Install

Node.js 22 or later. Download `open-piggy-0.1.0-preview.7.tgz` from [GitHub Releases](https://github.com/LampScript/open-piggy/releases), then:

```sh
npm install -g ./open-piggy-0.1.0-preview.7.tgz
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

## Agent-friendly official QR login

**Preview.7 displays QR and waits for confirmation in interactive terminals; --detach retains background Agent tasks. The new provider has offline lifecycle tests; actual official widget extraction and end-to-end QR acceptance remain unverified because the current environment blocks the official login URL. No alternate channel was used to bypass that restriction.**

Chromium is still required for login, but QR mode does not open a visible window. In the source checkout:

```sh
node dist/cli.js browser install
node dist/cli.js browser doctor
node dist/cli.js auth login --qr --wait
node dist/cli.js auth status --login-id <returned-loginId>
node dist/cli.js auth login --url
node dist/cli.js auth login --browser
node dist/cli.js auth cancel --login-id <returned-loginId>
node dist/cli.js auth logout
```

`auth login` equals `--qr`. In an interactive terminal it prints the QR on stderr and keeps waiting until the task authenticates or fails; stdout receives one final JSON result. `--wait` forces this flow in redirected/non-TTY shells. Agent callers use `--detach` to return the task ID, private QR PNG path when ready, loopback URL and polling/cancellation commands without foreground waiting. The terminal watcher follows QR files that appear later, rather than exiting at the initial pending result. It renders a changed QR payload once and waits for actual confirmation; stdout stays JSON. The extractor supports login-origin embedded frames, visible img/canvas/container QR candidates and explicitly labeled QR-login mode switches. Candidates must decode as QR before publication. These paths have synthetic fixture tests, not online official-widget acceptance. Missing QR still fails explicitly after30seconds. `--url` hands off the SAME background session rather than pretending a generic login link will return another browser's cookies. `--browser` creates an explicitly visible task for manual official verification.

`auth status --login-id` only reads local state; `auth status` without an ID verifies the saved session with the official HTTP endpoint. A pending task is not a successful login. The five-minute `expiresAt` is the task deadline; the official QR may expire earlier (`qrExpiresAt:null`). New login tasks, QR images and handoff links are private transient authentication data.

Only the tool's own official-browser session is saved, after HTTP verification. The existing Chrome profile is never read. Logout cancels and waits for pending task persistence before removing the local session. Finished tasks close their browser/loopback server and remove QR/profile artifacts.

Local state: `~/.config/open-piggy/` (POSIX directory0700, files0600); `OPEN_PIGGY_HOME` overrides it. Windows users should protect the directory with a private ACL. A global install needs the matching Playwright Chromium; see `npm ls -g playwright` and install that Playwright version's Chromium. Detailed commands, state semantics, limitations and remote-loopback guidance: [Agent login](docs/agent-login.zh-CN.md).

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

## Marriott hotel-package associations

```sh
open-piggy search-marriott-package --keyword 上海 --hotel-brands 万豪 \
  --check-in-date 2026-12-01 --check-out-date 2026-12-02 --sort-type price_asc --limit 3
```

This preview requires explicit stay dates and a mainland city keyword (or `--province-or-city` as an explicit city with a hotel keyword). It looks up packages for one page of actual officially brand-filtered hotels. It does not implement the official CLI's arbitrary keyword/global catalogue semantics. Original `displayPrice` is retained; only a positive numeric `/晚` display is parsed as a per-night starting price. Tax, inclusions and actual bookability are unknown. See [package evidence](docs/package-evidence.md).

## Command status

| Command | This preview |
|---|---|
| `search-flight` | Partial: live quotes, ranges, all sorts, hours, transfers and exact segment selection; fare rules incomplete |
| `search-train` | Partial: direct trains, ranges, hour filters and independent return ticket combinations; no transfers |
| `search-poi` | Partial: verified popular attractions by city |
| `search-hotel` | Partial: mainland dated hotel queries and limited filters |
| `search-marriott-hotel` | Partial: mainland hotels using verified official Marriott brand facets |
| `search-marriott-package` | Partial: dated package associations for official Marriott-brand mainland hotels; not full catalogue |
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
| 7 | Login browser runtime/setup failure |

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

## Login browser setup

Installing the npm CLI installs the Playwright library, not its browser binaries. Run `open-piggy browser install` on the machine where login executes; it uses the exact installed Playwright CLI, not npx/latest. `open-piggy browser doctor` checks a private persistent Chromium context on about:blank only and exits nonzero if setup is not ready. It does not visit any login page or install OS packages/change browser security flags.

Missing browser, system libraries, incompatible runtime and missing graphical display have distinct sanitized errors. QR mode is headless; --browser requires a graphical display. A known terminal login-start failure now returns status1 and a nonzero exit code; polling an existing task remains a successful read whose data.state must be checked.

The real Chromium offline component fixture is `npm run test:login-browser`. It blocks all browser network requests and exercises synthetic iframe/canvas QR, handoff, terminal rendering, synthetic persistence and cleanup. This is not real official login acceptance. Linux deployment findings: [dev2 validation](docs/dev2-validation.zh-CN.md).

## Terminal scan-and-confirm workflow

```sh
open-piggy browser install
open-piggy auth login --qr --wait
```

The first command is normally needed only once per matching browser version. The second prints a readable QR when extraction succeeds, waits for official app confirmation and backend verification, then reports the saved session. It does not treat pending or QR-ready as authentication. Ctrl+C requests cancellation of the task, not logout of a previously saved session. For Agent/task polling use `open-piggy auth login --qr --detach`. The terminal workflow is tested with synthetic existing tasks; real official QR acceptance is still pending in the restricted environment.
