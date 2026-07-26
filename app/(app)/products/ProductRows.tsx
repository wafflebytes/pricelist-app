'use client';

import {List} from '@astryxdesign/core/List';
import {Item} from '@astryxdesign/core/Item';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import type {ProductSummary} from '@/lib/types';
import {inr, pct, formatDate} from '@/lib/format';
import {Sparkline} from '@/components/Sparkline';

/**
 * The narrow-viewport presentation of the product list.
 *
 * Rows, not cards — an eight-column table cannot be squeezed into 390px
 * without becoming a horizontal-scroll maze, so below the breakpoint the same
 * data is re-laid-out as edge-to-edge rows: the description, then the two
 * figures that actually drive a decision (current price, price movement), then
 * provenance. Everything else is one tap away on the detail page.
 */
export function ProductRows({rows}: {rows: ProductSummary[]}) {
  return (
    <List hasDividers density="spacious">
      {rows.map(row => (
        <Item
          key={row.product_id}
          as="li"
          align="start"
          href={`/products/${row.product_id}`}
          label={row.description}
          labelLines={2}
          description={
            <VStack gap={1.5}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Text type="body" weight="semibold" hasTabularNumbers>
                  {inr(row.current_price)}
                </Text>
                {row.change_pct === null ? null : (
                  <Badge
                    variant={
                      row.change_pct > 0.05
                        ? 'warning'
                        : row.change_pct < -0.05
                          ? 'success'
                          : 'neutral'
                    }
                    label={pct(row.change_pct)}
                  />
                )}
                {row.product_code ? (
                  <Badge variant="neutral" label={row.product_code} />
                ) : null}
              </HStack>
              <Text type="supporting" color="secondary">
                {formatDate(row.last_purchase_date)} · {row.entry_count}{' '}
                {row.entry_count === 1 ? 'entry' : 'entries'}
              </Text>
            </VStack>
          }
          endContent={
            <Sparkline points={row.sparkline} label={`${row.description} price trend`} />
          }
        />
      ))}
    </List>
  );
}
