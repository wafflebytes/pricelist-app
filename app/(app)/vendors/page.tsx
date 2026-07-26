import type {Metadata} from 'next';
import {createClient} from '@/lib/supabase/server';
import type {VendorStats} from '@/lib/types';
import {VendorsView} from './VendorsView';

export const metadata: Metadata = {title: 'Vendors · Aalino Price List'};

/**
 * Read-only. There is no vendor CRUD in v1 (PRD §6.5) — this page exists so the
 * multi-vendor model is legible to staff, and so vendor #2 has an obvious home
 * when a second ledger is onboarded.
 */
export default async function VendorsPage() {
  const supabase = await createClient();
  const {data, error} = await supabase
    .from('vendor_stats')
    .select('*')
    .order('display_name');

  if (error) throw new Error(error.message);

  return <VendorsView vendors={(data ?? []) as VendorStats[]} />;
}
