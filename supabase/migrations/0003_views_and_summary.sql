-- 0003_views_and_summary.sql — derived reads. PRD §4.3 / §2.8.
-- Nothing here is stored redundantly: "current price" is always computed.

-- ============================================================================
-- app_users — minimal, deliberate exposure of auth.users so the UI can render
-- "added by" (PRD US-18). Only id and email. Runs with the view owner's rights
-- because authenticated has no direct grant on auth.users.
-- ============================================================================
create or replace view public.app_users
with (security_invoker = false) as
select u.id, u.email
from auth.users u;

revoke all on public.app_users from anon;
grant select on public.app_users to authenticated;

-- ============================================================================
-- product_summary(p_from, p_to)
--
-- One round trip for the whole main table: per-product rollup plus the
-- sparkline series, computed over the active date window.
--
-- Range semantics (PRD §9.3 + §9 assumption on empty products):
--   * Metrics are always computed over the window.
--   * When BOTH bounds are null (all time), products with zero entries are
--     still returned — a just-created product must be visible.
--   * When either bound is set, only products with >= 1 entry in the window
--     are returned.
--
-- "Current price" tie-break: purchase_date desc, created_at desc, id desc.
-- Required because 7 product/date pairs in the Signify export carry two
-- distinct prices on the same day (PRD §2.6a).
-- ============================================================================
create or replace function public.product_summary(
  p_from date default null,
  p_to   date default null
)
returns table (
  product_id          uuid,
  vendor_id           uuid,
  vendor_name         text,
  description         text,
  product_code        text,
  entry_count         integer,
  first_price         numeric,
  current_price       numeric,
  min_price           numeric,
  max_price           numeric,
  first_purchase_date date,
  last_purchase_date  date,
  change_pct          numeric,
  volatility_pct      numeric,
  sparkline           jsonb,
  created_at          timestamptz,
  updated_at          timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with windowed as (
    select pe.*
    from public.price_entries pe
    where (p_from is null or pe.purchase_date >= p_from)
      and (p_to   is null or pe.purchase_date <= p_to)
  ),
  ranked as (
    select
      w.*,
      row_number() over (
        partition by w.product_id
        order by w.purchase_date desc, w.created_at desc, w.id desc
      ) as rn_last,
      row_number() over (
        partition by w.product_id
        order by w.purchase_date asc, w.created_at asc, w.id asc
      ) as rn_first
    from windowed w
  ),
  agg as (
    select
      r.product_id,
      count(*)::integer                                     as entry_count,
      min(r.unit_price)                                     as min_price,
      max(r.unit_price)                                     as max_price,
      min(r.purchase_date)                                  as first_purchase_date,
      max(r.purchase_date)                                  as last_purchase_date,
      max(r.unit_price) filter (where r.rn_last = 1)        as current_price,
      max(r.unit_price) filter (where r.rn_first = 1)       as first_price,
      jsonb_agg(
        jsonb_build_object('d', r.purchase_date, 'p', r.unit_price)
        order by r.purchase_date asc, r.created_at asc, r.id asc
      )                                                     as sparkline
    from ranked r
    group by r.product_id
  )
  select
    p.id,
    p.vendor_id,
    v.display_name,
    p.description,
    p.product_code,
    coalesce(a.entry_count, 0),
    a.first_price,
    a.current_price,
    a.min_price,
    a.max_price,
    a.first_purchase_date,
    a.last_purchase_date,
    case
      when a.first_price is null or a.first_price = 0 then null
      else round((a.current_price - a.first_price) / a.first_price * 100, 2)
    end,
    case
      when a.min_price is null or a.min_price = 0 then null
      else round((a.max_price - a.min_price) / a.min_price * 100, 2)
    end,
    coalesce(a.sparkline, '[]'::jsonb),
    p.created_at,
    p.updated_at
  from public.products p
  join public.vendors v on v.id = p.vendor_id
  left join agg a on a.product_id = p.id
  where
    case
      when p_from is null and p_to is null then true
      else a.product_id is not null
    end;
$$;

grant execute on function public.product_summary(date, date) to authenticated;

-- ============================================================================
-- product_entries(p_product_id, p_from, p_to)
-- Detail page: raw entries with the author's email resolved.
-- ============================================================================
create or replace function public.product_entries(
  p_product_id uuid,
  p_from       date default null,
  p_to         date default null
)
returns table (
  id            uuid,
  purchase_date date,
  unit_price    numeric,
  quantity      numeric,
  line_amount   numeric,
  voucher_no    text,
  source        text,
  created_by    uuid,
  created_by_email text,
  created_at    timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    pe.id, pe.purchase_date, pe.unit_price, pe.quantity, pe.line_amount,
    pe.voucher_no, pe.source, pe.created_by, au.email, pe.created_at
  from public.price_entries pe
  left join public.app_users au on au.id = pe.created_by
  where pe.product_id = p_product_id
    and (p_from is null or pe.purchase_date >= p_from)
    and (p_to   is null or pe.purchase_date <= p_to)
  order by pe.purchase_date desc, pe.created_at desc;
$$;

grant execute on function public.product_entries(uuid, date, date) to authenticated;

-- ============================================================================
-- vendor_stats — /vendors read-only page.
-- ============================================================================
create or replace view public.vendor_stats
with (security_invoker = true) as
select
  v.id,
  v.name,
  v.display_name,
  v.created_at,
  count(distinct p.id)::integer  as product_count,
  count(pe.id)::integer          as entry_count,
  min(pe.purchase_date)          as earliest_purchase,
  max(pe.purchase_date)          as latest_purchase
from public.vendors v
left join public.products p       on p.vendor_id = v.id
left join public.price_entries pe on pe.product_id = p.id
group by v.id, v.name, v.display_name, v.created_at;

grant select on public.vendor_stats to authenticated;
