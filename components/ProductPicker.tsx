'use client';

import {useMemo} from 'react';
import {Typeahead} from '@astryxdesign/core/Typeahead';
import type {SearchableItem, SearchSource} from '@astryxdesign/core/Typeahead';
import {Item} from '@astryxdesign/core/Item';
import {Badge} from '@astryxdesign/core/Badge';
import {HStack} from '@astryxdesign/core/Layout';
import type {ProductSummary} from '@/lib/types';
import {inr, formatDate} from '@/lib/format';
import {fuzzyRank} from '@/lib/fuzzy';

export type ProductOption = SearchableItem<ProductSummary>;

/**
 * Pick an existing product by typing part of its description or code.
 *
 * This is the entry point for the app's most common task — recording what we
 * just paid — so it has to be fast: type `rc370`, see the match with its last
 * price, select, move on. Nobody should have to retype a 45-character Signify
 * spec string.
 *
 * `createStaticSource` is not used because it only does substring matching on
 * the label; Signify descriptions have erratic spacing (`BN 021` vs `BN021C`),
 * so the source is implemented directly on top of the ranked fuzzy matcher.
 */
export function ProductPicker({
  products,
  value,
  onChange,
  label = 'Product',
  isRequired,
  status,
}: {
  products: ProductSummary[];
  value: ProductOption | null;
  onChange: (option: ProductOption | null) => void;
  label?: string;
  isRequired?: boolean;
  status?: {type: 'error' | 'warning' | 'success'; message?: string};
}) {
  const options = useMemo<ProductOption[]>(
    () =>
      products.map(p => ({
        id: p.product_id,
        label: p.description,
        auxiliaryData: p,
      })),
    [products],
  );

  const searchSource = useMemo<SearchSource<ProductOption>>(
    () => ({
      search: (query: string) =>
        fuzzyRank(query, options, o => [o.label, o.auxiliaryData?.product_code], 20),
      // On focus, offer the most recently purchased products — the thing being
      // priced today is usually something bought recently.
      bootstrap: () =>
        [...options]
          .sort((a, b) =>
            (b.auxiliaryData?.last_purchase_date ?? '').localeCompare(
              a.auxiliaryData?.last_purchase_date ?? '',
            ),
          )
          .slice(0, 10),
    }),
    [options],
  );

  return (
    <Typeahead<ProductOption>
      label={label}
      searchSource={searchSource}
      value={value}
      onChange={onChange}
      placeholder="Type a description or product code…"
      description="Start typing — matches appear as you go."
      hasEntriesOnFocus
      isRequired={isRequired}
      status={status}
      maxMenuItems={8}
      // The source is synchronous, so debouncing only adds latency.
      debounceMs={0}
      renderItem={option => {
        const product = option.auxiliaryData;
        return (
          <Item
            label={option.label}
            labelLines={2}
            description={
              product
                ? `${inr(product.current_price)} · ${
                    product.entry_count
                  } ${product.entry_count === 1 ? 'entry' : 'entries'} · last ${formatDate(
                    product.last_purchase_date,
                  )}`
                : undefined
            }
            endContent={
              product?.product_code ? (
                <HStack gap={1}>
                  <Badge variant="neutral" label={product.product_code} />
                </HStack>
              ) : undefined
            }
          />
        );
      }}
    />
  );
}
