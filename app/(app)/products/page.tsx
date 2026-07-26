import type {Metadata} from 'next';
import {createClient} from '@/lib/supabase/server';
import type {ProductSummary, Vendor} from '@/lib/types';
import {ProductsView} from './ProductsView';

export const metadata: Metadata = {title: 'Products · Aalino Price List'};

/**
 * The main table. One RPC round trip returns the per-product rollup plus each
 * sparkline series, so there is no N+1 for 195 rows (PRD §4.3).
 */
export default async function ProductsPage() {
  const supabase = await createClient();

  const [summaryRes, vendorRes] = await Promise.all([
    supabase.rpc('product_summary', {p_from: null, p_to: null}),
    supabase.from('vendors').select('*').order('display_name'),
  ]);

  if (summaryRes.error) throw new Error(summaryRes.error.message);

  return (
    <ProductsView
      initialRows={(summaryRes.data ?? []) as ProductSummary[]}
      vendors={(vendorRes.data ?? []) as Vendor[]}
    />
  );
}
