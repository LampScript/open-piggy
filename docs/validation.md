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

Flight baggage/fare conditions and full filters, train transfers/round trips/ranges, full POI filters, hotel parsing and filters, Marriott-specific inventory/packages, and consumer-web AI search. Cross-platform QR login needs device acceptance on each OS. No stable release until these pass; no browser query fallback.
