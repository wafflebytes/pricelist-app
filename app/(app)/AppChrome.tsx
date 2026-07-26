'use client';

import {useEffect, useRef} from 'react';
import {usePathname, useRouter} from 'next/navigation';
import NextLink from 'next/link';
import {AppShell, useAppShellMobile} from '@astryxdesign/core/AppShell';
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

/**
 * Responsive contract for the frame:
 *   >= 1024px side nav 260 (collapsible, resizable) | content
 *   <  1024px side nav becomes the AppShell mobile drawer with a hamburger
 *             toggle; the drawer closes itself on navigation
 *
 * The breakpoint is raised from AppShell's default 'md' (768) to 'lg' (1024) so
 * the frame and the page switch together: the product table gives way to rows
 * at 1024, and at 834 a 260px sidebar would leave those rows only ~574px.
 */
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
      mobileNav={{breakpoint: 'lg'}}
      sideNav={
        <SideNav
          collapsible
          resizable={{defaultWidth: 260, minWidth: 200, maxWidth: 380, autoSaveId: 'aalino-sidenav'}}
          header={<SideNavHeading heading="Price List" superheading="Aalino India" />}
          footer={
            <VStack gap={1} padding={2}>
              <Text type="supporting" color="secondary" maxLines={1} hasTruncateTooltip>
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
              as={NextLink}
              href="/products"
              icon={TableCellsIcon}
              isSelected={pathname.startsWith('/products')}
            />
            <SideNavItem
              label="Vendors"
              as={NextLink}
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
      <CloseMobileNavOnNavigate pathname={pathname} />
      {children}
    </AppShell>
  );
}

/**
 * Tapping a nav item on mobile navigates but leaves the drawer covering the
 * page. This closes it once the route actually changes.
 *
 * Must live inside AppShell — useAppShellMobile reads AppShell context.
 */
function CloseMobileNavOnNavigate({pathname}: {pathname: string}) {
  const {closeMobileNav, isMobileNavOpen} = useAppShellMobile();
  const previous = useRef(pathname);

  useEffect(() => {
    if (previous.current !== pathname) {
      previous.current = pathname;
      if (isMobileNavOpen) closeMobileNav();
    }
  }, [pathname, isMobileNavOpen, closeMobileNav]);

  return null;
}
