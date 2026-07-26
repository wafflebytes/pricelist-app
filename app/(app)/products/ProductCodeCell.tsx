'use client';

import {useState} from 'react';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Button} from '@astryxdesign/core/Button';
import {Text} from '@astryxdesign/core/Text';
import {HStack} from '@astryxdesign/core/Layout';
import {updateProduct} from '@/lib/actions';

/**
 * Inline-editable product code.
 *
 * This is inline rather than dialog-only because assigning codes is the main
 * data-entry chore the app creates — no code exists anywhere in the source
 * ledger (PRD §2.7), so all 195 start empty and someone has to work through
 * them. Everything else about a product edits via the dialog.
 */
export function ProductCodeCell({
  productId,
  code,
  onSaved,
  onError,
}: {
  productId: string;
  code: string | null;
  onSaved: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(code ?? '');
  const [isSaving, setIsSaving] = useState(false);

  async function commit() {
    const next = draft.trim();
    if (next === (code ?? '')) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    const result = await updateProduct({id: productId, productCode: next || null});
    setIsSaving(false);

    if (!result.ok) {
      onError(result.error);
      setDraft(code ?? '');
      return;
    }
    setIsEditing(false);
    await onSaved();
  }

  if (!isEditing) {
    return code ? (
      <Button
        label={code}
        variant="ghost"
        size="sm"
        tooltip="Edit product code"
        onClick={() => {
          setDraft(code);
          setIsEditing(true);
        }}
      />
    ) : (
      // Empty renders as an affordance, not a blank cell — an uncoded product
      // is a to-do item.
      <Button
        label="Add code"
        variant="ghost"
        size="sm"
        tooltip="No product code set"
        onClick={() => {
          setDraft('');
          setIsEditing(true);
        }}
      />
    );
  }

  return (
    <HStack gap={1} vAlign="center">
      <TextInput
        label="Product code"
        isLabelHidden
        size="sm"
        value={draft}
        onChange={setDraft}
        placeholder="e.g. AAL-0001"
        isLoading={isSaving}
        hasAutoFocus
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'Enter') void commit();
          if (e.key === 'Escape') {
            setDraft(code ?? '');
            setIsEditing(false);
          }
        }}
        onBlur={() => void commit()}
      />
      {isSaving ? (
        <Text type="supporting" color="secondary">
          saving…
        </Text>
      ) : null}
    </HStack>
  );
}
