# PRD — Aalino Price List App

**Owner:** Aalino (commercial electrical products distributor)
**Repo:** `wafflebytes/pricelist-app` (empty at time of writing)
**Status:** Approved for implementation. Hand to Claude Code for design-system exploration → build → deploy.
**Date:** 2026-07-26

---

## 0. One-paragraph summary

Aalino buys commercial electrical products (currently lighting, from Signify Innovations India Ltd) and receives periodic Tally ledger exports from its vendors. Those exports contain, buried inside voucher structure, every unit price Aalino has ever actually paid. Today that history is unreadable. This app turns it into a **product master list with per-product unit-price history**: a dense sortable/filterable table of every product with an inline price sparkline, drill-in detail views with a full price-history line chart, and manual add/edit of products, internal product codes, and one-off price entries. Multi-user, invite-only, live-syncing. It is a **price intelligence tool, not an accounting tool** — no GST, no invoices, no ledger reconciliation.

---

## 1. Problem & goals

### The problem
1. **No answer to "what does this cost us?"** — A staff member quoting a customer has no place to look up what Aalino last paid for `BVP282 LED120 CW FG SY5WB 100W V1`, or what it paid a year ago.
2. **No visibility on vendor price movement.** Signify's prices genuinely move — 33% of products in the export have more than one distinct historical unit price, with real swings (see §2.4). Nobody can see this today.
3. **No clean product master.** There are 195 distinct product descriptions in the export, all vendor-worded, with no Aalino-internal product code anywhere. There is no canonical list Aalino owns.

### Goals for v1
- **G1.** A single canonical product master, backed by real purchase history, with Aalino-owned internal product codes.
- **G2.** Answer "what did we pay, when, and is it going up?" in ≤2 clicks from landing.
- **G3.** Trustworthy history — no fabricated price movements (see the Debit Note decision, §2.3).
- **G4.** Multi-vendor-ready schema from day one, with zero multi-vendor UI complexity until a second vendor exists.

### Explicit non-goals for v1
Accounting/GST, invoicing, stock/inventory, customer-facing pricing or margin calculation, purchase orders, in-app file import, role tiers, dark mode, mobile-first layout (desktop-first; must not break on tablet).

---

## 2. Data analysis & insights

**This section is ground truth, derived from the actual source file (`Price List App (2).xlsx`, single sheet `Signify Innovations India Ltd`, 4,943 rows × 12 cols). It is not to be re-derived during implementation.**

### 2.1 The source is not a table

The export is a Tally *ledger account* print, not a data table. Rows 1–13 are letterhead (Kloseven Royale, Mumbai) and vendor block ("Signify Innovations India Ltd / Formerly Known As Philips Lighting India Limited / Bhivandi - Thane"). Row 13 declares the ledger period `1-Apr-24 to 31-Mar-27`. Row 14 is the header: `Date | Particulars (cols 2–8) | Vch Type | Vch No. | Debit | Credit`.

Below that, data is **voucher-grouped, not row-per-record**:

- A row with a populated `Date` starts a new voucher and carries `Vch Type`, `Vch No.`, and the voucher-level Debit/Credit total.
- Subsequent rows with a **blank** `Date` are that voucher's child lines, and are a mix of:
  - **product lines** — `col2 = description`, `col3 = qty`, `col4 = unit rate`, `col5 = line amount`
  - **non-product lines** — `Purchase`, `CGST`, `SGST`, `IGST`, `Rounding Off`, `TCS on Purchase (FY24-25) @0.1%`, `New Ref`, `Agst Ref`, `Closing Balance`, and at least one service line (`SRV-2375 SO SERVICE LINE JOB`).

**Parser rule:** a child row is a product line **iff** `col2` is non-empty AND `col3` (qty) and `col4` (rate) are both numeric. Every non-product label above fails this test. This rule yields exactly **784 product lines** across **728 vouchers**.

### 2.2 Voucher-type breakdown

| Vch Type | Vouchers | Product lines | Treatment |
|---|---|---|---|
| Purchase | 625 | 746 | **Ingest as PriceEntry** |
| Debit Note | 44 | 37 | **Excluded entirely** |
| Intransit | 1 | 1 | **Ingest as PriceEntry** (real purchase, goods in transit) |
| Payment | 49 | 0 | Ignore (cash movement, no products) |
| Journal | 8 | 0 | Ignore |
| *(blank)* | 1 | 0 | Ignore (Opening Balance row) |

