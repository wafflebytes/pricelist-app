import {redirect} from 'next/navigation';
import {createClient, getUser} from '@/lib/supabase/server';
import {AppChrome} from './AppChrome';

/**
 * Authenticated shell. The middleware already redirects anonymous requests;
 * this is the second gate, so a middleware misconfiguration can't leak data.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) redirect('/login');

  // Vendor count decides whether the Vendor column and nav item earn their
  // place: multi-vendor UI stays out of the way until vendor #2 exists
  // (PRD §10).
  const supabase = await createClient();
  const {count: vendorCount} = await supabase
    .from('vendors')
    .select('*', {count: 'exact', head: true});

  return (
    <AppChrome email={user.email ?? 'Signed in'} vendorCount={vendorCount ?? 1}>
      {children}
    </AppChrome>
  );
}
