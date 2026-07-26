'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useRouter} from 'next/navigation';
import {
  Layout,
  LayoutContent,
  LayoutHeader,
  HStack,
  VStack,
  StackItem,
} from '@astryxdesign/core/Layout';
import {Grid} from '@astryxdesign/core/Grid';
import {Section} from '@astryxdesign/core/Section';
import {Card} from '@astryxdesign/core/Card';
import {Text, Heading} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Badge} from '@astryxdesign/core/Badge';
import {Banner} from '@astryxdesign/core/Banner';
import {Breadcrumbs, BreadcrumbItem} from '@astryxdesign/core/Breadcrumbs';
import {DateRangeInput} from '@astryxdesign/core/DateRangeInput';
import type {DateRange} from '@astryxdesign/core/DateRangeInput';
import {AlertDialog} from '@astryxdesign/core/AlertDialog';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {
  Table,
  useTableSortable,
  proportional,
  pixel,
} from '@astryxdesign/core/Table';
import type {TableColumn} from '@astryxdesign/core/Table';
import {Chart, ChartAxis, ChartGrid, line, dot} from '@astryxdesign/charts';
import {PlusIcon, PencilSquareIcon, TrashIcon} from '@heroicons/react/24/outline';

import type {Product, ProductEntryRow, Vendor} from '@/lib/types';
import {inr, qty, pct, formatDate, relativeDays} from '@/lib/format';
import {getClient} from '@/lib/supabase/client';
import {deletePriceEntry} from '@/lib/actions';
import {ProductDialog} from '../ProductDialog';
import {PriceEntryDialog} from './PriceEntryDialog';

const EPOCH_DAY = 86_400_000;

/** 'YYYY-MM-DD' → days since epoch. Pure calendar arithmetic, no local tz. */
function toDayNumber(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / EPOCH_DAY);
}

function fromDayNumber(day: number): string {
  return new Date(day * EPOCH_DAY).toISOString().slice(0, 10);
}

type SortState = Array<{sortKey: string; direction: 'ascending' | 'descending'}>;

