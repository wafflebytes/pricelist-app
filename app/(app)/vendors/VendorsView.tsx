'use client';

import {
  Layout,
  LayoutContent,
  LayoutHeader,
  VStack,
} from '@astryxdesign/core/Layout';
import {Text, Heading} from '@astryxdesign/core/Text';
import {Banner} from '@astryxdesign/core/Banner';
import {Table, proportional, pixel} from '@astryxdesign/core/Table';
import type {TableColumn} from '@astryxdesign/core/Table';
import {List} from '@astryxdesign/core/List';
import {Item} from '@astryxdesign/core/Item';
import {useMediaQuery} from '@astryxdesign/core/hooks';
import type {VendorStats} from '@/lib/types';
import {formatDate} from '@/lib/format';

const columns: TableColumn<VendorStats>[] = [
  {
    key: 'display_name',
    header: 'Vendor',
    width: proportional(2),
    renderCell: v => (
      <VStack gap={0}>
        <Text type="body" weight="medium">
          {v.display_name}
        </Text>
        <Text type="supporting">{v.name}</Text>
      </VStack>
    ),
  },
  {
    key: 'product_count',
    header: 'Products',
    width: pixel(110),
    align: 'end',
    renderCell: v => <Text type="body">{v.product_count}</Text>,
  },
  {
    key: 'entry_count',
    header: 'Price entries',
    width: pixel(130),
    align: 'end',
    renderCell: v => <Text type="body">{v.entry_count}</Text>,
  },
  {
    key: 'earliest_purchase',
    header: 'First purchase',
    width: pixel(150),
    renderCell: v => <Text type="body">{formatDate(v.earliest_purchase)}</Text>,
  },
  {
    key: 'latest_purchase',
    header: 'Latest purchase',
    width: pixel(150),
    renderCell: v => <Text type="body">{formatDate(v.latest_purchase)}</Text>,
  },
];

export function VendorsView({vendors}: {vendors: VendorStats[]}) {
  const isWide = useMediaQuery('(min-width: 769px)', true);

  return (
    <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider>
          <VStack gap={1} padding={isWide ? 3 : 2}>
            <Heading level={1}>Vendors</Heading>
            <Text type="supporting">
              {vendors.length === 1
                ? 'One vendor onboarded.'
                : `${vendors.length} vendors onboarded.`}
            </Text>
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={isWide ? 3 : 2}>
          <VStack gap={3}>
            <Banner
              status="info"
              title="Vendors are onboarded by script, not in the app"
              description="A new vendor ledger export is parsed, de-duplicated and seeded by scripts/seed-ledger.ts. There is deliberately no in-app import."
            />
            {isWide ? (
              <Table<VendorStats>
                data={vendors}
                columns={columns}
                idKey="id"
                density="balanced"
                dividers="rows"
              />
            ) : (
              <List hasDividers density="spacious">
                {vendors.map(v => (
                  <Item
                    key={v.id}
                    as="li"
                    align="start"
                    label={v.display_name}
                    labelLines={2}
                    description={
                      <VStack gap={0.5}>
                        <Text type="supporting" color="secondary">
                          {v.product_count} products · {v.entry_count} price entries
                        </Text>
                        <Text type="supporting" color="secondary">
                          {formatDate(v.earliest_purchase)} → {formatDate(v.latest_purchase)}
                        </Text>
                      </VStack>
                    }
                  />
                ))}
              </List>
            )}
          </VStack>
        </LayoutContent>
      }
    />
  );
}
