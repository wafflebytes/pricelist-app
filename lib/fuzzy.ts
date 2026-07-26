/**
 * Fuzzy matching for the product search box and the add-product duplicate hint.
 *
 * IMPORTANT: this is a *presentation* concern only. Product identity is still
 * exact-match on the normalized description (PRD §2.5) — the 112 near-identical
 * description pairs in the Signify export are genuinely different SKUs, so
 * nothing here may ever merge records. Fuzzy matching only decides what to show
 * a human and in what order; the human still chooses.
 *
 * Signify descriptions are dense spec strings — `RC370B LED36S-6500 G6 L60W60
 * PSU OD V3 BLOCK` — with inconsistent spacing (`BN 021` vs `BN021C`) and
 * punctuation. So matching:
 *   - is case- and punctuation-insensitive
 *   - matches query tokens in any order (`282 bvp` finds `BVP282 …`)
 *   - falls back to a subsequence scan, so `rc370` finds `RC 370B`
 */

/** Strip everything but alphanumerics — makes `BN 021` and `BN021` comparable. */
function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Is `needle` a subsequence of `haystack`? Both should be squashed. */
function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

/**
 * 0 = no match. Higher is better.
 *
 * Scoring is ordered so the obvious answer wins: an exact hit beats a prefix,
 * which beats a substring, which beats scattered-token, which beats a loose
 * subsequence.
 */
export function fuzzyScore(query: string, target: string): number {
  const q = squash(query);
  if (!q) return 1;
  const t = squash(target);
  if (!t) return 0;

  if (t === q) return 1000;
  if (t.startsWith(q)) return 900 - (t.length - q.length) * 0.1;

  const at = t.indexOf(q);
  if (at >= 0) return 800 - at - (t.length - q.length) * 0.05;

  // Every query token must appear somewhere. Handles reordered input and
  // multi-term queries like "bvp282 100w".
  const qt = tokens(query);
  const tt = tokens(target).map(squash);
  if (qt.length > 1) {
    const all = qt.every(token => {
      const s = squash(token);
      return s === '' || tt.some(word => word.includes(s)) || t.includes(s);
    });
    if (all) return 600 - t.length * 0.05;
  }

  if (isSubsequence(q, t)) return 300 - t.length * 0.05;

  return 0;
}

/** Best score across several fields, e.g. description + product code. */
export function fuzzyScoreAny(query: string, targets: Array<string | null | undefined>): number {
  let best = 0;
  for (const target of targets) {
    if (!target) continue;
    const score = fuzzyScore(query, target);
    if (score > best) best = score;
  }
  return best;
}

/** Rank and filter, dropping non-matches. Stable for equal scores. */
export function fuzzyRank<T>(
  query: string,
  items: T[],
  getFields: (item: T) => Array<string | null | undefined>,
  limit?: number,
): T[] {
  if (!query.trim()) return limit ? items.slice(0, limit) : items;

  const scored = items
    .map((item, index) => ({item, index, score: fuzzyScoreAny(query, getFields(item))}))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(entry => entry.item);

  return limit ? scored.slice(0, limit) : scored;
}

/**
 * Similarity of two full strings, 0..1 — used to decide whether a
 * being-typed description looks like one that already exists.
 *
 * Dice coefficient over character bigrams: cheap, order-tolerant, and it does
 * not reward length the way a raw edit distance does.
 */
export function similarity(a: string, b: string): number {
  const x = squash(a);
  const y = squash(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    bigrams.set(g, (bigrams.get(g) ?? 0) + 1);
  }

  let hits = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const count = bigrams.get(g) ?? 0;
    if (count > 0) {
      bigrams.set(g, count - 1);
      hits++;
    }
  }

  return (2 * hits) / (x.length - 1 + y.length - 1);
}
