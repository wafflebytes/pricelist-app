/**
 * provision-user.ts — creates the first invite-only account.
 *
 * The app has no signup route (PRD US-1). Accounts are provisioned here or in
 * the Supabase dashboard.
 *
 *   SEED_OWNER_EMAIL=sales@aalino.com SEED_OWNER_PASSWORD=... npm run provision:user
 */
import {createClient} from '@supabase/supabase-js';

async function main() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const email = process.env.SEED_OWNER_EMAIL ?? 'sales@aalino.com';
  const password = process.env.SEED_OWNER_PASSWORD;

  if (!url || !secret) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY are not set.');
  if (!password) throw new Error('SEED_OWNER_PASSWORD is not set.');

  const db = createClient(url, secret, {auth: {persistSession: false}});

  const {data: list, error: listErr} = await db.auth.admin.listUsers({perPage: 1000});
  if (listErr) throw listErr;

  const existing = list.users.find(u => u.email?.toLowerCase() === email.toLowerCase());

  if (existing) {
    const {error} = await db.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (error) throw error;
    console.log(`✓ ${email} already existed — password reset. id=${existing.id}`);
    return;
  }

  const {data, error} = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  console.log(`✓ created ${email}  id=${data.user.id}`);
  console.log('\nReminder: disable public signups in Supabase → Authentication → Sign In / Providers');
  console.log('("Allow new users to sign up" off). The app has no signup route, but the');
  console.log('Auth API endpoint stays open until that toggle is flipped (PRD §10).');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
