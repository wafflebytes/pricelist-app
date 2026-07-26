'use client';

import {useMemo, useState} from 'react';
import {useRouter} from 'next/navigation';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Selector} from '@astryxdesign/core/Selector';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {HStack, VStack, StackItem} from '@astryxdesign/core/Layout';
import {Text} from '@astryxdesign/core/Text';
import {List} from '@astryxdesign/core/List';
import {Item} from '@astryxdesign/core/Item';
import {fuzzyRank, similarity} from '@/lib/fuzzy';
import type {Product, Vendor} from '@/lib/types';
import {createProduct, updateProduct} from '@/lib/actions';

/**
 * Add / edit a product. Used from the main table (create) and the detail
 * header (edit).
 *
 * Mounted only while open, so `useState` initialisers are the reset — no
 * sync-state-in-effect, and a dismissed dialog can never reopen with stale
 * input.
 *
 * A duplicate description or product code is reported by name, with a link to
 * the record it collided with (PRD US-14 / US-15) — not as a generic error.
 */
export function ProductDialog({
  isOpen,
  onClose,
  vendors,
  product,
  existing = [],
  onSaved,
}: {
  /** Always true in practice: the parent mounts this only while open. */
  isOpen: boolean;
  onClose: () => void;
  vendors: Vendor[];
  /** Omitted for create. */
  product?: Pick<Product, 'id' | 'description' | 'product_code' | 'notes' | 'vendor_id'>;
  /**
   * Existing products, used only to suggest matches while typing. Never used to
   * merge anything — identity stays exact-match (PRD §2.5).
   */
  existing?: Array<{id: string; description: string; product_code: string | null}>;
  onSaved: (createdId?: string) => void | Promise<void>;
}) {
  const router = useRouter();
  const isEdit = Boolean(product);

  const [description, setDescription] = useState(product?.description ?? '');
  const [productCode, setProductCode] = useState(product?.product_code ?? '');
  const [notes, setNotes] = useState(product?.notes ?? '');
  const [vendorId, setVendorId] = useState(product?.vendor_id ?? vendors[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [conflictId, setConflictId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Live fuzzy suggestions as the description is typed. Two jobs: stop someone
  // re-adding a product that already exists, and save them typing a 45-character
  // spec string when they only meant to find it.
  const suggestions = useMemo(() => {
    const query = description.trim();
    if (query.length < 2) return [];
    return fuzzyRank(
      query,
      existing.filter(e => e.id !== product?.id),
      e => [e.description, e.product_code],
      5,
    ).map(e => ({...e, similarity: similarity(query, e.description)}));
  }, [description, existing, product?.id]);

  // A very close match is worth a louder warning than a merely related one —
  // but it is still only advice. Near-identical Signify descriptions are
  // frequently different SKUs (wattage/CCT variants), so the user decides.
  const closest = suggestions[0];
  const looksLikeDuplicate = closest !== undefined && closest.similarity >= 0.8;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setConflictId(null);
    setIsSaving(true);

    const result = isEdit
      ? await updateProduct({
          id: product!.id,
          description,
          productCode: productCode.trim() || null,
          notes,
        })
      : await createProduct({
          description,
          vendorId,
          productCode: productCode.trim() || null,
          notes,
        });

    setIsSaving(false);

    if (!result.ok) {
      setError(result.error);
      setConflictId(result.conflictProductId ?? null);
      return;
    }

    onClose();
    await onSaved(isEdit ? undefined : (result.data as {id: string} | undefined)?.id);
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={open => !open && onClose()} purpose="form" width={520}>
      <DialogHeader
        title={isEdit ? 'Edit product' : 'Add product'}
        subtitle={
          isEdit
            ? 'Purchase history is not affected by these changes.'
            : 'Price entries are added afterwards, from the product page.'
        }
      />
      <form onSubmit={handleSubmit} noValidate>
        <VStack gap={4}>
          <FormLayout>
            {error ? (
              <Banner
                status="error"
                title={error}
                endContent={
                  conflictId ? (
                    <Button
                      label="View it"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        onClose();
                        router.push(`/products/${conflictId}`);
                      }}
                    />
                  ) : undefined
                }
              />
            ) : null}

            <TextInput
              label="Description"
              value={description}
              onChange={setDescription}
              placeholder="e.g. RC370B LED36S-6500 G6 L60W60 PSU OD V3"
              description="Exactly as the vendor words it. Near-identical descriptions are different SKUs and are kept separate."
              isRequired
              status={
                looksLikeDuplicate
                  ? {
                      type: 'warning',
                      message: 'Very similar to an existing product — check the matches below.',
                    }
                  : undefined
              }
            />

            {suggestions.length > 0 ? (
              <VStack gap={1}>
                <Text type="supporting">
                  {looksLikeDuplicate
                    ? 'Did you mean one of these?'
                    : 'Existing products that look similar'}
                </Text>
                <List hasDividers density="compact">
                  {suggestions.map(match => (
                    <Item
                      key={match.id}
                      as="li"
                      label={match.description}
                      labelLines={2}
                      description={match.product_code ?? 'No product code'}
                      onClick={() => {
                        onClose();
                        router.push(`/products/${match.id}`);
                      }}
                    />
                  ))}
                </List>
                <Text type="supporting" color="secondary">
                  Different wattage or colour temperature means a different
                  product — add it as new if none of these are it.
                </Text>
              </VStack>
            ) : null}

            {/* The vendor field is modelled and stored, never hardcoded. It is
                a single-option Selector today and becomes a real choice the
                moment a second vendor exists (PRD §9.7). */}
            <Selector
              label="Vendor"
              options={vendors.map(v => ({value: v.id, label: v.display_name}))}
              value={vendorId}
              onChange={value => setVendorId(value)}
              isDisabled={isEdit || vendors.length <= 1}
              disabledMessage={
                isEdit
                  ? 'A product cannot be moved between vendors.'
                  : 'Only one vendor exists so far.'
              }
            />

            <TextInput
              label="Product code"
              value={productCode}
              onChange={setProductCode}
              placeholder="e.g. AAL-0001"
              description="Aalino-internal. Optional, but must be unique when set."
              isOptional
            />

            <TextInput
              label="Notes"
              value={notes}
              onChange={setNotes}
              isOptional
            />
          </FormLayout>

          <HStack gap={2}>
            <StackItem size="fill" />
            <Button label="Cancel" variant="ghost" onClick={onClose} />
            <Button
              type="submit"
              label={isEdit ? 'Save changes' : 'Add product'}
              variant="primary"
              isLoading={isSaving}
              isDisabled={!description.trim() || !vendorId}
            />
          </HStack>
        </VStack>
      </form>
    </Dialog>
  );
}
