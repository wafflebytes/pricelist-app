'use client';

import {useState} from 'react';
import {useRouter} from 'next/navigation';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Selector} from '@astryxdesign/core/Selector';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {HStack, VStack, StackItem} from '@astryxdesign/core/Layout';
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
  onSaved,
}: {
  /** Always true in practice: the parent mounts this only while open. */
  isOpen: boolean;
  onClose: () => void;
  vendors: Vendor[];
  /** Omitted for create. */
  product?: Pick<Product, 'id' | 'description' | 'product_code' | 'notes' | 'vendor_id'>;
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
            />

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