**→ 747 PriceEntry rows seeded.**

### 2.3 Decision: Debit Notes are excluded from price history

Debit Notes are returns/reversals. Tally records them at the **original purchase rate**, not a current market rate. Real example from the file: on **2026-07-18** a Debit Note reverses 10 × `BVP282 LED120 CW FG SY5WB 100W V1` at **₹3,800** — but that product's contemporaneous purchase price had moved to **₹4,500**. Ingesting that line would render a phantom −16% price crash on the chart on a day when nothing changed.

This is not a nice-to-have filter. **Debit Note rows must never reach `price_entries`.** The seeding script must hard-drop them at parse time and log the count (expected: 37).

### 2.4 Price volatility is real — this app has a reason to exist

- **64 of 195 products (33%)** have more than one distinct historical unit price.
- Average **4.02** entries per product; the busiest (`RC370B LED36S-6500`) has **41**.
- Observed swings from the actual data (min → max unit rate, Purchase lines only):

| Product | Entries | Min | Max | Δ |
|---|---|---|---|---|
| `BY202P LED43S CW PSU PC` | 7 | ₹1,200 | ₹1,800 | **+50%** |
| `BN308C LED40S-6500` | 8 | ₹1,270 | ₹1,900 | **+50%** |
| `BN021C LED22S 6500` | 14 | ₹200 | ₹270 | **+35%** |
| `BVP282 LED120 CW FG SY5WB 100W V1` | 32 | ₹3,500 | ₹4,500 | **+29%** |
| `28W Sky Cove LED Strip (WW)` | 10 | ₹450 | ₹564 | **+25%** |
| `RC810B LED30S 6500` | 7 | ₹3,700 | ₹4,500 | **+22%** |
| `BRP334 LED144 CW R5C FG PSU S1` | 12 | ₹3,800 | ₹4,500 | **+18%** |

The sparkline in the main table is therefore load-bearing, not decoration — a third of rows have something to show.

### 2.5 Decision: dedup is exact-match on normalized description. No fuzzy matching.

195 raw descriptions. Normalizing (trim + case-fold; independently re-verified with aggressive alphanumeric-only collapsing) still yields **195 distinct keys — zero collisions**. There are no whitespace or casing duplicates to merge.

There *are* 112 pairs above 85% string similarity — e.g. `BRP331 LED48 CW R5N PC PSU S1` vs `BRP331 LED54 CW R5N PC PSU S1`, or `RC340B LED36S-6500` vs `RC340B LED36S-4000`. **These are confirmed to be genuinely different SKUs** (wattage / lumen / colour-temperature variants), not typos. Signify part descriptions encode spec in the string; a one-character delta is a different physical product at a different price.

**Fuzzy matching is forbidden.** Product identity = normalized exact description, scoped to vendor. Where two descriptions really are the same SKU worded differently, a human resolves it later via an explicit merge action — which is **out of scope for v1** (§10).

Note for the implementer: some descriptions look like Tally-truncated prefixes of others (`RC370B LED36S-6500` with 41 entries vs `RC370B LED36S-6500 G6 L60W60 PSU OD V3 BLOCK` with 24). Do **not** auto-collapse these. They stay as separate products. This is exactly the case the future merge tool would handle.

### 2.6 Known data edge cases the seeding script must handle explicitly

**(a) Two different prices for the same product on the same day — 7 occurrences.** Real, not corrupt: two vouchers on one date at different rates.

| Date | Product | Rates |
|---|---|---|
| 2025-03-18 | `DN296B LED 15S-6500` | ₹510, ₹530 |
| 2025-04-11 | `BRP264 LED84` | ₹1,850, ₹2,000 |
| 2025-04-15 | `BY220P G2 LED140S` | ₹2,900, ₹3,000 |
| 2025-04-23 | `BN021C LED22S 6500` | ₹210, ₹260 |
| 2025-08-29 | `RC370B LED36S-6500` | ₹1,050, ₹1,100 |
| 2025-11-04 | `BN 021 LED40S 6500` | ₹380, ₹390 |
| 2026-07-20 | `BRP331 LED48 CW R5N PC PSU S1` | ₹1,400, ₹1,450 |

**Implication:** `purchase_date` is *not* unique per product. The chart must tolerate two points at the same x. "Current price" needs a deterministic tie-break (§4.3).

