/**
 * seed-ledger.ts — one-time ledger ingest. PRD §5.
 *
 * The source is a Tally *ledger account* print, not a table: rows 1-13 are
 * letterhead, row 14 is the header, and everything below is voucher-grouped
 * (a dated parent row followed by undated child rows).
 *
 * Ground truth this script asserts against (PRD §2.2):
 *   784 product lines total
 *   746 Purchase + 1 Intransit  -> 747 price_entries
 *    37 Debit Note              -> dropped entirely (PRD §2.3)
 *   195 distinct products
 *
 * There is deliberately no in-app importer (PRD §5). This script is the
 * documented path for onboarding vendor #2.
 */
import {readFileSync} from 'node:fs';
import * as XLSX from 'xlsx';
import {createClient} from '@supabase/supabase-js';

// ---------------------------------------------------------------- constants
const COL = {
  DATE: 0,
  DRCR: 1,
  PARTICULARS: 2,
  QTY: 3,
  RATE: 4,
  AMOUNT: 5,
  VCH_TYPE: 8,
  VCH_NO: 9,
  DEBIT: 10,
  CREDIT: 11,
} as const;

/** Voucher types whose product lines represent a real acquisition at a real rate. */
const PRICE_BEARING = new Set(['Purchase', 'Intransit']);

const EXPECTED = {
  productLines: 784,
  priceEntries: 747,
  debitNoteLines: 37,
  products: 195,
} as const;

const VENDOR_NAME = 'Signify Innovations India Ltd';
const VENDOR_DISPLAY = 'Signify (formerly Philips Lighting India)';

// ---------------------------------------------------------------- types
type Cell = string | number | Date | boolean | null | undefined;
type Row = Cell[];

interface ProductLine {
  description: string;
  quantity: number;
  unitPrice: number;
  lineAmount: number | null;
  purchaseDate: string; // YYYY-MM-DD
  voucherNo: string | null;
  voucherType: string;
  /** 1-based row number in the source sheet. The import key, and real provenance. */
  sourceLineNo: number;
}

// ---------------------------------------------------------------- helpers
function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isNum(v: Cell): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * The sheet is read with `cellDates: false` so every date arrives as an Excel
 * serial and is decoded by SSF, which is exact and timezone-free.
 *
 * `cellDates: true` must NOT be used here: it decodes 2024-04-05 to
 * 2024-04-04T23:59:50 local (a float-rounding artifact), which silently shifts
 * every purchase back one calendar day.
 */
function toIsoDate(v: Cell): string | null {
  if (typeof v === 'number') {
    const parsed = XLSX.SSF.parse_date_code(v);
    if (!parsed || !parsed.y) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  if (v instanceof Date) {
    // Defensive fallback only. Round to the nearest day to undo the artifact
    // above before formatting.
    const rounded = new Date(Math.round(v.getTime() / 86_400_000) * 86_400_000);
    return rounded.toISOString().slice(0, 10);
  }
  return null;
}

function text(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function inr(n: number): string {
  return `₹${n.toLocaleString('en-IN', {maximumFractionDigits: 2})}`;
}

// ---------------------------------------------------------------- parse
interface ParseResult {
  lines: ProductLine[];
  stats: {
    totalRows: number;
    voucherCount: number;
    productLines: number;
    byVoucherType: Record<string, number>;
    droppedDebitNote: number;
    droppedOtherVoucherType: Record<string, number>;
    nonProductLabels: Record<string, number>;
  };
}

function parseLedger(path: string): ParseResult {
  const wb = XLSX.read(readFileSync(path), {cellDates: false});
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });

  const headerIdx = rows.findIndex(r => text(r?.[COL.DATE]) === 'Date');
  if (headerIdx < 0) throw new Error('Could not locate the "Date" header row.');

  const stats: ParseResult['stats'] = {
    totalRows: rows.length - headerIdx - 1,
    voucherCount: 0,
    productLines: 0,
    byVoucherType: {},
    droppedDebitNote: 0,
    droppedOtherVoucherType: {},
    nonProductLabels: {},
  };

  const lines: ProductLine[] = [];
  let current: {date: string | null; type: string; no: string | null} | null = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const dateCell = row[COL.DATE];
    const iso = toIsoDate(dateCell);

    // A populated Date cell starts a new voucher.
    if (iso) {
      current = {
        date: iso,
        type: text(row[COL.VCH_TYPE]),
        no: text(row[COL.VCH_NO]) || null,
      };
      stats.voucherCount++;
      continue;
    }
    if (!current) continue;

    // Product line test (PRD §2.1): description present AND qty and rate both
    // numeric. Every non-product label — Purchase, CGST, SGST, IGST,
    // Rounding Off, TCS on Purchase, New Ref, Agst Ref, Closing Balance —
    // fails this test.
    const description = text(row[COL.PARTICULARS]);
    if (!description) continue;

    const qty = row[COL.QTY];
    const rate = row[COL.RATE];
    if (!isNum(qty) || !isNum(rate)) {
      stats.nonProductLabels[description.slice(0, 48)] =
        (stats.nonProductLabels[description.slice(0, 48)] ?? 0) + 1;
      continue;
    }

    stats.productLines++;
    stats.byVoucherType[current.type] =
      (stats.byVoucherType[current.type] ?? 0) + 1;

    // --- the Debit Note decision (PRD §2.3) -------------------------------
    // Debit Notes are returns, recorded at the ORIGINAL purchase rate. A 2026
    // return tagged at a 2024 rate would render as a price crash that never
    // happened. They never reach price_entries.
    if (current.type === 'Debit Note') {
      stats.droppedDebitNote++;
      continue;
    }
    if (!PRICE_BEARING.has(current.type)) {
      stats.droppedOtherVoucherType[current.type] =
        (stats.droppedOtherVoucherType[current.type] ?? 0) + 1;
      continue;
    }

    const amount = row[COL.AMOUNT];
    lines.push({
      description,
      quantity: qty,
      unitPrice: rate,
      lineAmount: isNum(amount) ? amount : null,
      purchaseDate: current.date!,
      voucherNo: current.no,
      voucherType: current.type,
      sourceLineNo: i + 1, // 1-based, matches what a human sees in Excel
    });
  }

  return {lines, stats};
}

