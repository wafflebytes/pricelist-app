'use client';

import {List} from '@astryxdesign/core/List';
import {Item} from '@astryxdesign/core/Item';
import {Text} from '@astryxdesign/core/Text';
import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {PencilSquareIcon, TrashIcon} from '@heroicons/react/24/outline';
import type {ProductEntryRow} from '@/lib/types';
import {inr, qty, formatDate} from '@/lib/format';

/**
 * Narrow-viewport presentation of a product's purchase entries.
 *
 * The desktop table has eight columns including two icon actions; at 390px that
 * becomes unreadable. Here each entry is one row: date and price lead, the
 * supporting figures sit underneath, and the actions stay reachable at the end.
 */
export function EntryRows({
  entries,
  onEdit,
  onDelete,
}: {
  entries: ProductEntryRow[];
  onEdit: (entry: ProductEntryRow) => void;
  onDelete: (entry: ProductEntryRow) => void;
}) {
  return (
    <List hasDividers density="spacious">
      {entries.map(entry => (
        <Item
          key={entry.id}
          as="li"
          align="start"
          label={
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Text type="body" weight="semibold" hasTabularNumbers>
                {inr(Number(entry.unit_price))}
              </Text>
              <Text type="body" color="secondary">
                {formatDate(entry.purchase_date)}
              </Text>
              <Badge
                variant={entry.source === 'manual' ? 'info' : 'neutral'}
                label={entry.source === 'manual' ? 'Manual' : 'Imported'}
              />
            </HStack>
          }
          description={
            <VStack gap={0.5}>
              <Text type="supporting" color="secondary">
                Qty {qty(Number(entry.quantity))}
                {entry.line_amount === null
                  ? ''
                  : ` · ${inr(Number(entry.line_amount))}`}
                {entry.voucher_no ? ` · ${entry.voucher_no}` : ''}
              </Text>
              <Text type="supporting" color="secondary">
                {entry.created_by_email ?? 'Unknown'}
              </Text>
            </VStack>
          }
          endContent={
            <HStack gap={1}>
              <Button
                label="Edit entry"
                isIconOnly
                variant="ghost"
                size="sm"
                icon={<PencilSquareIcon width={16} height={16} />}
                onClick={() => onEdit(entry)}
              />
              <Button
                label="Delete entry"
                isIconOnly
                variant="ghost"
                size="sm"
                icon={<TrashIcon width={16} height={16} />}
                onClick={() => onDelete(entry)}
              />
            </HStack>
          }
        />
      ))}
    </List>
  );
}
