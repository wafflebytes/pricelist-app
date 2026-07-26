-- 0001_init.sql — Aalino Price List App core schema
-- See PRD §4. Multi-vendor from day one; product identity = (vendor, normalized description).

create extension if not exists pg_trgm;

-- ============================================================================
-- vendors
-- ============================================================================
create table if not exists public.vendors (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  display_name text not null,
  created_at   timestamptz not null default now()
);

create unique index if not exists vendors_name_key on public.vendors (lower(name));

-- ============================================================================
-- products
-- ============================================================================
create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references public.vendors (id) on delete restrict,
  description  text not null,

  -- The ONLY dedup mechanism (PRD §2.5): trim + case-fold + collapse internal
  -- whitespace. No fuzzy matching — 112 near-duplicate pairs in the Signify
  -- export are genuinely distinct SKUs (wattage/lumen/CCT variants).
  description_norm text generated always as (
    lower(regexp_replace(btrim(description), '\s+', ' ', 'g'))
  ) stored,

  product_code text,   -- Aalino-internal. Absent from all source data.
  notes        text,

  created_by   uuid references auth.users (id) on delete set null default auth.uid(),
  updated_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint products_description_not_blank check (btrim(description) <> '')
);

-- Same normalized description cannot repeat within a vendor; MAY repeat across
-- vendors (two vendors can legitimately sell the same SKU).
create unique index if not exists products_vendor_desc_key
  on public.products (vendor_id, description_norm);

-- product_code is unique only when set, and globally — it is an Aalino-internal
-- identifier, so one code must never mean two things (PRD §9.2).
create unique index if not exists products_code_key
  on public.products (upper(btrim(product_code)))
  where product_code is not null and btrim(product_code) <> '';

create index if not exists products_vendor_idx on public.products (vendor_id);
create index if not exists products_desc_trgm
  on public.products using gin (description gin_trgm_ops);
create index if not exists products_code_trgm
  on public.products using gin (product_code gin_trgm_ops);

-- ============================================================================
-- price_entries
-- ============================================================================
create table if not exists public.price_entries (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products (id) on delete cascade,
  purchase_date date not null,
  unit_price    numeric(12, 2) not null check (unit_price > 0),
  quantity      numeric(12, 2) not null check (quantity > 0),
  line_amount   numeric(14, 2),  -- as printed in the ledger; display only, never used for price math
  voucher_no    text,
  source        text not null default 'manual'
                check (source in ('ledger_import', 'manual')),
  source_batch  text,

  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint price_entries_date_sane
    check (purchase_date >= date '2000-01-01' and purchase_date <= current_date + 1)
);

-- Re-import safety (PRD §4.2). Imported rows only, so a user is never blocked
-- from manually entering an identical repeat purchase.
create unique index if not exists price_entries_import_key
  on public.price_entries (
    product_id, purchase_date, unit_price, quantity,
    coalesce(voucher_no, ''), coalesce(source_batch, '')
  )
  where source = 'ledger_import';

create index if not exists price_entries_product_date_idx
  on public.price_entries (product_id, purchase_date desc, created_at desc);
create index if not exists price_entries_date_idx
  on public.price_entries (purchase_date desc);

-- ============================================================================
-- updated_at triggers
-- ============================================================================
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

drop trigger if exists price_entries_touch_updated_at on public.price_entries;
create trigger price_entries_touch_updated_at
  before update on public.price_entries
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- seed the one vendor that exists today
-- ============================================================================
insert into public.vendors (name, display_name)
values ('Signify Innovations India Ltd', 'Signify (formerly Philips Lighting India)')
on conflict (lower(name)) do nothing;
