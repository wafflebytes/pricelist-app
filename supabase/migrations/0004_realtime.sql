-- 0004_realtime.sql — Supabase Realtime. PRD §7.
-- products and price_entries are subscribed; vendors never changes.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products'
  ) then
    alter publication supabase_realtime add table public.products;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'price_entries'
  ) then
    alter publication supabase_realtime add table public.price_entries;
  end if;
end $$;

-- REPLICA IDENTITY FULL so DELETE payloads carry product_id, which the client
-- needs in order to know which row/chart to invalidate.
alter table public.price_entries replica identity full;
alter table public.products      replica identity full;
