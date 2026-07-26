-- 0002_rls.sql — Row Level Security. PRD §4.4.
-- Invite-only, single trust tier: every authenticated user reads and writes
-- everything. Anonymous users get nothing. Authorship is enforced, not trusted.

alter table public.vendors       enable row level security;
alter table public.products      enable row level security;
alter table public.price_entries enable row level security;

-- ---------------------------------------------------------------- vendors
-- Read-only from the app in v1. No insert/update/delete policy exists, so
-- those operations are denied for every non-service role by default.
drop policy if exists "vendors: authenticated read" on public.vendors;
create policy "vendors: authenticated read"
  on public.vendors for select to authenticated using (true);

-- ---------------------------------------------------------------- products
drop policy if exists "products: authenticated read" on public.products;
create policy "products: authenticated read"
  on public.products for select to authenticated using (true);

-- created_by must be the caller. Makes it impossible to write a row
-- attributed to someone else.
drop policy if exists "products: authenticated insert" on public.products;
create policy "products: authenticated insert"
  on public.products for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "products: authenticated update" on public.products;
create policy "products: authenticated update"
  on public.products for update to authenticated
  using (true)
  with check (updated_by = auth.uid());

-- No delete policy on products: deleting a product would cascade away real
-- purchase history (PRD §9.1).

-- ------------------------------------------------------------ price_entries
drop policy if exists "price_entries: authenticated read" on public.price_entries;
create policy "price_entries: authenticated read"
  on public.price_entries for select to authenticated using (true);

drop policy if exists "price_entries: authenticated insert" on public.price_entries;
create policy "price_entries: authenticated insert"
  on public.price_entries for insert to authenticated
  with check (created_by = auth.uid());

drop policy if exists "price_entries: authenticated update" on public.price_entries;
create policy "price_entries: authenticated update"
  on public.price_entries for update to authenticated
  using (true) with check (true);

drop policy if exists "price_entries: authenticated delete" on public.price_entries;
create policy "price_entries: authenticated delete"
  on public.price_entries for delete to authenticated using (true);