**(b) Byte-identical repeated lines — 8 groups, 9 surplus rows.** Same date, product, qty, and rate appearing more than once (e.g. `DN296B LED 15S-6500`, 100 @ ₹510 on 2025-07-27, three times; `BY320P G2 LED195S CW PSU GR FG WB`, 43 @ ₹5,000 on 2025-02-12, twice). These may be genuine split vouchers or export artifacts. **Do not silently drop them.** Ingest all of them (they are price-identical, so they cannot distort the chart) and have the script **log each group** so a human can review. Deduplication across *re-imports* is handled by the natural key in §4.2.

**(c) Value ranges for validation.** Unit rate ₹50 – ₹24,580. Quantity 1 – 1,600, **always integer** (no fractional qty anywhere in 784 lines). No rate has a decimal component in this export — but the schema must still be `numeric(12,2)`; a future vendor will have paise.

**(d) Coverage.** 28 distinct months, 2024-04 through 2026-07, no gaps; 11–51 product lines per month. Every month has data, so a naive month-bucketed chart will not show holes.

### 2.7 What the source does *not* contain

- **No product code.** Nowhere in the file. It is an Aalino-internal concept, entered by hand in the app, optional, unique only when set.
- **No per-product tax.** CGST/SGST/IGST are voucher-level sibling lines, not attributable to a specific product line. Out of scope — this is a price list tool.
- **No unit of measure, category, brand field, or MRP.** Deliberately not inventing these in v1.

### 2.8 Derived metrics worth surfacing

Computed on the fly from `price_entries` (never stored redundantly):

| Metric | Definition | Where it appears |
|---|---|---|
| **Current price** | Unit price of the latest entry (§4.3 tie-break) | Main table column, detail header |
| **Last purchased** | `max(purchase_date)` | Main table column, primary sort/filter target |
| **Price change %** | `(current − first) / first × 100` over the active date range | Main table column (signed, coloured), detail header |
| **Min / max price** | Over the active date range | Detail header stat |
| **Entry count** | Count of entries in range | Main table column, detail header |
| **Sparkline series** | Ordered `(purchase_date, unit_price)` | Main table cell |
| **Single-purchase product** | `entry_count = 1` — ~79 products (~40%) sit here | Filter chip; sparkline renders as a single dot, not a flat line |
| **Stale product** | `max(purchase_date)` older than 180 days | Filter chip |
| **Most volatile** | `(max − min) / min` desc | Sort option on main table |
| **Uncoded product** | `product_code IS NULL` | Filter chip — drives the product-coding backlog |

The "uncoded" and "stale" chips exist because they define actual work queues for staff, not because they're interesting statistics.

---

## 3. Users & user stories

Two to five internal Aalino staff (sales + purchase). Same permissions. First account: `sales@aalino.com`. Invite-only.

### Authentication
**US-1.** As a staff member, I log in with my email and password at `/login` and land on the product table. There is **no signup route anywhere in the app** — accounts are provisioned by an admin in the Supabase dashboard. Hitting any app route unauthenticated redirects to `/login`.
**US-2.** As an admin, I invite a colleague from the Supabase dashboard; they set a password via the emailed link and can use the app immediately with no further configuration.

### Main table
**US-3.** As a staff member, I land on a table of all ~195 products showing description, product code, vendor, current price, last purchased, entry count, price change %, and a sparkline — so I can scan the whole catalogue in one view.
**US-4.** I sort the table by any of: last-purchased date, description, current price, price change %, entry count.
**US-5.** I filter by a purchase date range, so I can ask "what did we buy in FY25-26?" The range constrains **both** which products appear (those with ≥1 entry in range) and the derived metrics shown (current price, change %, sparkline all reflect the range).
**US-6.** I search across description and product code with a single input and get incremental results.
**US-7.** I filter by the quick chips: *Uncoded*, *Single purchase*, *Not purchased in 180 days*, *Price increased*.
**US-8.** I see a row count that reflects active filters ("64 of 195 products"), so I know the filter is doing something.

### Product detail
**US-9.** I click a row and land on that product's detail page showing a full price-history line chart over time.
**US-10.** On the detail page I apply an **independent** date range — separate from the table's filter — to zoom into a period.
**US-11.** Below the chart I see the raw entries in a table (date, unit price, qty, line amount, voucher no., added by), sortable by date ascending or descending.
**US-12.** I see summary stats in the detail header: current price, first price, change %, min, max, entry count, last purchased.
**US-13.** I return to the table with my table-level filters still intact.

