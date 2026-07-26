-- 0005_source_line_provenance.sql
--
-- Fixes the import-key design. The original natural key was
--   (product_id, purchase_date, unit_price, quantity, voucher_no, source_batch)
-- which cannot represent the 6 byte-identical repeated ledger lines described in
-- PRD §2.6b — two of them share a voucher number, so the index rejected them and
-- the seed landed 745 rows instead of the mandated 747.
--
-- PRD §2.6b is explicit that all of these rows must be ingested (they are
-- price-identical, so they cannot distort a chart) and merely flagged for review.
-- So the key becomes the ledger line itself: one spreadsheet row = one entry.
-- This also buys real provenance — any price entry can be traced back to a row
-- number in a named export.

alter table public.price_entries
  add column if not exists source_line_no integer;

drop index if exists public.price_entries_import_key;

create unique index if not exists price_entries_source_line_key
  on public.price_entries (source_batch, source_line_no)
  where source = 'ledger_import';

comment on column public.price_entries.source_line_no is
  '1-based row number in the source .xlsx that produced this entry. Null for manual entries.';