// ---------------------------------------------------------------- anomalies
/** Identical repeated lines (PRD §2.6b) — ingested, but reported for review. */
function findIdenticalGroups(lines: ProductLine[]) {
  const map = new Map<string, ProductLine[]>();
  for (const l of lines) {
    const k = `${l.purchaseDate}|${l.description}|${l.quantity}|${l.unitPrice}`;
    (map.get(k) ?? map.set(k, []).get(k)!).push(l);
  }
  return [...map.values()].filter(g => g.length > 1);
}

/** Two distinct prices on one day (PRD §2.6a) — legitimate, drives the tie-break. */
function findSameDayPriceSplits(lines: ProductLine[]) {
  const map = new Map<string, Set<number>>();
  for (const l of lines) {
    const k = `${l.purchaseDate}|${l.description}`;
    (map.get(k) ?? map.set(k, new Set()).get(k)!).add(l.unitPrice);
  }
  return [...map.entries()]
    .filter(([, prices]) => prices.size > 1)
    .map(([k, prices]) => {
      const [date, description] = k.split('|');
      return {date, description, prices: [...prices].sort((a, b) => a - b)};
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------- main
async function main() {
  const xlsxPath = process.env.SEED_LEDGER_XLSX;
  const batch = process.env.SEED_BATCH ?? 'signify-import';
  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? 'sales@aalino.com';
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const strict = process.env.SEED_STRICT !== 'false';

  if (!xlsxPath) throw new Error('SEED_LEDGER_XLSX is not set.');
  if (!url || !secret) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY are not set.');

  console.log('═'.repeat(72));
  console.log('Aalino ledger seed');
  console.log(`  source : ${xlsxPath}`);
  console.log(`  batch  : ${batch}`);
  console.log('═'.repeat(72));

  // ---- 1. parse -----------------------------------------------------------
  const {lines, stats} = parseLedger(xlsxPath);

  console.log('\n── PARSE ──');
  console.log(`  rows below header      ${stats.totalRows}`);
  console.log(`  vouchers               ${stats.voucherCount}`);
  console.log(`  product lines          ${stats.productLines}`);
  console.log('  product lines by voucher type:');
  for (const [t, n] of Object.entries(stats.byVoucherType).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${(t || '(blank)').padEnd(14)} ${String(n).padStart(4)}`);
  }
  console.log(`  DROPPED Debit Note     ${stats.droppedDebitNote}   (returns at original rate — PRD §2.3)`);
  for (const [t, n] of Object.entries(stats.droppedOtherVoucherType)) {
    console.log(`  DROPPED ${t.padEnd(14)} ${n}`);
  }
  console.log(`  → price-bearing lines  ${lines.length}`);

  const skippedLabels = Object.entries(stats.nonProductLabels).sort((a, b) => b[1] - a[1]);
  console.log(`  non-product labels skipped (${skippedLabels.length} distinct):`);
  for (const [label, n] of skippedLabels.slice(0, 12)) {
    console.log(`      ${String(n).padStart(4)}  ${label}`);
  }

  // ---- 2. assertions ------------------------------------------------------
  const failures: string[] = [];
  if (stats.productLines !== EXPECTED.productLines)
    failures.push(`product lines: expected ${EXPECTED.productLines}, got ${stats.productLines}`);
  if (stats.droppedDebitNote !== EXPECTED.debitNoteLines)
    failures.push(`debit note lines: expected ${EXPECTED.debitNoteLines}, got ${stats.droppedDebitNote}`);
  if (lines.length !== EXPECTED.priceEntries)
    failures.push(`price-bearing lines: expected ${EXPECTED.priceEntries}, got ${lines.length}`);

  const distinctNorm = new Set(lines.map(l => normalize(l.description)));
  const distinctRaw = new Set(lines.map(l => l.description.trim()));

  console.log('\n── DEDUP (exact match on normalized description; no fuzzy — PRD §2.5) ──');
  console.log(`  distinct raw descriptions        ${distinctRaw.size}`);
  console.log(`  distinct normalized descriptions ${distinctNorm.size}`);
  if (distinctRaw.size !== distinctNorm.size) {
    console.log('  NOTE: normalization collapsed some raw variants (whitespace/casing).');
  }

  // ---- 3. anomaly report --------------------------------------------------
  const identical = findIdenticalGroups(lines);
  console.log(`\n── IDENTICAL REPEATED LINES (PRD §2.6b) — ingested, flagged for review ──`);
  console.log(`  groups ${identical.length}, surplus rows ${identical.reduce((s, g) => s + g.length - 1, 0)}`);
  for (const g of identical) {
    const l = g[0];
    console.log(`      ×${g.length}  ${l.purchaseDate}  ${l.description.slice(0, 42).padEnd(42)} qty ${l.quantity} @ ${inr(l.unitPrice)}`);
  }

  const splits = findSameDayPriceSplits(lines);
  console.log(`\n── SAME DAY, DIFFERENT PRICE (PRD §2.6a) — legitimate; drives the current-price tie-break ──`);
  console.log(`  cases ${splits.length}`);
  for (const s of splits) {
    console.log(`      ${s.date}  ${s.description.slice(0, 42).padEnd(42)} ${s.prices.map(inr).join(', ')}`);
  }

  const prices = lines.map(l => l.unitPrice);
  const qtys = lines.map(l => l.quantity);
  const dates = lines.map(l => l.purchaseDate).sort();
  console.log('\n── RANGES ──');
  console.log(`  unit price  ${inr(Math.min(...prices))} – ${inr(Math.max(...prices))}`);
  console.log(`  quantity    ${Math.min(...qtys)} – ${Math.max(...qtys)}  (non-integer: ${qtys.filter(q => !Number.isInteger(q)).length})`);
  console.log(`  dates       ${dates[0]} → ${dates[dates.length - 1]}`);

  if (failures.length) {
    console.error('\n✗ GROUND-TRUTH ASSERTIONS FAILED:');
    for (const f of failures) console.error(`    ${f}`);
    console.error('\nThe source file does not match the analysis in PRD §2. Stopping.');
    console.error('Re-run with SEED_STRICT=false only if the deviation is understood.');
    if (strict) process.exit(1);
  } else {
    console.log('\n✓ all ground-truth assertions passed');
  }

  // ---- 4. write -----------------------------------------------------------
  const db = createClient(url, secret, {auth: {persistSession: false}});

  // vendor
  const {data: vendorRow, error: vendorErr} = await db
    .from('vendors')
    .select('id')
    .eq('name', VENDOR_NAME)
    .maybeSingle();
  if (vendorErr) throw vendorErr;

  let vendorId = vendorRow?.id as string | undefined;
  if (!vendorId) {
    const {data, error} = await db
      .from('vendors')
      .insert({name: VENDOR_NAME, display_name: VENDOR_DISPLAY})
      .select('id')
      .single();
    if (error) throw error;
    vendorId = data.id;
  }

  // owner user
  const {data: userList, error: userErr} = await db.auth.admin.listUsers({perPage: 1000});
  if (userErr) throw userErr;
  const owner = userList.users.find(u => u.email?.toLowerCase() === ownerEmail.toLowerCase());
  if (!owner) {
    throw new Error(
      `No auth user for ${ownerEmail}. Run \`npm run provision:user\` first — imported ` +
        `rows must be attributable (PRD US-18).`,
    );
  }

  console.log('\n── WRITE ──');
  console.log(`  vendor  ${VENDOR_NAME} → ${vendorId}`);
  console.log(`  owner   ${ownerEmail} → ${owner.id}`);

  // products: read-then-insert, keyed on normalized description. Deliberately
  // not an upsert — the report must distinguish created from matched.
  const {data: existingProducts, error: prodReadErr} = await db
    .from('products')
    .select('id, description, description_norm')
    .eq('vendor_id', vendorId);
  if (prodReadErr) throw prodReadErr;

  const byNorm = new Map<string, string>();
  for (const p of existingProducts ?? []) byNorm.set(p.description_norm as string, p.id as string);

  // First raw spelling wins as the stored description.
  const firstSpelling = new Map<string, string>();
  for (const l of lines) {
    const n = normalize(l.description);
    if (!firstSpelling.has(n)) firstSpelling.set(n, l.description.trim());
  }

  const toCreate = [...firstSpelling.entries()]
    .filter(([n]) => !byNorm.has(n))
    .map(([, description]) => ({vendor_id: vendorId!, description, created_by: owner.id}));

  let created = 0;
  for (let i = 0; i < toCreate.length; i += 200) {
    const chunk = toCreate.slice(i, i + 200);
    const {data, error} = await db
      .from('products')
      .insert(chunk)
      .select('id, description_norm');
    if (error) throw error;
    for (const p of data ?? []) byNorm.set(p.description_norm as string, p.id as string);
    created += data?.length ?? 0;
  }
  console.log(`  products  created ${created}, matched ${firstSpelling.size - created}, total distinct ${firstSpelling.size}`);

  if (firstSpelling.size !== EXPECTED.products) {
    console.warn(`  ⚠ expected ${EXPECTED.products} distinct products, saw ${firstSpelling.size}`);
  }

  // Optional reset, so a corrected parse can replace a bad batch without
  // hand-written SQL. Only ever touches ledger_import rows of THIS batch —
  // manual entries are untouchable from here.
  if (process.env.SEED_RESET === 'true') {
    const {error: delErr, count} = await db
      .from('price_entries')
      .delete({count: 'exact'})
      .eq('source', 'ledger_import')
      .eq('source_batch', batch);
    if (delErr) throw delErr;
    console.log(`  reset     deleted ${count} existing rows from batch "${batch}"`);
  }

  // Idempotency key is the ledger line itself: (source_batch, source_line_no).
  // One spreadsheet row = one price entry.
  //
  // It is deliberately NOT a value-based key. The 6 byte-identical repeated
  // lines in §2.6b must all be ingested — a value key would silently collapse
  // them and land 745 rows instead of 747. They were reported above for human
  // review, which is what the PRD asks for.
  //
  // Computed in-script rather than via ON CONFLICT because the DB guard is a
  // PARTIAL unique index (source='ledger_import') and PostgREST cannot target
  // a partial index for conflict inference.
  const {data: existingEntries, error: entryReadErr} = await db
    .from('price_entries')
    .select('source_line_no')
    .eq('source', 'ledger_import')
    .eq('source_batch', batch);
  if (entryReadErr) throw entryReadErr;

  const seen = new Set((existingEntries ?? []).map(e => e.source_line_no as number));

  const rowsToInsert: Array<Record<string, unknown>> = [];
  let skippedDuplicate = 0;

  for (const l of lines) {
    if (seen.has(l.sourceLineNo)) {
      skippedDuplicate++;
      continue;
    }
    rowsToInsert.push({
      product_id: byNorm.get(normalize(l.description))!,
      purchase_date: l.purchaseDate,
      unit_price: l.unitPrice,
      quantity: l.quantity,
      line_amount: l.lineAmount,
      voucher_no: l.voucherNo,
      source: 'ledger_import',
      source_batch: batch,
      source_line_no: l.sourceLineNo,
      created_by: owner.id,
    });
  }

  let inserted = 0;
  for (let i = 0; i < rowsToInsert.length; i += 500) {
    const chunk = rowsToInsert.slice(i, i + 500);
    const {error, count} = await db
      .from('price_entries')
      .insert(chunk, {count: 'exact'});
    if (error) throw error;
    inserted += count ?? chunk.length;
  }

  console.log(`  entries   inserted ${inserted}, skipped as duplicate ${skippedDuplicate}`);

  // ---- 5. verify ----------------------------------------------------------
  const [{count: productTotal}, {count: entryTotal}] = await Promise.all([
    db.from('products').select('*', {count: 'exact', head: true}),
    db.from('price_entries').select('*', {count: 'exact', head: true}),
  ]);

  console.log('\n── FINAL STATE ──');
  console.log(`  products      ${productTotal}`);
  console.log(`  price_entries ${entryTotal}`);
  console.log(
    `  ${productTotal === EXPECTED.products && entryTotal === EXPECTED.priceEntries ? '✓' : '⚠'} ` +
      `expected ${EXPECTED.products} products / ${EXPECTED.priceEntries} entries`,
  );
  console.log('\nDone.');
}

main().catch(err => {
  console.error('\n✗ seed failed');
  console.error(err);
  process.exit(1);
});