### Editing
**US-14.** I add a new product (description, vendor, optional product code) via a dialog. If the normalized description already exists for that vendor, I get a clear inline error naming the existing product and a link to it — not a duplicate row.
**US-15.** I edit a product's description or assign/change its product code. If I set a code already in use, I get an inline uniqueness error naming the conflicting product.
**US-16.** I add a one-off price entry to a product (date, unit price, qty, optional voucher no.) from the detail page. The chart, the stats, and the product's row in the table all update immediately.
**US-17.** I edit or delete a price entry I or a colleague added, because typos in price data are worse than missing data.
**US-18.** Every product and every price entry records who created it and when, and the detail table shows "added by" — because this is price-sensitive data and mistakes need an owner.

### Realtime
**US-19.** While I have the table open, a colleague adding a price entry causes the affected row's current price, change %, last-purchased, and sparkline to update live, with no refresh.
**US-20.** While I have a product's detail page open, a colleague's edit to that product's entries updates the chart and entry table live.
**US-21.** A newly created product appears in my open table without a refresh (subject to my active filters).

---

## 4. Data model

### 4.1 Entities

```
vendors 1 ──< products 1 ──< price_entries
                                  │
auth.users ──────────────────────┘  (created_by on both products and price_entries)
```

- **vendors** — modeled properly from day one. Seeded with exactly one row: Signify Innovations India Ltd. No vendor CRUD UI in v1.
- **products** — the master list. Identity = `(vendor_id, normalized description)`.
- **price_entries** — one row per ingested Purchase/Intransit product line, plus manual additions. Debit-Note-sourced rows never appear here.

### 4.2 Postgres DDL (Supabase)

```sql
-- ============ vendors ============
create table public.vendors (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  display_name text not null,
  created_at   timestamptz not null default now()
);
create unique index vendors_name_key on public.vendors (lower(name));

-- Seed (exactly one row in v1):
-- name: 'Signify Innovations India Ltd'
-- display_name: 'Signify (formerly Philips Lighting India)'

-- ============ products ============
create table public.products (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references public.vendors(id) on delete restrict,
  description   text not null,
  -- generated normalization key: trimmed + case-folded + internal whitespace collapsed.
  -- This is the ONLY dedup mechanism. No fuzzy matching. See PRD 2.5.
  description_norm text generated always as (
    lower(regexp_replace(btrim(description), '\s+', ' ', 'g'))
  ) stored,
  product_code  text,               -- Aalino-internal. Optional. Not in source data.
  notes         text,
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint products_description_not_blank check (btrim(description) <> '')
);

-- Identity: same normalized description cannot repeat within a vendor,
-- but MAY repeat across vendors (two vendors can sell the same SKU).
create unique index products_vendor_desc_key
  on public.products (vendor_id, description_norm);

-- product_code: unique only when set. Global across vendors — it is an
-- Aalino-internal code, so the same code must never mean two things.
create unique index products_code_key
  on public.products (upper(btrim(product_code)))
  where product_code is not null and btrim(product_code) <> '';

create index products_vendor_idx on public.products (vendor_id);
-- Trigram index to back the PowerSearch free-text field across ~195 rows and beyond.
create extension if not exists pg_trgm;
create index products_desc_trgm on public.products using gin (description gin_trgm_ops);

-- ============ price_entries ============
create table public.price_entries (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references public.products(id) on delete cascade,
  purchase_date  date not null,
  unit_price     numeric(12,2) not null check (unit_price > 0),
  quantity       numeric(12,2) not null check (quantity > 0),
  line_amount    numeric(14,2),      -- as printed in the ledger; may differ from qty*rate by rounding
  voucher_no     text,               -- e.g. 'MH0010162259', or a bare '5'
  source         text not null default 'manual'
                 check (source in ('ledger_import','manual')),
  source_batch   text,               -- e.g. 'signify-2026-07-26' — provenance for the seed run
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint price_entries_date_sane
    check (purchase_date >= date '2000-01-01' and purchase_date <= current_date + 1)
);

-- Re-import safety: the same ledger line must not be ingested twice across
-- repeated seed runs. Applies to imported rows only, so manual entries are
-- never blocked (a user may legitimately enter an identical repeat purchase).
create unique index price_entries_import_key
  on public.price_entries (product_id, purchase_date, unit_price, quantity,
                           coalesce(voucher_no, ''), coalesce(source_batch, ''))
  where source = 'ledger_import';

create index price_entries_product_date_idx
  on public.price_entries (product_id, purchase_date desc, created_at desc);
create index price_entries_date_idx on public.price_entries (purchase_date desc);
```