export function ProductDetail({
  product,
  vendorName,
  vendors,
  initialEntries,
}: {
  product: Product;
  vendorName: string;
  vendors: Vendor[];
  initialEntries: ProductEntryRow[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<ProductEntryRow[]>(initialEntries);

  // This range is deliberately independent of the main table's filter
  // (PRD US-10) — nothing is shared between the two views.
  const [range, setRange] = useState<DateRange | null>(null);
  const [sort, setSort] = useState<SortState>([
    {sortKey: 'purchase_date', direction: 'descending'},
  ]);
  const [error, setError] = useState<string | null>(null);
  const [liveNotice, setLiveNotice] = useState<string | null>(null);
  const [isProductDialogOpen, setIsProductDialogOpen] = useState(false);
  const [entryDialog, setEntryDialog] = useState<
    {mode: 'create'} | {mode: 'edit'; entry: ProductEntryRow} | null
  >(null);
  const [pendingDelete, setPendingDelete] = useState<ProductEntryRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const rangeKey = `${range?.start ?? ''}|${range?.end ?? ''}`;

  const load = useCallback(async () => {
    const {data, error: rpcError} = await getClient().rpc('product_entries', {
      p_product_id: product.id,
      p_from: range?.start ?? null,
      p_to: range?.end ?? null,
    });
    if (rpcError) setError(rpcError.message);
    else {
      setEntries((data ?? []) as ProductEntryRow[]);
      setError(null);
    }
  }, [product.id, range?.start, range?.end]);

  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    void load();
  }, [rangeKey, load]);

  // Realtime, scoped server-side to this product's entries plus this product
  // row. The chart and the entries table both derive from `entries`, so one
  // list is the single source of truth for both (PRD §7).
  useEffect(() => {
    const supabase = getClient();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      setLiveNotice('Updated by someone else.');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void load();
        setTimeout(() => setLiveNotice(null), 2500);
      }, 300);
    };

    const channel = supabase
      .channel(`product-${product.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'price_entries',
          filter: `product_id=eq.${product.id}`,
        },
        schedule,
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'products',
          filter: `id=eq.${product.id}`,
        },
        () => router.refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'products',
          filter: `id=eq.${product.id}`,
        },
        () => {
          setError('This product was removed. Returning to the product list.');
          setTimeout(() => router.push('/products'), 1500);
        },
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [product.id, load, router]);

  // -------------------------------------------------------------------- stats
  const stats = useMemo(() => {
    if (entries.length === 0) return null;
    // product_entries returns newest-first.
    const chronological = [...entries].sort((a, b) =>
      a.purchase_date.localeCompare(b.purchase_date),
    );
    const prices = chronological.map(e => Number(e.unit_price));
    const first = prices[0];
    const current = prices[prices.length - 1];
    return {
      count: entries.length,
      first,
      current,
      min: Math.min(...prices),
      max: Math.max(...prices),
      changePct: first ? ((current - first) / first) * 100 : null,
      firstDate: chronological[0].purchase_date,
      lastDate: chronological[chronological.length - 1].purchase_date,
      chronological,
    };
  }, [entries]);

  // -------------------------------------------------------------------- chart
  // x is a day number on a linear scale, not the date string: a band scale
  // would collapse the two entries that share a date, and a linear axis also
  // shows the real gaps between purchases.
  const chartData = useMemo(
    () =>
      (stats?.chronological ?? []).map(e => ({
        day: toDayNumber(e.purchase_date),
        price: Number(e.unit_price),
      })),
    [stats],
  );

  const chartSeries = useMemo(
    () => [
      line('price', {curve: 'linear', strokeWidth: 2}),
      // dodge spreads coincident points, so both prices on a shared date stay
      // individually visible (PRD §2.6a).
      dot('price', {radius: 3, dodge: true}),
    ],
    [],
  );

  const sortable = useTableSortable<ProductEntryRow>({
    sort,
    onSortChange: next => setSort([...next] as SortState),
  });

  const sortedEntries = useMemo(() => {
    const copy = [...entries];
    const spec = sort[0];
    if (!spec) return copy;
    const dir = spec.direction === 'ascending' ? 1 : -1;
    copy.sort((a, b) => {
      let cmp = 0;
      switch (spec.sortKey) {
        case 'purchase_date':
          cmp = a.purchase_date.localeCompare(b.purchase_date);
          break;
        case 'unit_price':
          cmp = Number(a.unit_price) - Number(b.unit_price);
          break;
        case 'quantity':
          cmp = Number(a.quantity) - Number(b.quantity);
          break;
        case 'line_amount':
          cmp = Number(a.line_amount ?? 0) - Number(b.line_amount ?? 0);
          break;
        case 'voucher_no':
          cmp = (a.voucher_no ?? '').localeCompare(b.voucher_no ?? '');
          break;
        default:
          cmp = 0;
      }
      // Stable tie-break, so a shared date never reorders between renders.
      return cmp !== 0 ? cmp * dir : a.created_at.localeCompare(b.created_at);
    });
    return copy;
  }, [entries, sort]);

  const columns = useMemo<TableColumn<ProductEntryRow>[]>(
    () => [
      {
        key: 'purchase_date',
        header: 'Purchase date',
        width: pixel(150),
        sortable: true,
        renderCell: e => <Text type="body">{formatDate(e.purchase_date)}</Text>,
      },
      {
        key: 'unit_price',
        header: 'Unit price',
        width: pixel(130),
        align: 'end',
        sortable: true,
        renderCell: e => (
          <Text type="body" weight="medium">
            {inr(Number(e.unit_price))}
          </Text>
        ),
      },
      {
        key: 'quantity',
        header: 'Qty',
        width: pixel(90),
        align: 'end',
        sortable: true,
        renderCell: e => <Text type="body">{qty(Number(e.quantity))}</Text>,
      },
      {
        key: 'line_amount',
        header: 'Line amount',
        width: pixel(140),
        align: 'end',
        sortable: true,
        renderCell: e => (
          <Text type="body" color="secondary">
            {e.line_amount === null ? '—' : inr(Number(e.line_amount))}
          </Text>
        ),
      },
      {
        key: 'voucher_no',
        header: 'Voucher no.',
        width: pixel(140),
        sortable: true,
        renderCell: e => (
          <Text type="body" color="secondary">
            {e.voucher_no ?? '—'}
          </Text>
        ),
      },
      {
        key: 'source',
        header: 'Source',
        width: pixel(110),
        renderCell: e => (
          <Badge
            variant={e.source === 'manual' ? 'info' : 'neutral'}
            label={e.source === 'manual' ? 'Manual' : 'Imported'}
          />
        ),
      },
      {
        key: 'created_by_email',
        header: 'Added by',
        width: proportional(1),
        renderCell: e => (
          <Text type="supporting">{e.created_by_email ?? 'Unknown'}</Text>
        ),
      },
      {
        key: 'actions',
        header: '',
        width: pixel(96),
        resizable: false,
        renderCell: e => (
          <HStack gap={1}>
            <Button
              label="Edit entry"
              isIconOnly
              variant="ghost"
              size="sm"
              icon={<PencilSquareIcon width={16} height={16} />}
              onClick={() => setEntryDialog({mode: 'edit', entry: e})}
            />
            <Button
              label="Delete entry"
              isIconOnly
              variant="ghost"
              size="sm"
              icon={<TrashIcon width={16} height={16} />}
              onClick={() => setPendingDelete(e)}
            />
          </HStack>
        ),
      },
    ],
    [],
  );

  async function confirmDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    const result = await deletePriceEntry({
      id: pendingDelete.id,
      productId: product.id,
    });
    setIsDeleting(false);
    setPendingDelete(null);
    if (!result.ok) setError(result.error);
    else await load();
  }

  return (
    // The dialogs sit OUTSIDE Layout: Layout resolves its body as
    // `content ?? children`, so anything passed as a child is silently
    // dropped whenever `content` is set.
    <>
      <Layout
      height="fill"
      header={
        <LayoutHeader hasDivider>
          <VStack gap={3} padding={3}>
            <Breadcrumbs>
              <BreadcrumbItem href="/products">Products</BreadcrumbItem>
              <BreadcrumbItem isCurrent>{product.description}</BreadcrumbItem>
            </Breadcrumbs>

            <HStack gap={2} vAlign="start">
              <StackItem size="fill">
                <VStack gap={1}>
                  <Heading level={1}>{product.description}</Heading>
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <Badge
                      variant={product.product_code ? 'neutral' : 'warning'}
                      label={product.product_code ?? 'No product code'}
                    />
                    <Text type="supporting">{vendorName}</Text>
                    {product.notes ? (
                      <Text type="supporting">· {product.notes}</Text>
                    ) : null}
                  </HStack>
                </VStack>
              </StackItem>
              <Button
                label="Edit product"
                variant="secondary"
                icon={<PencilSquareIcon width={16} height={16} />}
                onClick={() => setIsProductDialogOpen(true)}
              />
              <Button
                label="Add price entry"
                variant="primary"
                icon={<PlusIcon width={16} height={16} />}
                onClick={() => setEntryDialog({mode: 'create'})}
              />
            </HStack>

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
        <LayoutContent padding={3}>
          <VStack gap={4}>
            {/* Stat row. Cards are right here: six discrete, comparable
                figures in a grid is exactly what Card is for. */}
            <Grid columns={{minWidth: 150, max: 6}} gap={2}>
              <StatCard label="Current price" value={inr(stats?.current ?? null)} />
              <StatCard label="First price" value={inr(stats?.first ?? null)} />
              <StatCard
                label="Change"
                value={pct(stats?.changePct ?? null)}
                tone={
                  stats?.changePct == null
                    ? 'neutral'
                    : stats.changePct > 0.05
                      ? 'warning'
                      : stats.changePct < -0.05
                        ? 'success'
                        : 'neutral'
                }
              />
              <StatCard label="Lowest" value={inr(stats?.min ?? null)} />
              <StatCard label="Highest" value={inr(stats?.max ?? null)} />
              <StatCard
                label="Entries"
                value={String(stats?.count ?? 0)}
                hint={
                  stats?.lastDate
                    ? `last ${relativeDays(stats.lastDate)}`
                    : undefined
                }
              />
            </Grid>

            <Section padding={3}>
              <VStack gap={3}>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <StackItem size="fill">
                    <VStack gap={0.5}>
                      <Heading level={2}>Price history</Heading>
                      <Text type="supporting">
                        {stats
                          ? `${stats.count} purchase${
                              stats.count === 1 ? '' : 's'
                            } · ${formatDate(stats.firstDate)} → ${formatDate(
                              stats.lastDate,
                            )}`
                          : 'No purchases in this range'}
                      </Text>
                    </VStack>
                  </StackItem>
                  <DateRangeInput
                    label="Date range"
                    isLabelHidden
                    value={range}
                    onChange={setRange}
                    placeholder="All time"
                    size="sm"
                  />
                </HStack>
              {chartData.length === 0 ? (
                <EmptyState
                  isCompact
                  title="No price history in this range"
                  description="Widen the date range, or add a price entry."
                />
              ) : chartData.length === 1 ? (
                <VStack gap={2}>
                  <Chart
                    data={chartData}
                    xKey="day"
                    series={chartSeries}
                    height={280}
                    yBaseline="data"
                    margin={{left: 72, right: 16, top: 16, bottom: 32}}
                    grid={<ChartGrid horizontal />}
                    axes={
                      <>
                        <ChartAxis
                          position="bottom"
                          tickCount={2}
                          tickFormat={v => formatDate(fromDayNumber(Number(v)))}
                        />
                        <ChartAxis
                          position="left"
                          tickCount={3}
                          tickFormat={v => inr(Number(v))}
                        />
                      </>
                    }
                  />
                  <Text type="supporting">
                    Only one purchase on record, so there is no trend to plot yet.
                    A second entry will draw the line.
                  </Text>
                </VStack>
              ) : (
                <Chart
                  data={chartData}
                  xKey="day"
                  series={chartSeries}
                  height={320}
                  // Not zero-baselined: the moves that matter here are 5-20%,
                  // and a zero baseline flattens them (PRD §9.4).
                  yBaseline="data"
                  margin={{left: 72, right: 16, top: 16, bottom: 32}}
                  grid={<ChartGrid horizontal />}
                  axes={
                    <>
                      <ChartAxis
                        position="bottom"
                        tickCount={6}
                        tickFormat={v => formatDate(fromDayNumber(Number(v)))}
                      />
                      <ChartAxis
                        position="left"
                        tickCount={5}
                        tickFormat={v => inr(Number(v))}
                      />
                    </>
                  }
                  tooltip={{
                    render: xValue => {
                      const iso = fromDayNumber(Number(xValue));
                      const sameDay = entries.filter(
                        e => e.purchase_date.slice(0, 10) === iso,
                      );
                      if (sameDay.length === 0) return null;
                      return (
                        <VStack gap={1}>
                          <Text type="label">{formatDate(iso)}</Text>
                          {sameDay.map(e => (
                            <Text key={e.id} type="supporting">
                              {inr(Number(e.unit_price))} · qty {qty(Number(e.quantity))}
                              {e.voucher_no ? ` · ${e.voucher_no}` : ''}
                            </Text>
                          ))}
                        </VStack>
                      );
                    },
                  }}
                />
              )}
              </VStack>
            </Section>

            <Section padding={3}>
              <VStack gap={3}>
                <VStack gap={0.5}>
                  <Heading level={2}>Purchase entries</Heading>
                  <Text type="supporting">
                    Every recorded purchase of this product. Debit notes from the
                    vendor ledger are excluded — they are returns booked at the
                    original rate, not new prices.
                  </Text>
                </VStack>
              {sortedEntries.length === 0 ? (
                <EmptyState
                  isCompact
                  title="No entries in this range"
                  description="Clear the date range, or add a price entry."
                  actions={
                    <Button
                      label="Add price entry"
                      variant="primary"
                      onClick={() => setEntryDialog({mode: 'create'})}
                    />
                  }
                />
              ) : (
                <Table<ProductEntryRow>
                  data={sortedEntries}
                  columns={columns}
                  idKey="id"
                  density="compact"
                  dividers="rows"
                  hasHover
                  plugins={{sortable}}
                />
              )}
              </VStack>
            </Section>
          </VStack>
        </LayoutContent>
      }
      />
      {isProductDialogOpen ? (
        <ProductDialog
          isOpen
          onClose={() => setIsProductDialogOpen(false)}
          vendors={vendors}
          product={product}
          onSaved={() => router.refresh()}
        />
      ) : null}

      {entryDialog ? (
        <PriceEntryDialog
          isOpen
          productId={product.id}
          entry={entryDialog.mode === 'edit' ? entryDialog.entry : undefined}
          onClose={() => setEntryDialog(null)}
          onSaved={async () => {
            setEntryDialog(null);
            await load();
          }}
        />
      ) : null}

      <AlertDialog
        isOpen={pendingDelete !== null}
        onOpenChange={open => !open && setPendingDelete(null)}
        title="Delete this price entry?"
        description={
          pendingDelete
            ? `${formatDate(pendingDelete.purchase_date)} · ${inr(
                Number(pendingDelete.unit_price),
              )} · qty ${qty(Number(pendingDelete.quantity))}${
                pendingDelete.source === 'ledger_import'
                  ? '. This row came from a vendor ledger import, so deleting it removes real recorded history.'
                  : '.'
              }`
            : ''
        }
        actionLabel="Delete entry"
        cancelLabel="Keep it"
        actionVariant="destructive"
        isActionLoading={isDeleting}
        onAction={confirmDelete}
      />
    </>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  return (
    <Card padding={3}>
      <VStack gap={1}>
        <Text type="supporting">{label}</Text>
        {tone === 'neutral' ? (
          <Text type="large" weight="semibold">
            {value}
          </Text>
        ) : (
          <Badge variant={tone} label={value} />
        )}
        {hint ? <Text type="supporting">{hint}</Text> : null}
      </VStack>
    </Card>
  );
}
