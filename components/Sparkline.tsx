'use client';

import {Chart, line} from '@astryxdesign/charts';
import {Text} from '@astryxdesign/core/Text';
import {HStack, Stack} from '@astryxdesign/core/Layout';
import type {SparkPoint} from '@/lib/types';

const SPARK_HEIGHT = 34;
/** Matches the Price trend column width, less cell padding. */
const SPARK_WIDTH = 124;

/**
 * Compact price trend for a table row. Axes, grid, legend and tooltip are all
 * suppressed — the row's own Current price and Change % columns carry the
 * numbers, so this is purely shape.
 *
 * A single-entry product gets a dot plus a caption rather than a flat line,
 * because ~83 of 195 products have exactly one purchase and a flat line would
 * read as "price held steady" (PRD §2.8).
 */
export function Sparkline({points}: {points: SparkPoint[]}) {
  if (points.length === 0) {
    return (
      <Text type="supporting" color="secondary">
        —
      </Text>
    );
  }

  if (points.length === 1) {
    return (
      <HStack gap={1} vAlign="center" height={SPARK_HEIGHT}>
        <Text type="supporting" color="secondary">
          single purchase
        </Text>
      </HStack>
    );
  }

  // The chart's x is the point index, not the date: a sparkline shows sequence,
  // and irregular purchase gaps would otherwise crush most points against one
  // edge at this width.
  const data = points.map((pt, i) => ({i, price: pt.p}));

  return (
    // Chart sizes itself from its container via ResizeObserver and has no
    // `width` prop. Inside a table cell it measures wider than the column and
    // spills past the table's right edge, so the width is pinned here.
    <Stack width={SPARK_WIDTH} height={SPARK_HEIGHT} style={{overflow: 'hidden'}}>
      <Chart
        data={data}
        xKey="i"
        series={[line('price', {curve: 'monotone', strokeWidth: 1.5})]}
        height={SPARK_HEIGHT}
        margin={{left: 2, right: 2, top: 4, bottom: 4}}
        // 'data' baseline, not zero: the movements that matter here are 5-20%,
        // and a zero baseline flattens them into a straight line (PRD §9.4).
        yBaseline="data"
      />
    </Stack>
  );
}
