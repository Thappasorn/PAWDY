# Reporting draft — not deployed

This code can be loaded for offline tests. Live entry points still stop at
`requireValidatedIntegration_()`; importing it no longer throws globally.
Do not remove that gate until actual authorized staging tests pass.

The writer is designed to reuse a host project's `PAWDY.spreadsheetId`,
`PAWDY.timezone`, `PAWDY.since` and `PAWDY.until` without copying their values into
this repository. It validates the full header, plans API-owned cell updates,
keeps business inputs and performs a single Sheets batch. It does not change
the host project's scheduler.

Fixed: Display list endpoint, successful error envelopes, unknown versus zero
metrics, multi-ad aggregation, exact string IDs, literal caption writes, GET
report requests, pagination guards, Bangkok schedules and removal of an
unverified Business refresh endpoint. Unmapped ads fail rather than vanish.

Remaining: validate Accounts API organic permissions and adapter for the target
app; the optional Display adapter requires a **separate Display API approval**
and explicit `TIKTOK_ORGANIC_PRODUCT=DISPLAY`. Business credentials cannot be
substituted for Display credentials. Verify report metrics, periods, mapping,
currency, staging writes, formula recalculation and dashboard aggregation.
Conversions, revenue and paid engagement are not fabricated. No live API test
has passed and no schedule has been installed.

Keep secrets only in private Script Properties. Do not put them in source code,
the shared Sheet, tests or issue/PR text. The source contains no real account or
spreadsheet identifiers.

Run: `node --test test/tiktok-reporting.cjs`

Primary references used:
- https://developers.tiktok.com/doc/tiktok-api-v2-video-list/
- https://developers.tiktok.com/doc/oauth-user-access-token-management/
- https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/src/api/ReportingApi.js
- https://github.com/tiktok/tiktok-business-api-sdk/blob/main/js_sdk/src/api/AuthenticationApi.js
