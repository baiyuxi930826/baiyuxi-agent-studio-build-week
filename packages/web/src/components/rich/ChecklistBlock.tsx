'use client';

import type { RichChecklistBlock } from '@/stores/chat-types';
import { StudioIcon } from './StudioIcons';

export function ChecklistBlock({ block }: { block: RichChecklistBlock }) {
  const items = Array.isArray(block.items) ? block.items : [];
  return (
    <div className="rounded-lg border border-studio p-3">
      {block.title && <div className="font-medium text-sm mb-2">{block.title}</div>}
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-sm">
            <StudioIcon
              name={item.checked ? 'check-square' : 'square'}
              className={`mt-0.5 h-4 w-4 shrink-0 ${item.checked ? 'text-studio-muted' : 'text-studio-secondary'}`}
            />
            <span className={item.checked ? 'line-through text-studio-muted' : ''}>{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
