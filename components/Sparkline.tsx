import {Text} from '@astryxdesign/core/Text';
import type {SparkPoint} from '@/lib/types';

const W = 112;
const H = 28;
const PAD = 3;

/**
 * Compact price trend for a table row.
 *
 * Deliberately hand-rolled SVG rather than `<Chart>` from @astryxdesign/charts.
 * The PRD sanctioned this fallback after measurement, and measurement said to
 * take it: Chart sizes itself with a ResizeObserver and exposes no `width`
 * prop, so 50 of them per page meant 50 observers thrashing layout during
 * scroll, and inside a table cell each one measured wider than its column and
 * spilled past the table's right edge.
 *
 * This version has a fixed viewBox, no measurement, no effects, and renders
 * during SSR. Colour comes from theme tokens — no hardcoded hex.
 *
 * A single-entry product gets a caption instead of a line: 83 of 195 products
 * have exactly one purchase, and a flat line would read as "price held steady"
 * when the truth is "we only ever bought this once".
 */
export function Sparkline({points, label}: {points: SparkPoint[]; label?: string}) {
  if (points.length === 0) {
    return (
      <Text type="supporting" color="secondary">
        —
      </Text>
    );
  }

  if (points.length === 1) {
    return (
      <Text type="supporting" color="secondary">
        single purchase
      </Text>
    );
  }

  const prices = points.map(p => Number(p.p));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // Flat series would divide by zero; render it as a centred line.
  const span = max - min || 1;

  const stepX = (W - PAD * 2) / (points.length - 1);
  const coords = prices.map((price, i) => {
    const x = PAD + i * stepX;
    const y = max === min
      ? H / 2
      : PAD + (1 - (price - min) / span) * (H - PAD * 2);
    return [x, y] as const;
  });

  const d = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lastX, lastY] = coords[coords.length - 1];
  const rising = prices[prices.length - 1] > prices[0];

  // A rising cost is what warrants attention; a falling one is good news.
  // Matches the Change badge's warning/success tones on the same row.
  const stroke = rising ? 'var(--color-text-orange)' : 'var(--color-text-green)';

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={
        label ??
        `Price trend across ${points.length} purchases, ${rising ? 'rising' : 'falling'} overall`
      }
      style={{display: 'block', overflow: 'visible'}}
    >
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Marks the latest price, so the eye lands on "where we are now". */}
      <circle cx={lastX} cy={lastY} r={2} fill={stroke} />
    </svg>
  );
}
