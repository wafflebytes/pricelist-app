'use client';

import {Theme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import type {ReactNode} from 'react';

/**
 * Astryx theme provider. mode="light" is pinned — the app is light mode only
 * (PRD §6), so it must not follow the OS preference.
 */
export function Providers({children}: {children: ReactNode}) {
  return (
    <Theme theme={neutralTheme} mode="light">
      {children}
    </Theme>
  );
}
