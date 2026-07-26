'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {
  Layout,
  LayoutContent,
  LayoutHeader,
  LayoutFooter,
  HStack,
  VStack,
  StackItem,
  Stack,
} from '@astryxdesign/core/Layout';
import {Text, Heading} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Pagination} from '@astryxdesign/core/Pagination';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Tooltip} from '@astryxdesign/core/Tooltip';
import {ToggleButton, ToggleButtonGroup} from '@astryxdesign/core/ToggleButton';
import {Link} from '@astryxdesign/core/Link';
import {useMediaQuery} from '@astryxdesign/core/hooks';
import NextLink from 'next/link';
import {DateRangeInput} from '@astryxdesign/core/DateRangeInput';
import type {DateRange} from '@astryxdesign/core/DateRangeInput';
import {
  Table,
  useTableSortable,
  useTableColumnResize,
  proportional,
  pixel,
} from '@astryxdesign/core/Table';
import type {TableColumn} from '@astryxdesign/core/Table';
import {PlusIcon, TableCellsIcon} from '@heroicons/react/24/outline';

import type {ProductSummary, Vendor} from '@/lib/types';
import {
  inr,
  pct,
  formatDate,
  relativeDays,
  daysSince,
  STALE_DAYS,
} from '@/lib/format';
import {getClient} from '@/lib/supabase/client';
import {useHasMounted} from '@/lib/useHasMounted';
import {fuzzyScoreAny} from '@/lib/fuzzy';
import {Sparkline} from '@/components/Sparkline';
import {ProductCodeCell} from './ProductCodeCell';
import {ProductRows} from './ProductRows';
import {ProductDialog} from './ProductDialog';

const PAGE_SIZE = 50;

// Responsive contract for this page:
//   >= 1200px full table: description | code | price | change | last | entries | trend
//   >= 1024px drop Entries and Product code — the columns a pricing decision
//             rarely needs (both still editable on the detail page)
//   <  1024px the table is replaced by ProductRows (edge-to-edge rows), because
//             a 260px side nav leaves an 834px tablet only ~574px of content —
//             not enough for five columns without horizontal scrolling. The
//             toolbar stacks, its controls go full-width, and the page action
//             becomes icon-only.
const BP_TABLE = '(min-width: 1024px)';
const BP_WIDE = '(min-width: 1200px)';

type SortState = Array<{
  sortKey: string;
  direction: 'ascending' | 'descending';
}>;

type Chip = 'uncoded' | 'single' | 'stale' | 'increased';

const CHIP_LABEL: Record<Chip, string> = {
  uncoded: 'Uncoded',
  single: 'Single purchase',
  stale: `Not purchased in ${STALE_DAYS}d`,
  increased: 'Price increased',
};

/** Abbreviated chip labels for narrow viewports. */
const CHIP_LABEL_SHORT: Record<Chip, string> = {
  uncoded: 'Uncoded',
  single: 'One-off',
  stale: 'Stale',
  increased: 'Rising',
};

/** Financial-year presets, because that is how the ledger itself is cut. */
const RANGE_PRESETS = [
  {label: 'FY 2024-25', getRange: () => fy(2024)},
  {label: 'FY 2025-26', getRange: () => fy(2025)},
  {label: 'FY 2026-27', getRange: () => fy(2026)},
];

/** Indian financial year: 1 Apr of `startYear` to 31 Mar of the next. */
function fy(startYear: number): DateRange {
  return {
    start: `${startYear}-04-01` as DateRange['start'],
    end: `${startYear + 1}-03-31` as DateRange['end'],
  };
}

