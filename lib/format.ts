import type {IsoDate} from './types';

/**
 * INR with Indian digit grouping (₹1,20,000). Decimals shown only when
 * non-zero (PRD §8) — no export in the Signify batch has paise, so forcing
 * ".00" everywhere would be noise.
 */
export function inr(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const hasPaise = Math.abs(value % 1) > 0.001;
  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

/** Plain number with Indian grouping — quantities. */
export function qty(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const hasFraction = Math.abs(value % 1) > 0.001;
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  });
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * 'YYYY-MM-DD' → '05 Apr 2024'.
 *
 * Deliberately string surgery, not `new Date()`. A purchase_date is a calendar
 * date; constructing a Date parses it as UTC midnight and formatting in a
 * behind-UTC timezone would show the previous day.
 */
export function formatDate(iso: IsoDate | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  const month = MONTHS[Number(m) - 1];
  if (!month) return iso;
  return `${d} ${month} ${y}`;
}

/** '05 Apr 2024, 14:32' — for created_at timestamps, which are real instants. */
export function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  const dt = new Date(ts);
  if (Number.isNaN(dt.getTime())) return ts;
  return `${formatDate(
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
      dt.getDate(),
    ).padStart(2, '0')}`,
  )}, ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

/** Whole days between an ISO date and today, using calendar arithmetic only. */
export function daysSince(iso: IsoDate | null | undefined): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const then = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - then) / 86_400_000);
}

/** '3 months ago' — the hover hint on Last purchased (PRD §6.2). */
export function relativeDays(iso: IsoDate | null | undefined): string {
  const days = daysSince(iso);
  if (days === null) return '—';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(days / 365);
  const rem = Math.round((days % 365) / 30);
  return rem > 0
    ? `${years}y ${rem}m ago`
    : `${years} year${years === 1 ? '' : 's'} ago`;
}

/** Signed percentage, e.g. '+28.6%'. */
export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

/** Today as 'YYYY-MM-DD' in local time — the default for a new price entry. */
export function todayIso(): IsoDate {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(
    n.getDate(),
  ).padStart(2, '0')}`;
}

export const STALE_DAYS = 180;
