import type {Metadata} from 'next';
import {LoginForm} from './LoginForm';

export const metadata: Metadata = {title: 'Sign in · Aalino Price List'};

/**
 * The only unauthenticated route.
 *
 * There is deliberately no signup route anywhere in this app (PRD US-1) —
 * accounts are provisioned by an admin.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{next?: string}>;
}) {
  const {next} = await searchParams;
  return <LoginForm next={next} />;
}
