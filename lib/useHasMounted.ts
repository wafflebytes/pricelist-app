'use client';

import {useSyncExternalStore} from 'react';

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * `false` during SSR and the hydration pass, `true` afterwards.
 *
 * Needed for anything derived from "now". Vercel runs the server in UTC while
 * staff browsers are in IST, so for 5.5 hours a day the two are on different
 * calendar days and a relative label like "3 days ago" renders differently on
 * each side — a text hydration mismatch (React #418).
 *
 * Implemented with useSyncExternalStore rather than an effect so there is no
 * setState-in-effect and no extra render pass.
 */
export function useHasMounted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
