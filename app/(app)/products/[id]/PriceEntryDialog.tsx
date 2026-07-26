'use client';

import {useState} from 'react';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {TextInput} from '@astryxdesign/core/TextInput';
import {DateInput} from '@astryxdesign/core/DateInput';
import type {ISODateString} from '@astryxdesign/core/Calendar';
import {Button} from '@astryxdesign/core/Button';
import {Banner} from '@astryxdesign/core/Banner';
import {Text} from '@astryxdesign/core/Text';
import {HStack, VStack, StackItem} from '@astryxdesign/core/Layout';
import type {ProductEntryRow} from '@/lib/types';
import {createPriceEntry, updatePriceEntry} from '@/lib/actions';
import {inr, todayIso} from '@/lib/format';

/** Add or edit a single price entry (PRD US-16 / US-17). */
export function PriceEntryDialog({
  isOpen,
  productId,
  entry,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  productId: string;
  entry?: ProductEntryRow;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const isEdit = Boolean(entry);

  const [purchaseDate, setPurchaseDate] = useState<ISODateString | undefined>(
    (entry?.purchase_date.slice(0, 10) ?? todayIso()) as ISODateString,
  );
  const [unitPrice, setUnitPrice] = useState(
    entry ? String(Number(entry.unit_price)) : '',
  );
  const [quantity, setQuantity] = useState(
    entry ? String(Number(entry.quantity)) : '',
  );
  const [voucherNo, setVoucherNo] = useState(entry?.voucher_no ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const price = Number(unitPrice);
  const qtyNum = Number(quantity);
  const isValid =
    Boolean(purchaseDate) &&
    Number.isFinite(price) &&
    price > 0 &&
    Number.isFinite(qtyNum) &&
    qtyNum > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!purchaseDate) return;
    setError(null);
    setIsSaving(true);

    const payload = {
      productId,
      purchaseDate,
      unitPrice: price,
      quantity: qtyNum,
      voucherNo: voucherNo.trim() || null,
    };

    const result = isEdit
      ? await updatePriceEntry({...payload, id: entry!.id})
      : await createPriceEntry(payload);

    setIsSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await onSaved();
  }

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={open => !open && onClose()}
      // purpose="info" so clicking the backdrop closes the dialog, matching
      // Escape. "form" deliberately blocks backdrop dismissal after any
      // interaction to protect typed input — accepted trade-off: dismissal
      // consistency was the explicit ask.
      purpose="info"
      width={480}
    >
      <DialogHeader
        title={isEdit ? 'Edit price entry' : 'Add price entry'}
        subtitle={
          isEdit && entry?.source === 'ledger_import'
            ? 'This entry came from a vendor ledger import.'
            : undefined
        }
      />
      <form onSubmit={handleSubmit} noValidate>
        <VStack gap={4}>
          <FormLayout>
            {error ? <Banner status="error" title={error} /> : null}

            <DateInput
              label="Purchase date"
              value={purchaseDate}
              onChange={setPurchaseDate}
              max={todayIso() as ISODateString}
              isRequired
            />
            <TextInput
              label="Unit price (₹)"
              value={unitPrice}
              onChange={setUnitPrice}
              placeholder="e.g. 1050"
              isRequired
              status={
                unitPrice !== '' && !(price > 0)
                  ? {type: 'error', message: 'Enter a number greater than zero.'}
                  : undefined
              }
            />
            <TextInput
              label="Quantity"
              value={quantity}
              onChange={setQuantity}
              placeholder="e.g. 40"
              isRequired
              status={
                quantity !== '' && !(qtyNum > 0)
                  ? {type: 'error', message: 'Enter a number greater than zero.'}
                  : undefined
              }
            />
            <TextInput
              label="Voucher no."
              value={voucherNo}
              onChange={setVoucherNo}
              placeholder="e.g. MH0010162259"
              isOptional
            />

            {isValid ? (
              <Text type="supporting">
                Line amount will be recorded as {inr(price * qtyNum)}.
              </Text>
            ) : null}
          </FormLayout>

          <HStack gap={2}>
            <StackItem size="fill" />
            <Button label="Cancel" variant="ghost" onClick={onClose} />
            <Button
              type="submit"
              label={isEdit ? 'Save entry' : 'Add entry'}
              variant="primary"
              isLoading={isSaving}
              isDisabled={!isValid}
            />
          </HStack>
        </VStack>
      </form>
    </Dialog>
  );
}
