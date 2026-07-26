'use client';

import {usePathname, useRouter} from 'next/navigation';
import {AppShell} from '@astryxdesign/core/AppShell';
import {
  SideNav,
  SideNavHeading,
  SideNavItem,
  SideNavSection,
} from '@astryxdesign/core/SideNav';
import {Button} from '@astryxdesign/core/Button';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/Layout';
import {Badge} from '@astryxdesign/core/Badge';
import {
  TableCellsIcon,
  BuildingStorefrontIcon,
} from '@heroicons/react/24/outline';
import {getClient} from '@/lib/supabase/client';

export function AppChrome({
  children,
  email,
  vendorCount,
}: {
  children: React.ReactNode;
  email: string;
  vendorCount: number;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await getClient().auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  return (
    <AppShell
      height="fill"
      contentPadding={0}
      sideNav={
        <SideNav
          collapsible
          resizable={{autoSaveId: 'aalino-sidenav'}}
          header={
            <SideNavHeading
              heading="Price List"
              superheading="Aalino India"
            />
          }
          footer={
            <VStack gap={2} padding={2}>
              <Text type="supporting" color="secondary">
                {email}
              </Text>
              <Button
                label="Sign out"
                variant="ghost"
                size="sm"
                width="100%"
                onClick={signOut}
              />
            </VStack>
          }
        >
          <SideNavSection title="Navigate" isHeaderHidden>
            <SideNavItem
              label="Products"
              href="/products"
              icon={TableCellsIcon}
              isSelected={pathname.startsWith('/products')}
            />
            <SideNavItem
              label="Vendors"
              href="/vendors"
              icon={BuildingStorefrontIcon}
              isSelected={pathname.startsWith('/vendors')}
              endContent={
                vendorCount > 1 ? (
                  <Badge label={String(vendorCount)} variant="neutral" />
                ) : undefined
              }
            />
          </SideNavSection>
        </SideNav>
      }
    >
      {children}
    </AppShell>
  );
}
