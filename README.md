# Aalino Price List

Internal price list and vendor price-history tool for **Aalino India Pvt. Ltd.**, a distributor of commercial electrical products.

Aalino receives periodic Tally ledger exports from its vendors. Every unit price it has ever paid is in those files, buried inside voucher structure. This app turns them into a product master with per-product price history: a dense sortable table of every product with an inline price sparkline, drill-in detail views with a full price-history chart, and manual add/edit of products, internal product codes, and one-off price entries. Multi-user, invite-only, live-syncing.

It is a **price intelligence tool, not an accounting tool** — no GST, no invoices, no ledger reconciliation.

Built to `PRD.md` (see [Deviations](#deviations-from-the-prd)).

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router, Turbopack) |
| Design system | [Astryx](https://github.com/facebook/astryx) — `@astryxdesign/core`, `theme-neutral`, `charts`. Light mode only |
| Backend | Supabase — Postgres, Auth, Realtime |
| Hosting | Vercel |

### A note on the Astryx version pin

All four Astryx packages are pinned to the exact same canary, `0.1.8-canary.fe8657a`.

`@astryxdesign/charts` has no stable release — its `latest` tag is a `0.0.0-bootstrap.0` placeholder — and every canary peer-depends on the *identically versioned* core. Mixing stable `core@0.1.8` with a charts canary fails to resolve. Since the PRD requires `@astryxdesign/charts` for the sparkline and the price-history chart, the whole set moves to one canary together. **Bump all four at once, or none.**

---

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill it in
npm run db:push                # apply supabase/migrations/*.sql
npm run provision:user         # create the first invite-only account
npm run seed                   # parse + seed the vendor ledger
npm run dev
```

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run db:push` | Applies `supabase/migrations/*.sql` in order, tracked in `public.schema_migrations`. Idempotent |
| `npm run provision:user` | Creates (or resets the password of) `SEED_OWNER_EMAIL` |
| `npm run seed` | Parses the ledger `.xlsx` and seeds products + price entries. Idempotent. `SEED_RESET=true` replaces the batch |
| `node --env-file=.env.local scripts/smoke.mjs` | End-to-end functional suite (~50 checks, drives real Chrome) |
| `node --env-file=.env.local scripts/responsive.mjs` | Layout suite across 390 / 834 / 1280 / 1600 |
| `node --env-file=.env.local scripts/entry-ux.mjs` | Price-entry flow, scroll and dialog-dismissal regressions |

Point any of them at production with `SMOKE_BASE_URL=https://pricelist.aalino.com`.

---

## Data pipeline

The source is a Tally **ledger account print**, not a table. Rows 1–13 are letterhead, row 14 is the header, and everything below is voucher-grouped: a dated parent row followed by undated child rows.

A child row is a product line **iff** its description is non-empty *and* both quantity and rate are numeric. That single rule excludes every non-product label in the file (`Purchase`, `CGST`, `SGST`, `IGST`, `Rounding Off`, `TCS on Purchase`, `New Ref`, `Agst Ref`, `Closing Balance`, and one stray service line).

From the Signify export, verified twice and asserted by the seed script:

| | |
|---|---|
| Product lines | **784** |
| → `Purchase` | 746 · ingested |
| → `Intransit` | 1 · ingested (a real acquisition at a real rate) |
| → `Debit Note` | 37 · **dropped** |
| Price entries seeded | **747** |
| Distinct products | **195** |
| Date range | 2024-04-05 → 2026-07-24 |

### Why Debit Notes are excluded

Debit Notes are returns, and Tally records them at the **original purchase rate**. On 2026-07-18 a Debit Note reverses `BVP282 LED120 CW FG SY5WB 100W V1` at ₹3,800 — but that product's price had moved to ₹4,500 by then. Ingesting it would draw a 16% price crash on a day when nothing happened. They never reach `price_entries`.

### Why dedup is exact-match only

195 raw descriptions normalize (trim + case-fold + collapse whitespace) to 195 distinct keys — **zero collisions**. There are 112 pairs above 85% string similarity, but they are genuinely different SKUs: `BRP331 LED48 CW R5N PC PSU S1` vs `BRP331 LED54 CW R5N PC PSU S1` differ by wattage. Signify encodes spec in the description, so a one-character delta is a different product at a different price.

**Fuzzy matching is forbidden.** Product identity is `(vendor_id, description_norm)`, enforced by a unique index.

### Two dates that matter

- **Serial dates, not `cellDates`.** `xlsx` with `cellDates: true` decodes 2024-04-05 to `2024-04-04T23:59:50` local — a float-rounding artifact that silently shifts every purchase back one day. The parser reads serials and decodes them with `SSF.parse_date_code`, which is exact and timezone-free.
- **`purchase_date` is a calendar date.** It is never passed through `new Date()` for display. `lib/format.ts` formats by string surgery, because constructing a `Date` parses as UTC midnight and would render the previous day in a behind-UTC timezone.

### Known data anomalies (surfaced, not hidden)

The seed script reports both every run:

- **6 byte-identical repeated lines.** Same date, product, qty and rate — possibly split vouchers, possibly export artifacts. All are ingested (they are price-identical, so they cannot distort a chart) and logged for review.
- **7 cases of two different prices on one day**, e.g. `RC370B LED36S-6500` at ₹1,050 and ₹1,100 on 2025-08-29. Legitimate. This is why `purchase_date` is not unique per product, why "current price" needs a deterministic tie-break, and why the detail chart uses a linear x-axis with dodged dots instead of a band scale that would collapse them.

Because ledger lines can legitimately repeat, the import key is the **ledger line itself** — `(source_batch, source_line_no)` — not a value tuple. That preserves all 747 rows, keeps re-runs idempotent, and lets any price entry be traced back to a row number in a named export.

---

## Schema

```
vendors 1 ──< products 1 ──< price_entries
                                  │
auth.users ──────────────────────┘   (created_by / updated_by)
```

- **`products.description_norm`** — generated, stored, uniquely indexed with `vendor_id`. The only dedup mechanism.
- **`products.product_code`** — Aalino-internal, absent from all source data. Optional, unique when set, unique *globally* (one code must never mean two things, even across vendors).
- **`price_entries.line_amount`** — stored as printed in the ledger so rounding is preserved. Displayed, never used for price math.
- **Nothing derived is stored.** "Current price" is always computed.

### Derived reads

| Function / view | Purpose |
|---|---|
| `product_summary(from, to)` | One round trip for the whole main table: per-product rollup plus each sparkline series, over the active window. No N+1 for 195 rows |
| `product_entries(id, from, to)` | Detail page entries with the author's email resolved |
| `vendor_stats` | The `/vendors` page |
| `app_users` | Minimal, deliberate exposure of `auth.users` (id + email only) so the UI can render "added by" |

**Current price tie-break:** `purchase_date desc, created_at desc, id desc`.

**Range semantics:** metrics are always computed over the window. With no bounds (all time), products with zero entries are still returned so a just-created product is visible; with either bound set, only products having ≥1 entry in the window appear.

### Security

RLS is on for all three tables. Anonymous gets nothing. Authenticated users read and write everything — a single trust tier is right for 2–5 people.

Authorship is **enforced, not trusted**: `with check (created_by = auth.uid())` makes it impossible to write a row attributed to someone else. `products` has no delete policy at all, since deleting a product would cascade away real purchase history.

The secret key is used only by local scripts and is never sent to the client.

---

## Realtime

`products` and `price_entries` are in the `supabase_realtime` publication with `REPLICA IDENTITY FULL`, so DELETE payloads carry `product_id`.

- **Main table** subscribes to both tables and refetches the summary, debounced 300ms, so a burst of inserts costs one round trip instead of one per event. It also refetches once on `online` to close any gap from a dropped socket.
- **Detail page** subscribes server-side-filtered to this product's entries. The chart and the entries table both derive from one `entries` list, so there is a single source of truth for both.
- Remote changes never steal focus or reset sort, filter, or scroll.

---

## Deviations from the PRD

Everything below was verified against the database or the browser.

1. **Plain search instead of `PowerSearch`.** The PRD left this to judgement ("if warranted"). It isn't: the two useful axes are description and product code, both free text, and PowerSearch's field/operator/value tokens add three interactions per query without adding reach. The enumerated dimensions are covered by the four quick-filter chips.

2. **`Section` has no `title`/`subtitle`/`endContent` props** in this Astryx version, so section headers are composed explicitly from `Heading` + `Text`.

3. **Dialogs render outside `Layout`.** `Layout` resolves its body as `content ?? children`, so anything passed as a child is silently dropped whenever `content` is set. This cost real debugging time — every dialog was mounting nowhere.

4. **The sparkline is hand-rolled SVG, not `<Chart>`.** The PRD sanctioned this fallback "only after measuring". Measurement said take it: `Chart` sizes itself with a `ResizeObserver` and exposes no `width` prop, so 50 per page meant 50 observers thrashing layout during scroll, and inside a table cell each measured wider than its column and spilled past the table's right edge. The replacement has a fixed viewBox, no effects, renders during SSR, and colours from theme tokens. `<Chart>` is still used for the detail page's price history, where there is exactly one and it has room.

5. **The description cell is a `Link`, not a `Button`.** Buttons size to their content, so a 45-character Signify description overflowed its column and painted over the next cell. `Link`'s own `maxLines` does not fix it either — it clamps the inner `Text` while the anchor itself stays `inline-flex` with `overflow: visible`, so the clamp box just grows. The anchor needs to become a clipping block in its own right.

6. **Search is fuzzy and ranked** (`lib/fuzzy.ts`), so `rc370` finds `RC 370B …` and `282 bvp` finds `BVP282 …` despite the export's inconsistent spacing. Typing a description in the add-product dialog surfaces similar existing products live, with a louder warning above 0.8 similarity. This is presentation only — identity is still exact-match on the normalized description, and nothing here ever merges records.

7. **PRD §2.4 statistics counted debit-note lines.** Over the 747 rows actually ingested the correct figures are **3.83** average entries per product (not 4.02), **35** for the busiest product `RC370B LED36S-6500` (not 41 — it has 35 purchases plus 6 debit-note lines), and **83** single-purchase products (not ~79). The headline claim is unaffected and confirmed exactly: **64 of 195 products (33%)** have more than one distinct historical price.

8. **PRD §2.6b said 8 identical-line groups / 9 surplus rows**; that count included debit notes. Over price-bearing lines only it is **6 groups / 6 surplus rows**.

9. **`middleware.ts` → `proxy.ts`.** Next.js 16 deprecates the `middleware` file convention.

10. **Added `price_entries.source_line_no`** (migration `0005`) — see the import-key rationale above. Without it the seed lands 745 rows instead of the mandated 747.

---

## Recording prices is the primary action

The daily job is recording what was paid; creating a product is the rare
consequence of it. So **New price entry** is the primary button on the products
page and **Add product** is secondary.

The entry flow is built for speed: pick the product from a fuzzy dropdown
(`rc370` is enough), see its last price and entry count inline on each option,
then price / qty / date. **Save and add another** keeps the date and voucher
number — ledger lines usually share a voucher — and clears only what changes per
line. A price more than 50% off the last one shows a warning without blocking,
since a genuine 50% move happens (see the volatility table above).

`Typeahead` is used for that picker because there the user *is* selecting an
existing record. It is deliberately **not** used for the add-product description
field, where the whole point is entering something new; that field stays free
text with live suggestions beside it.

## Two scroll bugs worth remembering

"The first scroll over the table does nothing; scroll again and it works" had two
independent causes, both now covered by `scripts/entry-ux.mjs`:

1. **`.astryx-table-scroll-wrapper` was a vertical scroll container with nothing
   to scroll**, so Chrome latched the wheel event to it before chaining to the
   real scroller. `overflow-y: visible` alone does not fix this — CSS forces
   `visible` to compute as `auto` when the other axis scrolls, so the element
   stays a scroll container. `overflow-x: clip` has no such side effect. This is
   the only hand-written CSS rule in the project and `app/globals.css` explains
   why.
2. **A `Tooltip` per cell** put 150+ fixed-position nodes in a 50-row table, and
   moving the pointer into it made Chrome drop the following wheel event. The
   description now clamps to two lines (which shows more than the tooltip did)
   and the row buttons rely on their own labels. Tooltip count in the table went
   from 152 to 2.

Dialogs use `purpose="info"` so clicking the backdrop closes them, matching
Escape. `purpose="form"` blocks backdrop dismissal to protect typed input; the
trade-off was accepted deliberately in favour of consistent dismissal.

## Responsive behaviour

The PRD asked for desktop-first that "must not break" on tablet. It now adapts properly instead:

| Width | Products | Detail |
|---|---|---|
| ≥ 1200px | 7 columns | 6 stat tiles, 320px chart, 8-column entries table |
| ≥ 1024px | drops Entries and Product code | same |
| < 1024px | table replaced by edge-to-edge rows | tiles reflow, 220px chart with fewer ticks, entries become rows |
| < 1024px | side nav becomes the AppShell drawer, closing itself on navigation; toolbar stacks full-width; page actions go icon-only | |

The table is replaced rather than scrolled sideways below 1024px because a 260px side nav leaves an 834px tablet only ~574px of content — not enough for five columns. Long descriptions are clamped with an ellipsis and a hover tooltip at every width, and no viewport scrolls horizontally.

`scripts/responsive.mjs` enforces this across 390 / 834 / 1280 / 1600: no horizontal page overflow, correct layout and column set per width, descriptions actually ellipsised, no content painted over the next column (accounting for clipping ancestors), exactly one vertical scroll container, and no console errors.

## What is deliberately not here

No in-app CSV/XLSX import (vendor ledgers are seeded by script — that was an explicit scope cut). No product merge or fuzzy dedup tooling. No roles or permission tiers. No GST/tax/invoicing. No stock or purchase orders. No customer pricing or margins. No multi-vendor UI — the schema supports it, and the Vendor column and nav badge appear automatically once a second vendor row exists. No dark mode. No export. No price alerts. Desktop-first.

Products cannot be deleted from the UI, by design. Price entries can.

---

## Operational note

Public signup must be turned **off** in Supabase → Authentication → Sign In / Providers ("Allow new users to sign up"). The app ships no signup route, but the Auth API endpoint stays open until that toggle is flipped.
