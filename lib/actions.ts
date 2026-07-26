'use server';

import {revalidatePath} from 'next/cache';
import {createClient} from './supabase/server';
import type {IsoDate} from './types';

/**
 * Mutations run as server actions so RLS sees the caller's session and
 * `created_by`/`updated_by` are enforced by policy rather than trusted from
 * the client (PRD §4.4).
 *
 * Every failure returns a specific message — a uniqueness conflict names the
 * record it collided with. No bare "Something went wrong" (PRD §8).
 */

export type ActionResult<T = undefined> =
  | {ok: true; data: T}
  | {ok: false; error: string; conflictProductId?: string};

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

const UNIQUE_VIOLATION = '23505';

// ---------------------------------------------------------------- products

export async function createProduct(input: {
  description: string;
  vendorId: string;
  productCode?: string | null;
  notes?: string | null;
}): Promise<ActionResult<{id: string}>> {
  const description = input.description.trim();
  if (!description) return {ok: false, error: 'Description is required.'};

  const supabase = await createClient();
  const code = input.productCode?.trim() || null;

  // Pre-flight so the message can name the existing record. The unique indexes
  // are still the real guard — this is for the wording, not the correctness.
  const {data: dupeDesc} = await supabase
    .from('products')
    .select('id, description')
    .eq('vendor_id', input.vendorId)
    .eq('description_norm', normalize(description))
    .maybeSingle();

  if (dupeDesc) {
    return {
      ok: false,
      error: `"${dupeDesc.description}" already exists for this vendor.`,
      conflictProductId: dupeDesc.id,
    };
  }

  if (code) {
    const codeConflict = await findProductByCode(code);
    if (codeConflict) {
      return {
        ok: false,
        error: `Product code "${code}" is already used by "${codeConflict.description}".`,
        conflictProductId: codeConflict.id,
      };
    }
  }

  const {data, error} = await supabase
    .from('products')
    .insert({
      vendor_id: input.vendorId,
      description,
      product_code: code,
      notes: input.notes?.trim() || null,
    })
    .select('id')
    .single();

  if (error) return {ok: false, error: translate(error)};

  revalidatePath('/products');
  return {ok: true, data: {id: data.id}};
}

export async function updateProduct(input: {
  id: string;
  description?: string;
  productCode?: string | null;
  notes?: string | null;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: {user},
  } = await supabase.auth.getUser();
  if (!user) return {ok: false, error: 'Your session has expired. Sign in again.'};

  const patch: Record<string, unknown> = {updated_by: user.id};

  if (input.description !== undefined) {
    const description = input.description.trim();
    if (!description) return {ok: false, error: 'Description cannot be empty.'};

    const {data: current} = await supabase
      .from('products')
      .select('vendor_id')
      .eq('id', input.id)
      .single();

    if (current) {
      const {data: dupe} = await supabase
        .from('products')
        .select('id, description')
        .eq('vendor_id', current.vendor_id)
        .eq('description_norm', normalize(description))
        .neq('id', input.id)
        .maybeSingle();
      if (dupe) {
        return {
          ok: false,
          error: `"${dupe.description}" already exists for this vendor.`,
          conflictProductId: dupe.id,
        };
      }
    }
    patch.description = description;
  }

  if (input.productCode !== undefined) {
    const code = input.productCode?.trim() || null;
    if (code) {
      const conflict = await findProductByCode(code, input.id);
      if (conflict) {
        return {
          ok: false,
          error: `Product code "${code}" is already used by "${conflict.description}".`,
          conflictProductId: conflict.id,
        };
      }
    }
    patch.product_code = code;
  }

  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;

  const {error} = await supabase.from('products').update(patch).eq('id', input.id);
  if (error) return {ok: false, error: translate(error)};

  revalidatePath('/products');
  revalidatePath(`/products/${input.id}`);
  return {ok: true, data: undefined};
}

