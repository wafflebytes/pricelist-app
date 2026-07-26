import type {Metadata} from 'next';
import './globals.css';
import {Providers} from './providers';

export const metadata: Metadata = {
  title: 'Aalino Price List',
  description:
    'Internal price list and vendor price history for Aalino India Pvt. Ltd.',
};

export default function RootLayout({
  children,
}: Readonly<{children: React.ReactNode}>) {
  return (
    // data-theme is set server-side so browser chrome (scrollbars, native
    // pickers) is correct before hydration. Light mode only (PRD §6).
    // theme-neutral uses system fonts, so no next/font loading is needed.
    <html lang="en" data-theme="light">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