Both tables get a standard `updated_at` trigger.

> **Note on the import key:** it deliberately includes `source_batch`. Two separate ledger drops that both contain the same historical line would each be recorded — that's a *bug in how the exports were cut*, and it must surface loudly in the seed script's diff report rather than being silently absorbed. Within a single batch, the key blocks true re-runs of the same script.

### 4.3 "Current price" is derived, never stored

```sql
-- Deterministic tie-break — required because 7 product/date pairs have two
-- distinct prices on the same day (PRD 2.6a).
select distinct on (product_id) product_id, unit_price, purchase_date
from public.price_entries
order by product_id, purchase_date desc, created_at desc, id desc;
```

Expose this and the other derived metrics as a database view (`product_price_summary`) so the table page fetches one query, not N+1. The view must accept the date-range filter — implement as a SQL function `product_summary(from_date date, to_date date)` returning the per-product rollup, or fetch raw entries and roll up client-side if the row count stays this small. **Prefer the SQL function**: it keeps sparkline data, sort, and pagination on one side of the wire.

### 4.4 Row Level Security

Invite-only, single trust tier. Every authenticated user can read and write everything; anonymous users can do nothing.

```sql
alter table public.vendors      enable row level security;
alter table public.products     enable row level security;
alter table public.price_entries enable row level security;

-- Read: any authenticated user
create policy "auth read" on public.products
  for select to authenticated using (true);
-- (same shape for vendors, price_entries)

-- Write: any authenticated user, but authorship must be truthful
create policy "auth insert" on public.products
  for insert to authenticated with check (created_by = auth.uid());
create policy "auth update" on public.products
  for update to authenticated using (true) with check (updated_by = auth.uid());
create policy "auth delete" on public.price_entries
  for delete to authenticated using (true);

-- vendors: read-only from the app in v1 — no insert/update/delete policy.
```

**Attribution is enforced, not suggested.** The `with check (created_by = auth.uid())` clause makes it impossible to write a row attributed to someone else. Do not let the client pass an arbitrary `created_by`.

Signup must be disabled at the Supabase project level (Auth → disable new signups), not merely by omitting the UI route.

---

## 5. Seeding pipeline (one-time script, not a product feature)

**Scope cut, deliberate and binding: there is no in-app import feature in v1.** Future ledger drops are handed to Claude Code and seeded by script. Do not add a CSV/XLSX upload screen to this app.

The script (`scripts/seed-ledger.ts`, run locally against Supabase with the service role key) must:

1. Read the sheet, skip to the header row (locate the row whose first cell is `Date`), and parse voucher groups per §2.1.
2. Classify each child row; keep only product lines under `Vch Type ∈ {Purchase, Intransit}`.
3. **Hard-drop Debit Notes.** Assert the dropped count equals **37**; fail loudly if not.
4. Upsert vendor `Signify Innovations India Ltd`.
5. Upsert products on `(vendor_id, description_norm)`, preserving the **original** description verbatim as `description` (the normalized form is generated). Assert **195** distinct products, or explain the delta.
6. Insert price entries with `source = 'ledger_import'`, `source_batch = 'signify-2026-07-26'`, `created_by` = the `sales@aalino.com` user id. Assert **747** rows inserted.
7. Emit a report to stdout: rows parsed, rows skipped by reason, debit notes dropped, products created vs matched, entries inserted vs skipped-as-duplicate, **the 8 identical-line groups from §2.6b**, and **the 7 same-day-different-price cases from §2.6a**.
8. Be idempotent — a second run inserts zero rows and reports 747 duplicates skipped.

The script is committed to the repo. It is the documented path for onboarding vendor #2.

---

## 6. Screens & Astryx component mapping

Design system: **Astryx** — `@astryxdesign/core`, `@astryxdesign/theme-neutral`, `@astryxdesign/charts`. **Light mode only.**

