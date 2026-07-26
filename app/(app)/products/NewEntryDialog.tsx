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
import {Badge} from '@astryxdesign/core/Badge';
import {HStack, VStack, StackItem} from '@astryxdesign/core/Layout';
import type {ProductSummary} from '@/lib/types';
import {createPriceEntry} from '@/lib/actions';
import {inr, pct, formatDate, todayIso} from '@/lib/format';
import {ProductPicker, type ProductOption} from '@/components/ProductPicker';

/**
 * The app's primary action: record what we just paid for something.
 *
 * Recording prices is the daily job — creating a product is a rare
 * consequence of it — so this is the main button on the products page and
 * "Add product" is secondary.
 *
 * Flow: pick the product from a fuzzy dropdown, then price, qty, date. The
 * picked product's last price is shown inline so an obvious fat-finger
 * (₹10,500 where the last five purchases were ₹1,050) is visible before saving.
 */
export function NewEntryDialog({
  isOpen,
  products,
  onClose,
  onSaved,
  onCreateProduct,
}: {
  isOpen: boolean;
  products: ProductSummary[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  /** Escape hatch when the product genuinely does not exist yet. */
  onCreateProduct: () => void;
}) {
  const [selected, setSelected] = useState<ProductOption | null>(null);
  const [purchaseDate, setPurchaseDate] = useState<ISODateString | undefined>(
    todayIso() as ISODateString,
  );
  const [unitPrice, setUnitPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [voucherNo, setVoucherNo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const product = selected?.auxiliaryData;
  const price = Number(unitPrice);
  const qtyNum = Number(quantity);
  const isValid =
    Boolean(selected) &&
    Boolean(purchaseDate) &&
    Number.isFinite(price) &&
    price > 0 &&
    Number.isFinite(qtyNum) &&
    qtyNum > 0;

  // Advisory only — a real 5x price move is possible, so this warns and never blocks.
  const last = product?.current_price ?? null;
  const swing =
    last && price > 0 ? ((price - Number(last)) / Number(last)) * 100 : null;
  const looksOff = swing !== null && Math.abs(swing) >= 50;

  async function submit(keepOpen: boolean) {
    if (!selected || !purchaseDate) return;
    setError(null);
    setIsSaving(true);

    const result = await createPriceEntry({
      productId: selected.id,
      purchaseDate,
      unitPrice: price,
      quantity: qtyNum,
      voucherNo: voucherNo.trim() || null,
    });

    setIsSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    await onSaved();

    if (keepOpen) {
      // Ledger drops arrive in batches, so "save and add another" keeps the
      // date and voucher (usually shared across a voucher's lines) and clears
      // only what changes per line.
      setSavedNotice(`Saved ${inr(price)} for ${selected.label}.`);
      setSelected(null);
      setUnitPrice('');
      setQuantity('');
    } else {
      onClose();
    }
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
      width={560}
    >
      <DialogHeader
        title="New price entry"
        subtitle="Record what was paid for a product on a given date."
      />
      <form
        onSubmit={e => {
          e.preventDefault();
          void submit(false);
        }}
        noValidate
      >
        <VStack gap={4}>
          <FormLayout>
            {error ? <Banner status="error" title={error} /> : null}
            {savedNotice ? (
              <Banner
                status="success"
                title={savedNotice}
                isDismissable
                onDismiss={() => setSavedNotice(null)}
              />
            ) : null}

            <ProductPicker
              products={products}
              value={selected}
              onChange={option => {
                setSelected(option);
                setSavedNotice(null);
              }}
              isRequired
            />

            {product ? (
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Text type="supporting">
                  Last paid {inr(product.current_price)} on{' '}
                  {formatDate(product.last_purchase_date)}
                </Text>
                {product.change_pct === null ? null : (
                  <Badge
                    variant={
                      product.change_pct > 0.05
                        ? 'warning'
                        : product.change_pct < -0.05
                          ? 'success'
                          : 'neutral'
                    }
                    label={`${pct(product.change_pct)} lifetime`}
                  />
                )}
              </HStack>
            ) : (
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Text type="supporting" color="secondary">
                  Not in the list?
                </Text>
                <Button
                  label="Add a new product"
                  variant="ghost"
                  size="sm"
                  onClick={onCreateProduct}
                />
              </HStack>
            )}

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
                  : looksOff
                    ? {
                        type: 'warning',
                        message: `That is ${pct(swing)} against the last price — double-check it.`,
                      }
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
              description="Kept when you save and add another — voucher lines usually share one."
              isOptional
            />

            {isValid ? (
              <Text type="supporting">
                Line amount will be recorded as {inr(price * qtyNum)}.
              </Text>
            ) : null}
          </FormLayout>

          <HStack gap={2} wrap="wrap">
            <StackItem size="fill" />
            <Button label="Cancel" variant="ghost" onClick={onClose} />
            <Button
              label="Save and add another"
              variant="secondary"
              isDisabled={!isValid || isSaving}
              onClick={() => void submit(true)}
            />
            <Button
              type="submit"
              label="Save entry"
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
