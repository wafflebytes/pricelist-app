import type {Metadata} from 'next';
import {notFound} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
import type {Product, ProductEntryRow, Vendor} from '@/lib/types';
import {ProductDetail} from './ProductDetail';

export async function generateMetadata({
  params,
}: {
  params: Promise<{id: string}>;
}): Promise<Metadata> {
  const {id} = await params;
  const supabase = await createClient();
  const {data} = await supabase
    .from('products')
    .select('description')
    .eq('id', id)
    .maybeSingle();
  return {
    title: data
      ? `${data.description} · Aalino Price List`
      : 'Product · Aalino Price List',
  };
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{id: string}>;
}) {
  const {id} = await params;
  const supabase = await createClient();

  const [productRes, entriesRes, vendorRes] = await Promise.all([
    supabase.from('products').select('*').eq('id', id).maybeSingle(),
    supabase.rpc('product_entries', {
      p_product_id: id,
      p_from: null,
      p_to: null,
    }),
    supabase.from('vendors').select('*').order('display_name'),
  ]);

  if (productRes.error) throw new Error(productRes.error.message);
  if (!productRes.data) notFound();
  if (entriesRes.error) throw new Error(entriesRes.error.message);

  const vendors = (vendorRes.data ?? []) as Vendor[];
  const product = productRes.data as Product;

  return (
    <ProductDetail
      product={product}
      vendorName={
        vendors.find(v => v.id === product.vendor_id)?.display_name ?? 'Unknown vendor'
      }
      vendors={vendors}
      initialEntries={(entriesRes.data ?? []) as ProductEntryRow[]}
    />
  );
}