export function ProductsView({
  initialRows,
  vendors,
}: {
  initialRows: ProductSummary[];
  vendors: Vendor[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ProductSummary[]>(initialRows);
  // The all-time product count, held constant so the header keeps a stable
  // denominator once a date range narrows `rows`.
  const totalProducts = initialRows.length;
  const [range, setRange] = useState<DateRange | null>(null);
  const [search, setSearch] = useState('');
  const [chips, setChips] = useState<Chip[]>([]);
  const [sort, setSort] = useState<SortState>([
    {sortKey: 'last_purchase_date', direction: 'descending'},
  ]);
  const [page, setPage] = useState(1);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [liveNotice, setLiveNotice] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  // Relative dates depend on "now", which differs between the UTC server and
  // an IST browser. They are rendered only after hydration.
  const hasMounted = useHasMounted();

  // useMediaQuery is SSR-safe and returns the server default on first render,
  // so the desktop table is what gets server-rendered and there is no
  // hydration mismatch; narrow viewports swap to rows immediately after.
  const isTableLayout = useMediaQuery(BP_TABLE, true);
  const isWide = useMediaQuery(BP_WIDE, true);

  // Only surface the vendor column once a second vendor actually exists
  // (PRD §10) — the field is modelled and stored either way.
  const showVendor = vendors.length > 1;

  // ------------------------------------------------------------ data loading
  const rangeKey = `${range?.start ?? ''}|${range?.end ?? ''}`;

  const load = useCallback(async () => {
    setIsRefreshing(true);
    const {data, error: rpcError} = await getClient().rpc('product_summary', {
      p_from: range?.start ?? null,
      p_to: range?.end ?? null,
    });
    if (rpcError) setError(rpcError.message);
    else {
      setRows((data ?? []) as ProductSummary[]);
      setError(null);
    }
    setIsRefreshing(false);
  }, [range?.start, range?.end]);

  // Refetch when the window changes. Skipped on first mount — the server
  // already delivered the all-time rows.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    void load();
    setPage(1);
  }, [rangeKey, load]);

  // ---------------------------------------------------------------- realtime
  // A remote change invalidates derived metrics for a row, so the summary is
  // refetched — but coalesced, so a burst of inserts costs one round trip
  // rather than one per event (PRD §7).
  useEffect(() => {
    const supabase = getClient();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (message: string) => {
      setLiveNotice(message);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void load();
        setTimeout(() => setLiveNotice(null), 2500);
      }, 300);
    };

    const channel = supabase
      .channel('products-table')
      .on(
        'postgres_changes',
        {event: '*', schema: 'public', table: 'price_entries'},
        () => schedule('Price data was updated by someone else — refreshed.'),
      )
      .on(
        'postgres_changes',
        {event: '*', schema: 'public', table: 'products'},
        () => schedule('The product list was updated by someone else — refreshed.'),
      )
      .subscribe();

    // Close any gap opened by a dropped socket.
    const onOnline = () => void load();
    window.addEventListener('online', onOnline);

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  // ----------------------------------------------------------------- filters
  // Search is fuzzy and ranked (see lib/fuzzy): 'rc370' finds 'RC 370B ...',
  // '282 bvp' finds 'BVP282 ...'. Signify part descriptions have inconsistent
  // spacing, so a plain substring test misses obvious intent.
  const filtered = useMemo(() => {
    const query = search.trim();

    const matches = rows.filter(r => {
      for (const chip of chips) {
        if (chip === 'uncoded' && r.product_code) return false;
        if (chip === 'single' && r.entry_count !== 1) return false;
        if (chip === 'stale') {
          // Only reachable after hydration (a chip must be clicked), but the
          // guard keeps "now" out of the server render for certain.
          if (!hasMounted) return false;
          const age = daysSince(r.last_purchase_date);
          if (age === null || age <= STALE_DAYS) return false;
        }
        if (chip === 'increased' && !(r.change_pct !== null && r.change_pct > 0))
          return false;
      }
      return true;
    });

    if (!query) return matches;

    // Rank by match quality so the intended product surfaces first. This is a
    // display ordering only — it never merges or renames anything.
    return matches
      .map(r => ({
        r,
        score: fuzzyScoreAny(query, [
          r.description,
          r.product_code,
          showVendor ? r.vendor_name : null,
        ]),
      }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.r);
  }, [rows, search, chips, showVendor, hasMounted]);

  // -------------------------------------------------------------------- sort
  const sorted = useMemo(() => {
    // A search query supplies its own relevance ordering; re-sorting by a
    // column would bury the best match.
    if (search.trim()) return filtered;
    if (sort.length === 0) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      for (const {sortKey, direction} of sort) {
        const dir = direction === 'ascending' ? 1 : -1;
        const cmp = compareBy(sortKey, a, b);
        if (cmp !== 0) return cmp * dir;
      }
      return 0;
    });
    return copy;
  }, [filtered, sort, search]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // ----------------------------------------------------------------- plugins
  const sortable = useTableSortable<ProductSummary>({
    sort,
    onSortChange: next => setSort([...next] as SortState),
  });
  const columns = useMemo<TableColumn<ProductSummary>[]>(() => {
    const cols: TableColumn<ProductSummary>[] = [
      {
        key: 'description',
        header: 'Description',
        width: proportional(3),
        sortable: true,
        // A ghost Button was wrong here: buttons size to their content, so a
        // 45-character Signify description overflowed the column and collided
        // with the next cell.
        //
        // Link's own `maxLines` does not help either: it clamps the inner Text,
        // but the anchor itself renders as inline-flex with overflow:visible, so
        // the clamp box just grows with the content. The `<td>` is already
        // overflow:hidden / white-space:nowrap under table-layout:fixed, so the
        // anchor only needs to become a block that participates in that
        // clipping. Structural properties only — no colour, size or spacing here.
        renderCell: (row: ProductSummary) => (
          <Link
            as={NextLink}
            href={`/products/${row.product_id}`}
            tooltip={row.description}
            style={{
              display: 'block',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {row.description}
          </Link>
        ),
      },
      {
        key: 'product_code',
        header: 'Product code',
        width: pixel(160),
        sortable: true,
        renderCell: (row: ProductSummary) => (
          <ProductCodeCell
            productId={row.product_id}
            code={row.product_code}
            onSaved={load}
            onError={setError}
          />
        ),
      },
    ];

    if (showVendor) {
      cols.push({
        key: 'vendor_name',
        header: 'Vendor',
        width: pixel(180),
        sortable: true,
        renderCell: (row: ProductSummary) => (
          <Text type="body">{row.vendor_name}</Text>
        ),
      });
    }

    cols.push(
      {
        key: 'current_price',
        header: 'Current price',
        width: pixel(140),
        align: 'end',
        sortable: true,
        renderCell: (row: ProductSummary) => (
          <Text type="body" weight="medium" hasTabularNumbers>
            {inr(row.current_price)}
          </Text>
        ),
      },
      {
        key: 'change_pct',
        header: 'Change',
        width: pixel(110),
        align: 'end',
        sortable: true,
        renderCell: (row: ProductSummary) => <ChangeBadge value={row.change_pct} />,
      },
      {
        key: 'last_purchase_date',
        header: 'Last purchased',
        width: pixel(150),
        sortable: true,
        renderCell: (row: ProductSummary) =>
          hasMounted ? (
            <Tooltip content={relativeDays(row.last_purchase_date)}>
              <Text type="body">{formatDate(row.last_purchase_date)}</Text>
            </Tooltip>
          ) : (
            <Text type="body">{formatDate(row.last_purchase_date)}</Text>
          ),
      },
      {
        key: 'entry_count',
        header: 'Entries',
        width: pixel(90),
        align: 'end',
        sortable: true,
        renderCell: (row: ProductSummary) => (
          <Text type="body" hasTabularNumbers>
            {row.entry_count}
          </Text>
        ),
      },
      {
        key: 'sparkline',
        header: 'Price trend',
        width: pixel(150),
        renderCell: (row: ProductSummary) => (
          <Sparkline
            points={row.sparkline}
            label={`${row.description} price trend`}
          />
        ),
      },
    );

    // Shed the columns a pricing decision rarely needs before the table is
    // forced into horizontal scrolling. Entries goes first, then Product code
    // (still editable from the detail page).
    return isWide
      ? cols
      : cols.filter(c => c.key !== 'entry_count' && c.key !== 'product_code');
  }, [showVendor, load, hasMounted, isWide]);

  const columnResize = useTableColumnResize<ProductSummary>({
    columnWidths,
    // UseTableColumnResizeConfig pins `columns` to TableColumn<Record<string,
    // unknown>>[] rather than making it generic, and TableColumn<T> is
    // invariant in T (renderCell consumes T). The hook only reads `key` and
    // `width` off these, so narrowing here is safe.
    columns: columns as unknown as TableColumn<Record<string, unknown>>[],
    onColumnResizeEnd: updates =>
      setColumnWidths(prev => ({...prev, ...updates})),
  });

  const hasFilters = Boolean(search.trim()) || chips.length > 0 || range !== null;

  return (
    // The dialog sits OUTSIDE Layout: Layout resolves its body as
    // `content ?? children`, so anything passed as a child is silently dropped
    // whenever `content` is set.
    <>
      <Layout
        height="fill"
      header={
        <LayoutHeader hasDivider>
          <VStack gap={isTableLayout ? 3 : 2} padding={isTableLayout ? 3 : 2}>
            <HStack gap={2} vAlign="center">
              <StackItem size="fill">
                <VStack gap={0.5}>
                  <Heading level={1}>Products</Heading>
                  <Text type="supporting">
                    {sorted.length === totalProducts
                      ? `${totalProducts} products`
                      : `${sorted.length} of ${totalProducts} products`}
                    {range ? ' in range' : ''}
                    {isRefreshing ? ' · refreshing…' : ''}
                  </Text>
                </VStack>
              </StackItem>
              <Button
                label="Add product"
                variant="primary"
                // Icon-only on narrow screens: the title already says
                // "Products", so the word is redundant and the space is not.
                isIconOnly={!isTableLayout}
                icon={<PlusIcon width={16} height={16} />}
                onClick={() => setIsDialogOpen(true)}
              />
            </HStack>

            {/* The toolbar stacks below the table breakpoint and its controls
                go full-width — side-by-side inputs at 390px leave each one too
                narrow to read its own placeholder. */}
            <Stack
              direction={isTableLayout ? 'horizontal' : 'vertical'}
              gap={2}
              vAlign={isTableLayout ? 'end' : undefined}
              wrap={isTableLayout ? 'wrap' : undefined}
            >
              <StackItem size={isTableLayout ? undefined : 'fill'}>
                <SearchField value={search} onChange={setSearch} />
              </StackItem>
              <StackItem size={isTableLayout ? undefined : 'fill'}>
                <DateRangeInput
                  label="Purchase date range"
                  isLabelHidden={!isTableLayout}
                  value={range}
                  onChange={setRange}
                  presets={RANGE_PRESETS}
                  placeholder="All time"
                  size="md"
                />
              </StackItem>
              {/* OverflowList would hide chips behind a "+2" affordance; on a
                  work queue every chip should stay reachable, so they wrap. */}
              <ToggleButtonGroup
                label="Quick filters"
                type="multiple"
                size="sm"
                value={chips}
                onChange={value => {
                  setChips((value as Chip[]) ?? []);
                  setPage(1);
                }}
              >
                {(Object.keys(CHIP_LABEL) as Chip[]).map(chip => (
                  <ToggleButton
                    key={chip}
                    value={chip}
                    label={isTableLayout ? CHIP_LABEL[chip] : CHIP_LABEL_SHORT[chip]}
                  />
                ))}
              </ToggleButtonGroup>
            </Stack>

            {error ? (
              <Banner
                status="error"
                container="section"
                title={error}
                isDismissable
                onDismiss={() => setError(null)}
              />
            ) : null}
            {liveNotice ? (
              <Banner status="info" container="section" title={liveNotice} />
            ) : null}
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent padding={0}>
          {pageRows.length === 0 ? (
            <EmptyState
              icon={<TableCellsIcon width={32} height={32} />}
              title={hasFilters ? 'No products match these filters' : 'No products yet'}
              description={
                hasFilters
                  ? 'Widen the date range, clear a quick filter, or change the search.'
                  : 'Add a product, or seed a vendor ledger with the import script.'
              }
              actions={
                hasFilters ? (
                  <Button
                    label="Clear filters"
                    onClick={() => {
                      setSearch('');
                      setChips([]);
                      setRange(null);
                    }}
                  />
                ) : (
                  <Button
                    label="Add product"
                    variant="primary"
                    onClick={() => setIsDialogOpen(true)}
                  />
                )
              }
            />
          ) : isTableLayout ? (
            <Table<ProductSummary>
              data={pageRows}
              columns={columns}
              idKey="product_id"
              density="compact"
              dividers="rows"
              hasHover
              textOverflow="truncate"
              plugins={{sortable, columnResize}}
            />
          ) : (
            <ProductRows rows={pageRows} />
          )}
        </LayoutContent>
      }
      footer={
        sorted.length > PAGE_SIZE ? (
          <LayoutFooter hasDivider>
            <Stack direction="horizontal" hAlign="center" padding={2}>
              <Pagination
                page={safePage}
                onChange={setPage}
                totalItems={sorted.length}
                pageSize={PAGE_SIZE}
                variant="count"
                size="sm"
              />
            </Stack>
          </LayoutFooter>
        ) : undefined
      }
      />
      {isDialogOpen ? (
        <ProductDialog
          isOpen
          onClose={() => setIsDialogOpen(false)}
          vendors={vendors}
          existing={rows.map(r => ({
            id: r.product_id,
            description: r.description,
            product_code: r.product_code,
          }))}
          onSaved={async id => {
            await load();
            if (id) router.push(`/products/${id}`);
          }}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- helpers

function compareBy(key: string, a: ProductSummary, b: ProductSummary): number {
  switch (key) {
    case 'description':
      return a.description.localeCompare(b.description);
    case 'product_code':
      // Uncoded rows sort last in either direction — they are a work queue,
      // not a value.
      if (!a.product_code && !b.product_code) return 0;
      if (!a.product_code) return 1;
      if (!b.product_code) return -1;
      return a.product_code.localeCompare(b.product_code);
    case 'vendor_name':
      return a.vendor_name.localeCompare(b.vendor_name);
    case 'current_price':
      return nullLast(a.current_price, b.current_price);
    case 'change_pct':
      return nullLast(a.change_pct, b.change_pct);
    case 'entry_count':
      return a.entry_count - b.entry_count;
    case 'last_purchase_date':
      return (a.last_purchase_date ?? '').localeCompare(b.last_purchase_date ?? '');
    default:
      return 0;
  }
}

function nullLast(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function ChangeBadge({value}: {value: number | null}) {
  if (value === null) {
    return (
      <Text type="body" color="secondary">
        —
      </Text>
    );
  }
  // Up / down / flat is an enumerated state, which is what Badge is for.
  // A rising cost is the thing to notice, so it takes the warning tone.
  const variant = value > 0.05 ? 'warning' : value < -0.05 ? 'success' : 'neutral';
  return <Badge variant={variant} label={pct(value)} />;
}

/**
 * Plain single-field search rather than PowerSearch.
 *
 * The PRD floated PowerSearch "if warranted". It isn't: the two useful axes
 * here are description and product code, both free text, and PowerSearch's
 * field/operator/value tokens would add three interactions per query without
 * adding reach. The enumerated dimensions are covered by the four quick
 * filters beside it.
 */
function SearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <TextInput
      label="Search description or product code"
      isLabelHidden
      value={value}
      onChange={onChange}
      placeholder="Search description or product code…"
      hasClear
      size="md"
    />
  );
}
