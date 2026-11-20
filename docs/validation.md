# Validation

## Offline checks

Run `npm run check` for type checking, synthetic-fixture tests and build. Tests cover safe JSON/JSONP parsing without eval, HTTP-200 business failures, login expiry, rate/verification separation, redirect host restrictions, cookie host-only semantics, private POSIX file modes, corrupt-session redaction, MTop token bootstrap, train seat-price filtering/presale state, flight cents conversion/cabin filtering and strict per-direction duration ceilings.

No real credentials or full authenticated captures are stored in tests. CI does not use a real account. CI covers Node22/24 on Linux/macOS/Windows; local passing checks do not establish remote CI success.

## Live checks, 2026-11-20

- `auth login`: user completed official QR authentication and redirect. Pure-HTTP `auth status` passed afterward; session file mode0600.
- `search-poi --city-name 上海`: HTTP success, 10 genuine popular attractions and official links. Starting prices only, no dated availability claim.
- `search-train --origin 上海 --destination 北京 --dep-date 2027-02-04 --transport-no G532`: HTTP success; 347min, CNY576, bookable=false, future presale date reported.
- `search-flight --experimental --origin SHA --destination LAX --dep-date 2027-02-04 --back-date 2027-02-12 --transport-no AC026,AC554,AC551,AC025 --seat-class-name economy --total-duration-hour 20 --sort-type 3 --limit 1`: pure-HTTP flight/return/seller polling completed with correct flight identities and 906/1000min durations. Raw cents conversion was corroborated with the official price renderer; regression test added before release.
- `keyword-search --query 上海 --limit 3`: own-session HTTP query returned three real product titles and starting prices with official links; no dated availability claim.
- Other feature statuses and evidence are listed in endpoints.md; they must not be promoted based on command registration.

## Pending stable acceptance

Flight baggage/fare conditions and GDS fares, train transfers and full provider parity, full POI filters, overseas/advanced hotel filters, Marriott packages, and consumer-web AI search. Cross-platform QR login needs device acceptance on each OS. No stable release until these pass; no browser query fallback.

## Preview.2 alignment checks

- Direct train date ranges (2027-02-03..04), 06-hour bucket and second-class filtering succeeded over HTTP. Independent Shanghai/Beijing return tickets (02-04 /02-12) returned separate one-way schedules and an explicitly labeled sum, with presale/bookability preserved.
- Mainland hotel API and official Marriott facet filters succeeded with the tool's login session. Source and limitations: hotel-evidence.md. Hotel responses can drift; changed shapes fail explicitly.
- New regression coverage: date-pair budgets before large Cartesian allocation, failed-pair propagation, chronology of independent return tickets, all transport sort modes, exact flight sequence and preselected return-link type, local hour windows, and hotel city/brand/date response integrity.

- Preview.2 live flight acceptance queried both 2027-02-04 and 02-05 with a fixed 02-12 return, exact AC segment sequences, 温哥华 transfer filter, economy, strict duration<20h, departure-hour filter and duration sorting. Both requested date pairs completed; only the 02-04 combination matched the exact constraints. A non-match is not a claim that the other day has no inventory.

- Dated Marriott package association query (上海,2026-12-01..02, official 万豪 facet) succeeded over own-session HTTP and returned actual item IDs with displays780/晚 and1199/晚. Plain display retained; no total/tax/availability inference. Preview.2 final local suite:66tests.

## Preview.3 login validation

Default QR and URL login use a detached task with a private loopback handoff; explicit browser mode uses the same lock, cancellation and persistence lifecycle. Offline tests cover synthetic PNG terminal rendering, official-login URL/selector scope, task creation/status, same-home concurrency, cancellation before startup, QR+browser logout races, provider failure redaction, expiration, empty legacy lock recovery, private files and token/Host/path restrictions. The new provider has NOT been run against the restricted official login URL through any browser/headless/HTTP/proxy channel. Real QR widget and end-to-end acceptance remain pending; prior headed-login acceptance records apply only to earlier releases.

## Preview.5 QR extraction checks

Synthetic fixtures reproduce and verify fixes for rejected login-frame paths and missing canvas matching. Additional cases cover hidden first matches, decorative images, valid container QR images, nonofficial origins/ports and explicitly labeled QR-mode controls. This validates extraction code offline; it is not live official QR authentication acceptance.

## Preview.6 Linux runtime validation

A user-designated Debian10 x64/Node22.16 server reproduced a missing Playwright1.65.1 browser binary. Installing that dependency's exact Chromium build fixed persistent about:blank startup.104tests/typecheck/build, browser install/doctor and the real Chromium synthetic login component fixture passed on that server. No extra browser flags or system-library upgrades were used. The fixture asserts zero external browser requests; official QR/account authentication remains unverified and was not attempted remotely.

## Preview.7 terminal workflow

The terminal watcher now follows QR readiness through final confirmation. Unit tests cover delayed QR, payload-based redraw deduplication, interactive versus detached modes, cancellation and explicit failures. `npm run test:login-terminal` launches the actual CLI against an already prepared synthetic task, verifies QR block characters on stderr, no premature pending JSON on stdout and one final authenticated-fixture JSON. It never launches a real login provider; the child has an intentionally absent browser cache as a fail-closed guard. The real Chromium offline fixture also exercises the terminal watcher. No official account/QR acceptance is claimed.