async function findProductByCode(code: string, excludeId?: string) {
  const supabase = await createClient();
  let query = supabase
    .from('products')
    .select('id, description, product_code')
    .not('product_code', 'is', null);
  if (excludeId) query = query.neq('id', excludeId);

  const {data} = await query;
  const target = code.trim().toUpperCase();
  return (
    (data ?? []).find(p => (p.product_code ?? '').trim().toUpperCase() === target) ??
    null
  );
}

// ------------------------------------------------------------ price entries

export async function createPriceEntry(input: {
  productId: string;
  purchaseDate: IsoDate;
  unitPrice: number;
  quantity: number;
  voucherNo?: string | null;
}): Promise<ActionResult> {
  if (!(input.unitPrice > 0)) return {ok: false, error: 'Unit price must be greater than zero.'};
  if (!(input.quantity > 0)) return {ok: false, error: 'Quantity must be greater than zero.'};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.purchaseDate))
    return {ok: false, error: 'Pick a valid purchase date.'};

  const supabase = await createClient();
  const {error} = await supabase.from('price_entries').insert({
    product_id: input.productId,
    purchase_date: input.purchaseDate,
    unit_price: input.unitPrice,
    quantity: input.quantity,
    // Recomputed, not taken from the user — line_amount is display-only for
    // imported rows, so a manual entry's value should simply be consistent.
    line_amount: Number((input.unitPrice * input.quantity).toFixed(2)),
    voucher_no: input.voucherNo?.trim() || null,
    source: 'manual',
  });

  if (error) return {ok: false, error: translate(error)};

  revalidatePath('/products');
  revalidatePath(`/products/${input.productId}`);
  return {ok: true, data: undefined};
}

export async function updatePriceEntry(input: {
  id: string;
  productId: string;
  purchaseDate: IsoDate;
  unitPrice: number;
  quantity: number;
  voucherNo?: string | null;
}): Promise<ActionResult> {
  if (!(input.unitPrice > 0)) return {ok: false, error: 'Unit price must be greater than zero.'};
  if (!(input.quantity > 0)) return {ok: false, error: 'Quantity must be greater than zero.'};

  const supabase = await createClient();
  const {error} = await supabase
    .from('price_entries')
    .update({
      purchase_date: input.purchaseDate,
      unit_price: input.unitPrice,
      quantity: input.quantity,
      line_amount: Number((input.unitPrice * input.quantity).toFixed(2)),
      voucher_no: input.voucherNo?.trim() || null,
    })
    .eq('id', input.id);

  if (error) return {ok: false, error: translate(error)};

  revalidatePath('/products');
  revalidatePath(`/products/${input.productId}`);
  return {ok: true, data: undefined};
}

export async function deletePriceEntry(input: {
  id: string;
  productId: string;
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {error} = await supabase.from('price_entries').delete().eq('id', input.id);
  if (error) return {ok: false, error: translate(error)};

  revalidatePath('/products');
  revalidatePath(`/products/${input.productId}`);
  return {ok: true, data: undefined};
}

// ---------------------------------------------------------------- errors

function translate(error: {code?: string; message: string; details?: string}): string {
  if (error.code === UNIQUE_VIOLATION) {
    const target = `${error.message} ${error.details ?? ''}`;
    if (target.includes('products_code_key'))
      return 'That product code is already in use.';
    if (target.includes('products_vendor_desc_key'))
      return 'A product with that description already exists for this vendor.';
    return 'That record already exists.';
  }
  if (error.code === '23514') {
    if (error.message.includes('unit_price')) return 'Unit price must be greater than zero.';
    if (error.message.includes('quantity')) return 'Quantity must be greater than zero.';
    if (error.message.includes('date_sane'))
      return 'Purchase date must be a real date, and not in the future.';
    if (error.message.includes('description_not_blank')) return 'Description cannot be empty.';
    return 'That value failed a validation rule.';
  }
  if (error.code === '42501')
    return 'You do not have permission to do that. Products cannot be deleted.';
  return error.message;
}
