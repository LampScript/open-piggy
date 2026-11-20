# open-piggy 🐷

An independent, open-source CLI for publicly served Fliggy website interfaces. Queries use **HTTP only**. A browser is used only for official QR login and redirects, with a dedicated local session. No FlyAI MCP/API key, shared browser cookies, third-party AI model, order creation or payment.

**Preview, not a feature-complete replacement for FlyAI.** Limited train and attraction searches have live HTTP evidence; fixed-date flights now also pass own-session HTTP acceptance, with incomplete filters and fare rules. Four command categories are explicitly blocked rather than faked. See [capabilities](docs/compatibility.md) and [endpoint evidence](docs/endpoints.md).

完整中文对比：[与官方 FlyAI CLI 的功能及参数差异](docs/official-cli-diff.zh-CN.md)。

## Install

Node.js 22 or later. Download `open-piggy-0.1.0-preview.1.tgz` from [GitHub Releases](https://github.com/LampScript/open-piggy/releases), then:

```sh
npm install -g ./open-piggy-0.1.0-preview.1.tgz
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

## Experimental flight transport

```sh
open-piggy search-flight --experimental \
  --origin SHA --destination LAX \
  --dep-date 2027-02-04 --back-date 2027-02-12 \
  --transport-no AC026,AC554,AC551,AC025 \
  --total-duration-hour 20 --sort-type 3 --limit 1
```

This implements the public page's route setup, flight-selection polling and lowest-agent quote polling. **Logged-in fixed-date flight HTTP acceptance passed; full feature parity is still pending.** The explicit `--experimental` opt-in prevents presenting a partial flight implementation as a finished product. Response schemas are checked; business failure, verification and schema drift fail explicitly. Unknown baggage, fare brand and connection protection stay `null`.

The duration ceiling is strict and evaluated separately for each direction, including waiting time using the website's journey duration. Fixed-date searches only. Flight sorts `1` and `3` are implemented; unimplemented flags fail rather than being ignored. `--limit` controls examined candidates per direction (default 5), not upstream pagination; `coverage.exhaustive` is false. Only the website's lowest-agent tab is queried. Prices and availability must still be rechecked on the official booking page.

## Command status

| Command | This preview |
|---|---|
| `search-flight` | Live fixed-date HTTP quotes; experimental filters/fare-rule coverage |
| `search-train` | Partial: verified direct station-to-station search |
| `search-poi` | Partial: verified popular attractions by city |
| `search-hotel` | Blocked: result API unverified |
| `search-marriott-hotel` | Blocked: result API unverified |
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