### 6.0 Binding design-system rules
- No raw `<div>` for layout — use Astryx layout primitives (`Section`, `Card`, and the system's stack/grid primitives).
- **No hardcoded hex colours, no hardcoded px.** All spacing, colour, radius, typography via theme tokens from `@astryxdesign/theme-neutral`.
- No custom CSS files beyond what the design system requires for bootstrap.
- **Before writing any screen, the implementer must read the Astryx docs and the shipped templates.** The components named below are confirmed to exist; their exact props are not assumed here. Where a template already solves a screen, use the template rather than reassembling it.

Templates/recipes to study first: **`table-page-chart`**, **`table-page`**, **`PaginationWithTable`**, **`StickyColumnsHookUsage`**, **`ColumnResizeHookUsage`**. `table-page-chart` is very likely the direct basis for the product detail screen and possibly the main page.

### 6.1 App shell (all authenticated routes)
| Need | Component |
|---|---|
| Frame, header, content region | `AppShell` |
| Left nav | `SideNav` — v1 has two items: **Products** and **Vendors** (Vendors is a read-only single-row informational page; it exists to make the multi-vendor model visible without building multi-vendor UI) |
| Signed-in user + sign out | Whatever `AppShell` provides for a user slot; do not hand-roll a header |

### 6.2 `/products` — main table (the core of the app)

| Region | Component | Notes |
|---|---|---|
| Page container | `Section` | Title "Products", subtitle showing filtered count ("64 of 195") |
| Date range filter | `DateRangeInput` | Filters on `purchase_date`. Default: **all time.** Presets for FY24-25, FY25-26, Last 12 months |
| Multi-field search/filter | `PowerSearch` | Warranted here — the user needs description + product code + vendor + the quick chips in one control. If `PowerSearch` cannot host the boolean chips, pair it with `Selector` for them |
| Quick filter chips | `Selector` | Uncoded · Single purchase · Stale >180d · Price increased |
| The grid | `Table` | See columns below |
| Pagination | `PaginationWithTable` | 195 rows today; page size 50. Must not degrade when a second vendor triples the row count |
| Sticky first column | `StickyColumnsHookUsage` | Description column stays visible while scrolling to the sparkline |
| Resizable columns | `ColumnResizeHookUsage` | Descriptions run to 45+ chars; users must be able to widen |
| Add product | `Dialog` + `FormLayout` | Triggered from a primary action in the `Section` header |
| Empty / no-results state | Astryx empty-state primitive | Distinguish "no products yet" from "no products match your filter" — the second offers a clear-filters action |

**Columns:**

| # | Column | Sortable | Notes |
|---|---|---|---|
| 1 | Description | ✓ | Sticky. Click → detail. Truncate with tooltip |
| 2 | Product code | ✓ | Editable inline. Empty renders as a subdued "— Add code" affordance, not blank |
| 3 | Vendor | ✓ | Hidden by default while only one vendor exists; auto-shown once `vendors` has >1 row |
| 4 | Current price | ✓ | ₹, INR formatting, right-aligned, tabular numerals |
| 5 | Change % | ✓ | Signed, token-coloured (up = attention, down = positive). "—" for single-entry products |
| 6 | Last purchased | ✓ | **Default sort, descending.** Relative hint on hover ("3 months ago") |
| 7 | Entries | ✓ | Count within active range |
| 8 | Price trend | ✗ | Sparkline — `Chart` from `@astryxdesign/charts` with the `line` mark, axes/grid/legend suppressed, fixed height. Single-entry products render one dot |

**Sparkline performance is a real constraint:** 50 charts on screen per page. Render them from data already returned by the summary query (no per-row fetch), and if `Chart` proves heavy at 50 instances, fall back to a lightweight inline SVG polyline built from theme tokens — but only after measuring, and never for the detail-page chart.

**Inline editing:** product code is inline-editable in the table (it's the highest-frequency edit and the "uncoded" backlog is the main data-entry chore). Everything else edits via the `Dialog`.

### 6.3 `/products/[id]` — detail

| Region | Component | Notes |
|---|---|---|
| Header | `Section` | Description as title; product code, vendor as metadata; Edit + Add price entry actions |
| Stat row | `Card` ×6 | Current price · First price · Change % · Min · Max · Entries |
| Range filter | `DateRangeInput` | **Independent** of the table's filter. Defaults to all time |
| Chart | `Chart` + `ChartGrid` + `ChartAxis`, `line` mark | X = `purchase_date` (time axis), Y = `unit_price` (₹, **not** forced to zero — the interesting signal is a ₹1,050→₹1,100 move, which a zero-baseline flattens). Points marked; tooltip shows date, price, qty, voucher no. Two points on the same date must both render (§2.6a) |
| Entries table | `Table` | Date · Unit price · Qty · Line amount · Voucher no. · Source (Imported/Manual) · Added by · row actions (edit, delete). Sortable by date, default descending |
| Add/edit entry | `Dialog` + `FormLayout` | |
| Delete entry | Astryx confirm dialog | Destructive confirm required |
| Single-entry state | — | Chart area shows a single point plus an explanatory line, not an empty plot |

### 6.4 `/login`
`Card` + `FormLayout` centred, email + password, Astryx error presentation. **No signup link, no "create account", no magic-link self-serve.** Forgot-password links to Supabase's flow.

### 6.5 `/vendors`
Read-only `Table` of vendors with product count and entry count. One row in v1. No create/edit UI. Its purpose is to make the multi-vendor model legible to staff and to give vendor #2 an obvious home.

---

## 7. Realtime sync

**Tables with Realtime enabled:** `products`, `price_entries`. (`vendors` does not change; no subscription.)

**Main table page**
- Subscribe to `postgres_changes` on both tables for INSERT/UPDATE/DELETE.
- On any `price_entries` event, recompute the affected product's derived row (current price, change %, last purchased, entry count, sparkline) — locally if the payload is sufficient, otherwise refetch that single product's summary. **Do not refetch the whole table** on every event.
- On `products` INSERT, insert into local state if it satisfies active filters; on UPDATE, patch in place; on DELETE, remove.
- Coalesce bursts: debounce refetches by ~300ms so a script or rapid multi-entry session doesn't thrash.

**Detail page**
- Subscribe filtered server-side to `price_entries` where `product_id = eq.<id>`, plus the single `products` row.
- Chart series and entry table derive from one client-side entry list; a realtime event mutates that list and both re-render. Do not maintain two copies.
- If the product is deleted while open, show a non-destructive notice and route back to `/products`.

**Behaviour rules**
- Optimistic local write, then reconcile against the realtime echo of your own change — no duplicate rows, no flicker.
- Do not steal focus or reset scroll/sort/filter when a remote change lands.
- If a remote change alters a row the user is actively editing, keep the user's draft and surface a subtle "updated by <name>" indicator. **Never silently overwrite an open form.**
- On reconnect after a dropped socket, refetch the current view once to close the gap.

---

## 8. Non-functional requirements

- **Stack:** Next.js App Router · Supabase (Postgres + Auth + Realtime) · Vercel (deploy via Vercel CLI) · GitHub `wafflebytes/pricelist-app`.
- **Performance:** main table interactive in <1.5s on a normal office connection; sort/filter feel instant (client-side over the fetched page); detail page <1s.
- **Scale headroom:** design for 5,000 products / 100,000 price entries. Today: 195 / 747. Server-side pagination and the summary function exist for this reason.
- **Currency:** INR, `₹`, Indian digit grouping (`₹1,20,000`), 2 decimals shown only when non-zero.
- **Dates:** `DD MMM YYYY` display; ISO in the database; **Asia/Kolkata** throughout. `purchase_date` is a `date` — no timezone shifting allowed to move a purchase across midnight.
- **Accessibility:** keyboard-navigable table and dialogs; contrast per Astryx tokens; sparklines are decorative and must have their data available as text in the same row.
- **Errors:** every mutation failure surfaces a specific message (uniqueness conflict names the conflicting record). No silent failures, no bare "Something went wrong".
- **Secrets:** service role key is used only by the local seed script, never shipped to the client or set as a public env var.
- **Browsers:** current Chrome/Edge/Safari, desktop-first, must remain usable at tablet width.

---

## 9. Assumptions made in this PRD

Stated explicitly rather than left vague:

1. **Product deletion is not exposed in v1.** Price entries can be deleted; products cannot. Deleting a product would cascade away real purchase history. If a product is wrong, it gets edited or ignored.
2. **`product_code` uniqueness is global**, not per-vendor — it's an Aalino-internal identifier, so one code must never mean two things even across vendors.
3. **Date-range filtering on the main table filters products by whether they have entries in range**, and derived metrics are computed within that range. The alternative (show all products, compute over all time, only filter the sparkline) is more confusing.
4. **The Y axis on the detail chart is not zero-baselined**, because the meaningful movements here are 5–20% and a zero baseline hides them.
5. **The Intransit line is treated as a Purchase.** It is a real acquisition at a real negotiated rate.
6. **`line_amount` is stored as printed**, not recomputed from qty × rate, so ledger rounding is preserved. It is displayed, never used for price math.
7. **Vendor is not user-selectable when adding a product in v1** — it defaults to Signify because that's the only vendor. The field is modeled, stored, and rendered; it simply has one option. It becomes a `Selector` the moment `vendors` has a second row.
8. **Quantity is `numeric`, not `integer`,** despite all 784 source rows being whole numbers, because a future vendor will sell by metre or kilogram.

---

## 10. Definition of done for v1

**Shipped when all of the following are true:**

- [ ] `wafflebytes/pricelist-app` contains the Next.js app, the Supabase migrations, and `scripts/seed-ledger.ts`.
- [ ] Supabase project provisioned; migrations applied; RLS enabled and verified (an anonymous request returns zero rows, not an error page).
- [ ] Public signup disabled at the project level; `sales@aalino.com` provisioned and able to log in.
- [ ] Seed script run against production: **1 vendor, 195 products, 747 price entries, 37 Debit Note lines dropped**, report printed. Re-running inserts nothing.
- [ ] `/login` works; every other route redirects when unauthenticated.
- [ ] `/products` renders all 195 with the 8 columns, sparklines drawn, default sort last-purchased desc.
- [ ] Date range + search + all four quick chips filter correctly, and the filtered count is accurate.
- [ ] All sortable columns sort correctly in both directions.
- [ ] Product code editable inline; uniqueness violation shows a named error.
- [ ] Add-product dialog works and rejects a duplicate normalized description with a link to the existing product.
- [ ] `/products/[id]` renders the chart, the six stat cards, its **own independent** date range, and the entries table with add / edit / delete.
- [ ] `RC370B LED36S-6500` (41 entries) renders correctly, and a single-entry product renders its dot-plus-explanation state.
- [ ] Realtime verified with two browsers: adding a price entry in one updates the other's table row and detail chart within ~2s, without losing sort/filter/scroll.
- [ ] Every product and entry shows accurate attribution.
- [ ] Deployed to Vercel on a stable URL; env vars set; the service role key is not among the client-side vars.
- [ ] Astryx audit: no raw layout `<div>`s, no hardcoded hex, no hardcoded px, light mode only.

**Explicitly out of scope for v1** — do not build these, and do not partially scaffold them:

| Cut | Why |
|---|---|
| In-app CSV/XLSX import | Deliberate. Script-based seeding by Claude Code is the pipeline |
| Product merge / fuzzy dedup tooling | §2.5 — no confirmed duplicates exist yet |
| Roles, permission tiers, admin UI | Invite-only single tier is sufficient for 2–5 people |
| GST / tax / invoice / accounting | Not attributable per product; wrong tool |
| Stock, inventory, purchase orders | Not the problem being solved |
| Customer pricing, margin, quotes | Later product, different data |
| Multi-vendor UI (vendor switcher, comparison) | Schema supports it; UI waits until vendor #2 exists |
| Dark mode | Explicitly not needed |
| Export to Excel/PDF | No stated demand |
| Price alerts / notifications | Later, once history is trusted |
| Mobile-optimised layout | Desktop-first; tablet must merely not break |

---

## 11. First tasks for the implementing agent

In order:

1. **Explore Astryx fully before writing UI code** — read the docs for every component named in §6, and read the `table-page-chart`, `table-page`, `PaginationWithTable`, `StickyColumnsHookUsage`, `ColumnResizeHookUsage` templates. Report what the templates already give you so nothing here is rebuilt by hand.
2. Scaffold the Next.js app, wire Astryx + `theme-neutral`, get `AppShell` + `SideNav` + `/login` working end-to-end against Supabase Auth.
3. Apply the §4 migrations; verify RLS with an anonymous client.
4. Write and run `scripts/seed-ledger.ts` against a dev project; reconcile the report against the counts in §2.2 before touching the UI.
5. Build `/products`, then `/products/[id]`, then layer in Realtime.
6. Deploy to Vercel and walk the §10 checklist.

If reality contradicts anything in §2 during implementation, **stop and report the discrepancy** rather than adjusting the numbers — those figures were verified against the source file twice.
